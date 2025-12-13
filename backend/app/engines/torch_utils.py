import torch
import torchaudio
import math
from typing import Optional

def get_device() -> torch.device:
    """Get best available device (MPS > CUDA > CPU)."""
    if torch.backends.mps.is_available():
        return torch.device("mps")
    elif torch.cuda.is_available():
        return torch.device("cuda")
    return torch.device("cpu")

def load_audio(path: str, sr: int = 44100, duration: Optional[float] = None) -> torch.Tensor:
    """Load audio to tensor on device, resampling if needed."""
    device = get_device()
    try:
        # Calculate num_frames if duration specified
        # We need to know orig_sr first, which is tricky without opening.
        # torchaudio.info is fast.
        
        if duration:
            info = torchaudio.info(path)
            orig_sr = info.sample_rate
            num_frames = int(duration * orig_sr)
            waveform, orig_sr = torchaudio.load(path, num_frames=num_frames)
        else:
            waveform, orig_sr = torchaudio.load(path)
            
        waveform = waveform.to(device)
        
        if orig_sr != sr:
            resampler = torchaudio.transforms.Resample(orig_sr, sr).to(device)
            waveform = resampler(waveform)
            
        return waveform
    except Exception as e:
        print(f"[TORCH] Load failed: {e}")
        return torch.zeros(2, sr).to(device)

def save_audio(path: str, waveform: torch.Tensor, sr: int):
    """Save tensor to audio file."""
    # Move to CPU for saving
    waveform = waveform.detach().cpu()
    torchaudio.save(path, waveform, sr)

def pitch_shift(waveform: torch.Tensor, sr: int, n_steps: float) -> torch.Tensor:
    """
    High-quality pitch shift using Pedalboard (GPU-accelerated via JUCE).
    Avoids MPS ISTFT bugs. Preserves duration.
    """
    if n_steps == 0:
        return waveform
        
    from pedalboard import Pedalboard, PitchShift
    import numpy as np
    
    device = waveform.device
    
    # Convert to numpy for pedalboard
    # waveform: [channels, samples]
    audio_np = waveform.detach().cpu().numpy().astype(np.float32)
    
    # Apply pitch shift
    board = Pedalboard([PitchShift(semitones=n_steps)])
    shifted_np = board(audio_np, sr)
    
    # Convert back to tensor
    shifted = torch.from_numpy(shifted_np).float().to(device)
    
    # Ensure same length (pedalboard might add/remove samples)
    if shifted.shape[-1] > waveform.shape[-1]:
        shifted = shifted[..., :waveform.shape[-1]]
    elif shifted.shape[-1] < waveform.shape[-1]:
        shifted = torch.nn.functional.pad(shifted, (0, waveform.shape[-1] - shifted.shape[-1]))
        
    return shifted

def apply_convolution(waveform: torch.Tensor, kernel_size: int = 20) -> torch.Tensor:
    """Apply smoothing convolution (low-pass) on GPU."""
    device = waveform.device
    channels = waveform.shape[0]
    
    # Create smoothing kernel
    # Shape: [channels, 1, kernel_size] (groups=channels)
    kernel = torch.ones(channels, 1, kernel_size).to(device) / kernel_size
    
    # Pad to keep size same (same padding)
    padding = kernel_size // 2
    
    # Apply conv1d
    # input: [batch, channels, time] -> add batch dim
    inp = waveform.unsqueeze(0)
    
    out = torch.nn.functional.conv1d(
        inp, 
        kernel, 
        padding=padding, 
        groups=channels
    )
    
    # Remove batch dim
    out = out.squeeze(0)
    
    # Fix length if padding caused shift
    if out.shape[-1] > waveform.shape[-1]:
        out = out[..., :waveform.shape[-1]]
        
    return out
