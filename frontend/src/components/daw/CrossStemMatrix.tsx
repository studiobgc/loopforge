/**
 * CrossStemMatrix - Cross-stem triggering control
 * 
 * "One fader that determines how often a snare does a little roll... 
 * and another thing that listens and says 'If that snare plays that roll 
 * three times, then I'll do this.'" - Sean Booth
 * 
 * This matrix lets you route triggers from one stem's activity to 
 * trigger slices on another stem. For example:
 * - Drums → Bass: Every kick triggers a bass slice
 * - Bass → Other: Bass transients trigger pad swells
 * 
 * Features:
 * - Visual routing matrix
 * - Per-route probability
 * - Velocity scaling
 * - Slice selection mode (same, random, sequential, follow-energy)
 */

import React, { useState, useCallback } from 'react';
import { 
  ArrowRight, 
  Shuffle, 
  Repeat, 
  TrendingUp,
  Minus,
  Plus,
} from 'lucide-react';

interface Stem {
  id: string;
  name: string;
  role: 'drums' | 'bass' | 'vocals' | 'other';
}

type SliceSelectionMode = 'same' | 'random' | 'sequential' | 'energy-match';

interface CrossRoute {
  sourceId: string;
  targetId: string;
  enabled: boolean;
  probability: number;      // 0-1
  velocityScale: number;    // 0-2 (1 = same velocity)
  sliceMode: SliceSelectionMode;
  pitchOffset: number;      // semitones
  timeOffset: number;       // beats (can be negative for anticipation)
}

interface CrossStemMatrixProps {
  stems: Stem[];
  routes: CrossRoute[];
  onRouteChange: (sourceId: string, targetId: string, updates: Partial<CrossRoute>) => void;
  onRouteAdd: (sourceId: string, targetId: string) => void;
  onRouteRemove: (sourceId: string, targetId: string) => void;
  className?: string;
}

const ROLE_COLORS = {
  drums: 'bg-orange-500',
  bass: 'bg-blue-500',
  vocals: 'bg-purple-500',
  other: 'bg-green-500',
};

const SLICE_MODE_ICONS = {
  same: <Repeat className="w-3 h-3" />,
  random: <Shuffle className="w-3 h-3" />,
  sequential: <ArrowRight className="w-3 h-3" />,
  'energy-match': <TrendingUp className="w-3 h-3" />,
};

const SLICE_MODE_LABELS = {
  same: 'Same Index',
  random: 'Random',
  sequential: 'Sequential',
  'energy-match': 'Energy Match',
};

export const CrossStemMatrix: React.FC<CrossStemMatrixProps> = ({
  stems,
  routes,
  onRouteChange,
  onRouteAdd,
  onRouteRemove,
  className = '',
}) => {
  const [expandedCell, setExpandedCell] = useState<string | null>(null);
  
  const getRoute = useCallback((sourceId: string, targetId: string): CrossRoute | undefined => {
    return routes.find(r => r.sourceId === sourceId && r.targetId === targetId);
  }, [routes]);
  
  const toggleRoute = useCallback((sourceId: string, targetId: string) => {
    const route = getRoute(sourceId, targetId);
    if (route) {
      onRouteRemove(sourceId, targetId);
    } else {
      onRouteAdd(sourceId, targetId);
    }
  }, [getRoute, onRouteAdd, onRouteRemove]);
  
  const cellKey = (sourceId: string, targetId: string) => `${sourceId}->${targetId}`;
  
  if (stems.length === 0) {
    return (
      <div className={`flex items-center justify-center p-8 text-zinc-600 ${className}`}>
        <div className="text-sm">No stems loaded</div>
      </div>
    );
  }
  
  return (
    <div className={`${className}`}>
      {/* Header */}
      <div className="flex items-center justify-between mb-4">
        <h3 className="text-sm font-semibold text-zinc-300 uppercase tracking-wider">
          Cross-Stem Triggers
        </h3>
        <span className="text-xs text-zinc-500">
          {routes.filter(r => r.enabled).length} active routes
        </span>
      </div>
      
      {/* Matrix */}
      <div className="overflow-x-auto">
        <table className="w-full border-collapse">
          <thead>
            <tr>
              <th className="p-2 text-xs text-zinc-600 text-left">
                Source → Target
              </th>
              {stems.map(stem => (
                <th key={stem.id} className="p-2 text-center">
                  <div className={`w-3 h-3 rounded-full mx-auto mb-1 ${ROLE_COLORS[stem.role]}`} />
                  <span className="text-xs text-zinc-400 capitalize">{stem.role}</span>
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {stems.map(source => (
              <tr key={source.id}>
                {/* Row header */}
                <td className="p-2">
                  <div className="flex items-center gap-2">
                    <div className={`w-3 h-3 rounded-full ${ROLE_COLORS[source.role]}`} />
                    <span className="text-xs text-zinc-400 capitalize">{source.role}</span>
                    <ArrowRight className="w-3 h-3 text-zinc-700" />
                  </div>
                </td>
                
                {/* Matrix cells */}
                {stems.map(target => {
                  const isSelf = source.id === target.id;
                  const route = getRoute(source.id, target.id);
                  const isExpanded = expandedCell === cellKey(source.id, target.id);
                  
                  if (isSelf) {
                    return (
                      <td key={target.id} className="p-1">
                        <div className="w-full aspect-square bg-zinc-900/30 rounded flex items-center justify-center">
                          <Minus className="w-3 h-3 text-zinc-800" />
                        </div>
                      </td>
                    );
                  }
                  
                  return (
                    <td key={target.id} className="p-1 relative">
                      <div
                        onClick={() => {
                          if (route) {
                            setExpandedCell(isExpanded ? null : cellKey(source.id, target.id));
                          } else {
                            toggleRoute(source.id, target.id);
                          }
                        }}
                        className={`
                          w-full aspect-square rounded cursor-pointer transition-all
                          flex flex-col items-center justify-center gap-0.5
                          ${route?.enabled 
                            ? `bg-gradient-to-br from-${source.role === 'drums' ? 'orange' : source.role === 'bass' ? 'blue' : source.role === 'vocals' ? 'purple' : 'green'}-600/30 to-${target.role === 'drums' ? 'orange' : target.role === 'bass' ? 'blue' : target.role === 'vocals' ? 'purple' : 'green'}-600/30 border border-zinc-600` 
                            : 'bg-zinc-900/50 border border-zinc-800 hover:border-zinc-600'
                          }
                        `}
                      >
                        {route ? (
                          <>
                            <div className="text-[10px] font-mono text-white">
                              {Math.round(route.probability * 100)}%
                            </div>
                            <div className="text-zinc-500">
                              {SLICE_MODE_ICONS[route.sliceMode]}
                            </div>
                          </>
                        ) : (
                          <Plus className="w-3 h-3 text-zinc-700" />
                        )}
                      </div>
                      
                      {/* Expanded editor */}
                      {isExpanded && route && (
                        <div className="absolute z-50 top-full left-0 mt-2 w-48 p-3 bg-zinc-900 border border-zinc-700 rounded-lg shadow-xl">
                          <div className="text-xs text-zinc-400 mb-3">
                            {source.role} → {target.role}
                          </div>
                          
                          {/* Enable toggle */}
                          <div className="flex items-center justify-between mb-3">
                            <span className="text-xs text-zinc-500">Enabled</span>
                            <button
                              onClick={(e) => {
                                e.stopPropagation();
                                onRouteChange(source.id, target.id, { enabled: !route.enabled });
                              }}
                              className={`w-8 h-4 rounded-full transition-colors ${
                                route.enabled ? 'bg-green-600' : 'bg-zinc-700'
                              }`}
                            >
                              <div className={`w-3 h-3 rounded-full bg-white transition-transform ${
                                route.enabled ? 'translate-x-4' : 'translate-x-0.5'
                              }`} />
                            </button>
                          </div>
                          
                          {/* Probability */}
                          <div className="mb-3">
                            <label className="text-[10px] text-zinc-500 block mb-1">
                              Probability
                            </label>
                            <input
                              type="range"
                              min={0}
                              max={1}
                              step={0.05}
                              value={route.probability}
                              onChange={(e) => onRouteChange(source.id, target.id, { 
                                probability: parseFloat(e.target.value) 
                              })}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full"
                            />
                            <div className="text-right text-[10px] text-zinc-400">
                              {Math.round(route.probability * 100)}%
                            </div>
                          </div>
                          
                          {/* Slice mode */}
                          <div className="mb-3">
                            <label className="text-[10px] text-zinc-500 block mb-1">
                              Slice Selection
                            </label>
                            <div className="grid grid-cols-2 gap-1">
                              {(Object.keys(SLICE_MODE_LABELS) as SliceSelectionMode[]).map(mode => (
                                <button
                                  key={mode}
                                  onClick={(e) => {
                                    e.stopPropagation();
                                    onRouteChange(source.id, target.id, { sliceMode: mode });
                                  }}
                                  className={`
                                    flex items-center gap-1 px-2 py-1 text-[10px] rounded
                                    ${route.sliceMode === mode 
                                      ? 'bg-blue-600 text-white' 
                                      : 'bg-zinc-800 text-zinc-400 hover:text-white'
                                    }
                                  `}
                                >
                                  {SLICE_MODE_ICONS[mode]}
                                  {mode === 'energy-match' ? 'Energy' : mode}
                                </button>
                              ))}
                            </div>
                          </div>
                          
                          {/* Velocity scale */}
                          <div className="mb-3">
                            <label className="text-[10px] text-zinc-500 block mb-1">
                              Velocity Scale
                            </label>
                            <input
                              type="range"
                              min={0}
                              max={2}
                              step={0.1}
                              value={route.velocityScale}
                              onChange={(e) => onRouteChange(source.id, target.id, { 
                                velocityScale: parseFloat(e.target.value) 
                              })}
                              onClick={(e) => e.stopPropagation()}
                              className="w-full"
                            />
                            <div className="text-right text-[10px] text-zinc-400">
                              {route.velocityScale.toFixed(1)}x
                            </div>
                          </div>
                          
                          {/* Remove route */}
                          <button
                            onClick={(e) => {
                              e.stopPropagation();
                              onRouteRemove(source.id, target.id);
                              setExpandedCell(null);
                            }}
                            className="w-full text-xs text-red-400 hover:text-red-300 py-1"
                          >
                            Remove Route
                          </button>
                        </div>
                      )}
                    </td>
                  );
                })}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      
      {/* Legend */}
      <div className="mt-4 flex items-center gap-4 text-[10px] text-zinc-600">
        <div className="flex items-center gap-1">
          <Repeat className="w-3 h-3" /> Same slice
        </div>
        <div className="flex items-center gap-1">
          <Shuffle className="w-3 h-3" /> Random
        </div>
        <div className="flex items-center gap-1">
          <ArrowRight className="w-3 h-3" /> Sequential
        </div>
        <div className="flex items-center gap-1">
          <TrendingUp className="w-3 h-3" /> Energy match
        </div>
      </div>
    </div>
  );
};

export default CrossStemMatrix;
