/**
 * FootworkSequencer - Footwork production pattern sequencer
 * 
 * Features:
 * - Polyrhythmic pattern grid
 * - Micro-timing offset editor (MPC-style)
 * - Saturation controls per layer
 * - Envelope sweep controls for TR-808 style kicks
 * - Preset selector
 * - Layer management
 */

import React, { useState, useEffect, useCallback } from 'react';
import { 
  Play, 
  Square, 
  Layers,
  Settings,
  Plus,
  Trash2,
  RotateCcw,
  Sliders,
} from 'lucide-react';

// =============================================================================
// TYPES
// =============================================================================

interface PolyrhythmicLayer {
  id: string;
  name: string;
  hits: number;
  steps: number;
  subdivision: number;
  offset: number;
  saturation: number;  // 0-1
  microOffsets: number[];  // Per-step offsets
}

interface FootworkPattern {
  layers: PolyrhythmicLayer[];
  preset?: string;
  durationBeats: number;
}

interface FootworkSequencerProps {
  bpm: number;
  onPatternChange?: (pattern: FootworkPattern) => void;
  onGenerate?: (pattern: FootworkPattern) => void;
}

// =============================================================================
// COMPONENT
// =============================================================================

export const FootworkSequencer: React.FC<FootworkSequencerProps> = ({
  bpm,
  onPatternChange,
  onGenerate,
}) => {
  const [pattern, setPattern] = useState<FootworkPattern>({
    layers: [
      {
        id: 'layer-1',
        name: 'Kick',
        hits: 4,
        steps: 4,
        subdivision: 1.0,
        offset: 0.0,
        saturation: 0.3,
        microOffsets: [],
      },
    ],
    durationBeats: 4.0,
  });

  const [selectedLayer, setSelectedLayer] = useState<string | null>(pattern.layers[0]?.id);
  const [isPlaying, setIsPlaying] = useState(false);

  // Update parent on pattern change
  useEffect(() => {
    onPatternChange?.(pattern);
  }, [pattern, onPatternChange]);

  const handleAddLayer = useCallback(() => {
    const newLayer: PolyrhythmicLayer = {
      id: `layer-${Date.now()}`,
      name: `Layer ${pattern.layers.length + 1}`,
      hits: 4,
      steps: 4,
      subdivision: 1.0,
      offset: 0.0,
      saturation: 0.3,
      microOffsets: [],
    };
    setPattern(prev => ({
      ...prev,
      layers: [...prev.layers, newLayer],
    }));
    setSelectedLayer(newLayer.id);
  }, [pattern.layers.length]);

  const handleRemoveLayer = useCallback((layerId: string) => {
    setPattern(prev => ({
      ...prev,
      layers: prev.layers.filter(l => l.id !== layerId),
    }));
    if (selectedLayer === layerId) {
      setSelectedLayer(pattern.layers.find(l => l.id !== layerId)?.id || null);
    }
  }, [selectedLayer, pattern.layers]);

  const handleUpdateLayer = useCallback((layerId: string, updates: Partial<PolyrhythmicLayer>) => {
    setPattern(prev => ({
      ...prev,
      layers: prev.layers.map(l => 
        l.id === layerId ? { ...l, ...updates } : l
      ),
    }));
  }, []);

  const handleMicroOffsetChange = useCallback((
    layerId: string,
    stepIndex: number,
    offset: number
  ) => {
    setPattern(prev => ({
      ...prev,
      layers: prev.layers.map(l => {
        if (l.id !== layerId) return l;
        const newOffsets = [...(l.microOffsets || [])];
        while (newOffsets.length <= stepIndex) {
          newOffsets.push(0);
        }
        newOffsets[stepIndex] = offset;
        return { ...l, microOffsets: newOffsets };
      }),
    }));
  }, []);

  const handlePresetChange = useCallback((preset: string) => {
    // Load preset configuration
    // This would call the API to get preset config
    setPattern(prev => ({ ...prev, preset }));
  }, []);

  const handleGenerate = useCallback(() => {
    onGenerate?.(pattern);
  }, [pattern, onGenerate]);

  const selectedLayerData = pattern.layers.find(l => l.id === selectedLayer);

  return (
    <div className="w-full h-full flex flex-col bg-zinc-950 text-white p-4 gap-4">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-xl font-bold">Footwork Sequencer</h2>
          <p className="text-sm text-zinc-400">Polyrhythmic pattern generation</p>
        </div>
        <div className="flex items-center gap-2">
          <button
            onClick={() => setIsPlaying(!isPlaying)}
            className="px-4 py-2 bg-amber-600 hover:bg-amber-500 rounded-lg flex items-center gap-2"
          >
            {isPlaying ? <Square className="w-4 h-4" /> : <Play className="w-4 h-4" />}
            {isPlaying ? 'Stop' : 'Play'}
          </button>
          <button
            onClick={handleGenerate}
            className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 rounded-lg flex items-center gap-2"
          >
            <RotateCcw className="w-4 h-4" />
            Generate
          </button>
        </div>
      </div>

      {/* Preset Selector */}
      <div className="flex items-center gap-2">
        <label className="text-sm text-zinc-400">Preset:</label>
        <select
          value={pattern.preset || ''}
          onChange={(e) => handlePresetChange(e.target.value)}
          className="px-3 py-1 bg-zinc-900 border border-zinc-700 rounded text-sm"
        >
          <option value="">Custom</option>
          <option value="footwork_basic">Footwork Basic</option>
          <option value="juke_pattern">Juke Pattern</option>
          <option value="ghetto_house">Ghetto House</option>
          <option value="footwork_poly">Footwork Poly</option>
        </select>
      </div>

      {/* Main Content */}
      <div className="flex-1 flex gap-4">
        {/* Layer List */}
        <div className="w-48 bg-zinc-900 rounded-lg p-2 flex flex-col gap-2">
          <div className="flex items-center justify-between mb-2">
            <h3 className="text-sm font-semibold">Layers</h3>
            <button
              onClick={handleAddLayer}
              className="p-1 hover:bg-zinc-800 rounded"
            >
              <Plus className="w-4 h-4" />
            </button>
          </div>
          <div className="flex-1 overflow-y-auto space-y-1">
            {pattern.layers.map(layer => (
              <div
                key={layer.id}
                className={`
                  p-2 rounded cursor-pointer transition-colors
                  ${selectedLayer === layer.id ? 'bg-amber-600/20 border border-amber-600' : 'bg-zinc-800 hover:bg-zinc-700'}
                `}
                onClick={() => setSelectedLayer(layer.id)}
              >
                <div className="flex items-center justify-between">
                  <span className="text-sm font-medium">{layer.name}</span>
                  {pattern.layers.length > 1 && (
                    <button
                      onClick={(e) => {
                        e.stopPropagation();
                        handleRemoveLayer(layer.id);
                      }}
                      className="p-0.5 hover:bg-zinc-600 rounded"
                    >
                      <Trash2 className="w-3 h-3" />
                    </button>
                  )}
                </div>
                <div className="text-xs text-zinc-400 mt-1">
                  {layer.hits}/{layer.steps} @ {layer.subdivision}x
                </div>
              </div>
            ))}
          </div>
        </div>

        {/* Layer Editor */}
        {selectedLayerData && (
          <div className="flex-1 bg-zinc-900 rounded-lg p-4 flex flex-col gap-4">
            <div>
              <h3 className="text-lg font-semibold mb-2">{selectedLayerData.name}</h3>
              
              {/* Layer Parameters */}
              <div className="grid grid-cols-2 gap-4 mb-4">
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Hits</label>
                  <input
                    type="number"
                    min="1"
                    max="32"
                    value={selectedLayerData.hits}
                    onChange={(e) => handleUpdateLayer(selectedLayerData.id, { hits: parseInt(e.target.value) || 1 })}
                    className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Steps</label>
                  <input
                    type="number"
                    min="1"
                    max="32"
                    value={selectedLayerData.steps}
                    onChange={(e) => handleUpdateLayer(selectedLayerData.id, { steps: parseInt(e.target.value) || 1 })}
                    className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Subdivision</label>
                  <input
                    type="number"
                    min="0.25"
                    max="8"
                    step="0.25"
                    value={selectedLayerData.subdivision}
                    onChange={(e) => handleUpdateLayer(selectedLayerData.id, { subdivision: parseFloat(e.target.value) || 1.0 })}
                    className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm"
                  />
                </div>
                <div>
                  <label className="text-xs text-zinc-400 mb-1 block">Offset (beats)</label>
                  <input
                    type="number"
                    min="-2"
                    max="2"
                    step="0.1"
                    value={selectedLayerData.offset}
                    onChange={(e) => handleUpdateLayer(selectedLayerData.id, { offset: parseFloat(e.target.value) || 0.0 })}
                    className="w-full px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-sm"
                  />
                </div>
              </div>

              {/* Saturation Control */}
              <div className="mb-4">
                <div className="flex items-center justify-between mb-2">
                  <label className="text-sm text-zinc-400">Saturation</label>
                  <span className="text-xs text-zinc-500">{Math.round(selectedLayerData.saturation * 100)}%</span>
                </div>
                <input
                  type="range"
                  min="0"
                  max="1"
                  step="0.01"
                  value={selectedLayerData.saturation}
                  onChange={(e) => handleUpdateLayer(selectedLayerData.id, { saturation: parseFloat(e.target.value) })}
                  className="w-full"
                />
              </div>

              {/* Micro-Timing Editor */}
              <div>
                <label className="text-sm text-zinc-400 mb-2 block">Micro-Timing Offsets (MPC-style)</label>
                <div className="grid grid-cols-8 gap-1">
                  {Array.from({ length: selectedLayerData.steps }).map((_, i) => {
                    const offset = selectedLayerData.microOffsets?.[i] || 0;
                    return (
                      <div key={i} className="flex flex-col items-center gap-1">
                        <input
                          type="range"
                          min="-0.2"
                          max="0.2"
                          step="0.01"
                          value={offset}
                          onChange={(e) => handleMicroOffsetChange(selectedLayerData.id, i, parseFloat(e.target.value))}
                          className="w-full"
                          orient="vertical"
                          style={{ writingMode: 'vertical-lr' }}
                        />
                        <span className="text-[10px] text-zinc-500">{i + 1}</span>
                        {offset !== 0 && (
                          <span className="text-[8px] text-amber-400">
                            {offset > 0 ? '+' : ''}{offset.toFixed(2)}
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

