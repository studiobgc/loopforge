import React, { useState, useEffect, useCallback, useRef } from 'react';

const API_BASE = '';

interface FileItem {
    name: string;
    path: string;
    is_directory: boolean;
    size?: number;
    modified?: string;
    extension?: string;
}

interface LibraryLocation {
    name: string;
    path: string;
    exists: boolean;
}

interface FileBrowserProps {
    onFileSelect?: (files: File[]) => void;
    onFileDragStart?: (file: FileItem) => void;
}

const formatFileSize = (bytes?: number): string => {
    if (!bytes) return '';
    if (bytes < 1024) return `${bytes} B`;
    if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
    return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
};

export const FileBrowser: React.FC<FileBrowserProps> = ({ onFileSelect, onFileDragStart }) => {
    const [libraries, setLibraries] = useState<LibraryLocation[]>([]);
    const [currentPath, setCurrentPath] = useState<string | null>(null);
    const [items, setItems] = useState<FileItem[]>([]);
    const [parentPath, setParentPath] = useState<string | null>(null);
    const [loading, setLoading] = useState(false);
    const [error, setError] = useState<string | null>(null);
    const [searchQuery, setSearchQuery] = useState('');
    const [searchResults, setSearchResults] = useState<FileItem[] | null>(null);
    const [selectedFiles, setSelectedFiles] = useState<Set<string>>(new Set());
    const [previewingFile, setPreviewingFile] = useState<string | null>(null);
    const audioRef = useRef<HTMLAudioElement>(null);
    const searchTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

    // Load library locations on mount
    useEffect(() => {
        fetch(`${API_BASE}/api/filebrowser/libraries`)
            .then(res => res.json())
            .then(data => setLibraries(data.filter((lib: LibraryLocation) => lib.exists)))
            .catch(err => console.error('Failed to load libraries:', err));
    }, []);

    // Browse directory
    const browseDirectory = useCallback(async (path: string) => {
        setLoading(true);
        setError(null);
        setSearchResults(null);
        setSearchQuery('');
        
        try {
            const res = await fetch(`${API_BASE}/api/filebrowser/browse?path=${encodeURIComponent(path)}`);
            if (!res.ok) {
                const err = await res.json();
                throw new Error(err.detail || 'Failed to browse directory');
            }
            const data = await res.json();
            setCurrentPath(data.path);
            setParentPath(data.parent);
            setItems(data.items);
        } catch (err: any) {
            setError(err.message);
        } finally {
            setLoading(false);
        }
    }, []);

    // Search files
    const searchFiles = useCallback(async (query: string) => {
        if (!currentPath || query.length < 2) {
            setSearchResults(null);
            return;
        }

        try {
            const res = await fetch(
                `${API_BASE}/api/filebrowser/search?path=${encodeURIComponent(currentPath)}&query=${encodeURIComponent(query)}`
            );
            if (res.ok) {
                const data = await res.json();
                setSearchResults(data.results);
            }
        } catch (err) {
            console.error('Search failed:', err);
        }
    }, [currentPath]);

    // Debounced search
    useEffect(() => {
        if (searchTimeoutRef.current) {
            clearTimeout(searchTimeoutRef.current);
        }
        
        if (searchQuery.length >= 2) {
            searchTimeoutRef.current = setTimeout(() => {
                searchFiles(searchQuery);
            }, 300);
        } else {
            setSearchResults(null);
        }
        
        return () => {
            if (searchTimeoutRef.current) {
                clearTimeout(searchTimeoutRef.current);
            }
        };
    }, [searchQuery, searchFiles]);

    // Preview audio file
    const previewFile = useCallback((file: FileItem) => {
        if (previewingFile === file.path) {
            // Stop preview
            if (audioRef.current) {
                audioRef.current.pause();
                audioRef.current.currentTime = 0;
            }
            setPreviewingFile(null);
        } else {
            // Start preview
            setPreviewingFile(file.path);
            if (audioRef.current) {
                audioRef.current.src = `${API_BASE}/api/filebrowser/stream?path=${encodeURIComponent(file.path)}`;
                audioRef.current.play().catch(() => {});
            }
        }
    }, [previewingFile]);

    // Handle file selection
    const toggleFileSelection = useCallback((file: FileItem, event: React.MouseEvent) => {
        if (file.is_directory) return;
        
        setSelectedFiles(prev => {
            const next = new Set(prev);
            if (event.shiftKey || event.metaKey) {
                if (next.has(file.path)) {
                    next.delete(file.path);
                } else {
                    next.add(file.path);
                }
            } else {
                next.clear();
                next.add(file.path);
            }
            return next;
        });
    }, []);

    // Handle drag start for files
    const handleDragStart = useCallback((e: React.DragEvent, file: FileItem) => {
        if (file.is_directory) return;
        
        e.dataTransfer.setData('application/json', JSON.stringify(file));
        e.dataTransfer.setData('text/plain', file.path);
        e.dataTransfer.effectAllowed = 'copy';
        
        if (onFileDragStart) {
            onFileDragStart(file);
        }
    }, [onFileDragStart]);

    // Add selected files to session
    const addSelectedFiles = useCallback(async () => {
        if (selectedFiles.size === 0 || !onFileSelect) return;
        
        const filesToAdd: File[] = [];
        
        for (const path of selectedFiles) {
            try {
                const res = await fetch(`${API_BASE}/api/filebrowser/stream?path=${encodeURIComponent(path)}`);
                const blob = await res.blob();
                const filename = path.split('/').pop() || 'audio.wav';
                filesToAdd.push(new File([blob], filename, { type: blob.type }));
            } catch (err) {
                console.error('Failed to load file:', path, err);
            }
        }
        
        if (filesToAdd.length > 0) {
            onFileSelect(filesToAdd);
            setSelectedFiles(new Set());
        }
    }, [selectedFiles, onFileSelect]);

    // Double-click to add file
    const handleDoubleClick = useCallback(async (file: FileItem) => {
        if (file.is_directory) {
            browseDirectory(file.path);
            return;
        }
        
        if (!onFileSelect) return;
        
        try {
            const res = await fetch(`${API_BASE}/api/filebrowser/stream?path=${encodeURIComponent(file.path)}`);
            const blob = await res.blob();
            const fileObj = new File([blob], file.name, { type: blob.type });
            onFileSelect([fileObj]);
        } catch (err) {
            console.error('Failed to load file:', err);
        }
    }, [browseDirectory, onFileSelect]);

    const displayItems = searchResults || items;

    return (
        <div className="flex flex-col h-full" style={{ minHeight: 0 }}>
            {/* Header */}
            <div style={{ 
                padding: '12px 14px', 
                borderBottom: '1px solid rgba(255,255,255,0.08)',
                background: 'rgba(0,0,0,0.2)'
            }}>
                <div style={{ 
                    fontSize: '10px', 
                    fontWeight: 600, 
                    color: 'var(--accent-primary)',
                    letterSpacing: '1px',
                    marginBottom: '8px'
                }}>
                    FILE BROWSER
                </div>
                
                {/* Breadcrumb / Path */}
                {currentPath && (
                    <div className="flex items-center gap-1" style={{ marginBottom: '8px' }}>
                        <button
                            onClick={() => setCurrentPath(null)}
                            style={{
                                background: 'transparent',
                                border: 'none',
                                color: 'var(--text-dim)',
                                fontSize: '9px',
                                cursor: 'pointer',
                                padding: '2px 4px',
                            }}
                            title="Back to libraries"
                        >
                            ◀ LIBRARIES
                        </button>
                        {parentPath && (
                            <button
                                onClick={() => browseDirectory(parentPath)}
                                style={{
                                    background: 'rgba(255,255,255,0.05)',
                                    border: '1px solid rgba(255,255,255,0.1)',
                                    borderRadius: '3px',
                                    color: 'var(--text-dim)',
                                    fontSize: '9px',
                                    cursor: 'pointer',
                                    padding: '2px 6px',
                                }}
                                title="Go up"
                            >
                                ↑ UP
                            </button>
                        )}
                    </div>
                )}
                
                {/* Search */}
                {currentPath && (
                    <input
                        type="text"
                        placeholder="Search audio files..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        style={{
                            width: '100%',
                            background: 'rgba(0,0,0,0.3)',
                            border: '1px solid rgba(255,255,255,0.1)',
                            borderRadius: '4px',
                            padding: '6px 10px',
                            fontSize: '10px',
                            color: 'var(--text-bright)',
                            outline: 'none',
                        }}
                    />
                )}
            </div>

            {/* Content */}
            <div className="flex-1 overflow-y-auto custom-scrollbar" style={{ minHeight: 0 }}>
                {loading && (
                    <div style={{ padding: '20px', textAlign: 'center', color: 'var(--text-dim)', fontSize: '10px' }}>
                        Loading...
                    </div>
                )}
                
                {error && (
                    <div style={{ 
                        padding: '12px', 
                        margin: '8px',
                        background: 'rgba(239, 68, 68, 0.1)', 
                        border: '1px solid rgba(239, 68, 68, 0.2)',
                        borderRadius: '4px',
                        color: '#f87171',
                        fontSize: '10px'
                    }}>
                        {error}
                    </div>
                )}

                {/* Library Locations */}
                {!currentPath && !loading && (
                    <div style={{ padding: '8px' }}>
                        {libraries.map(lib => (
                            <button
                                key={lib.path}
                                onClick={() => browseDirectory(lib.path)}
                                style={{
                                    width: '100%',
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '10px',
                                    padding: '10px 12px',
                                    background: 'rgba(255,255,255,0.03)',
                                    border: '1px solid rgba(255,255,255,0.08)',
                                    borderRadius: '4px',
                                    marginBottom: '6px',
                                    cursor: 'pointer',
                                    transition: 'all 0.15s',
                                    textAlign: 'left',
                                }}
                                onMouseEnter={(e) => {
                                    e.currentTarget.style.background = 'rgba(6, 182, 212, 0.1)';
                                    e.currentTarget.style.borderColor = 'rgba(6, 182, 212, 0.3)';
                                }}
                                onMouseLeave={(e) => {
                                    e.currentTarget.style.background = 'rgba(255,255,255,0.03)';
                                    e.currentTarget.style.borderColor = 'rgba(255,255,255,0.08)';
                                }}
                            >
                                <span style={{ fontSize: '16px' }}>📁</span>
                                <div>
                                    <div style={{ fontSize: '11px', fontWeight: 500, color: 'var(--text-bright)' }}>
                                        {lib.name}
                                    </div>
                                    <div style={{ fontSize: '9px', color: 'var(--text-dim)', marginTop: '2px' }}>
                                        {lib.path}
                                    </div>
                                </div>
                            </button>
                        ))}
                        
                        {libraries.length === 0 && (
                            <div style={{ 
                                padding: '20px', 
                                textAlign: 'center', 
                                color: 'var(--text-dim)',
                                fontSize: '10px'
                            }}>
                                No library locations configured
                            </div>
                        )}
                    </div>
                )}

                {/* File/Folder List */}
                {currentPath && !loading && (
                    <div style={{ padding: '4px' }}>
                        {displayItems.map(item => (
                            <div
                                key={item.path}
                                draggable={!item.is_directory}
                                onDragStart={(e) => handleDragStart(e, item)}
                                onClick={(e) => {
                                    if (item.is_directory) {
                                        browseDirectory(item.path);
                                    } else {
                                        toggleFileSelection(item, e);
                                    }
                                }}
                                onDoubleClick={() => handleDoubleClick(item)}
                                style={{
                                    display: 'flex',
                                    alignItems: 'center',
                                    gap: '8px',
                                    padding: '6px 10px',
                                    marginBottom: '2px',
                                    borderRadius: '3px',
                                    cursor: item.is_directory ? 'pointer' : 'grab',
                                    background: selectedFiles.has(item.path) 
                                        ? 'rgba(6, 182, 212, 0.2)' 
                                        : 'transparent',
                                    border: selectedFiles.has(item.path)
                                        ? '1px solid rgba(6, 182, 212, 0.4)'
                                        : '1px solid transparent',
                                    transition: 'all 0.1s',
                                }}
                                onMouseEnter={(e) => {
                                    if (!selectedFiles.has(item.path)) {
                                        e.currentTarget.style.background = 'rgba(255,255,255,0.05)';
                                    }
                                }}
                                onMouseLeave={(e) => {
                                    if (!selectedFiles.has(item.path)) {
                                        e.currentTarget.style.background = 'transparent';
                                    }
                                }}
                            >
                                {/* Icon */}
                                <span style={{ fontSize: '12px', width: '16px', textAlign: 'center' }}>
                                    {item.is_directory ? '📁' : '🎵'}
                                </span>
                                
                                {/* Name & Details */}
                                <div style={{ flex: 1, minWidth: 0 }}>
                                    <div style={{ 
                                        fontSize: '10px', 
                                        color: 'var(--text-bright)',
                                        whiteSpace: 'nowrap',
                                        overflow: 'hidden',
                                        textOverflow: 'ellipsis',
                                    }}>
                                        {item.name}
                                    </div>
                                    {!item.is_directory && item.size && (
                                        <div style={{ fontSize: '8px', color: 'var(--text-dim)', marginTop: '1px' }}>
                                            {formatFileSize(item.size)}
                                        </div>
                                    )}
                                </div>
                                
                                {/* Preview Button */}
                                {!item.is_directory && (
                                    <button
                                        onClick={(e) => {
                                            e.stopPropagation();
                                            previewFile(item);
                                        }}
                                        style={{
                                            background: previewingFile === item.path 
                                                ? 'rgba(6, 182, 212, 0.3)' 
                                                : 'rgba(255,255,255,0.1)',
                                            border: 'none',
                                            borderRadius: '3px',
                                            padding: '3px 6px',
                                            fontSize: '9px',
                                            color: previewingFile === item.path 
                                                ? 'var(--accent-primary)' 
                                                : 'var(--text-dim)',
                                            cursor: 'pointer',
                                        }}
                                        title={previewingFile === item.path ? 'Stop' : 'Preview'}
                                    >
                                        {previewingFile === item.path ? '■' : '▶'}
                                    </button>
                                )}
                            </div>
                        ))}
                        
                        {displayItems.length === 0 && (
                            <div style={{ 
                                padding: '20px', 
                                textAlign: 'center', 
                                color: 'var(--text-dim)',
                                fontSize: '10px'
                            }}>
                                {searchQuery ? 'No matching files' : 'No audio files in this folder'}
                            </div>
                        )}
                    </div>
                )}
            </div>

            {/* Footer: Add Selected */}
            {selectedFiles.size > 0 && (
                <div style={{ 
                    padding: '10px 12px', 
                    borderTop: '1px solid rgba(255,255,255,0.08)',
                    background: 'rgba(0,0,0,0.2)'
                }}>
                    <button
                        onClick={addSelectedFiles}
                        style={{
                            width: '100%',
                            padding: '8px 12px',
                            background: 'linear-gradient(135deg, var(--accent-primary), #0891b2)',
                            border: 'none',
                            borderRadius: '4px',
                            color: '#000',
                            fontSize: '10px',
                            fontWeight: 600,
                            cursor: 'pointer',
                            letterSpacing: '0.5px',
                        }}
                    >
                        ADD {selectedFiles.size} FILE{selectedFiles.size > 1 ? 'S' : ''} TO SESSION
                    </button>
                </div>
            )}

            {/* Hidden audio element for previews */}
            <audio 
                ref={audioRef} 
                onEnded={() => setPreviewingFile(null)}
                style={{ display: 'none' }}
            />
        </div>
    );
};

export default FileBrowser;
