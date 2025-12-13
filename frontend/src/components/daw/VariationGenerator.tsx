/**
 * VariationGenerator - Generate musical variations of patterns
 * 
 * Not "randomize everything" - these are musical, taste-respecting variations:
 * - Fill: add hits on off-beats
 * - Sparse: remove some hits, keep the groove
 * - Late Snare: push snare-like hits late (Dilla style)
 * - Stutter: add retrigs/rolls on some hits
 */

import React, { useCallback } from 'react';
import { Sparkles, Minus, Clock, Zap } from 'lucide-react';
import { cn } from '../../lib/utils';

interface PatternEvent {
  id: string;
  stemId: string;
  sliceIndex: number;
  beat: number;
  microOffset: number;
  velocity: number;
}

interface VariationGeneratorProps {
  pattern: PatternEvent[];
  stemId: string;
  gridStepBeats: number;
  loopBeats: number;
  onVariationGenerated: (newPattern: PatternEvent[]) => void;
  className?: string;
}

type VariationType = 'fill' | 'sparse' | 'late' | 'stutter';

export const VariationGenerator: React.FC<VariationGeneratorProps> = ({
  pattern,
  stemId,
  gridStepBeats,
  loopBeats,
  onVariationGenerated,
  className = '',
}) => {
  const generateId = () => globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;

  const generateFill = useCallback(() => {
    if (pattern.length === 0) return;

    const newEvents: PatternEvent[] = [...pattern];
    const occupiedBeats = new Set(pattern.map(e => Math.round(e.beat / gridStepBeats)));

    // Add fills on off-beats (every other grid step that's empty)
    for (let step = 1; step < loopBeats / gridStepBeats; step += 2) {
      if (!occupiedBeats.has(step) && Math.random() > 0.5) {
        const sourceEvent = pattern[Math.floor(Math.random() * pattern.length)];
        newEvents.push({
          id: generateId(),
          stemId,
          sliceIndex: sourceEvent.sliceIndex,
          beat: step * gridStepBeats,
          microOffset: 0,
          velocity: sourceEvent.velocity * 0.7,
        });
      }
    }

    onVariationGenerated(newEvents);
  }, [pattern, stemId, gridStepBeats, loopBeats, onVariationGenerated]);

  const generateSparse = useCallback(() => {
    if (pattern.length <= 1) return;

    // Keep ~60% of hits, but always keep first and strong beats
    const newEvents = pattern.filter((e) => {
      const isFirstBeat = e.beat < gridStepBeats;
      const isDownbeat = Math.round(e.beat) % 4 === 0;
      if (isFirstBeat || isDownbeat) return true;
      return Math.random() > 0.4;
    });

    onVariationGenerated(newEvents);
  }, [pattern, gridStepBeats, onVariationGenerated]);

  const generateLateSnare = useCallback(() => {
    if (pattern.length === 0) return;

    // Push hits on beats 2 and 4 (snare positions) late
    const newEvents = pattern.map(e => {
      const beatInBar = e.beat % 4;
      const isSnarePosition = Math.abs(beatInBar - 2) < 0.1 || Math.abs(beatInBar - 4) < 0.1 || beatInBar < 0.1 && e.beat > 0;
      
      if (isSnarePosition) {
        return {
          ...e,
          id: generateId(),
          microOffset: e.microOffset + (gridStepBeats * 0.15), // Push late
        };
      }
      return { ...e, id: generateId() };
    });

    onVariationGenerated(newEvents);
  }, [pattern, gridStepBeats, onVariationGenerated]);

  const generateStutter = useCallback(() => {
    if (pattern.length === 0) return;

    const newEvents: PatternEvent[] = [];

    for (const e of pattern) {
      newEvents.push({ ...e, id: generateId() });

      // 30% chance to add a stutter (retrig)
      if (Math.random() > 0.7) {
        const stutterCount = Math.random() > 0.5 ? 2 : 3;
        const stutterInterval = gridStepBeats / stutterCount;

        for (let i = 1; i < stutterCount; i++) {
          newEvents.push({
            id: generateId(),
            stemId,
            sliceIndex: e.sliceIndex,
            beat: Math.min(e.beat + stutterInterval * i, loopBeats - gridStepBeats),
            microOffset: 0,
            velocity: e.velocity * (1 - i * 0.2),
          });
        }
      }
    }

    onVariationGenerated(newEvents);
  }, [pattern, stemId, gridStepBeats, loopBeats, onVariationGenerated]);

  const variations: { type: VariationType; label: string; icon: typeof Sparkles; action: () => void }[] = [
    { type: 'fill', label: 'Fill', icon: Sparkles, action: generateFill },
    { type: 'sparse', label: 'Sparse', icon: Minus, action: generateSparse },
    { type: 'late', label: 'Late', icon: Clock, action: generateLateSnare },
    { type: 'stutter', label: 'Stutter', icon: Zap, action: generateStutter },
  ];

  return (
    <div className={cn('', className)}>
      <div className="flex items-center justify-between mb-2">
        <span className="text-[10px] text-zinc-500 uppercase">Variations</span>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {variations.map(({ type, label, icon: Icon, action }) => (
          <button
            key={type}
            onClick={action}
            disabled={pattern.length === 0}
            className="flex flex-col items-center gap-1 py-2 px-1 bg-zinc-800 hover:bg-zinc-700 disabled:opacity-40 disabled:cursor-not-allowed rounded transition-all"
          >
            <Icon className="w-3 h-3 text-cyan-400" />
            <span className="text-[9px] text-zinc-400">{label}</span>
          </button>
        ))}
      </div>
    </div>
  );
};

export default VariationGenerator;
