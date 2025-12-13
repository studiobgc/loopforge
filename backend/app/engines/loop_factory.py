import librosa
import numpy as np
import soundfile as sf
from pathlib import Path
from typing import List, Dict, Optional
from pedalboard import Pedalboard, Chorus, Reverb, Distortion, Limiter, Compressor, Delay, HighpassFilter, LowpassFilter, Gain, PitchShift, Bitcrush
from .structure_engine import StructureEngine
from .vocal_saliency import VocalSaliency
import matplotlib.pyplot as plt
import io
import base64

class LoopFactory:
    def __init__(self):
        self.sr = 44100

    def load_audio(self, path: Path):
        from app.engines.torch_utils import load_audio
        # Load to GPU, convert to numpy for librosa compatibility (for now)
        tensor = load_audio(str(path), sr=self.sr)
        y = tensor.cpu().numpy()
        
        # Ensure stereo [2, N]
        if y.ndim == 1:
            y = np.stack([y, y])
        elif y.shape[0] > 2:
            y = y[:2]
            
        return y, self.sr

    def _get_transients(self, y_mono, sr):
        onset_env = librosa.onset.onset_strength(y=y_mono, sr=sr)
        onsets = librosa.onset.onset_detect(
            onset_envelope=onset_env, 
            sr=sr, 
            units='samples',
            backtrack=True,
            pre_max=20,
            post_max=20,
            pre_avg=100,
            post_avg=100,
            delta=0.2,
            wait=10
        )
        return onsets

    def _consensus_beat_tracking(self, y_mono, sr, master_bpm=None):
        # If master_bpm is provided, we constrain the search
        if master_bpm:
            tempo, beat_frames = librosa.beat.beat_track(y=y_mono, sr=sr, start_bpm=master_bpm, tightness=100)
        else:
            tempo, beat_frames = librosa.beat.beat_track(y=y_mono, sr=sr)
        
        beat_times = librosa.frames_to_time(beat_frames, sr=sr)
        beat_samples = librosa.frames_to_samples(beat_frames)
        return tempo, beat_samples

    def analyze_for_visualization(self, audio_path: Path, role: str) -> Dict:
        """
        Generate analysis data for frontend visualization (Spectrogram, etc.)
        """
        y, sr = self.load_audio(audio_path)
        y_mono = librosa.to_mono(y)
        
        # Spectrogram
        S = librosa.feature.melspectrogram(y=y_mono, sr=sr, n_mels=128)
        S_dB = librosa.power_to_db(S, ref=np.max)
        
        plt.figure(figsize=(10, 4))
        librosa.display.specshow(S_dB, sr=sr, x_axis='time', y_axis='mel', cmap='magma')
        plt.axis('off')
        plt.tight_layout(pad=0)
        
        buf = io.BytesIO()
        plt.savefig(buf, format='png', bbox_inches='tight', pad_inches=0)
        plt.close()
        buf.seek(0)
        img_str = base64.b64encode(buf.read()).decode('utf-8')
        
        return {
            "spectrogram_b64": img_str,
            "duration": librosa.get_duration(y=y_mono, sr=sr)
        }

    def process(self, audio_path: Path, output_dir: Path, role: str, master_bpm: Optional[float] = None, target_key: Optional[str] = None) -> List[Dict]:
        """
        Intelligently extracts loops from a stem based on its role.
        Enforces strict grid alignment if master_bpm is provided (Anchor Mode).
        """
        y, sr = self.load_audio(audio_path)
        y_mono = librosa.to_mono(y)
        duration = librosa.get_duration(y=y_mono, sr=sr)

        # 1. Analyze Rhythm / Grid
        if master_bpm:
            # ANCHOR MODE: Construct a strict grid
            # We still need to find the "Phase" (where the first beat is)
            onset_env = librosa.onset.onset_strength(y=y_mono, sr=sr)
            # Find the first strong onset to align the grid
            first_onset = np.argmax(onset_env[:int(sr*2)]) # Look in first 2 seconds
            start_offset_samples = librosa.frames_to_samples(first_onset)
            
            # Calculate samples per beat
            samples_per_beat = int((60.0 / master_bpm) * sr)
            
            # Construct beats array
            beats = np.arange(start_offset_samples, len(y_mono), samples_per_beat)
            bpm = master_bpm
        else:
            # FREE MODE: Detect BPM
            bpm, beats = self._consensus_beat_tracking(y_mono, sr)

        # 2. Define Loop Strategies based on Role
        candidates = []
        
        if role in ['vocals', 'melody']:
            # PHRASE-AWARE DETECTION
            # Use intelligent phrase boundary detection instead of arbitrary grid slicing
            from app.engines.phrase_detection import PhraseDetectionEngine
            
            phrase_engine = PhraseDetectionEngine(
                sr=sr,
                silence_threshold_db=-40.0,
                min_phrase_duration=1.5,  # At least 1.5 seconds
                max_phrase_duration=8.0,   # No more than 8 seconds
                min_gap_duration=0.3       # 300ms silence gap minimum
            )
            
            # Detect all phrases
            phrases = phrase_engine.detect_from_file(audio_path, bpm=bpm if master_bpm else None)
            
            if len(phrases) > 0:
                # Get best loop phrases (prioritize chorus/hooks)
                best_phrases = phrase_engine.get_best_loop_phrases(
                    phrases,
                    target_duration=4.0,  # Prefer ~4 second phrases
                    top_n=6
                )
                
                for phrase in best_phrases:
                    candidates.append({
                        'start': phrase.start_sample,
                        'end': phrase.end_sample,
                        'score': phrase.confidence + (0.5 if phrase.phrase_type in ['chorus', 'hook'] else 0),
                        'bars': max(1, int((phrase.duration / 60.0) * bpm / 4)) if bpm else 4,
                        'dna': {
                            'phrase_type': phrase.phrase_type,
                            'pitch_range_hz': phrase.pitch_range,
                            'energy': phrase.energy,
                            'duration': phrase.duration,
                            'confidence': phrase.confidence
                        }
                    })
            
            # Fallback to vocal saliency if no phrases detected
            if len(candidates) == 0:
                saliency = VocalSaliency(sr=sr)
                vocal_candidates = saliency.analyze_catchiness(audio_path)
                for vc in vocal_candidates:
                    start_sample = librosa.time_to_samples(vc['start_time'], sr=sr)
                    end_sample = librosa.time_to_samples(vc['end_time'], sr=sr)
                    candidates.append({
                        'start': start_sample,
                        'end': end_sample,
                        'score': vc['score'],
                        'bars': 4,
                        'dna': {'source': 'saliency_fallback'}
                    })
        else:
            # Grid Slicing with Structural Awareness
            beats_per_loop = 16 # 4 bars * 4 beats
            
            # If we have enough beats
            if len(beats) > beats_per_loop:
                # Slide through the track
                step = 16 if master_bpm else 4 # In Anchor mode, jump by 4 bars. In Free mode, maybe finer? Keep 16.
                
                for i in range(0, len(beats) - beats_per_loop, step):
                    start_sample = beats[i]
                    end_sample = beats[i + beats_per_loop]
                    
                    if end_sample >= len(y_mono): break

                    # Validation: Check energy
                    chunk = y_mono[start_sample:end_sample]
                    rms = librosa.feature.rms(y=chunk)[0]
                    if np.mean(rms) < 0.02: continue

                    # --- SPECTRAL INTELLIGENCE SCORING ---
                    score_energy = np.mean(rms)
                    S = np.abs(librosa.stft(chunk))
                    contrast = librosa.feature.spectral_contrast(S=S, sr=sr)
                    score_contrast = np.mean(contrast)
                    onset_env = librosa.onset.onset_strength(y=chunk, sr=sr)
                    score_rhythm = np.mean(onset_env)

                    if role == 'drums':
                        final_score = (score_energy * 0.3) + (score_rhythm * 0.7)
                    else:
                        final_score = (score_energy * 0.33) + (score_contrast * 0.33) + (score_rhythm * 0.33)
                    
                    candidates.append({
                        'start': start_sample,
                        'end': end_sample,
                        'score': final_score,
                        'dna': {
                            'energy': float(score_energy),
                            'rhythm': float(score_rhythm),
                            'tonality': float(score_contrast)
                        },
                        'bars': 4
                    })

        # 3. Extract and Process Candidates
        results = []
        candidates.sort(key=lambda x: x['score'], reverse=True)
        top_candidates = candidates[:6] # Top 6 loops

        for idx, c in enumerate(top_candidates):
            # Transient-Locked Slicing (Onset + Zero-Crossing)
            start_s = c['start']
            end_s = c['end']
            
            # In Anchor Mode, we trust the Grid more, but we still want zero-crossing
            # to avoid clicks. We do NOT want to snap to nearest transient if it deviates 
            # too much from the grid, otherwise we lose sync.
            
            # Zero-Crossing Snap (Tight window)
            zc_window = int(0.005 * sr) # 5ms
            
            # Snap Start
            zc_region = y_mono[max(0, start_s - zc_window) : min(len(y_mono), start_s + zc_window)]
            zero_crossings = librosa.zero_crossings(zc_region, pad=False)
            zc_indices = np.where(zero_crossings)[0]
            if len(zc_indices) > 0:
                center = len(zc_region) // 2
                closest_zc = zc_indices[np.argmin(np.abs(zc_indices - center))]
                start_s = max(0, start_s - zc_window + closest_zc)
            
            # Snap End
            zc_region_end = y_mono[max(0, end_s - zc_window) : min(len(y_mono), end_s + zc_window)]
            zero_crossings_end = librosa.zero_crossings(zc_region_end, pad=False)
            zc_indices_end = np.where(zero_crossings_end)[0]
            if len(zc_indices_end) > 0:
                center = len(zc_region_end) // 2
                closest_zc_end = zc_indices_end[np.argmin(np.abs(zc_indices_end - center))]
                end_s = max(0, end_s - zc_window + closest_zc_end)

            # Extract
            loop_audio = y[:, start_s:end_s]
            
            # Micro-Fade (Essential for seamless looping)
            fade_len = int(0.002 * sr) # 2ms
            if loop_audio.shape[1] > fade_len * 2:
                fade_in = np.linspace(0, 1, fade_len)
                fade_out = np.linspace(1, 0, fade_len)
                loop_audio[:, :fade_len] *= fade_in
                loop_audio[:, -fade_len:] *= fade_out

            # Save
            out_name = f"{role}_loop_{idx+1}_{int(bpm)}bpm.wav"
            out_path = output_dir / out_name
            sf.write(out_path, loop_audio.T, sr)
            
            results.append({
                "type": "loop",
                "role": role,
                "filename": out_name,
                "path": str(out_path),
                "bpm": round(bpm),
                "bars": c['bars'],
                "key": target_key,
                "score": float(c['score']),
                "dna": c.get('dna', {})
            })

        return results

    def mutate(self, audio_path: Path, output_dir: Path, texture: str) -> Dict:
        """
        Applies a generative DSP texture to an existing loop using Spotify Pedalboard.
        """
        y, sr = self.load_audio(audio_path)
        
        # Ensure float32
        y = y.astype(np.float32)

        # DSP Chain based on texture
        board = Pedalboard()
        
        if texture == "inferno":
            # Gritty, distorted, warm
            board.append(Distortion(drive_db=24))
            board.append(LowpassFilter(cutoff_frequency_hz=2500))
            board.append(Compressor(threshold_db=-15, ratio=4, attack_ms=10, release_ms=100))
            board.append(Gain(gain_db=3))

        elif texture == "quantum":
            # Rhythmic delay, spaced out
            board.append(Delay(delay_seconds=0.15, feedback=0.6, mix=0.5))
            board.append(Reverb(room_size=0.7, wet_level=0.3))
            board.append(Compressor(threshold_db=-12, ratio=3))

        elif texture == "astral":
            # Shimmering, pitched up, ethereal
            board.append(PitchShift(semitones=12))
            board.append(Chorus(rate_hz=1.5, depth=0.4, mix=0.5))
            board.append(Reverb(room_size=0.9, wet_level=0.7, damping=0.2))
            board.append(HighpassFilter(cutoff_frequency_hz=400))

        elif texture == "crush":
            # Bitcrushed, lo-fi digital artifacting
            board.append(Bitcrush(bit_depth=8))
            board.append(Gain(gain_db=6)) # Compensate for volume loss
            board.append(Compressor(threshold_db=-10, ratio=4))

        elif texture == "vapor":
            # Slowed, detuned, nostalgic
            board.append(PitchShift(semitones=-2))
            board.append(LowpassFilter(cutoff_frequency_hz=1500))
            board.append(Reverb(room_size=0.8, wet_level=0.4))
        
        # Always limit at the end to prevent clipping
        board.append(Limiter(threshold_db=-1.0))

        # Process
        # Pedalboard expects (channels, samples)
        processed = board(y, sr)

        # Save
        out_name = f"mutated_{texture}_{audio_path.name}"
        out_path = output_dir / out_name
        sf.write(out_path, processed.T, sr)

        return {
            "filename": out_name,
            "path": str(out_path),
            "texture": texture
        }
