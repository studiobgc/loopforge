/**
 * Rule Engine - Autechre-style conditional trigger modification
 * 
 * Evaluates rules against trigger context and modifies/blocks triggers accordingly.
 * Designed for real-time, sample-accurate processing.
 */

export interface TriggerRule {
  id: string;
  name: string;
  condition: string;
  action: string;
  probability: number;
  enabled: boolean;
}

export interface TriggerContext {
  sliceIndex: number;
  velocity: number;
  beat: number;
  consecutivePlays: number;
  totalPlays: number;
  timeSinceLast: number;
  stemRole: string;
}

export interface ModifiedTrigger {
  skip: boolean;
  velocity: number;
  pitchShift: number;
  sliceIndex: number;
  reverse: boolean;
  doubleTrigger: boolean;
  resetSequence: boolean;
}

export class RuleEngine {
  private playHistory: Map<string, number[]> = new Map();
  private lastPlayTime: Map<string, number> = new Map();
  private consecutiveCount: Map<string, number> = new Map();
  private lastSliceIndex: Map<string, number> = new Map();
  
  reset(): void {
    this.playHistory.clear();
    this.lastPlayTime.clear();
    this.consecutiveCount.clear();
    this.lastSliceIndex.clear();
  }
  
  recordPlay(stemId: string, sliceIndex: number, beat: number): void {
    const key = stemId;
    
    if (!this.playHistory.has(key)) {
      this.playHistory.set(key, []);
    }
    this.playHistory.get(key)!.push(beat);
    
    const lastSlice = this.lastSliceIndex.get(key);
    if (lastSlice === sliceIndex) {
      this.consecutiveCount.set(key, (this.consecutiveCount.get(key) ?? 0) + 1);
    } else {
      this.consecutiveCount.set(key, 1);
    }
    
    this.lastSliceIndex.set(key, sliceIndex);
    this.lastPlayTime.set(key, beat);
  }
  
  getContext(stemId: string, sliceIndex: number, velocity: number, beat: number, stemRole: string): TriggerContext {
    const history = this.playHistory.get(stemId) ?? [];
    const lastTime = this.lastPlayTime.get(stemId) ?? 0;
    
    return {
      sliceIndex,
      velocity,
      beat,
      consecutivePlays: this.consecutiveCount.get(stemId) ?? 0,
      totalPlays: history.length,
      timeSinceLast: beat - lastTime,
      stemRole,
    };
  }
  
  evaluateCondition(condition: string, ctx: TriggerContext): boolean {
    switch (condition) {
      case 'consecutive_plays > 2':
        return ctx.consecutivePlays > 2;
      case 'consecutive_plays > 3':
        return ctx.consecutivePlays > 3;
      case 'total_plays % 4':
        return ctx.totalPlays > 0 && ctx.totalPlays % 4 === 0;
      case 'total_plays % 8':
        return ctx.totalPlays > 0 && ctx.totalPlays % 8 === 0;
      case 'slice_index == 0':
        return ctx.sliceIndex === 0;
      case 'velocity > 0.8':
        return ctx.velocity > 0.8;
      case 'time_since_last > 4':
        return ctx.timeSinceLast > 4;
      default:
        return false;
    }
  }
  
  applyAction(action: string, trigger: ModifiedTrigger): ModifiedTrigger {
    const result = { ...trigger };
    
    switch (action) {
      case 'skip_next':
        result.skip = true;
        break;
      case 'double_trigger':
        result.doubleTrigger = true;
        break;
      case 'pitch_up_12':
        result.pitchShift = (result.pitchShift || 0) + 12;
        break;
      case 'pitch_down_12':
        result.pitchShift = (result.pitchShift || 0) - 12;
        break;
      case 'pitch_up_7':
        result.pitchShift = (result.pitchShift || 0) + 7;
        break;
      case 'reverse':
        result.reverse = true;
        break;
      case 'random_slice':
        result.sliceIndex = Math.floor(Math.random() * 16);
        break;
      case 'half_velocity':
        result.velocity *= 0.5;
        break;
      case 'double_velocity':
        result.velocity = Math.min(1, result.velocity * 2);
        break;
      case 'reset_sequence':
        result.resetSequence = true;
        break;
    }
    
    return result;
  }
  
  evaluate(
    rules: TriggerRule[],
    stemId: string,
    sliceIndex: number,
    velocity: number,
    beat: number,
    stemRole: string
  ): ModifiedTrigger {
    const ctx = this.getContext(stemId, sliceIndex, velocity, beat, stemRole);
    
    let result: ModifiedTrigger = {
      skip: false,
      velocity,
      pitchShift: 0,
      sliceIndex,
      reverse: false,
      doubleTrigger: false,
      resetSequence: false,
    };
    
    for (const rule of rules) {
      if (!rule.enabled) continue;
      
      if (this.evaluateCondition(rule.condition, ctx)) {
        if (Math.random() <= rule.probability) {
          result = this.applyAction(rule.action, result);
        }
      }
    }
    
    this.recordPlay(stemId, result.sliceIndex, beat);
    
    return result;
  }
}

export interface CrossRoute {
  sourceId: string;
  targetId: string;
  enabled: boolean;
  probability: number;
  velocityScale: number;
  sliceMode: 'same' | 'random' | 'sequential' | 'energy-match';
  pitchOffset: number;
  timeOffset: number;
}

export class CrossStemRouter {
  private sequentialCounters: Map<string, number> = new Map();
  private maxSlices = 16;
  
  reset(): void {
    this.sequentialCounters.clear();
  }
  
  setMaxSlices(count: number): void {
    this.maxSlices = count;
  }
  
  evaluateRoutes(
    routes: CrossRoute[],
    sourceId: string,
    sourceSliceIndex: number,
    sourceVelocity: number,
    sourceBeat: number
  ): Array<{
    targetId: string;
    sliceIndex: number;
    velocity: number;
    beat: number;
    pitchOffset: number;
  }> {
    const triggers: Array<{
      targetId: string;
      sliceIndex: number;
      velocity: number;
      beat: number;
      pitchOffset: number;
    }> = [];
    
    for (const route of routes) {
      if (!route.enabled) continue;
      if (route.sourceId !== sourceId) continue;
      
      if (Math.random() > route.probability) continue;
      
      let targetSlice: number;
      const routeKey = `${route.sourceId}->${route.targetId}`;
      
      switch (route.sliceMode) {
        case 'same':
          targetSlice = sourceSliceIndex;
          break;
        case 'random':
          targetSlice = Math.floor(Math.random() * this.maxSlices);
          break;
        case 'sequential':
          const counter = this.sequentialCounters.get(routeKey) ?? 0;
          targetSlice = counter % this.maxSlices;
          this.sequentialCounters.set(routeKey, counter + 1);
          break;
        case 'energy-match':
          targetSlice = sourceSliceIndex;
          break;
        default:
          targetSlice = sourceSliceIndex;
      }
      
      triggers.push({
        targetId: route.targetId,
        sliceIndex: targetSlice,
        velocity: sourceVelocity * route.velocityScale,
        beat: sourceBeat + route.timeOffset,
        pitchOffset: route.pitchOffset,
      });
    }
    
    return triggers;
  }
}

let ruleEngineInstance: RuleEngine | null = null;
let crossStemRouterInstance: CrossStemRouter | null = null;

export function getRuleEngine(): RuleEngine {
  if (!ruleEngineInstance) {
    ruleEngineInstance = new RuleEngine();
  }
  return ruleEngineInstance;
}

export function getCrossStemRouter(): CrossStemRouter {
  if (!crossStemRouterInstance) {
    crossStemRouterInstance = new CrossStemRouter();
  }
  return crossStemRouterInstance;
}
