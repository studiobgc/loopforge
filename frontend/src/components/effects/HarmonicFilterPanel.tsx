/**
 * HarmonicFilterPanel - Advanced Harmonic Filterbank UI
 * 
 * Inspired by Harmonium (Trevor Treglia's SuperCollider instrument).
 * Time-varying spectral filterbank with LFO modulation, voicing modes,
 * and presets for creative sound design.
 */

import React, { useState, useCallback } from 'react';
import { 
  Waves, Music, Sliders, Play, Loader2, Check, X, 
  Sparkles, ChevronDown, Info, Download, Volume2
} from 'lucide-react';
import { api } from '../../api/client';

interface HarmonicFilterPanelProps {
  sessionId: string;
  stemPath: string;
  stemRole: string;
  detectedKey?: string;
  sessionKey?: string;
  onProcessed?: (outputUrl: string) => void;
}

const NOTES = ['C', 'C#', 'D', 'D#', 'E', 'F', 'F#', 'G', 'G#', 'A', 'A#', 'B'];

const MODES = [
  { value: 'major', label: 'Major', desc: 'Bright, happy' },
  { value: 'minor', label: 'Minor', desc: 'Dark, moody' },
  { value: 'pentatonic', label: 'Pentatonic', desc: 'Open, ambient' },
  { value: 'dorian', label: 'Dorian', desc: 'Jazz, soul' },
  { value: 'chromatic', label: 'Chromatic', desc: 'All notes' },
];

const VOICINGS = [
  { value: 'natural', label: 'Natural', desc: 'Standard harmonic series' },
  { value: 'odd_only', label: 'Hollow', desc: 'Odd harmonics only (clarinet-like)' },
  { value: 'fifth', label: 'Power', desc: 'Root + fifth emphasis' },
  { value: 'spread', label: 'Spread', desc: 'Wide partial spacing' },
  { value: 'dense', label: 'Dense', desc: 'Clustered low-mids' },
];

const MOTIONS = [
  { value: 'static', label: 'Static', desc: 'No movement' },
  { value: 'breathe', label: 'Breathe', desc: 'Slow sine LFO' },
  { value: 'pulse', label: 'Pulse', desc: 'Rhythmic gating' },
  { value: 'shimmer', label: 'Shimmer', desc: 'Chorus-like detuning' },
  { value: 'drift', label: 'Drift', desc: 'Random walk' },
];

const PRESETS = [
  { value: '', label: 'Custom', desc: 'Manual settings' },
  { value: 'drone', label: 'Drone', desc: 'Deep, breathing pad' },
  { value: 'crystalline', label: 'Crystalline', desc: 'Bright, shimmering' },
  { value: 'hollow', label: 'Hollow', desc: 'Odd harmonics, static' },
  { value: 'warm', label: 'Warm', desc: 'Dark, dense low-end' },
  { value: 'ethereal', label: 'Ethereal', desc: 'Drifting fifths' },
];

export const HarmonicFilterPanel: React.FC<HarmonicFilterPanelProps> = ({
  sessionId,
  stemPath,
  stemRole,
  detectedKey,
  sessionKey,
  onProcessed,
}) => {
  // Parse detected key
  const parseKey = (key?: string): { root: string; mode: string } => {
    if (!key) return { root: 'C', mode: 'major' };
    const parts = key.split(' ');
    return {
      root: parts[0] || 'C',
      mode: parts[1]?.toLowerCase() || 'major',
    };
  };

  const defaultKey = parseKey(detectedKey || sessionKey);
  
  // State
  const [preset, setPreset] = useState('');
  const [rootNote, setRootNote] = useState(defaultKey.root);
  const [mode, setMode] = useState(defaultKey.mode);
  const [numHarmonics, setNumHarmonics] = useState(16);
  const [resonance, setResonance] = useState(0.5);
  const [spectralTilt, setSpectralTilt] = useState(0);
  const [voicing, setVoicing] = useState('natural');
  const [motion, setMotion] = useState('static');
  const [motionRate, setMotionRate] = useState(0.1);
  const [motionDepth, setMotionDepth] = useState(0.3);
  const [mix, setMix] = useState(1.0);
  
  const [showAdvanced, setShowAdvanced] = useState(false);
  const [isProcessing, setIsProcessing] = useState(false);
  const [result, setResult] = useState<{ success: boolean; url?: string; error?: string } | null>(null);

  // Key mismatch detection
  const stemKeyParsed = parseKey(detectedKey);
  const sessionKeyParsed = parseKey(sessionKey);
  const keyMismatch = detectedKey && sessionKey && 
    (stemKeyParsed.root !== sessionKeyParsed.root || stemKeyParsed.mode !== sessionKeyParsed.mode);

  const handleApply = useCallback(async () => {
    setIsProcessing(true);
    setResult(null);
    
    try {
      const response = await api.applyHarmonicFilter({
        sessionId,
        stemPath,
        rootNote,
        mode: mode as any,
        numHarmonics,
        resonance,
        mix,
        spectralTilt,
        voicing: voicing as any,
        motion: motion as any,
        motionRate,
        motionDepth,
        preset: preset || undefined,
      });
      
      setResult({ success: true, url: response.output_url });
      onProcessed?.(response.output_url);
    } catch (err: any) {
      setResult({ 
        success: false, 
        error: err.response?.data?.detail || err.message || 'Processing failed' 
      });
    } finally {
      setIsProcessing(false);
    }
  }, [sessionId, stemPath, rootNote, mode, numHarmonics, resonance, mix, 
      spectralTilt, voicing, motion, motionRate, motionDepth, preset, onProcessed]);

  // Match to session key
  const handleMatchToSession = () => {
    if (sessionKey) {
      const parsed = parseKey(sessionKey);
      setRootNote(parsed.root);
      setMode(parsed.mode);
    }
  };

  return (
    <div className="bg-zinc-900/80 border border-zinc-800 rounded-xl overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-zinc-800/50 bg-gradient-to-r from-purple-500/10 to-transparent">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <Waves className="w-4 h-4 text-purple-400" />
            <h3 className="text-sm font-medium text-zinc-200">Harmonic Filterbank</h3>
          </div>
          <a 
            href="https://www.trevortreglia.com/harmonium" 
            target="_blank" 
            rel="noopener noreferrer"
            className="text-[10px] text-zinc-600 hover:text-purple-400 transition-colors"
          >
            Inspired by Harmonium
          </a>
        </div>
        <p className="text-[11px] text-zinc-500 mt-1">
          Extract pitched material through time-varying resonant filters
        </p>
      </div>

      <div className="p-4 space-y-4">
        {/* Key Mismatch Warning */}
        {keyMismatch && (
          <div className="p-3 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <div className="flex items-start gap-2">
              <Info className="w-4 h-4 text-amber-400 flex-shrink-0 mt-0.5" />
              <div className="flex-1">
                <p className="text-xs text-amber-300">
                  <strong>Key mismatch:</strong> Stem is in <span className="font-mono">{detectedKey}</span>, 
                  session anchor is <span className="font-mono">{sessionKey}</span>
                </p>
                <button
                  onClick={handleMatchToSession}
                  className="mt-1.5 text-[11px] text-amber-400 hover:text-amber-300 underline"
                >
                  Filter to match session key ({sessionKey})
                </button>
              </div>
            </div>
          </div>
        )}

        {/* Preset Selection */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-400 flex items-center gap-1">
            <Sparkles className="w-3 h-3" />
            Preset
          </label>
          <div className="grid grid-cols-3 gap-1.5">
            {PRESETS.map((p) => (
              <button
                key={p.value}
                onClick={() => setPreset(p.value)}
                className={`
                  px-2 py-1.5 rounded-lg text-[11px] transition-all
                  ${preset === p.value 
                    ? 'bg-purple-500 text-white' 
                    : 'bg-zinc-800 text-zinc-400 hover:bg-zinc-700 hover:text-zinc-200'}
                `}
                title={p.desc}
              >
                {p.label}
              </button>
            ))}
          </div>
        </div>

        {/* Target Key */}
        <div className="space-y-2">
          <label className="text-xs text-zinc-400 flex items-center gap-1">
            <Music className="w-3 h-3" />
            Target Key
          </label>
          <div className="flex gap-2">
            <select
              value={rootNote}
              onChange={(e) => setRootNote(e.target.value)}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
            >
              {NOTES.map((note) => (
                <option key={note} value={note}>{note}</option>
              ))}
            </select>
            <select
              value={mode}
              onChange={(e) => setMode(e.target.value)}
              className="flex-1 bg-zinc-800 border border-zinc-700 rounded-lg px-3 py-2 text-sm text-zinc-200 focus:outline-none focus:ring-1 focus:ring-purple-500"
            >
              {MODES.map((m) => (
                <option key={m.value} value={m.value}>{m.label}</option>
              ))}
            </select>
          </div>
          {detectedKey && (
            <p className="text-[10px] text-zinc-600">
              Stem detected: <span className="text-zinc-400 font-mono">{detectedKey}</span>
            </p>
          )}
        </div>

        {/* Core Parameters */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Sliders className="w-3 h-3 text-zinc-500" />
            <span className="text-xs text-zinc-400">Sound</span>
          </div>
          
          {/* Voicing */}
          <div className="space-y-1.5">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Voicing</span>
              <span className="text-zinc-400">{VOICINGS.find(v => v.value === voicing)?.label}</span>
            </div>
            <div className="flex gap-1">
              {VOICINGS.map((v) => (
                <button
                  key={v.value}
                  onClick={() => setVoicing(v.value)}
                  className={`
                    flex-1 py-1 rounded text-[10px] transition-all
                    ${voicing === v.value 
                      ? 'bg-purple-500/30 text-purple-300 ring-1 ring-purple-500/50' 
                      : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}
                  `}
                  title={v.desc}
                >
                  {v.label.slice(0, 4)}
                </button>
              ))}
            </div>
          </div>
          
          {/* Resonance */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Resonance</span>
              <span className="text-zinc-400 font-mono">{Math.round(resonance * 100)}%</span>
            </div>
            <input
              type="range"
              min="0"
              max="100"
              value={resonance * 100}
              onChange={(e) => setResonance(parseInt(e.target.value) / 100)}
              className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
            />
          </div>

          {/* Spectral Tilt */}
          <div className="space-y-1">
            <div className="flex justify-between text-xs">
              <span className="text-zinc-500">Tilt</span>
              <span className="text-zinc-400 font-mono">
                {spectralTilt > 0 ? '+' : ''}{spectralTilt} dB/oct
              </span>
            </div>
            <input
              type="range"
              min="-12"
              max="12"
              value={spectralTilt}
              onChange={(e) => setSpectralTilt(parseInt(e.target.value))}
              className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
            />
            <div className="flex justify-between text-[10px] text-zinc-600">
              <span>Dark</span>
              <span>Bright</span>
            </div>
          </div>
        </div>

        {/* Motion Section */}
        <div className="space-y-3">
          <div className="flex items-center gap-2">
            <Volume2 className="w-3 h-3 text-zinc-500" />
            <span className="text-xs text-zinc-400">Motion</span>
          </div>
          
          <div className="flex gap-1">
            {MOTIONS.map((m) => (
              <button
                key={m.value}
                onClick={() => setMotion(m.value)}
                className={`
                  flex-1 py-1.5 rounded text-[10px] transition-all
                  ${motion === m.value 
                    ? 'bg-purple-500/30 text-purple-300 ring-1 ring-purple-500/50' 
                    : 'bg-zinc-800 text-zinc-500 hover:text-zinc-300'}
                `}
                title={m.desc}
              >
                {m.label}
              </button>
            ))}
          </div>

          {motion !== 'static' && (
            <div className="grid grid-cols-2 gap-3">
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-500">Rate</span>
                  <span className="text-zinc-400 font-mono">{motionRate.toFixed(1)} Hz</span>
                </div>
                <input
                  type="range"
                  min="1"
                  max="100"
                  value={motionRate * 10}
                  onChange={(e) => setMotionRate(parseInt(e.target.value) / 10)}
                  className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>
              <div className="space-y-1">
                <div className="flex justify-between text-[10px]">
                  <span className="text-zinc-500">Depth</span>
                  <span className="text-zinc-400 font-mono">{Math.round(motionDepth * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="100"
                  value={motionDepth * 100}
                  onChange={(e) => setMotionDepth(parseInt(e.target.value) / 100)}
                  className="w-full h-1 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
                />
              </div>
            </div>
          )}
        </div>

        {/* Advanced Toggle */}
        <button
          onClick={() => setShowAdvanced(!showAdvanced)}
          className="w-full flex items-center justify-between px-3 py-2 text-xs text-zinc-500 hover:text-zinc-300 bg-zinc-800/50 rounded-lg transition-colors"
        >
          <span>Advanced</span>
          <ChevronDown className={`w-3 h-3 transition-transform ${showAdvanced ? 'rotate-180' : ''}`} />
        </button>

        {showAdvanced && (
          <div className="space-y-3 pt-2">
            {/* Harmonics */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Harmonics</span>
                <span className="text-zinc-400 font-mono">{numHarmonics}</span>
              </div>
              <input
                type="range"
                min="4"
                max="32"
                value={numHarmonics}
                onChange={(e) => setNumHarmonics(parseInt(e.target.value))}
                className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
            </div>
            
            {/* Mix */}
            <div className="space-y-1">
              <div className="flex justify-between text-xs">
                <span className="text-zinc-500">Dry/Wet</span>
                <span className="text-zinc-400 font-mono">{Math.round(mix * 100)}%</span>
              </div>
              <input
                type="range"
                min="0"
                max="100"
                value={mix * 100}
                onChange={(e) => setMix(parseInt(e.target.value) / 100)}
                className="w-full h-1.5 bg-zinc-700 rounded-lg appearance-none cursor-pointer accent-purple-500"
              />
            </div>
          </div>
        )}

        {/* Apply Button */}
        <button
          onClick={handleApply}
          disabled={isProcessing}
          className={`
            w-full flex items-center justify-center gap-2 px-4 py-3 rounded-lg
            text-sm font-medium transition-all
            ${isProcessing 
              ? 'bg-purple-500/20 text-purple-400 cursor-wait' 
              : 'bg-purple-500 hover:bg-purple-400 text-white shadow-lg shadow-purple-500/20'}
          `}
        >
          {isProcessing ? (
            <>
              <Loader2 className="w-4 h-4 animate-spin" />
              Processing...
            </>
          ) : (
            <>
              <Play className="w-4 h-4" />
              Apply Filter
            </>
          )}
        </button>

        {/* Result */}
        {result && (
          <div className={`
            p-3 rounded-lg text-sm
            ${result.success 
              ? 'bg-emerald-500/10 border border-emerald-500/30' 
              : 'bg-red-500/10 border border-red-500/30'}
          `}>
            {result.success ? (
              <div className="flex items-center justify-between">
                <div className="flex items-center gap-2">
                  <Check className="w-4 h-4 text-emerald-400" />
                  <span className="text-emerald-300 text-xs">Processed</span>
                </div>
                {result.url && (
                  <a 
                    href={result.url} 
                    target="_blank" 
                    rel="noopener noreferrer"
                    className="flex items-center gap-1 text-xs text-emerald-400 hover:text-emerald-300"
                  >
                    <Download className="w-3 h-3" />
                    Download
                  </a>
                )}
              </div>
            ) : (
              <div className="flex items-start gap-2">
                <X className="w-4 h-4 text-red-400 flex-shrink-0 mt-0.5" />
                <p className="text-red-300 text-xs">{result.error}</p>
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
};

export default HarmonicFilterPanel;
