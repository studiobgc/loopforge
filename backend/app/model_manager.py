"""
CTO-Level Model Manager
Centralized, thread-safe model loading and caching with lifecycle management.
Ensures models are loaded once, reused efficiently, and cleaned up properly.
"""
import threading
import gc
import torch
from typing import Optional, Dict, Any
from functools import lru_cache

# Note: ModelManager now handles all caching internally
# These globals are kept for backward compatibility but not used


class ModelManager:
    """
    Singleton model manager for all AI models.
    Provides thread-safe lazy loading, caching, and cleanup.
    """
    
    _instance = None
    _lock = threading.Lock()
    
    def __new__(cls):
        if cls._instance is None:
            with cls._lock:
                if cls._instance is None:
                    cls._instance = super().__new__(cls)
                    cls._instance._initialized = False
        return cls._instance
    
    def __init__(self):
        if self._initialized:
            return
        self._initialized = True
        self._models: Dict[str, Any] = {}
        self._model_locks: Dict[str, threading.Lock] = {}
        self._load_status: Dict[str, bool] = {}
    
    def get_separator(self, force_reload=False):
        """Get or create Demucs separator (thread-safe)."""
        model_key = "demucs_separator"
        
        if model_key not in self._model_locks:
            self._model_locks[model_key] = threading.Lock()
        
        with self._model_locks[model_key]:
            if force_reload and model_key in self._models:
                # Cleanup old model
                del self._models[model_key]
                self._clear_gpu_memory()
            
            if model_key not in self._models:
                from app.separator import StemSeparator
                print("[MODEL_MANAGER] Loading Demucs separator...")
                self._models[model_key] = StemSeparator()
                self._load_status[model_key] = True
                print("[MODEL_MANAGER] Demucs separator ready")
            
            return self._models[model_key]
    
    def get_tagging_engine(self, force_reload=False):
        """Get or create CLAP tagging engine (thread-safe, lazy-loaded)."""
        model_key = "clap_tagging"
        
        if model_key not in self._model_locks:
            self._model_locks[model_key] = threading.Lock()
        
        with self._model_locks[model_key]:
            if force_reload and model_key in self._models:
                del self._models[model_key]
                self._clear_gpu_memory()
            
            if model_key not in self._models:
                from app.engines.tagging_engine import TaggingEngine
                print("[MODEL_MANAGER] Loading CLAP tagging engine (lazy)...")
                self._models[model_key] = TaggingEngine()
                self._load_status[model_key] = True
                print("[MODEL_MANAGER] CLAP tagging engine ready")
            
            return self._models[model_key]
    
    def preload_critical_models(self):
        """Preload critical models at startup (non-blocking)."""
        import threading
        
        def preload_demucs():
            try:
                self.get_separator()
            except Exception as e:
                print(f"[MODEL_MANAGER] Failed to preload Demucs: {e}")
        
        # Preload Demucs in background thread
        thread = threading.Thread(target=preload_demucs, daemon=True)
        thread.start()
        return thread
    
    def warmup_models(self):
        """Warmup all models to ensure they're ready."""
        print("[MODEL_MANAGER] Warming up models...")
        try:
            self.get_separator()
            print("[MODEL_MANAGER] ✅ All critical models warmed up")
        except Exception as e:
            print(f"[MODEL_MANAGER] ⚠️  Model warmup warning: {e}")
    
    def _clear_gpu_memory(self):
        """Clear GPU memory cache."""
        gc.collect()
        if torch.cuda.is_available():
            torch.cuda.empty_cache()
            torch.cuda.synchronize()
        elif torch.backends.mps.is_available():
            if hasattr(torch.mps, 'empty_cache'):
                torch.mps.empty_cache()
        gc.collect()
    
    def cleanup(self):
        """Cleanup all models and free memory."""
        print("[MODEL_MANAGER] Cleaning up models...")
        with self._cache_lock:
            for key in list(self._models.keys()):
                try:
                    del self._models[key]
                except:
                    pass
            self._models.clear()
            self._load_status.clear()
        self._clear_gpu_memory()
        print("[MODEL_MANAGER] Cleanup complete")


# Global singleton instance
_model_manager: Optional[ModelManager] = None
_manager_lock = threading.Lock()


def get_model_manager() -> ModelManager:
    """Get global model manager instance."""
    global _model_manager
    if _model_manager is None:
        with _manager_lock:
            if _model_manager is None:
                _model_manager = ModelManager()
    return _model_manager


# Convenience functions for backward compatibility
def get_separator(force_reload=False):
    """Get Demucs separator (thread-safe, cached)."""
    return get_model_manager().get_separator(force_reload)


def get_tagging_engine(force_reload=False):
    """Get CLAP tagging engine (thread-safe, lazy-loaded)."""
    return get_model_manager().get_tagging_engine(force_reload)

