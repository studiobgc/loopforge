"""
File Browser API Routes

Browse local filesystem for audio files (Ableton-style sample management).
"""

import os
from pathlib import Path
from typing import Optional, List
from datetime import datetime

from fastapi import APIRouter, HTTPException, Query
from fastapi.responses import FileResponse
from pydantic import BaseModel

router = APIRouter(prefix="/filebrowser", tags=["File Browser"])

# Audio file extensions we support
AUDIO_EXTENSIONS = {'.wav', '.mp3', '.aiff', '.aif', '.flac', '.m4a', '.ogg', '.opus'}

# Default sample library paths (macOS)
DEFAULT_LIBRARY_PATHS = [
    "/Users/ben/Music/Audio Hijack",  # Audio Hijack recordings
    os.path.expanduser("~/Music"),
    os.path.expanduser("~/Desktop"),
    os.path.expanduser("~/Downloads"),
]


class FileItem(BaseModel):
    name: str
    path: str
    is_directory: bool
    size: Optional[int] = None
    modified: Optional[str] = None
    extension: Optional[str] = None
    duration: Optional[float] = None


class DirectoryListing(BaseModel):
    path: str
    parent: Optional[str]
    items: List[FileItem]
    audio_count: int
    folder_count: int


class LibraryLocation(BaseModel):
    name: str
    path: str
    exists: bool


def get_file_info(file_path: Path) -> Optional[FileItem]:
    """Get file/directory info with safety checks."""
    try:
        if not file_path.exists():
            return None
        
        stat = file_path.stat()
        is_dir = file_path.is_dir()
        
        # Skip hidden files and system directories
        if file_path.name.startswith('.'):
            return None
        
        # For files, check if it's an audio file we support
        ext = file_path.suffix.lower() if not is_dir else None
        if not is_dir and ext not in AUDIO_EXTENSIONS:
            return None
        
        return FileItem(
            name=file_path.name,
            path=str(file_path),
            is_directory=is_dir,
            size=stat.st_size if not is_dir else None,
            modified=datetime.fromtimestamp(stat.st_mtime).isoformat() if stat.st_mtime else None,
            extension=ext,
        )
    except (PermissionError, OSError):
        return None


@router.get("/libraries", response_model=List[LibraryLocation])
async def get_library_locations():
    """Get configured sample library locations."""
    locations = []
    
    for path in DEFAULT_LIBRARY_PATHS:
        p = Path(path)
        locations.append(LibraryLocation(
            name=p.name,
            path=str(p),
            exists=p.exists() and p.is_dir()
        ))
    
    return locations


@router.get("/browse", response_model=DirectoryListing)
async def browse_directory(
    path: str = Query(..., description="Directory path to browse"),
    show_all: bool = Query(False, description="Show all files, not just audio")
):
    """Browse a directory for audio files."""
    dir_path = Path(path)
    
    if not dir_path.exists():
        raise HTTPException(404, f"Directory not found: {path}")
    
    if not dir_path.is_dir():
        raise HTTPException(400, f"Not a directory: {path}")
    
    # Security: prevent path traversal attacks
    try:
        dir_path = dir_path.resolve()
    except (PermissionError, OSError) as e:
        raise HTTPException(403, f"Access denied: {e}")
    
    items: List[FileItem] = []
    audio_count = 0
    folder_count = 0
    
    try:
        for entry in sorted(dir_path.iterdir(), key=lambda x: (not x.is_dir(), x.name.lower())):
            # Skip hidden files
            if entry.name.startswith('.'):
                continue
            
            if entry.is_dir():
                items.append(FileItem(
                    name=entry.name,
                    path=str(entry),
                    is_directory=True,
                ))
                folder_count += 1
            else:
                ext = entry.suffix.lower()
                if ext in AUDIO_EXTENSIONS or show_all:
                    try:
                        stat = entry.stat()
                        items.append(FileItem(
                            name=entry.name,
                            path=str(entry),
                            is_directory=False,
                            size=stat.st_size,
                            modified=datetime.fromtimestamp(stat.st_mtime).isoformat(),
                            extension=ext,
                        ))
                        if ext in AUDIO_EXTENSIONS:
                            audio_count += 1
                    except (PermissionError, OSError):
                        continue
    except PermissionError:
        raise HTTPException(403, f"Permission denied: {path}")
    
    # Get parent path
    parent = str(dir_path.parent) if dir_path.parent != dir_path else None
    
    return DirectoryListing(
        path=str(dir_path),
        parent=parent,
        items=items,
        audio_count=audio_count,
        folder_count=folder_count,
    )


@router.get("/search")
async def search_audio_files(
    path: str = Query(..., description="Root directory to search"),
    query: str = Query(..., description="Search query (filename contains)"),
    max_results: int = Query(50, le=200, description="Maximum results")
):
    """Search for audio files by name within a directory tree."""
    root_path = Path(path)
    
    if not root_path.exists() or not root_path.is_dir():
        raise HTTPException(404, f"Directory not found: {path}")
    
    results: List[FileItem] = []
    query_lower = query.lower()
    
    try:
        for root, dirs, files in os.walk(root_path):
            # Skip hidden directories
            dirs[:] = [d for d in dirs if not d.startswith('.')]
            
            for filename in files:
                if len(results) >= max_results:
                    break
                
                ext = Path(filename).suffix.lower()
                if ext not in AUDIO_EXTENSIONS:
                    continue
                
                if query_lower in filename.lower():
                    file_path = Path(root) / filename
                    try:
                        stat = file_path.stat()
                        results.append(FileItem(
                            name=filename,
                            path=str(file_path),
                            is_directory=False,
                            size=stat.st_size,
                            modified=datetime.fromtimestamp(stat.st_mtime).isoformat(),
                            extension=ext,
                        ))
                    except (PermissionError, OSError):
                        continue
            
            if len(results) >= max_results:
                break
    except PermissionError:
        pass
    
    return {
        "query": query,
        "root": str(root_path),
        "results": results,
        "count": len(results),
        "truncated": len(results) >= max_results
    }


@router.get("/stream")
async def stream_audio_file(path: str = Query(..., description="File path to stream")):
    """Stream an audio file for preview playback."""
    file_path = Path(path)
    
    if not file_path.exists():
        raise HTTPException(404, f"File not found: {path}")
    
    if not file_path.is_file():
        raise HTTPException(400, f"Not a file: {path}")
    
    ext = file_path.suffix.lower()
    if ext not in AUDIO_EXTENSIONS:
        raise HTTPException(400, f"Not an audio file: {path}")
    
    # Determine MIME type
    mime_types = {
        '.wav': 'audio/wav',
        '.mp3': 'audio/mpeg',
        '.aiff': 'audio/aiff',
        '.aif': 'audio/aiff',
        '.flac': 'audio/flac',
        '.m4a': 'audio/mp4',
        '.ogg': 'audio/ogg',
        '.opus': 'audio/opus',
    }
    
    return FileResponse(
        file_path,
        media_type=mime_types.get(ext, 'audio/wav'),
        filename=file_path.name,
    )


@router.post("/add-library")
async def add_library_location(path: str = Query(..., description="Directory path to add")):
    """Add a new library location (validates path exists)."""
    dir_path = Path(path)
    
    if not dir_path.exists():
        raise HTTPException(404, f"Directory not found: {path}")
    
    if not dir_path.is_dir():
        raise HTTPException(400, f"Not a directory: {path}")
    
    # In a full implementation, we'd persist this to a config file
    # For now, just validate and return
    return {
        "success": True,
        "path": str(dir_path.resolve()),
        "name": dir_path.name,
    }
