"""
Embeddings API - CLAP-based semantic audio search endpoints.

Enables:
- Generate embeddings for slices
- Text-to-audio search
- Audio-to-audio similarity search
- Auto-ranking by sonic characteristics
- Diverse auto-kit generation
"""

from fastapi import APIRouter, HTTPException, Query, Body
from pathlib import Path
from typing import List, Optional
import numpy as np

from ..engines.embedding_engine import get_embedding_engine
from ..core.storage import get_storage
from ..core.database import get_db
from ..core.models import SliceBankRecord

router = APIRouter(prefix="/embeddings", tags=["embeddings"])


@router.post("/generate/{slice_bank_id}")
async def generate_embeddings(
    slice_bank_id: str,
) -> dict:
    """
    Generate CLAP embeddings for all slices in a slice bank.
    
    Embeddings are stored in the slice_data JSON for each slice.
    """
    db = get_db()
    storage = get_storage()
    engine = get_embedding_engine()
    
    with db.session() as session:
        bank = session.query(SliceBankRecord).filter_by(id=slice_bank_id).first()
        if not bank:
            raise HTTPException(404, "Slice bank not found")
        
        # Find source audio - stems are stored at storage/stems/{session_id}/
        stems_dir = storage.root / "stems" / bank.session_id
        
        stem_role = bank.stem_role.value if bank.stem_role else "drums"
        audio_path = stems_dir / f"{stem_role}.wav"
        
        if not audio_path.exists():
            # Fallback: check uploads directory for source
            uploads_dir = storage.root / "uploads" / bank.session_id
            source_files = list(uploads_dir.glob("*.*")) if uploads_dir.exists() else []
            if not source_files:
                raise HTTPException(404, f"Audio source not found at {audio_path}")
            audio_path = source_files[0]
        
        # Get slice data
        slice_data = bank.slice_data or []
        
        # Generate embeddings for each slice
        embeddings_generated = 0
        for i, s in enumerate(slice_data):
            start = s.get('start_time', 0)
            end = s.get('end_time', start + 0.5)
            
            try:
                emb = engine.get_audio_embedding(str(audio_path), start, end)
                s['embedding'] = emb.tolist()
                embeddings_generated += 1
            except Exception as e:
                print(f"[EMBEDDINGS] Failed to generate embedding for slice {i}: {e}")
                s['embedding'] = None
        
        # Save updated slice bank
        bank.slice_data = slice_data
        session.commit()
        
        return {
            "slice_bank_id": slice_bank_id,
            "embeddings_generated": embeddings_generated,
            "total_slices": len(slice_data),
        }


@router.post("/search/text")
async def search_by_text(
    slice_bank_id: str = Body(...),
    query: str = Body(..., description="Text description of desired sound"),
    top_k: int = Body(8, description="Number of results to return"),
) -> dict:
    """
    Search slices by text description.
    
    Examples:
    - "punchy kick"
    - "snappy snare"
    - "deep bass"
    - "bright hi-hat"
    - "vocal chop"
    """
    db = get_db()
    engine = get_embedding_engine()
    
    with db.session() as session:
        bank = session.query(SliceBankRecord).filter_by(id=slice_bank_id).first()
        if not bank:
            raise HTTPException(404, "Slice bank not found")
        
        slice_data = bank.slice_data or []
        
        # Get text embedding
        text_emb = engine.get_text_embedding(query)
        
        # Score each slice
        results = []
        for i, s in enumerate(slice_data):
            emb = s.get('embedding')
            if emb is None:
                continue
            
            emb_arr = np.array(emb)
            score = engine.compute_similarity(text_emb, emb_arr)
            
            results.append({
                "slice_index": i,
                "score": float(score),
                "start_time": s.get('start_time'),
                "end_time": s.get('end_time'),
                "rms_energy": s.get('rms_energy'),
            })
        
        # Sort by score
        results.sort(key=lambda x: x['score'], reverse=True)
        
        return {
            "query": query,
            "results": results[:top_k],
            "total_searched": len(results),
        }


@router.post("/search/similar")
async def search_similar(
    slice_bank_id: str = Body(...),
    reference_slice_index: int = Body(..., description="Index of the reference slice"),
    top_k: int = Body(8, description="Number of results to return"),
) -> dict:
    """
    Find slices similar to a reference slice.
    
    Great for finding variations or similar sounds within a slice bank.
    """
    db = get_db()
    engine = get_embedding_engine()
    
    with db.session() as session:
        bank = session.query(SliceBankRecord).filter_by(id=slice_bank_id).first()
        if not bank:
            raise HTTPException(404, "Slice bank not found")
        
        slice_data = bank.slice_data or []
        
        if reference_slice_index >= len(slice_data):
            raise HTTPException(400, "Reference slice index out of range")
        
        ref_slice = slice_data[reference_slice_index]
        ref_emb = ref_slice.get('embedding')
        
        if ref_emb is None:
            raise HTTPException(400, "Reference slice has no embedding. Generate embeddings first.")
        
        ref_emb_arr = np.array(ref_emb)
        
        # Score all other slices
        results = []
        for i, s in enumerate(slice_data):
            if i == reference_slice_index:
                continue
            
            emb = s.get('embedding')
            if emb is None:
                continue
            
            emb_arr = np.array(emb)
            score = engine.compute_similarity(ref_emb_arr, emb_arr)
            
            results.append({
                "slice_index": i,
                "score": float(score),
                "start_time": s.get('start_time'),
                "end_time": s.get('end_time'),
            })
        
        results.sort(key=lambda x: x['score'], reverse=True)
        
        return {
            "reference_slice": reference_slice_index,
            "results": results[:top_k],
        }


@router.post("/auto-kit")
async def generate_auto_kit(
    slice_bank_id: str = Body(...),
    num_pads: int = Body(16, description="Number of pads to fill"),
    strategy: str = Body("diverse", description="Selection strategy: diverse, punchy, bright, deep"),
) -> dict:
    """
    Automatically select slices for an MPC-style kit.
    
    Strategies:
    - diverse: Maximize sonic variety (default)
    - punchy: Prioritize hard-hitting transients
    - bright: Prioritize high-frequency content
    - deep: Prioritize low-frequency content
    """
    db = get_db()
    engine = get_embedding_engine()
    
    with db.session() as session:
        bank = session.query(SliceBankRecord).filter_by(id=slice_bank_id).first()
        if not bank:
            raise HTTPException(404, "Slice bank not found")
        
        slice_data = bank.slice_data or []
        
        # Collect embeddings
        embeddings = []
        valid_indices = []
        
        for i, s in enumerate(slice_data):
            emb = s.get('embedding')
            if emb is not None:
                embeddings.append(np.array(emb))
                valid_indices.append(i)
        
        if len(embeddings) == 0:
            raise HTTPException(400, "No embeddings found. Generate embeddings first.")
        
        # Select based on strategy
        if strategy == "diverse":
            selected_local = engine.rank_by_diversity(embeddings, num_pads)
            selected_indices = [valid_indices[i] for i in selected_local]
        else:
            # Use text-based ranking
            criteria_map = {
                "punchy": "punchy hard-hitting transient",
                "bright": "bright crispy high frequency",
                "deep": "deep low bass sub",
            }
            criteria = criteria_map.get(strategy, "punchy")
            
            ranked = engine.auto_rank_slices(embeddings, criteria)
            selected_local = [idx for idx, _ in ranked[:num_pads]]
            selected_indices = [valid_indices[i] for i in selected_local]
        
        # Build result
        kit = []
        for pad_idx, slice_idx in enumerate(selected_indices):
            s = slice_data[slice_idx]
            kit.append({
                "pad": pad_idx,
                "slice_index": slice_idx,
                "start_time": s.get('start_time'),
                "end_time": s.get('end_time'),
                "rms_energy": s.get('rms_energy'),
            })
        
        return {
            "slice_bank_id": slice_bank_id,
            "strategy": strategy,
            "kit": kit,
            "num_pads_filled": len(kit),
        }


@router.post("/rank")
async def rank_slices(
    slice_bank_id: str = Body(...),
    criteria: str = Body(..., description="Text description for ranking, e.g., 'punchy kick', 'snappy snare'"),
) -> dict:
    """
    Rank all slices by similarity to a text criteria.
    
    Returns all slices sorted by how well they match the description.
    """
    db = get_db()
    engine = get_embedding_engine()
    
    with db.session() as session:
        bank = session.query(SliceBankRecord).filter_by(id=slice_bank_id).first()
        if not bank:
            raise HTTPException(404, "Slice bank not found")
        
        slice_data = bank.slice_data or []
        
        # Get text embedding
        text_emb = engine.get_text_embedding(criteria)
        
        # Score all slices
        results = []
        for i, s in enumerate(slice_data):
            emb = s.get('embedding')
            if emb is None:
                continue
            
            score = engine.compute_similarity(text_emb, np.array(emb))
            results.append({
                "slice_index": i,
                "score": float(score),
                "start_time": s.get('start_time'),
                "end_time": s.get('end_time'),
                "rms_energy": s.get('rms_energy'),
                "transient_strength": s.get('transient_strength'),
            })
        
        results.sort(key=lambda x: x['score'], reverse=True)
        
        return {
            "criteria": criteria,
            "ranked_slices": results,
            "total_ranked": len(results),
        }
