import torch
import torchaudio
import torchaudio.transforms as T

class TimeStretchEngine:
    def __init__(self, sr=44100):
        self.sr = sr
        self.device = torch.device("cuda" if torch.cuda.is_available() else "cpu")
        if torch.backends.mps.is_available():
            self.device = torch.device("mps")

    def stretch_audio(self, audio_tensor: torch.Tensor, rate: float) -> torch.Tensor:
        """
        Stretches audio by a given rate (speed up or slow down) without changing pitch.
        rate > 1.0: Speed up (shorter duration)
        rate < 1.0: Slow down (longer duration)
        """
        if abs(rate - 1.0) < 0.01:
            return audio_tensor

        # Ensure tensor is on device
        audio_tensor = audio_tensor.to(self.device)
        
        # Handle stereo/mono
        # TimeStretch expects complex spectrogram (freq, time, complex)
        # We need to process channels independently or batched? 
        # T.TimeStretch supports batching if we format correctly.
        
        # Using Phase Vocoder via torchaudio
        n_fft = 2048
        hop_length = 512
        
        # 1. STFT
        # audio_tensor shape: [Channels, Time]
        stft = torch.stft(
            audio_tensor, 
            n_fft=n_fft, 
            hop_length=hop_length, 
            window=torch.hann_window(n_fft).to(self.device),
            return_complex=True
        )
        # stft shape: [Channels, Freq, Time]
        
        # 2. Time Stretch
        # T.TimeStretch expects (..., Freq, Time) complex tensor
        stretcher = T.TimeStretch(hop_length=hop_length, n_freq=n_fft//2 + 1, fixed_rate=rate).to(self.device)
        
        # Forward pass
        # Note: fixed_rate in init is deprecated in some versions, but if we pass it here it's fine.
        # Actually, let's check if we can pass rate to forward.
        # If fixed_rate is set, forward() takes (complex_specgrams).
        # If fixed_rate is None, forward() takes (complex_specgrams, rate).
        # To be safe and flexible, let's try to use the functional API or re-instantiate if needed.
        # But T.TimeStretch is stateful? No, it's a transform.
        
        stretched_stft = stretcher(stft)
        
        # 3. Inverse STFT
        # We need to calculate expected length
        expected_len = int(audio_tensor.shape[-1] / rate)
        
        stretched_audio = torch.istft(
            stretched_stft, 
            n_fft=n_fft, 
            hop_length=hop_length, 
            window=torch.hann_window(n_fft).to(self.device),
            length=expected_len
        )
        
        return stretched_audio

    def match_bpm(self, audio_tensor: torch.Tensor, source_bpm: float, target_bpm: float) -> torch.Tensor:
        """
        Stretches audio to match target BPM.
        """
        if not source_bpm or not target_bpm or source_bpm <= 0 or target_bpm <= 0:
            return audio_tensor
            
        # If source is 120, target is 128. We need to speed up.
        # rate = 128 / 120 = 1.066
        rate = target_bpm / source_bpm
        
        return self.stretch_audio(audio_tensor, rate)
