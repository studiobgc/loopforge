"""
Embedding Engine - CLAP-based audio embeddings for semantic search.

Uses CLAP (Contrastive Language-Audio Pretraining) to generate
embeddings for audio slices, enabling:
- Semantic similarity search ("find slices similar to this one")
- Text-to-audio search ("find punchy kicks")
- Auto-ranking slices by sonic characteristics
- Smart auto-kit generation based on sonic diversity

This is the "productization" of CLAP for Loop Forge.
"""

import torch
import numpy as np
from pathlib import Path
from typing import List, Dict, Optional, Tuple, Union
from dataclasses import dataclass, asdict
import json
import hashlib

from app.engines.torch_utils import load_audio


@dataclass
class AudioEmbedding:
    """
    A CLAP embedding for an audio segment.
    """
    id: str
    source_path: str
    start_time: float
    end_time: float
    embedding: List[float]  # 512-dim CLAP embedding
    
    # Optional metadata
    slice_index: Optional[int] = None
    slice_bank_id: Optional[str] = None
    tags: Optional[List[str]] = None
    
    def to_dict(self) -> Dict:
        return asdict(self)
    
    @classmethod
    def from_dict(cls, data: Dict) -> 'AudioEmbedding':
        return cls(**data)


class EmbeddingEngine:
    """
    CLAP-based embedding engine for semantic audio search.
    
    Generates 512-dimensional embeddings that capture the
    semantic/sonic characteristics of audio.
    """
    
    EMBEDDING_DIM = 512
    
    def __init__(self, model_name: str = "laion/clap-htsat-unfused"):
        print(f"[EMBEDDING] Loading CLAP model: {model_name}...")
        self.device = "mps" if torch.backends.mps.is_available() else "cpu"
        self.model_name = model_name
        self.model = None
        self.processor = None
        self._load_model()
        
        # Embedding cache (in-memory for speed, can be persisted)
        self._cache: Dict[str, np.ndarray] = {}
    
    def _load_model(self):
        """Load CLAP model"""
        try:
            from transformers import ClapModel, ClapProcessor
            self.model = ClapModel.from_pretrained(self.model_name).to(self.device)
            self.processor = ClapProcessor.from_pretrained(self.model_name)
            self.model.eval()
            print(f"[EMBEDDING] Model loaded on {self.device}")
        except Exception as e:
            print(f"[EMBEDDING] Failed to load model: {e}")
            self.model = None
    
    def _get_cache_key(self, path: str, start: float, end: float) -> str:
        """Generate cache key for an audio segment"""
        key_str = f"{path}:{start:.3f}:{end:.3f}"
        return hashlib.md5(key_str.encode()).hexdigest()
    
    def get_audio_embedding(
        self,
        audio_path: str,
        start_time: float = 0.0,
        end_time: Optional[float] = None,
        use_cache: bool = True,
    ) -> np.ndarray:
        """
        Get CLAP embedding for an audio segment.
        
        Args:
            audio_path: Path to audio file
            start_time: Start time in seconds
            end_time: End time in seconds (None = end of file)
            use_cache: Whether to use cached embeddings
        
        Returns:
            512-dimensional numpy array
        """
        if self.model is None:
            return np.zeros(self.EMBEDDING_DIM)
        
        # Check cache
        cache_key = self._get_cache_key(audio_path, start_time, end_time or -1)
        if use_cache and cache_key in self._cache:
            return self._cache[cache_key]
        
        try:
            # Load audio segment
            target_sr = 48000  # CLAP expects 48kHz
            waveform = load_audio(audio_path, sr=target_sr)
            audio_np = waveform.cpu().numpy()
            
            # Mix to mono if needed
            if audio_np.ndim > 1 and audio_np.shape[0] > 1:
                audio_np = audio_np.mean(axis=0)
            elif audio_np.ndim > 1:
                audio_np = audio_np[0]
            
            # Extract segment
            start_sample = int(start_time * target_sr)
            if end_time is not None:
                end_sample = int(end_time * target_sr)
                audio_np = audio_np[start_sample:end_sample]
            else:
                audio_np = audio_np[start_sample:]
            
            # Limit to 10s for memory
            max_samples = target_sr * 10
            if len(audio_np) > max_samples:
                audio_np = audio_np[:max_samples]
            
            # Get embedding
            inputs = self.processor(
                audios=audio_np,
                return_tensors="pt",
                sampling_rate=target_sr,
            )
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            
            with torch.no_grad():
                audio_features = self.model.get_audio_features(**inputs)
            
            embedding = audio_features[0].cpu().numpy()
            
            # Normalize
            embedding = embedding / (np.linalg.norm(embedding) + 1e-8)
            
            # Cache
            if use_cache:
                self._cache[cache_key] = embedding
            
            return embedding
            
        except Exception as e:
            print(f"[EMBEDDING] Failed to get embedding: {e}")
            return np.zeros(self.EMBEDDING_DIM)
    
    def get_text_embedding(self, text: str) -> np.ndarray:
        """
        Get CLAP embedding for a text description.
        
        This enables text-to-audio search like "punchy kick" or "atmospheric pad".
        """
        if self.model is None:
            return np.zeros(self.EMBEDDING_DIM)
        
        try:
            inputs = self.processor(
                text=[text],
                return_tensors="pt",
                padding=True,
            )
            inputs = {k: v.to(self.device) for k, v in inputs.items()}
            
            with torch.no_grad():
                text_features = self.model.get_text_features(**inputs)
            
            embedding = text_features[0].cpu().numpy()
            embedding = embedding / (np.linalg.norm(embedding) + 1e-8)
            
            return embedding
            
        except Exception as e:
            print(f"[EMBEDDING] Failed to get text embedding: {e}")
            return np.zeros(self.EMBEDDING_DIM)
    
    def compute_similarity(
        self,
        embedding1: np.ndarray,
        embedding2: np.ndarray,
    ) -> float:
        """Compute cosine similarity between two embeddings"""
        return float(np.dot(embedding1, embedding2))
    
    def find_similar(
        self,
        query_embedding: np.ndarray,
        candidate_embeddings: List[np.ndarray],
        top_k: int = 5,
    ) -> List[Tuple[int, float]]:
        """
        Find most similar embeddings to query.
        
        Returns list of (index, similarity_score) tuples.
        """
        similarities = [
            self.compute_similarity(query_embedding, emb)
            for emb in candidate_embeddings
        ]
        
        # Sort by similarity (descending)
        indexed = list(enumerate(similarities))
        indexed.sort(key=lambda x: x[1], reverse=True)
        
        return indexed[:top_k]
    
    def rank_by_diversity(
        self,
        embeddings: List[np.ndarray],
        num_select: int = 16,
    ) -> List[int]:
        """
        Select diverse set of slices by maximizing embedding distance.
        
        Uses a greedy algorithm to select slices that are maximally
        different from each other - great for auto-kit generation.
        
        Returns indices of selected slices.
        """
        if len(embeddings) <= num_select:
            return list(range(len(embeddings)))
        
        selected = []
        remaining = list(range(len(embeddings)))
        
        # Start with the slice that has highest norm (most "distinctive")
        norms = [np.linalg.norm(e) for e in embeddings]
        first_idx = int(np.argmax(norms))
        selected.append(first_idx)
        remaining.remove(first_idx)
        
        # Greedily select slices that are most different from already selected
        while len(selected) < num_select and remaining:
            max_min_dist = -1
            best_idx = remaining[0]
            
            for idx in remaining:
                # Find minimum distance to any already-selected slice
                min_dist = min(
                    1 - self.compute_similarity(embeddings[idx], embeddings[s])
                    for s in selected
                )
                
                if min_dist > max_min_dist:
                    max_min_dist = min_dist
                    best_idx = idx
            
            selected.append(best_idx)
            remaining.remove(best_idx)
        
        return selected
    
    def auto_rank_slices(
        self,
        embeddings: List[np.ndarray],
        criteria: str = "punchy",
    ) -> List[Tuple[int, float]]:
        """
        Rank slices by semantic similarity to a criteria.
        
        Args:
            embeddings: List of slice embeddings
            criteria: Text description of desired sound
                     e.g., "punchy", "bright", "deep bass", "snappy snare"
        
        Returns:
            List of (index, score) tuples, sorted by score descending
        """
        # Get text embedding for criteria
        text_emb = self.get_text_embedding(criteria)
        
        # Score each slice
        scores = [
            (i, self.compute_similarity(emb, text_emb))
            for i, emb in enumerate(embeddings)
        ]
        
        # Sort by score
        scores.sort(key=lambda x: x[1], reverse=True)
        
        return scores
    
    def generate_slice_embeddings(
        self,
        audio_path: str,
        slices: List[Dict],
    ) -> List[AudioEmbedding]:
        """
        Generate embeddings for all slices in a slice bank.
        
        Args:
            audio_path: Path to source audio
            slices: List of slice dicts with start_time, end_time
        
        Returns:
            List of AudioEmbedding objects
        """
        embeddings = []
        
        for i, s in enumerate(slices):
            start = s.get('start_time', 0)
            end = s.get('end_time', start + 0.5)
            
            emb_array = self.get_audio_embedding(audio_path, start, end)
            
            embedding = AudioEmbedding(
                id=f"{Path(audio_path).stem}_{i}",
                source_path=audio_path,
                start_time=start,
                end_time=end,
                embedding=emb_array.tolist(),
                slice_index=i,
            )
            embeddings.append(embedding)
        
        return embeddings
    
    def clear_cache(self):
        """Clear the embedding cache"""
        self._cache.clear()


# Singleton
_embedding_engine: Optional[EmbeddingEngine] = None


def get_embedding_engine() -> EmbeddingEngine:
    """Get the embedding engine singleton"""
    global _embedding_engine
    if _embedding_engine is None:
        _embedding_engine = EmbeddingEngine()
    return _embedding_engine
