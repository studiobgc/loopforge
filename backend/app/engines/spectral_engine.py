"""
SpectralEngine - Advanced Spectral Manipulation

Frontier audio processing techniques:
- Spectral Freeze (time-frozen textures)
- Paulstretch (extreme ambient time-stretch)
- Spectral Morphing (blend between two sources)
- Vocoder synthesis
- Harmonic manipulation
- Convolution textures
"""

import numpy as np
from typing import Optional, Tuple
from scipy import signal
from scipy.ndimage import uniform_filter1d
import librosa


class SpectralEngine:
    """
    Advanced spectral manipulation engine.
    
    These are frontier techniques used in experimental
    sound design and ambient music production.
    """
    
    def __init__(self, sr: int = 44100):
        self.sr = sr
    
    # =========================================================================
    # SPECTRAL FREEZE - Time-frozen textures
    # =========================================================================
    
    def spectral_freeze(
        self,
        audio: np.ndarray,
        freeze_point: float = 0.5,
        duration: float = 10.0,
        n_fft: int = 4096,
        evolution: float = 0.1
    ) -> np.ndarray:
        """
        Freeze audio at a single moment, creating an infinite sustain.
        
        Like holding a single frame of sound forever - creates
        haunting, ethereal textures from any source.
        
        Args:
            audio: Input audio
            freeze_point: Where to freeze (0-1, percentage of audio)
            duration: Output duration in seconds
            n_fft: FFT size (larger = smoother freeze)
            evolution: Subtle phase evolution for life (0-1)
        """
        # Find the frame to freeze
        hop_length = n_fft // 4
        D = librosa.stft(audio, n_fft=n_fft, hop_length=hop_length)
        
        total_frames = D.shape[1]
        freeze_frame = int(total_frames * freeze_point)
        freeze_frame = max(0, min(freeze_frame, total_frames - 1))
        
        # Extract magnitude and phase at freeze point
        frozen_mag = np.abs(D[:, freeze_frame:freeze_frame+1])
        frozen_phase = np.angle(D[:, freeze_frame:freeze_frame+1])
        
        # Calculate output frames needed
        output_samples = int(duration * self.sr)
        output_frames = output_samples // hop_length + 1
        
        # Build output spectrogram with evolving phase
        output_mag = np.tile(frozen_mag, (1, output_frames))
        
        # Evolve phase slowly for subtle movement
        phase_evolution = np.linspace(0, evolution * np.pi * 2, output_frames)
        output_phase = frozen_phase + phase_evolution.reshape(1, -1)
        
        # Add subtle random phase drift for organic feel
        drift = np.random.uniform(-0.1, 0.1, output_phase.shape) * evolution
        output_phase += drift
        
        # Reconstruct
        D_frozen = output_mag * np.exp(1j * output_phase)
        frozen = librosa.istft(D_frozen, hop_length=hop_length, length=output_samples)
        
        return frozen.astype(np.float32)
    
    # =========================================================================
    # PAULSTRETCH - Extreme time-stretching
    # =========================================================================
    
    def paulstretch(
        self,
        audio: np.ndarray,
        stretch_factor: float = 8.0,
        window_size_seconds: float = 0.25
    ) -> np.ndarray:
        """
        Paulstretch algorithm for extreme time-stretching.
        
        Creates ethereal, ambient textures by stretching audio
        to extreme lengths while preserving tonal quality.
        Used by artists like Stars of the Lid, William Basinski.
        
        Args:
            audio: Input audio
            stretch_factor: How much to stretch (2-100x typical)
            window_size_seconds: Analysis window size
        """
        # Paulstretch parameters
        window_size = int(window_size_seconds * self.sr)
        window_size = window_size if window_size % 2 == 0 else window_size + 1
        half_window = window_size // 2
        
        # Calculate output length
        input_length = len(audio)
        output_length = int(input_length * stretch_factor)
        
        # Create output buffer
        output = np.zeros(output_length, dtype=np.float32)
        
        # Hann window for smooth overlap
        window = np.hanning(window_size)
        
        # Process
        input_pos = 0.0
        output_pos = 0
        
        while output_pos < output_length - window_size:
            # Get input position
            ipos = int(input_pos)
            
            # Extract window from input
            if ipos + window_size <= input_length:
                segment = audio[ipos:ipos + window_size].copy()
            else:
                # Wrap around or pad
                segment = np.zeros(window_size)
                remaining = input_length - ipos
                if remaining > 0:
                    segment[:remaining] = audio[ipos:]
            
            # Apply window
            segment *= window
            
            # FFT
            spectrum = np.fft.rfft(segment)
            
            # Randomize phase (key to paulstretch sound)
            magnitudes = np.abs(spectrum)
            random_phases = np.random.uniform(0, 2 * np.pi, len(spectrum))
            spectrum = magnitudes * np.exp(1j * random_phases)
            
            # IFFT
            stretched = np.fft.irfft(spectrum, n=window_size)
            stretched *= window
            
            # Overlap-add to output
            if output_pos + window_size <= output_length:
                output[output_pos:output_pos + window_size] += stretched
            
            # Advance positions
            input_pos += window_size / stretch_factor
            output_pos += half_window
        
        # Normalize
        max_val = np.max(np.abs(output))
        if max_val > 0:
            output = output / max_val * 0.95
        
        return output
    
    # =========================================================================
    # SPECTRAL MORPH - Blend between two sources
    # =========================================================================
    
    def spectral_morph(
        self,
        audio_a: np.ndarray,
        audio_b: np.ndarray,
        morph_amount: float = 0.5,
        n_fft: int = 2048
    ) -> np.ndarray:
        """
        Morph between two audio sources spectrally.
        
        Creates hybrid textures by blending the spectral
        characteristics of two sounds.
        
        Args:
            audio_a: First audio source
            audio_b: Second audio source
            morph_amount: Blend amount (0 = A, 1 = B, 0.5 = equal mix)
            n_fft: FFT size
        """
        # Match lengths
        min_len = min(len(audio_a), len(audio_b))
        audio_a = audio_a[:min_len]
        audio_b = audio_b[:min_len]
        
        hop_length = n_fft // 4
        
        # Get spectrograms
        D_a = librosa.stft(audio_a, n_fft=n_fft, hop_length=hop_length)
        D_b = librosa.stft(audio_b, n_fft=n_fft, hop_length=hop_length)
        
        # Match shapes
        min_frames = min(D_a.shape[1], D_b.shape[1])
        D_a = D_a[:, :min_frames]
        D_b = D_b[:, :min_frames]
        
        # Separate magnitude and phase
        mag_a, phase_a = np.abs(D_a), np.angle(D_a)
        mag_b, phase_b = np.abs(D_b), np.angle(D_b)
        
        # Morph magnitudes (log-domain for perceptual smoothness)
        mag_a_log = np.log1p(mag_a)
        mag_b_log = np.log1p(mag_b)
        morphed_mag_log = mag_a_log * (1 - morph_amount) + mag_b_log * morph_amount
        morphed_mag = np.expm1(morphed_mag_log)
        
        # Morph phases (circular interpolation)
        # Use phase from dominant source
        morphed_phase = phase_a if morph_amount < 0.5 else phase_b
        
        # Reconstruct
        D_morphed = morphed_mag * np.exp(1j * morphed_phase)
        morphed = librosa.istft(D_morphed, hop_length=hop_length, length=min_len)
        
        return morphed.astype(np.float32)
    
    # =========================================================================
    # VOCODER - Classic vocoder synthesis
    # =========================================================================
    
    def vocoder(
        self,
        modulator: np.ndarray,
        carrier: np.ndarray,
        num_bands: int = 32,
        attack_ms: float = 5.0,
        release_ms: float = 50.0
    ) -> np.ndarray:
        """
        Classic vocoder synthesis.
        
        Uses modulator (typically voice) to control the
        spectral envelope of carrier (typically synth).
        
        Args:
            modulator: Modulator signal (voice)
            carrier: Carrier signal (synth/noise)
            num_bands: Number of frequency bands
            attack_ms: Envelope follower attack time
            release_ms: Envelope follower release time
        """
        # Match lengths
        min_len = min(len(modulator), len(carrier))
        modulator = modulator[:min_len]
        carrier = carrier[:min_len]
        
        # Create filter bank (logarithmically spaced)
        freq_low = 80  # Hz
        freq_high = 12000  # Hz
        
        # Generate center frequencies
        centers = np.exp(np.linspace(
            np.log(freq_low), 
            np.log(freq_high), 
            num_bands
        ))
        
        # Bandwidth (in octaves)
        bandwidth = 1.0 / num_bands * 4
        
        output = np.zeros(min_len)
        
        for center in centers:
            # Calculate Q for this band
            Q = center / (center * bandwidth)
            Q = max(0.5, min(Q, 50))  # Clamp Q
            
            # Normalized frequency
            w0 = center / (self.sr / 2)
            if w0 >= 1.0:
                continue
            
            # Design bandpass filter
            try:
                b, a = signal.iirpeak(w0, Q)
            except:
                continue
            
            # Filter both signals
            mod_band = signal.lfilter(b, a, modulator)
            car_band = signal.lfilter(b, a, carrier)
            
            # Envelope follower on modulator
            envelope = np.abs(mod_band)
            
            # Smooth envelope (attack/release)
            attack_samples = int(attack_ms * self.sr / 1000)
            release_samples = int(release_ms * self.sr / 1000)
            
            envelope = uniform_filter1d(envelope, size=max(1, attack_samples))
            
            # Apply envelope to carrier
            output += car_band * envelope
        
        # Normalize
        max_val = np.max(np.abs(output))
        if max_val > 0:
            output = output / max_val * 0.95
        
        return output.astype(np.float32)
    
    # =========================================================================
    # HARMONIC RESONANCE - Add/remove harmonics
    # =========================================================================
    
    def harmonic_resonance(
        self,
        audio: np.ndarray,
        fundamental: float = 100.0,
        harmonics: list[Tuple[int, float]] = None,
        resonance_q: float = 50.0
    ) -> np.ndarray:
        """
        Add resonance at specific harmonic frequencies.
        
        Creates bell-like, metallic, or organ-like tones
        by boosting specific harmonics.
        
        Args:
            audio: Input audio
            fundamental: Base frequency in Hz
            harmonics: List of (harmonic_number, gain) tuples
            resonance_q: Q factor for resonant filters
        """
        if harmonics is None:
            # Default: boost 1st, 3rd, 5th harmonics (organ-like)
            harmonics = [(1, 1.0), (3, 0.5), (5, 0.3), (7, 0.15)]
        
        output = audio.copy()
        
        for harmonic_num, gain in harmonics:
            freq = fundamental * harmonic_num
            
            # Skip if above Nyquist
            if freq >= self.sr / 2:
                continue
            
            # Normalized frequency
            w0 = freq / (self.sr / 2)
            
            # Design resonant filter
            try:
                b, a = signal.iirpeak(w0, resonance_q)
                resonated = signal.lfilter(b, a, audio)
                output += resonated * gain
            except:
                continue
        
        # Normalize
        max_val = np.max(np.abs(output))
        if max_val > 0:
            output = output / max_val * 0.95
        
        return output.astype(np.float32)
    
    # =========================================================================
    # SPECTRAL BLUR - Frequency smearing
    # =========================================================================
    
    def spectral_blur(
        self,
        audio: np.ndarray,
        blur_amount: float = 0.5,
        n_fft: int = 2048
    ) -> np.ndarray:
        """
        Blur the spectrum, smearing frequencies together.
        
        Creates soft, diffuse textures like a photo with
        lens blur applied to sound.
        
        Args:
            audio: Input audio
            blur_amount: How much to blur (0-1)
            n_fft: FFT size
        """
        hop_length = n_fft // 4
        
        D = librosa.stft(audio, n_fft=n_fft, hop_length=hop_length)
        mag = np.abs(D)
        phase = np.angle(D)
        
        # Blur magnitude in frequency direction
        blur_size = int(blur_amount * 50) + 1
        mag_blurred = uniform_filter1d(mag, size=blur_size, axis=0)
        
        # Optionally blur in time too
        time_blur = int(blur_amount * 10) + 1
        mag_blurred = uniform_filter1d(mag_blurred, size=time_blur, axis=1)
        
        # Add subtle phase randomization
        phase_noise = np.random.uniform(-np.pi * blur_amount * 0.3, 
                                        np.pi * blur_amount * 0.3, 
                                        phase.shape)
        phase_blurred = phase + phase_noise
        
        D_blurred = mag_blurred * np.exp(1j * phase_blurred)
        blurred = librosa.istft(D_blurred, hop_length=hop_length, length=len(audio))
        
        return blurred.astype(np.float32)
    
    # =========================================================================
    # CONVOLUTION TEXTURE - Impulse response based
    # =========================================================================
    
    def create_texture_ir(
        self,
        texture_type: str = 'shimmer',
        duration: float = 2.0
    ) -> np.ndarray:
        """
        Create synthetic impulse responses for texture effects.
        
        Args:
            texture_type: 'shimmer', 'metallic', 'cloud', 'reverse'
            duration: IR duration in seconds
        """
        samples = int(duration * self.sr)
        
        if texture_type == 'shimmer':
            # Shimmer: delayed, pitch-shifted reflections
            ir = np.zeros(samples)
            
            for i in range(8):
                delay = int((0.05 + i * 0.1) * self.sr)
                if delay < samples:
                    # Each reflection slightly pitch-shifted
                    freq = 1.0 + i * 0.02
                    t = np.arange(samples - delay) / self.sr
                    reflection = np.sin(2 * np.pi * freq * 440 * t) * np.exp(-t * 3)
                    ir[delay:] += reflection * (0.5 ** i)
            
        elif texture_type == 'metallic':
            # Metallic: resonant modes
            ir = np.zeros(samples)
            freqs = [220, 440, 660, 880, 1100, 1320]
            
            t = np.arange(samples) / self.sr
            for i, freq in enumerate(freqs):
                decay = 2 + i * 0.5
                ir += np.sin(2 * np.pi * freq * t) * np.exp(-t * decay) * 0.3
            
        elif texture_type == 'cloud':
            # Cloud: diffuse, granular texture
            ir = np.random.randn(samples) * np.exp(-np.arange(samples) / samples * 4)
            
            # Low-pass filter for softness
            b, a = signal.butter(4, 2000 / (self.sr / 2), 'low')
            ir = signal.lfilter(b, a, ir)
            
        elif texture_type == 'reverse':
            # Reverse reverb style
            ir = np.exp(np.arange(samples) / samples * 3 - 3)
            ir *= np.random.randn(samples) * 0.3 + 0.7
            ir = ir[::-1]  # Reverse
        
        else:
            ir = np.zeros(samples)
            ir[0] = 1.0  # Simple impulse
        
        # Normalize
        max_val = np.max(np.abs(ir))
        if max_val > 0:
            ir = ir / max_val
        
        return ir.astype(np.float32)
    
    def apply_texture(
        self,
        audio: np.ndarray,
        texture_type: str = 'shimmer',
        mix: float = 0.5,
        ir_duration: float = 2.0
    ) -> np.ndarray:
        """
        Apply texture via convolution.
        
        Args:
            audio: Input audio
            texture_type: Type of texture IR
            mix: Wet/dry mix (0-1)
            ir_duration: IR duration
        """
        ir = self.create_texture_ir(texture_type, ir_duration)
        
        # Convolve
        wet = signal.fftconvolve(audio, ir, mode='same')
        
        # Normalize wet signal
        max_wet = np.max(np.abs(wet))
        if max_wet > 0:
            wet = wet / max_wet * np.max(np.abs(audio))
        
        # Mix
        output = audio * (1 - mix) + wet * mix
        
        return output.astype(np.float32)
