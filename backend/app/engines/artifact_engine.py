"""
ArtifactEngine - Intentional Imperfection Generator

The Bladee/experimental vocal processing philosophy:
"Amplify artifacts as textural elements rather than hiding them."

Features:
- Bitcrushing & digital degradation
- Granular stutter effects
- Phase smearing & spectral chaos
- Formant manipulation
- Compression + saturation chains
- Pitch instability/wobble
"""

import numpy as np
from dataclasses import dataclass
from typing import Optional, Literal
from scipy import signal
from scipy.ndimage import uniform_filter1d
import librosa


@dataclass
class ArtifactPreset:
    """Preset configuration for artifact effects."""
    name: str
    bitcrush_rate: int              # Target sample rate (6900-44100)
    bitcrush_depth: int             # Bit depth (8-24)
    stutter_intensity: float        # 0.0-1.0
    stutter_pattern: str            # 'random', '16th', 'triplet', 'chaos'
    phase_smear: float              # 0.0-1.0
    formant_shift: int              # Semitones (-24 to +24)
    compression_ratio: float        # 1.0-20.0
    saturation: float               # 0.0-1.0
    pitch_wobble: float             # 0.0-1.0
    wobble_speed: float             # Hz (0.5-20)
    layer_corruption: float         # 0.0-1.0
    
    @staticmethod
    def bladee_classic() -> 'ArtifactPreset':
        return ArtifactPreset(
            name="Bladee Classic",
            bitcrush_rate=22050,
            bitcrush_depth=16,
            stutter_intensity=0.2,
            stutter_pattern='16th',
            phase_smear=0.3,
            formant_shift=3,
            compression_ratio=8.0,
            saturation=0.4,
            pitch_wobble=0.15,
            wobble_speed=4.0,
            layer_corruption=0.3
        )
    
    @staticmethod
    def glitch_artifact() -> 'ArtifactPreset':
        return ArtifactPreset(
            name="Glitch Artifact",
            bitcrush_rate=11025,
            bitcrush_depth=12,
            stutter_intensity=0.6,
            stutter_pattern='chaos',
            phase_smear=0.5,
            formant_shift=-5,
            compression_ratio=12.0,
            saturation=0.6,
            pitch_wobble=0.3,
            wobble_speed=8.0,
            layer_corruption=0.5
        )
    
    @staticmethod
    def digital_decay() -> 'ArtifactPreset':
        return ArtifactPreset(
            name="Digital Decay",
            bitcrush_rate=8000,
            bitcrush_depth=8,
            stutter_intensity=0.1,
            stutter_pattern='random',
            phase_smear=0.7,
            formant_shift=0,
            compression_ratio=4.0,
            saturation=0.8,
            pitch_wobble=0.4,
            wobble_speed=2.0,
            layer_corruption=0.6
        )
    
    @staticmethod
    def ghost_voice() -> 'ArtifactPreset':
        return ArtifactPreset(
            name="Ghost Voice",
            bitcrush_rate=44100,
            bitcrush_depth=24,
            stutter_intensity=0.0,
            stutter_pattern='random',
            phase_smear=0.8,
            formant_shift=7,
            compression_ratio=2.0,
            saturation=0.2,
            pitch_wobble=0.5,
            wobble_speed=1.5,
            layer_corruption=0.7
        )


class ArtifactEngine:
    """
    Advanced artifact generation engine for experimental vocal processing.
    
    Philosophy: Instead of hiding processing artifacts, we amplify them
    as intentional textural elements. This creates the "impossible"
    vocal textures used by Bladee, Yeat, and experimental producers.
    
    Each effect can be applied independently or chained together.
    """
    
    PRESETS = {
        'bladee_classic': ArtifactPreset.bladee_classic,
        'glitch_artifact': ArtifactPreset.glitch_artifact,
        'digital_decay': ArtifactPreset.digital_decay,
        'ghost_voice': ArtifactPreset.ghost_voice,
    }
    
    def __init__(self, sr: int = 44100):
        """
        Initialize artifact engine.
        
        Args:
            sr: Default sample rate
        """
        self.sr = sr
    
    def apply_preset(
        self, 
        audio: np.ndarray,
        preset_name: str,
        sr: Optional[int] = None
    ) -> np.ndarray:
        """Apply a named preset to audio."""
        sr = sr or self.sr
        
        if preset_name not in self.PRESETS:
            raise ValueError(f"Unknown preset: {preset_name}")
        
        preset = self.PRESETS[preset_name]()
        return self.apply_full_chain(audio, sr, preset)
    
    def apply_full_chain(
        self,
        audio: np.ndarray,
        sr: int,
        preset: ArtifactPreset
    ) -> np.ndarray:
        """Apply full artifact chain from preset."""
        
        # Convert to mono for processing
        if audio.ndim > 1:
            audio = librosa.to_mono(audio)
        
        processed = audio.copy()
        
        # 1. Pitch wobble (before other effects)
        if preset.pitch_wobble > 0:
            processed = self.add_pitch_wobble(
                processed, sr,
                amount=preset.pitch_wobble,
                speed=preset.wobble_speed
            )
        
        # 2. Bitcrushing
        if preset.bitcrush_rate < sr or preset.bitcrush_depth < 24:
            processed = self.bitcrush(
                processed, sr,
                target_rate=preset.bitcrush_rate,
                bit_depth=preset.bitcrush_depth
            )
        
        # 3. Stutter/glitch
        if preset.stutter_intensity > 0:
            processed = self.stutter(
                processed, sr,
                intensity=preset.stutter_intensity,
                pattern=preset.stutter_pattern
            )
        
        # 4. Phase smearing
        if preset.phase_smear > 0:
            processed = self.phase_smear(
                processed,
                amount=preset.phase_smear
            )
        
        # 5. Formant shift
        if preset.formant_shift != 0:
            processed = self.shift_formants(
                processed, sr,
                semitones=preset.formant_shift
            )
        
        # 6. Compression + saturation
        if preset.compression_ratio > 1:
            processed = self.compress(
                processed,
                ratio=preset.compression_ratio
            )
        
        if preset.saturation > 0:
            processed = self.saturate(
                processed,
                amount=preset.saturation
            )
        
        # 7. Layer corruption (mix with corrupted copies)
        if preset.layer_corruption > 0:
            processed = self.layer_corruption(
                processed, sr,
                amount=preset.layer_corruption
            )
        
        return processed
    
    # =========================================================================
    # INDIVIDUAL EFFECTS
    # =========================================================================
    
    def bitcrush(
        self,
        audio: np.ndarray,
        sr: int,
        target_rate: int = 8000,
        bit_depth: int = 12
    ) -> np.ndarray:
        """
        Professional bit-crushing with dithering and nonlinear quantization.
        
        Creates musical, crunchy artifacts rather than harsh digital clipping.
        
        Args:
            audio: Input audio
            sr: Current sample rate
            target_rate: Target sample rate (lower = grittier)
            bit_depth: Target bit depth (lower = more quantization noise)
        """
        # 1. Dithering
        # Add low-level noise before quantization to prevent harsh harmonic aliasing
        # This makes the noise floor "analog" rather than "digital"
        dither_amplitude = 1.0 / (2 ** bit_depth)
        dither = np.random.normal(0, dither_amplitude, len(audio))
        audio_dithered = audio + dither
        
        # 2. Nonlinear Quantization (Soft Bitcrush)
        # Using tanh to "bend" the bits gives a warmer sound
        levels = 2 ** bit_depth
        # Scale up, apply nonlinearity, quantize, scale down
        # The tanh part compresses loud signals before quantization
        audio_compressed = np.tanh(audio_dithered * 2.0) / 2.0
        quantized = np.round(audio_compressed * (levels / 2)) / (levels / 2)
        
        # 3. Sample Rate Reduction with Aliasing
        if target_rate < sr:
            # We intentionally skip anti-aliasing filter to keep the "crunch"
            # This creates the characteristic "ringing" of vintage samplers
            step = sr / target_rate
            indices = np.arange(0, len(quantized), step)
            indices_int = indices.astype(int)
            # Clamp indices
            indices_int = np.minimum(indices_int, len(quantized) - 1)
            
            downsampled = quantized[indices_int]
            
            # Zero-order hold (stepped) interpolation for "digital" sound
            # or Linear for slightly smoother. Let's use Linear for now but without filtering
            crushed = np.interp(
                np.arange(len(audio)),
                indices,
                downsampled
            )
        else:
            crushed = quantized
        
        return crushed.astype(np.float32)
    
    def shift_formants(
        self,
        audio: np.ndarray,
        sr: int,
        semitones: int = 0
    ) -> np.ndarray:
        """
        Shift formants independently of pitch using WORLD vocoder.
        
        This is the research standard for high-quality vocal manipulation.
        
        Args:
            audio: Input audio
            sr: Sample rate
            semitones: Formant shift amount (-24 to +24)
        """
        if semitones == 0:
            return audio
            
        try:
            import pyworld
            
            # WORLD expects float64 (double)
            # Ensure mono
            if audio.ndim > 1:
                audio_mono = np.mean(audio, axis=0)
            else:
                audio_mono = audio
                
            audio_f64 = audio_mono.astype(np.float64)
            
            # 1. Analysis
            # Harvest F0 (pitch), spectral envelope (sp), and aperiodicity (ap)
            # frame_period=5.0 ms is standard
            f0, t = pyworld.harvest(audio_f64, sr)
            sp = pyworld.cheaptrick(audio_f64, f0, t, sr)
            ap = pyworld.d4c(audio_f64, f0, t, sr)
            
            # 2. Modify Spectral Envelope (Formant Shifting)
            # Scaling the frequency axis of the spectral envelope shifts formants
            # Higher formants = "chipmunk", Lower = "giant"
            
            # Shift factor
            # Positive semitones = shift formants UP (smaller vocal tract)
            # Negative semitones = shift formants DOWN (larger vocal tract)
            # We invert the ratio because stretching the envelope (ratio > 1) lowers the formants
            # To shift UP (semitones > 0), we need to shrink the envelope (ratio < 1)
            ratio = 2 ** (-semitones / 12.0)
            
            # Warp the spectrum
            rows, cols = sp.shape
            sp_shifted = np.zeros_like(sp)
            
            # Create frequency axis indices
            x = np.arange(cols)
            # Scale x axis
            x_scaled = x * ratio
            
            for i in range(rows):
                # Interpolate each frame
                sp_shifted[i] = np.interp(x_scaled, x, sp[i])
                
            # 3. Resynthesis
            y = pyworld.synthesize(f0, sp_shifted, ap, sr)
            
            # Match length
            if len(y) > len(audio):
                y = y[:len(audio)]
            elif len(y) < len(audio):
                y = np.pad(y, (0, len(audio) - len(y)))
            
            return y.astype(np.float32)
            
        except ImportError:
            print("[ARTIFACT] pyworld not found, falling back to resampling method")
            return self._shift_formants_fallback(audio, sr, semitones)
        except Exception as e:
            print(f"[ARTIFACT] pyworld failed: {e}, falling back")
            return self._shift_formants_fallback(audio, sr, semitones)

    def _shift_formants_fallback(
        self,
        audio: np.ndarray,
        sr: int,
        semitones: int
    ) -> np.ndarray:
        """Original resampling-based formant shifting (fallback)."""
        shift_ratio = 2 ** (semitones / 12)
        
        # Resample (changes both pitch and formants)
        new_sr = int(sr * shift_ratio)
        resampled = librosa.resample(audio, orig_sr=sr, target_sr=new_sr)
        
        # Pitch shift back (keeps formant change, restores pitch)
        # Use GPU acceleration if available
        try:
            from app.engines.torch_utils import pitch_shift, get_device
            import torch
            
            device = get_device()
            resampled_tensor = torch.from_numpy(resampled).float().to(device)
            if resampled_tensor.ndim == 1: resampled_tensor = resampled_tensor.unsqueeze(0)
            
            shifted_tensor = pitch_shift(resampled_tensor, new_sr, -semitones)
            formant_shifted = shifted_tensor.cpu().numpy()
            if formant_shifted.ndim == 2: formant_shifted = formant_shifted[0]
        except:
             # CPU fallback
             formant_shifted = librosa.effects.pitch_shift(resampled, sr=new_sr, n_steps=-semitones)
        
        # Resample back to original sample rate
        result = librosa.resample(formant_shifted, orig_sr=new_sr, target_sr=sr)
        
        # Match length
        if len(result) > len(audio):
            result = result[:len(audio)]
        elif len(result) < len(audio):
            result = np.pad(result, (0, len(audio) - len(result)))
        
        return result.astype(np.float32)
    
    def compress(
        self,
        audio: np.ndarray,
        threshold_db: float = -20.0,
        ratio: float = 8.0,
        attack_ms: float = 5.0,
        release_ms: float = 50.0
    ) -> np.ndarray:
        """
        Dynamic range compression.
        
        Heavy compression brings out artifacts by reducing dynamic range.
        
        Args:
            audio: Input audio
            threshold_db: Compression threshold in dB
            ratio: Compression ratio (1 = no compression)
            attack_ms: Attack time in milliseconds
            release_ms: Release time in milliseconds
        """
        if ratio <= 1:
            return audio
        
        # Convert to amplitude
        threshold = 10 ** (threshold_db / 20)
        
        # Envelope follower (simple moving average for now)
        env_samples = int(attack_ms * self.sr / 1000)
        envelope = uniform_filter1d(np.abs(audio), size=max(1, env_samples))
        
        # Calculate gain reduction
        gain = np.ones_like(audio)
        above_threshold = envelope > threshold
        
        if np.any(above_threshold):
            # Gain reduction above threshold
            db_above = 20 * np.log10(envelope[above_threshold] / threshold + 1e-10)
            gain_reduction = db_above - db_above / ratio
            gain[above_threshold] = 10 ** (-gain_reduction / 20)
        
        # Apply compression
        compressed = audio * gain
        
        # Makeup gain
        peak = np.max(np.abs(compressed))
        if peak > 0:
            compressed = compressed / peak * np.max(np.abs(audio))
        
        return compressed.astype(np.float32)
    
    def saturate(
        self,
        audio: np.ndarray,
        amount: float = 0.5,
        drive: float = 3.0
    ) -> np.ndarray:
        """
        Soft saturation/distortion.
        
        Makes artifacts more musical by adding harmonic content.
        
        Args:
            audio: Input audio
            amount: Wet/dry mix (0-1)
            drive: Saturation drive amount
        """
        if amount <= 0:
            return audio
        
        # Drive the signal
        driven = audio * (1 + drive * amount)
        
        # Soft clipping using tanh
        saturated = np.tanh(driven)
        
        # Mix with original
        result = audio * (1 - amount) + saturated * amount
        
        # Normalize
        peak = np.max(np.abs(result))
        if peak > 1:
            result = result / peak
        
        return result.astype(np.float32)
    
    def add_pitch_wobble(
        self,
        audio: np.ndarray,
        sr: int,
        amount: float = 0.3,
        speed: float = 4.0
    ) -> np.ndarray:
        """
        Add intentional pitch instability.
        
        Creates that "alive but wrong" pitch character.
        
        Args:
            audio: Input audio
            sr: Sample rate
            amount: Wobble depth in semitones
            speed: Wobble frequency in Hz
        """
        if amount <= 0:
            return audio
        
        # Create LFO for pitch modulation
        t = np.arange(len(audio)) / sr
        
        # Combine sine and random for organic wobble
        lfo = np.sin(2 * np.pi * speed * t) * 0.7
        lfo += np.random.uniform(-0.3, 0.3, len(audio))
        lfo *= amount
        
        # Apply as pitch shift (simplified - constant shift for now)
        avg_wobble = np.mean(lfo)
        
        if abs(avg_wobble) > 0.01:
            # Use GPU acceleration
            from app.engines.torch_utils import pitch_shift
            import torch
            from app.engines.torch_utils import get_device
            
            if isinstance(audio, np.ndarray):
                device = get_device()
                audio_tensor = torch.from_numpy(audio).float().to(device)
                if audio_tensor.ndim == 1: audio_tensor = audio_tensor.unsqueeze(0)
                
                shifted_tensor = pitch_shift(audio_tensor, sr, avg_wobble)
                wobbled = shifted_tensor.cpu().numpy()
                if wobbled.ndim == 2: wobbled = wobbled[0]
            else:
                wobbled = pitch_shift(audio, sr, avg_wobble)
        else:
            wobbled = audio
        
        return wobbled.astype(np.float32)
    
    def layer_corruption(
        self,
        audio: np.ndarray,
        sr: int,
        amount: float = 0.5,
        num_layers: int = 3
    ) -> np.ndarray:
        """
        Layer multiple corrupted copies for thick, impossible texture.
        
        Args:
            audio: Input audio
            sr: Sample rate
            amount: Mix amount (0-1)
            num_layers: Number of corrupted layers
        """
        if amount <= 0:
            return audio
        
        layers = [audio]
        layer_weight = amount / num_layers
        
        # Layer 1: Bitcrushed
        if num_layers >= 1:
            crushed = self.bitcrush(audio, sr, target_rate=11025, bit_depth=12)
            layers.append(crushed * layer_weight)
        
        # Layer 2: Phase smeared
        if num_layers >= 2:
            smeared = self.phase_smear(audio, amount=0.5)
            layers.append(smeared * layer_weight)
        
        # Layer 3: Formant shifted
        if num_layers >= 3:
            shifted = self.shift_formants(audio, sr, semitones=5)
            layers.append(shifted * layer_weight)
        
        # Mix all layers
        mixed = np.sum(layers, axis=0)
        
        # Normalize
        peak = np.max(np.abs(mixed))
        if peak > 0:
            mixed = mixed / peak * 0.95
        
        return mixed.astype(np.float32)
    
    @classmethod
    def get_preset_names(cls) -> list[str]:
        """Get list of available preset names."""
        return list(cls.PRESETS.keys())
    
    @classmethod
    def get_preset_info(cls, name: str) -> dict:
        """Get preset parameters as dict."""
        if name not in cls.PRESETS:
            raise ValueError(f"Unknown preset: {name}")
        
        preset = cls.PRESETS[name]()
        return {
            'name': preset.name,
            'bitcrush_rate': preset.bitcrush_rate,
            'bitcrush_depth': preset.bitcrush_depth,
            'stutter_intensity': preset.stutter_intensity,
            'stutter_pattern': preset.stutter_pattern,
            'phase_smear': preset.phase_smear,
            'formant_shift': preset.formant_shift,
            'compression_ratio': preset.compression_ratio,
            'saturation': preset.saturation,
            'pitch_wobble': preset.pitch_wobble,
            'wobble_speed': preset.wobble_speed,
            'layer_corruption': preset.layer_corruption,
        }
