/**
 * Euclidean Rhythm Generator
 * 
 * Implements Bjorklund's algorithm for distributing pulses evenly across steps.
 * Used by Autechre, Aphex Twin, and countless electronic artists.
 * 
 * Examples:
 * - E(3,8) = [x . . x . . x .] - Cuban tresillo
 * - E(5,8) = [x . x x . x x .] - Cuban cinquillo
 * - E(7,12) = West African bell pattern
 * - E(4,12) = [x . . x . . x . . x . .] - basic 4/4
 */

export interface EuclideanPattern {
  steps: number;
  pulses: number;
  rotation: number;
  pattern: boolean[];      // true = pulse, false = rest
  intervals: number[];     // intervals between pulses in steps
}

/**
 * Bjorklund's algorithm for generating Euclidean rhythms
 */
export function generateEuclidean(steps: number, pulses: number, rotation: number = 0): EuclideanPattern {
  if (pulses > steps) pulses = steps;
  if (pulses < 0) pulses = 0;
  if (steps < 1) steps = 1;
  
  // Build the pattern using Bjorklund's algorithm
  let pattern = bjorklund(steps, pulses);
  
  // Apply rotation
  if (rotation !== 0) {
    const normalizedRotation = ((rotation % steps) + steps) % steps;
    pattern = [...pattern.slice(normalizedRotation), ...pattern.slice(0, normalizedRotation)];
  }
  
  // Calculate intervals between pulses
  const intervals = calculateIntervals(pattern);
  
  return {
    steps,
    pulses,
    rotation,
    pattern,
    intervals,
  };
}

/**
 * Bjorklund's algorithm implementation
 * Based on the Euclidean algorithm for computing GCD
 */
function bjorklund(steps: number, pulses: number): boolean[] {
  if (pulses === 0) return new Array(steps).fill(false);
  if (pulses === steps) return new Array(steps).fill(true);
  
  // Initialize groups
  let groups: boolean[][] = [];
  
  // Start with pulses as [true] and rests as [false]
  for (let i = 0; i < pulses; i++) {
    groups.push([true]);
  }
  for (let i = 0; i < steps - pulses; i++) {
    groups.push([false]);
  }
  
  // Recursively distribute remainders
  while (true) {
    const numPulseGroups = groups.filter(g => g[0] === true).length;
    const numRestGroups = groups.length - numPulseGroups;
    
    if (numRestGroups <= 1) break;
    
    const minGroups = Math.min(numPulseGroups, numRestGroups);
    const newGroups: boolean[][] = [];
    
    // Combine pairs
    for (let i = 0; i < minGroups; i++) {
      newGroups.push([...groups[i], ...groups[groups.length - 1 - i]]);
    }
    
    // Keep remaining groups
    for (let i = minGroups; i < groups.length - minGroups; i++) {
      newGroups.push(groups[i]);
    }
    
    groups = newGroups;
  }
  
  // Flatten groups to pattern
  return groups.flat();
}

/**
 * Calculate intervals between pulses
 */
function calculateIntervals(pattern: boolean[]): number[] {
  const intervals: number[] = [];
  let lastPulse = -1;
  
  // Find first pulse
  const firstPulse = pattern.indexOf(true);
  if (firstPulse === -1) return intervals;
  
  lastPulse = firstPulse;
  
  // Walk through pattern finding intervals
  for (let i = firstPulse + 1; i < pattern.length + firstPulse; i++) {
    const idx = i % pattern.length;
    if (pattern[idx]) {
      intervals.push((i - lastPulse));
      lastPulse = i;
    }
  }
  
  return intervals;
}

/**
 * Generate multiple related patterns (polyrhythm)
 */
export function generatePolyrhythm(
  steps: number,
  pulseArray: number[],
  rotationArray: number[] = []
): EuclideanPattern[] {
  return pulseArray.map((pulses, i) => 
    generateEuclidean(steps, pulses, rotationArray[i] || 0)
  );
}

/**
 * Common Euclidean rhythm presets
 */
export const EUCLIDEAN_PRESETS = {
  'tresillo': { steps: 8, pulses: 3, rotation: 0 },
  'cinquillo': { steps: 8, pulses: 5, rotation: 0 },
  'bembe': { steps: 12, pulses: 7, rotation: 0 },
  'soukous': { steps: 12, pulses: 5, rotation: 0 },
  'bossa': { steps: 16, pulses: 5, rotation: 0 },
  'gahu': { steps: 16, pulses: 7, rotation: 0 },
  'aksak': { steps: 9, pulses: 4, rotation: 0 },
  'ruchenitza': { steps: 7, pulses: 4, rotation: 0 },
  'rumba': { steps: 16, pulses: 9, rotation: 0 },
  'techno': { steps: 16, pulses: 4, rotation: 0 },
  'house': { steps: 16, pulses: 4, rotation: 4 },
  'breakbeat': { steps: 16, pulses: 6, rotation: 0 },
  'dnb': { steps: 16, pulses: 5, rotation: 2 },
  'halftime': { steps: 32, pulses: 4, rotation: 0 },
} as const;

export type EuclideanPresetName = keyof typeof EUCLIDEAN_PRESETS;

/**
 * Visualize pattern as ASCII
 */
export function patternToString(pattern: boolean[], chars = { pulse: '●', rest: '○' }): string {
  return pattern.map(p => p ? chars.pulse : chars.rest).join(' ');
}

/**
 * Convert pattern to trigger times (0-1 normalized)
 */
export function patternToTriggers(pattern: boolean[]): number[] {
  return pattern
    .map((p, i) => p ? i / pattern.length : -1)
    .filter(t => t >= 0);
}
