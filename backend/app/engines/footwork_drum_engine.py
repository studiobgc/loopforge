"""
Footwork Drum Engine - TR-808 style drum synthesis.

Synthesizes classic drum machine sounds:
- Kick: Sine wave with pitch envelope sweep (60Hz → 20Hz)
- Snare: Noise burst + short sine tail
- Hi-hat: Filtered noise with short decay

Inspired by Chicago footwork's use of TR-808/909 drum machines.
"""

import numpy as np
from typing import Optional, Tuple, List, Dict, Any


class FootworkDrumEngine:
    """
    TR-808 style drum synthesis engine.
    
    Creates classic drum machine sounds with envelope control
    and saturation for footwork's signature grit.
    """
    
    def __init__(self, sample_rate: int = 44100):
        """
        Initialize drum synthesis engine.
        
        Args:
            sample_rate: Audio sample rate (default 44100)
        """
        self.sr = sample_rate
    
    def synthesize_kick(
        self,
        freq_start: float = 60.0,  # Hz
        freq_end: float = 20.0,    # Hz
        decay: float = 0.5,        # seconds
        saturation: float = 0.0,   # 0-1, saturation amount
        duration: float = 0.5,     # seconds
    ) -> np.ndarray:
        """
        Synthesize a TR-808 style kick drum.
        
        Uses exponential pitch envelope sweep from freq_start to freq_end.
        
        Args:
            freq_start: Starting frequency (Hz)
            freq_end: Ending frequency (Hz)
            decay: Decay time constant (seconds)
            saturation: Saturation amount (0-1)
            duration: Total duration (seconds)
        
        Returns:
            Mono audio array
        """
        num_samples = int(self.sr * duration)
        t = np.linspace(0, duration, num_samples)
        
        # Exponential frequency decay
        # freq(t) = freq_end + (freq_start - freq_end) * exp(-t/decay)
        freq = freq_end + (freq_start - freq_end) * np.exp(-t / decay)
        
        # Generate phase
        phase = np.cumsum(2 * np.pi * freq / self.sr)
        phase = np.mod(phase, 2 * np.pi)
        
        # Generate sine wave
        audio = np.sin(phase)
        
        # Apply amplitude envelope (exponential decay)
        amp_envelope = np.exp(-t / (decay * 0.8))
        audio = audio * amp_envelope
        
        # Normalize (handle edge case of silent audio)
        max_amp = np.max(np.abs(audio))
        if max_amp > 1e-6:  # Avoid division by very small numbers
            audio = audio / max_amp
        
        # Apply saturation if requested
        if saturation > 0:
            audio = self._apply_saturation(audio, saturation)
        
        return audio.astype(np.float32)
    
    def synthesize_snare(
        self,
        decay: float = 0.2,        # seconds
        saturation: float = 0.0,    # 0-1
        duration: float = 0.3,      # seconds
        noise_amount: float = 0.7,  # 0-1, how much noise vs sine
    ) -> np.ndarray:
        """
        Synthesize a TR-808 style snare drum.
        
        Combines noise burst with short sine tail.
        
        Args:
            decay: Decay time (seconds)
            saturation: Saturation amount (0-1)
            duration: Total duration (seconds)
            noise_amount: Ratio of noise to sine (0-1)
        
        Returns:
            Mono audio array
        """
        num_samples = int(self.sr * duration)
        t = np.linspace(0, duration, num_samples)
        
        # Noise burst (high-frequency filtered noise)
        # Use numpy's random state for reproducibility
        rng = np.random.RandomState(42)  # Fixed seed for consistent snare sound
        noise = rng.randn(num_samples).astype(np.float32)
        
        # Simple high-pass filter (emphasize high frequencies)
        # Apply envelope to noise
        noise_envelope = np.exp(-t / (decay * 0.3))
        noise = noise * noise_envelope * noise_amount
        
        # Sine tail (lower frequency, shorter)
        sine_freq = 200.0  # Hz
        phase = np.cumsum(2 * np.pi * sine_freq / self.sr)
        phase = np.mod(phase, 2 * np.pi)
        sine = np.sin(phase)
        sine_envelope = np.exp(-t / (decay * 0.5))
        sine = sine * sine_envelope * (1.0 - noise_amount)
        
        # Combine
        audio = noise + sine
        
        # Normalize (handle edge case of silent audio)
        max_amp = np.max(np.abs(audio))
        if max_amp > 1e-6:  # Avoid division by very small numbers
            audio = audio / max_amp
        
        # Apply saturation if requested
        if saturation > 0:
            audio = self._apply_saturation(audio, saturation)
        
        return audio.astype(np.float32)
    
    def synthesize_hat(
        self,
        decay: float = 0.1,         # seconds
        filter_cutoff: float = 8000.0,  # Hz
        duration: float = 0.15,     # seconds
        brightness: float = 0.8,    # 0-1, high-pass emphasis
    ) -> np.ndarray:
        """
        Synthesize a TR-808 style hi-hat.
        
        Filtered noise with short decay.
        
        Args:
            decay: Decay time (seconds)
            filter_cutoff: Effective filter cutoff (Hz) - simulated
            duration: Total duration (seconds)
            brightness: High-frequency emphasis (0-1)
        
        Returns:
            Mono audio array
        """
        num_samples = int(self.sr * duration)
        t = np.linspace(0, duration, num_samples)
        
        # Generate noise
        rng = np.random.RandomState(43)  # Fixed seed for consistent hat sound
        noise = rng.randn(num_samples).astype(np.float32)
        
        # Apply envelope
        envelope = np.exp(-t / decay)
        audio = noise * envelope
        
        # Simulate high-pass filter by emphasizing high frequencies
        # Simple approach: add high-frequency content
        if brightness > 0.5:
            # Add some high-frequency emphasis
            rng = np.random.RandomState(44)  # Fixed seed for consistent hat brightness
            high_freq = rng.randn(num_samples).astype(np.float32)
            high_freq = high_freq * envelope * (brightness - 0.5) * 0.3
            audio = audio + high_freq
        
        # Normalize (handle edge case of silent audio)
        max_amp = np.max(np.abs(audio))
        if max_amp > 1e-6:  # Avoid division by very small numbers
            audio = audio / max_amp
        
        return audio.astype(np.float32)
    
    def _apply_saturation(self, audio: np.ndarray, amount: float) -> np.ndarray:
        """
        Apply saturation/distortion to audio.
        
        Uses soft clipping for tube-style saturation.
        
        Args:
            audio: Input audio
            amount: Saturation amount (0-1)
        
        Returns:
            Saturated audio
        """
        if amount <= 0:
            return audio
        
        # Soft clipping: tanh-based saturation
        # More amount = more drive
        drive = 1.0 + (amount * 9.0)  # 1.0 to 10.0
        saturated = np.tanh(audio * drive)
        
        # Mix dry and wet
        mix = amount
        return (1.0 - mix) * audio + mix * saturated
    
    def synthesize_pattern(
        self,
        pattern: List[Tuple[float, str, Dict[str, Any]]],  # List of (time, type, params) tuples
        bpm: float = 160.0,
        duration_beats: float = 4.0,
    ) -> np.ndarray:
        """
        Synthesize a complete drum pattern.
        
        Args:
            pattern: List of (time_in_beats, drum_type, params_dict)
                drum_type: 'kick', 'snare', 'hat'
                params_dict: Optional parameters for that hit
            bpm: Tempo
            duration_beats: Pattern length in beats
        
        Returns:
            Stereo audio array (2, samples)
        """
        duration_seconds = (duration_beats * 60.0) / bpm
        num_samples = int(self.sr * duration_seconds)
        audio = np.zeros(num_samples, dtype=np.float32)
        
        for time_beats, drum_type, params in pattern:
            # Validate time
            if time_beats < 0 or time_beats >= duration_beats:
                continue
            
            time_seconds = (time_beats * 60.0) / bpm
            sample_offset = int(time_seconds * self.sr)
            
            if sample_offset < 0 or sample_offset >= num_samples:
                continue
            
            # Synthesize the drum hit with error handling
            try:
                if drum_type == 'kick':
                    hit = self.synthesize_kick(**params)
                elif drum_type == 'snare':
                    hit = self.synthesize_snare(**params)
                elif drum_type == 'hat':
                    hit = self.synthesize_hat(**params)
                else:
                    continue
            except Exception as e:
                # Log error but continue with other hits
                import logging
                logging.warning(f"Failed to synthesize {drum_type} at {time_beats} beats: {e}")
                continue
            
            # Mix into audio (handle bounds checking)
            if len(hit) > 0:
                end_offset = min(sample_offset + len(hit), num_samples)
                hit_length = end_offset - sample_offset
                if hit_length > 0:
                    audio[sample_offset:end_offset] += hit[:hit_length]
        
        # Normalize to prevent clipping (with safety margin)
        max_val = np.max(np.abs(audio))
        if max_val > 0.95:
            audio = audio * (0.95 / max_val)
        elif max_val < 1e-6:
            # Silent pattern - return zeros
            audio = np.zeros_like(audio)
        
        # Convert to stereo
        stereo = np.stack([audio, audio])
        
        return stereo.astype(np.float32)

