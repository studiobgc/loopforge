import { useState, useRef, useCallback } from 'react'
import { useDropzone } from 'react-dropzone'
// import WaveSurfer from 'wavesurfer.js' // Reserved for real waveform viz

// Types
interface SourceTrack {
  id: string
  file: File | null
  role: 'drums' | 'vocals' | 'bass' | 'melody' | null
  bpm: number | null
  key: string | null
  waveform: any | null
}

interface LoopResult {
  filename: string
  path: string
  bpm: number
  bars: number
  type: string
  role: string
  selected: boolean
}

type Phase = 'upload' | 'configure' | 'processing' | 'browse'

const ROLES = ['drums', 'vocals', 'bass', 'melody'] as const

export default function LoopWorkstation() {
  // Core state
  const [phase, setPhase] = useState<Phase>('upload')
  const [sources, setSources] = useState<SourceTrack[]>([])
  const [loops, setLoops] = useState<LoopResult[]>([])
  const [sessionId, setSessionId] = useState<string | null>(null)
  
  // Processing state
  const [progress, setProgress] = useState(0)
  const [stage, setStage] = useState('')
  
  // Playback state
  const [playingId, setPlayingId] = useState<string | null>(null)
  const audioRef = useRef<HTMLAudioElement | null>(null)
  // Reserved for future waveform visualization
  // const waveformRefs = useRef<Map<string, WaveSurfer>>(new Map())
  
  // Upload handler
  const onDrop = useCallback(async (files: File[]) => {
    const newSources: SourceTrack[] = files.map((file, i) => ({
      id: `track-${Date.now()}-${i}`,
      file,
      role: null,
      bpm: null,
      key: null,
      waveform: null
    }))
    
    setSources(prev => [...prev, ...newSources])
    
    if (phase === 'upload') {
      setPhase('configure')
    }
  }, [phase])
  
  const { getRootProps, getInputProps, isDragActive } = useDropzone({
    onDrop,
    accept: { 'audio/*': ['.mp3', '.wav', '.flac', '.m4a', '.aiff'] }
  })
  
  // Role assignment
  const setRole = (trackId: string, role: typeof ROLES[number] | null) => {
    setSources(prev => prev.map(s => 
      s.id === trackId ? { ...s, role } : s
    ))
  }
  
  // Remove track
  const removeTrack = (trackId: string) => {
    setSources(prev => prev.filter(s => s.id !== trackId))
  }
  
  // Process
  const startProcessing = async () => {
    const tracksWithRoles = sources.filter(s => s.file && s.role)
    if (tracksWithRoles.length === 0) return
    
    setPhase('processing')
    setProgress(0)
    setStage('uploading files...')
    
    try {
      // Upload
      const formData = new FormData()
      tracksWithRoles.forEach(s => {
        if (s.file) formData.append('files', s.file)
      })
      
      const uploadRes = await fetch('/api/forge/forge-complete', {
        method: 'POST',
        body: formData
      })
      const uploadData = await uploadRes.json()
      const session_id = uploadData.session_id
      setSessionId(session_id)
      
      // Build role map
      const roleMap: Record<string, string> = {}
      tracksWithRoles.forEach(s => {
        if (s.file && s.role) roleMap[s.file.name] = s.role
      })
      
      // Get anchor (first track's key)
      const anchorKey = uploadData.analyses?.[0]?.key || 'C'
      const anchorMode = uploadData.analyses?.[0]?.mode || 'minor'
      
      setStage('demucs · separating stems...')
      setProgress(10)
      
      // Start processing
      await fetch(
        `/api/forge/forge-complete/${session_id}/process?` + new URLSearchParams({
          anchor_key: anchorKey,
          anchor_mode: anchorMode,
          roles: JSON.stringify(roleMap),
          enabled_presets: ''
        }),
        { method: 'POST' }
      )
      
      // Poll for status
      const poll = setInterval(async () => {
        const res = await fetch(`/api/forge/forge-complete/${session_id}/status`)
        const data = await res.json()
        
        if (data.progress) setProgress(data.progress)
        if (data.message) setStage(data.message)
        
        if (data.status === 'complete') {
          clearInterval(poll)
          
          // Convert results to loops with selection state
          const loopResults: LoopResult[] = (data.results || []).map((r: any) => ({
            ...r,
            selected: true // Select all by default
          }))
          
          setLoops(loopResults)
          setPhase('browse')
        } else if (data.status === 'error') {
          clearInterval(poll)
          setStage(`error: ${data.message}`)
        }
      }, 1500)
      
    } catch (err) {
      console.error(err)
      setStage('error: processing failed')
    }
  }
  
  // Toggle loop selection
  const toggleLoop = (filename: string) => {
    setLoops(prev => prev.map(l => 
      l.filename === filename ? { ...l, selected: !l.selected } : l
    ))
  }
  
  // Select all / none
  const selectAll = () => setLoops(prev => prev.map(l => ({ ...l, selected: true })))
  const selectNone = () => setLoops(prev => prev.map(l => ({ ...l, selected: false })))
  
  // Play preview
  const playLoop = (filename: string) => {
    if (!audioRef.current) {
      audioRef.current = new Audio()
    }
    
    if (playingId === filename) {
      audioRef.current.pause()
      setPlayingId(null)
    } else {
      audioRef.current.src = `/api/forge/stream/${sessionId}/${filename}`
      audioRef.current.play()
      setPlayingId(filename)
      audioRef.current.onended = () => setPlayingId(null)
    }
  }
  
  // Download selected
  const downloadSelected = () => {
    if (!sessionId) return
    // For now, download the full zip
    // TODO: Create endpoint for selective download
    window.open(`/api/forge/download-complete/${sessionId}`, '_blank')
  }
  
  // Reset
  const reset = () => {
    setSources([])
    setLoops([])
    setSessionId(null)
    setPhase('upload')
    setProgress(0)
    setStage('')
  }

  return (
    <div className="min-h-screen bg-[#0a0a0b] text-[#e8e8e8] font-mono text-sm">
      {/* Header */}
      <header className="border-b border-white/10 px-6 py-4 flex items-center justify-between">
        <div className="flex items-center gap-4">
          <h1 className="text-xs font-bold tracking-widest uppercase opacity-70">Loop Forge</h1>
          <span className="text-[10px] px-2 py-0.5 bg-white/5 rounded opacity-50">v4.0</span>
        </div>
        <div className="flex items-center gap-3 text-[10px] opacity-40">
          <span>rubberband</span>
          <span>·</span>
          <span>neural vad</span>
          <span>·</span>
          <span>demucs</span>
        </div>
      </header>
      
      {/* Upload Phase */}
      {phase === 'upload' && (
        <main className="p-8">
          <div
            {...getRootProps()}
            className={`
              border border-dashed border-white/20 rounded-none p-16
              flex flex-col items-center justify-center
              cursor-pointer transition-colors
              ${isDragActive ? 'border-white/40 bg-white/5' : 'hover:border-white/30'}
            `}
          >
            <input {...getInputProps()} />
            <div className="text-center">
              <div className="text-2xl mb-4 opacity-30">↑</div>
              <p className="text-xs opacity-50 mb-2">drop audio files</p>
              <p className="text-[10px] opacity-30">.wav .mp3 .flac .m4a .aiff</p>
            </div>
          </div>
        </main>
      )}
      
      {/* Configure Phase */}
      {phase === 'configure' && (
        <main className="p-6">
          {/* Track List */}
          <div className="mb-8">
            <div className="text-[10px] uppercase tracking-widest opacity-40 mb-4">Source Tracks</div>
            <div className="space-y-2">
              {sources.map(track => (
                <div key={track.id} className="flex items-center gap-4 p-4 bg-white/5 border border-white/10">
                  {/* Filename */}
                  <div className="flex-1 truncate text-xs">
                    {track.file?.name}
                  </div>
                  
                  {/* Role Selector */}
                  <div className="flex gap-1">
                    {ROLES.map(role => (
                      <button
                        key={role}
                        onClick={() => setRole(track.id, track.role === role ? null : role)}
                        className={`
                          px-3 py-1.5 text-[10px] uppercase tracking-wider
                          border transition-colors
                          ${track.role === role 
                            ? 'bg-white text-black border-white' 
                            : 'border-white/20 hover:border-white/40'}
                        `}
                      >
                        {role}
                      </button>
                    ))}
                  </div>
                  
                  {/* Remove */}
                  <button 
                    onClick={() => removeTrack(track.id)}
                    className="text-white/30 hover:text-white/60 px-2"
                  >
                    ×
                  </button>
                </div>
              ))}
            </div>
          </div>
          
          {/* Add More */}
          <div
            {...getRootProps()}
            className="border border-dashed border-white/10 p-4 text-center cursor-pointer hover:border-white/20 mb-8"
          >
            <input {...getInputProps()} />
            <span className="text-[10px] opacity-40">+ add more files</span>
          </div>
          
          {/* Process Button */}
          <button
            onClick={startProcessing}
            disabled={!sources.some(s => s.role)}
            className={`
              w-full py-4 text-xs uppercase tracking-widest
              border transition-colors
              ${sources.some(s => s.role)
                ? 'border-white bg-white text-black hover:bg-white/90'
                : 'border-white/10 text-white/30 cursor-not-allowed'}
            `}
          >
            process
          </button>
        </main>
      )}
      
      {/* Processing Phase */}
      {phase === 'processing' && (
        <main className="p-8 flex flex-col items-center justify-center min-h-[60vh]">
          <div className="w-full max-w-md">
            {/* Progress */}
            <div className="text-4xl font-light mb-4 tabular-nums text-center">
              {progress}<span className="text-lg opacity-40">%</span>
            </div>
            
            {/* Stage */}
            <div className="text-[10px] text-center opacity-50 mb-8 h-4">
              {stage}
            </div>
            
            {/* Bar */}
            <div className="h-px bg-white/10 w-full">
              <div 
                className="h-full bg-white/60 transition-all duration-300"
                style={{ width: `${progress}%` }}
              />
            </div>
          </div>
        </main>
      )}
      
      {/* Browse Phase */}
      {phase === 'browse' && (
        <main className="p-6">
          {/* Controls */}
          <div className="flex items-center justify-between mb-6">
            <div className="flex items-center gap-4">
              <span className="text-[10px] uppercase tracking-widest opacity-40">
                {loops.length} outputs
              </span>
              <button onClick={selectAll} className="text-[10px] opacity-40 hover:opacity-70">all</button>
              <button onClick={selectNone} className="text-[10px] opacity-40 hover:opacity-70">none</button>
            </div>
            <div className="flex items-center gap-4">
              <button onClick={reset} className="text-[10px] opacity-40 hover:opacity-70">reset</button>
              <button
                onClick={downloadSelected}
                disabled={!loops.some(l => l.selected)}
                className={`
                  px-4 py-2 text-[10px] uppercase tracking-widest
                  ${loops.some(l => l.selected)
                    ? 'bg-white text-black'
                    : 'bg-white/10 text-white/30 cursor-not-allowed'}
                `}
              >
                download ({loops.filter(l => l.selected).length})
              </button>
            </div>
          </div>
          
          {/* Loop Grid */}
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-3">
            {loops.map(loop => (
              <div
                key={loop.filename}
                className={`
                  border p-4 transition-colors cursor-pointer
                  ${loop.selected ? 'border-white/40 bg-white/5' : 'border-white/10'}
                `}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-3">
                  <div className="flex items-center gap-2">
                    {/* Select checkbox */}
                    <button
                      onClick={() => toggleLoop(loop.filename)}
                      className={`
                        w-4 h-4 border flex items-center justify-center
                        ${loop.selected ? 'bg-white border-white' : 'border-white/30'}
                      `}
                    >
                      {loop.selected && <span className="text-black text-[10px]">✓</span>}
                    </button>
                    
                    {/* Role tag */}
                    <span className="text-[10px] uppercase tracking-wider opacity-50">
                      {loop.role}
                    </span>
                  </div>
                  
                  {/* Play button */}
                  <button
                    onClick={() => playLoop(loop.filename)}
                    className={`
                      w-8 h-8 border rounded-full flex items-center justify-center
                      transition-colors
                      ${playingId === loop.filename 
                        ? 'bg-white text-black border-white' 
                        : 'border-white/30 hover:border-white/50'}
                    `}
                  >
                    <span className="text-xs">{playingId === loop.filename ? '❚❚' : '▶'}</span>
                  </button>
                </div>
                
                {/* Waveform placeholder */}
                <div className="h-12 bg-white/5 mb-3 flex items-center justify-center">
                  <div className="flex items-end gap-px h-8">
                    {[...Array(40)].map((_, i) => (
                      <div
                        key={i}
                        className="w-1 bg-white/30"
                        style={{ height: `${20 + Math.sin(i * 0.5) * 15 + Math.random() * 10}%` }}
                      />
                    ))}
                  </div>
                </div>
                
                {/* Meta */}
                <div className="flex items-center justify-between text-[10px] opacity-40">
                  <span>{loop.bars} bars</span>
                  <span>{loop.bpm} bpm</span>
                </div>
                
                {/* Filename */}
                <div className="text-[10px] opacity-30 mt-2 truncate">
                  {loop.filename}
                </div>
              </div>
            ))}
          </div>
        </main>
      )}
    </div>
  )
}
