"""
Storage Layer

Content-addressable file storage with automatic organization.
Files are stored by SHA256 hash to prevent duplicates.
"""

import os
import hashlib
import shutil
from pathlib import Path
from typing import Optional, Tuple, BinaryIO
from datetime import datetime

# Storage root
STORAGE_ROOT = Path(os.getenv("LOOPFORGE_STORAGE", "./storage"))


class Storage:
    """
    Content-addressable file storage.
    
    Files are organized as:
        storage/
        ├── uploads/           # Original uploaded files
        │   └── {session_id}/
        ├── stems/             # Separated stems
        │   └── {session_id}/
        ├── slices/            # Exported slices
        │   └── {session_id}/
        ├── exports/           # Final exports
        │   └── {session_id}/
        └── cache/             # Temporary processing files
            └── {hash}/
    """
    
    BUCKETS = ["uploads", "stems", "slices", "exports", "cache"]
    
    def __init__(self, root: Optional[Path] = None):
        self.root = root or STORAGE_ROOT
        self._init_buckets()
    
    def _init_buckets(self):
        """Create storage directories"""
        for bucket in self.BUCKETS:
            (self.root / bucket).mkdir(parents=True, exist_ok=True)
    
    # =========================================================================
    # FILE OPERATIONS
    # =========================================================================
    
    def save_upload(
        self, 
        session_id: str, 
        filename: str, 
        file_obj: BinaryIO
    ) -> Tuple[Path, str]:
        """
        Save an uploaded file.
        
        Returns:
            Tuple of (file_path, content_hash)
        """
        session_dir = self.root / "uploads" / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        
        # Sanitize filename
        safe_filename = self._sanitize_filename(filename)
        file_path = session_dir / safe_filename
        
        # Write file and compute hash
        hasher = hashlib.sha256()
        with open(file_path, "wb") as f:
            while chunk := file_obj.read(8192):
                hasher.update(chunk)
                f.write(chunk)
        
        content_hash = hasher.hexdigest()
        return file_path, content_hash
    
    def save_stem(
        self,
        session_id: str,
        stem_name: str,
        source_path: Path,
        extension: str = ".wav"
    ) -> Path:
        """Save a separated stem"""
        session_dir = self.root / "stems" / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        
        dest_path = session_dir / f"{stem_name}{extension}"
        try:
            if source_path.resolve() != dest_path.resolve():
                os.replace(source_path, dest_path)
        except Exception:
            shutil.copy2(source_path, dest_path)
        return dest_path
    
    def save_slice(
        self,
        session_id: str,
        slice_bank_id: str,
        slice_index: int,
        source_path: Path,
    ) -> Path:
        """Save an exported slice"""
        session_dir = self.root / "slices" / session_id / slice_bank_id
        session_dir.mkdir(parents=True, exist_ok=True)
        
        dest_path = session_dir / f"slice_{slice_index:04d}.wav"
        shutil.copy2(source_path, dest_path)
        return dest_path
    
    def save_export(
        self,
        session_id: str,
        filename: str,
        source_path: Path,
    ) -> Path:
        """Save a final export"""
        session_dir = self.root / "exports" / session_id
        session_dir.mkdir(parents=True, exist_ok=True)
        
        dest_path = session_dir / filename
        shutil.copy2(source_path, dest_path)
        return dest_path
    
    def get_cache_path(self, cache_key: str, extension: str = "") -> Path:
        """Get a path for temporary cached files"""
        cache_dir = self.root / "cache" / cache_key[:2]  # Sharding by first 2 chars
        cache_dir.mkdir(parents=True, exist_ok=True)
        return cache_dir / f"{cache_key}{extension}"
    
    # =========================================================================
    # QUERIES
    # =========================================================================
    
    def get_stems(self, session_id: str) -> dict[str, Path]:
        """Get all stems for a session"""
        stem_dir = self.root / "stems" / session_id
        if not stem_dir.exists():
            return {}
        
        stems = {}
        for file_path in stem_dir.glob("*.wav"):
            stem_name = file_path.stem
            stems[stem_name] = file_path
        return stems
    
    def get_upload(self, session_id: str) -> Optional[Path]:
        """Get the original upload for a session"""
        upload_dir = self.root / "uploads" / session_id
        if not upload_dir.exists():
            return None
        
        # Return first audio file found
        for ext in [".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aiff"]:
            for file_path in upload_dir.glob(f"*{ext}"):
                return file_path
        return None
    
    def exists(self, path: Path) -> bool:
        """Check if a file exists"""
        return path.exists()
    
    def get_file_info(self, path: Path) -> dict:
        """Get file metadata"""
        if not path.exists():
            return {}
        
        stat = path.stat()
        return {
            "path": str(path),
            "size": stat.st_size,
            "modified": datetime.fromtimestamp(stat.st_mtime).isoformat(),
            "created": datetime.fromtimestamp(stat.st_ctime).isoformat(),
        }
    
    # =========================================================================
    # CLEANUP
    # =========================================================================
    
    def delete_session(self, session_id: str):
        """Delete all files for a session"""
        for bucket in ["uploads", "stems", "slices", "exports"]:
            session_dir = self.root / bucket / session_id
            if session_dir.exists():
                shutil.rmtree(session_dir)
    
    def cleanup_cache(self, max_age_hours: int = 24):
        """Remove old cache files"""
        cache_dir = self.root / "cache"
        if not cache_dir.exists():
            return
        
        cutoff = datetime.now().timestamp() - (max_age_hours * 3600)
        
        for shard_dir in cache_dir.iterdir():
            if not shard_dir.is_dir():
                continue
            for file_path in shard_dir.iterdir():
                if file_path.stat().st_mtime < cutoff:
                    file_path.unlink()
    
    # =========================================================================
    # UTILITIES
    # =========================================================================
    
    @staticmethod
    def _sanitize_filename(filename: str) -> str:
        """Remove potentially dangerous characters from filename"""
        # Keep only alphanumeric, dots, dashes, underscores
        safe_chars = set("abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789.-_")
        result = "".join(c if c in safe_chars else "_" for c in filename)
        # Ensure it doesn't start with a dot (hidden file)
        if result.startswith("."):
            result = "_" + result[1:]
        return result or "unnamed"
    
    @staticmethod
    def compute_hash(file_path: Path) -> str:
        """Compute SHA256 hash of a file"""
        hasher = hashlib.sha256()
        with open(file_path, "rb") as f:
            while chunk := f.read(8192):
                hasher.update(chunk)
        return hasher.hexdigest()


# Singleton instance
_storage: Optional[Storage] = None


def get_storage() -> Storage:
    """Get the storage singleton"""
    global _storage
    if _storage is None:
        _storage = Storage()
    return _storage
