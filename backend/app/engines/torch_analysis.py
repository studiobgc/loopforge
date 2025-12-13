import torch
import torchaudio
import math

def compute_rms(waveform: torch.Tensor, frame_length: int = 2048, hop_length: int = 512) -> torch.Tensor:
    """Compute RMS energy on GPU."""
    # Pad to match librosa centered frames
    pad = frame_length // 2
    waveform = torch.nn.functional.pad(waveform, (pad, pad), mode='reflect')
    
    # Unfold into frames: [channels, n_frames, frame_length]
    frames = waveform.unfold(-1, frame_length, hop_length)
    
    # RMS = sqrt(mean(x^2))
    rms = torch.sqrt(torch.mean(frames**2, dim=-1))
    return rms

def compute_spectral_flatness(waveform: torch.Tensor, n_fft: int = 2048, hop_length: int = 512) -> torch.Tensor:
    """Compute spectral flatness on GPU."""
    device = waveform.device
    window = torch.hann_window(n_fft).to(device)
    
    spec = torch.stft(
        waveform, 
        n_fft=n_fft, 
        hop_length=hop_length, 
        window=window, 
        return_complex=True,
        center=True
    )
    
    mag = torch.abs(spec)
    
    # Geometric mean / Arithmetic mean
    # Add small epsilon to avoid log(0)
    mag = mag + 1e-10
    
    log_mag = torch.log(mag)
    mean_log = torch.mean(log_mag, dim=1)
    geom_mean = torch.exp(mean_log)
    
    arith_mean = torch.mean(mag, dim=1)
    
    flatness = geom_mean / arith_mean
    return flatness

def compute_periodicity(waveform: torch.Tensor, frame_length: int = 2048, hop_length: int = 512) -> torch.Tensor:
    """
    Compute periodicity/voicedness confidence using GPU autocorrelation.
    Faster than pYIN for just detecting 'is this singing?'.
    """
    # Pad
    pad = frame_length // 2
    waveform = torch.nn.functional.pad(waveform, (pad, pad), mode='reflect')
    
    frames = waveform.unfold(-1, frame_length, hop_length)
    
    # FFT-based autocorrelation for speed
    # R(t) = IFFT( |FFT(x)|^2 )
    
    # Windowing
    window = torch.hann_window(frame_length).to(waveform.device)
    frames_w = frames * window
    
    # FFT
    fft = torch.fft.rfft(frames_w, dim=-1)
    
    # Power spectrum
    power = fft * torch.conj(fft)
    
    # IFFT -> Autocorrelation
    corr = torch.fft.irfft(power, dim=-1)
    
    # Normalize
    # corr[0] is energy
    energy = corr[..., 0:1] + 1e-10
    norm_corr = corr / energy
    
    # Find peak in valid pitch range
    # e.g. 50Hz - 2000Hz at 44100sr
    # lags: sr/2000 to sr/50
    sr = 44100 # Assumption
    min_lag = int(sr / 2000)
    max_lag = int(sr / 50)
    
    if max_lag >= frame_length:
        max_lag = frame_length - 1
        
    search_region = norm_corr[..., min_lag:max_lag]
    
    # Max peak in search region is our periodicity confidence
    confidence, _ = torch.max(search_region, dim=-1)
    
    return confidence
