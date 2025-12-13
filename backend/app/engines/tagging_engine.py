import torch
import torchaudio
from transformers import ClapModel, ClapProcessor
from typing import List, Dict, Union
import numpy as np
from app.engines.torch_utils import load_audio

class TaggingEngine:
    """
    AI-Powered Audio Tagging using CLAP (Contrastive Language-Audio Pretraining).
    Allows zero-shot classification of audio against text descriptions.
    """
    
    DEFAULT_TAGS = [
        "Drums", "Bass", "Guitar", "Piano", "Synthesizer", "Vocals",
        "Trap", "Hip Hop", "Rock", "Jazz", "Ambient", "Techno", "House",
        "Dark", "Happy", "Sad", "Energetic", "Chill", "Aggressive",
        "Lo-fi", "Cinematic", "Distorted", "Clean", "Acoustic"
    ]
    
    def __init__(self, model_name="laion/clap-htsat-unfused"):
        print(f"[TAGGING] Loading CLAP model: {model_name}...")
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        
        try:
            self.model = ClapModel.from_pretrained(model_name).to(self.device)
            self.processor = ClapProcessor.from_pretrained(model_name)
            print(f"[TAGGING] Model loaded on {self.device}")
        except Exception as e:
            print(f"[TAGGING] Failed to load model: {e}")
            self.model = None
            
    def predict_tags(self, audio_path: str, candidates: List[str] = None, top_k: int = 3) -> List[Dict]:
        """
        Predict tags for an audio file.
        """
        if not self.model:
            return []
            
        if candidates is None:
            candidates = self.DEFAULT_TAGS
            
        try:
            # Load audio using our GPU loader
            # CLAP expects 48kHz usually, but let's check processor
            # The processor handles resampling if we pass raw audio? 
            # Actually transformers processors usually expect numpy arrays at specific SR.
            # CLAP HTSAT expects 48000Hz.
            
            target_sr = 48000
            waveform = load_audio(audio_path, sr=target_sr)
            
            # Convert to numpy for processor (it handles tokenization etc)
            # Ideally we'd stay on GPU but transformers inputs are usually CPU/List
            audio_np = waveform.cpu().numpy()
            
            # If stereo, mix to mono
            if audio_np.ndim > 1 and audio_np.shape[0] > 1:
                audio_np = audio_np.mean(axis=0)
            elif audio_np.ndim > 1:
                audio_np = audio_np[0]
                
            # Slice to 10s max to avoid memory issues and focus on intro/core
            max_len = target_sr * 10
            if len(audio_np) > max_len:
                audio_np = audio_np[:max_len]
                
            # Prepare inputs
            inputs = self.processor(
                text=candidates, 
                audios=audio_np, 
                return_tensors="pt", 
                padding=True,
                sampling_rate=target_sr
            )
            
            # Move inputs to device
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            
            # Inference
            with torch.no_grad():
                outputs = self.model(**inputs)
                
            # Calculate similarity
            logits_per_audio = outputs.logits_per_audio  # [1, num_candidates]
            probs = logits_per_audio.softmax(dim=1)  # [1, num_candidates]
            
            # Get top k
            scores = probs[0].cpu().numpy()
            top_indices = scores.argsort()[-top_k:][::-1]
            
            results = []
            for idx in top_indices:
                results.append({
                    "tag": candidates[idx],
                    "score": float(scores[idx])
                })
                
            return results
            
        except Exception as e:
            print(f"[TAGGING] Prediction failed: {e}")
            return []
