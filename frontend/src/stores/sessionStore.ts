/**
 * Loop Forge Session Store
 * 
 * Zustand-based global state management with:
 * - Immer for immutable updates
 * - Persist middleware for session recovery
 * - DevTools integration
 */

import { create } from 'zustand';
import { devtools } from 'zustand/middleware';
import { immer } from 'zustand/middleware/immer';

// =============================================================================
// TYPES
// =============================================================================

export interface SliceData {
  index: number;
  startTime: number;
  endTime: number;
  duration: number;
  energy: number;
  transientStrength: number;
  brightness: number;
}

export interface SliceBank {
  id: string;
  stemRole: string;
  slices: SliceData[];
  isLoaded: boolean;  // Audio loaded in engine
  isPlaying: boolean;
}

export interface Stem {
  id: string;
  name: string;
  role: 'drums' | 'bass' | 'vocals' | 'other';
  path: string;
  sliceBankId: string | null;
  volume: number;
  muted: boolean;
  solo: boolean;
}

export interface Job {
  id: string;
  type: 'separation' | 'analysis' | 'slicing';
  status: 'pending' | 'running' | 'completed' | 'failed';
  progress: number;
  stage: string;
}

export interface TriggerRule {
  id: string;
  name: string;
  condition: string;
  action: string;
  probability: number;
  enabled: boolean;
}

export interface SequencerConfig {
  mode: 'sequential' | 'random' | 'probability' | 'euclidean' | 'chaos' | 'follow';
  bpm: number;
  swing: number;
  subdivision: number;
  euclideanSteps: number;
  euclideanPulses: number;
  chaosAmount: number;
  followSource: string | null;
}

export interface Session {
  id: string;
  filename: string;
  bpm: number;
  key: string;
  duration: number;
  stems: Stem[];
  sliceBanks: Map<string, SliceBank>;
  jobs: Job[];
}

export type WorkflowStage = 
  | 'idle'
  | 'uploading'
  | 'separating'
  | 'analyzing'
  | 'ready'
  | 'slicing'
  | 'sequencing'
  | 'exporting';

// =============================================================================
// STORE STATE
// =============================================================================

interface SessionState {
  // Session
  session: Session | null;
  workflowStage: WorkflowStage;
  
  // UI State
  selectedStemId: string | null;
  selectedSliceBankId: string | null;
  isPlaying: boolean;
  currentBeat: number;
  
  // Sequencer
  sequencerConfig: SequencerConfig;
  rules: TriggerRule[];
  
  // Transport
  masterVolume: number;
  
  // Error handling
  error: string | null;
}

interface SessionActions {
  // Session management
  setSession: (session: Session | null) => void;
  updateSession: (updates: Partial<Session>) => void;
  setWorkflowStage: (stage: WorkflowStage) => void;
  
  // Stem management
  addStem: (stem: Stem) => void;
  updateStem: (stemId: string, updates: Partial<Stem>) => void;
  selectStem: (stemId: string | null) => void;
  setStemVolume: (stemId: string, volume: number) => void;
  toggleStemMute: (stemId: string) => void;
  toggleStemSolo: (stemId: string) => void;
  
  // Slice bank management
  setSliceBank: (bank: SliceBank) => void;
  selectSliceBank: (bankId: string | null) => void;
  setSliceBankLoaded: (bankId: string, loaded: boolean) => void;
  
  // Job management
  addJob: (job: Job) => void;
  updateJob: (jobId: string, updates: Partial<Job>) => void;
  
  // Transport
  setIsPlaying: (playing: boolean) => void;
  setCurrentBeat: (beat: number) => void;
  setMasterVolume: (volume: number) => void;
  
  // Sequencer
  setSequencerConfig: (config: Partial<SequencerConfig>) => void;
  addRule: (rule: TriggerRule) => void;
  updateRule: (ruleId: string, updates: Partial<TriggerRule>) => void;
  removeRule: (ruleId: string) => void;
  
  // Error
  setError: (error: string | null) => void;
  
  // Reset
  reset: () => void;
}

type SessionStore = SessionState & SessionActions;

// =============================================================================
// INITIAL STATE
// =============================================================================

const initialState: SessionState = {
  session: null,
  workflowStage: 'idle',
  selectedStemId: null,
  selectedSliceBankId: null,
  isPlaying: false,
  currentBeat: 0,
  sequencerConfig: {
    mode: 'sequential',
    bpm: 120,
    swing: 0,
    subdivision: 4,
    euclideanSteps: 16,
    euclideanPulses: 4,
    chaosAmount: 0.5,
    followSource: null,
  },
  rules: [],
  masterVolume: 0.8,
  error: null,
};

// =============================================================================
// STORE
// =============================================================================

export const useSessionStore = create<SessionStore>()(
  devtools(
    immer(
      (set, _get) => ({
        ...initialState,

        // Session management
        setSession: (session) => set({ session, workflowStage: session ? 'ready' : 'idle' }),
        
        updateSession: (updates) => set((state) => {
          if (state.session) {
            Object.assign(state.session, updates);
          }
        }),
        
        setWorkflowStage: (stage) => set({ workflowStage: stage }),

        // Stem management
        addStem: (stem) => set((state) => {
          if (state.session) {
            state.session.stems.push(stem);
          }
        }),
        
        updateStem: (stemId, updates) => set((state) => {
          if (state.session) {
            const stem = state.session.stems.find(s => s.id === stemId);
            if (stem) Object.assign(stem, updates);
          }
        }),
        
        selectStem: (stemId) => set({ selectedStemId: stemId }),
        
        setStemVolume: (stemId, volume) => set((state) => {
          if (state.session) {
            const stem = state.session.stems.find(s => s.id === stemId);
            if (stem) stem.volume = Math.max(0, Math.min(1, volume));
          }
        }),
        
        toggleStemMute: (stemId) => set((state) => {
          if (state.session) {
            const stem = state.session.stems.find(s => s.id === stemId);
            if (stem) stem.muted = !stem.muted;
          }
        }),
        
        toggleStemSolo: (stemId) => set((state) => {
          if (state.session) {
            const stem = state.session.stems.find(s => s.id === stemId);
            if (stem) stem.solo = !stem.solo;
          }
        }),

        // Slice bank management
        setSliceBank: (bank) => set((state) => {
          if (state.session) {
            state.session.sliceBanks.set(bank.id, bank);
          }
        }),
        
        selectSliceBank: (bankId) => set({ selectedSliceBankId: bankId }),
        
        setSliceBankLoaded: (bankId, loaded) => set((state) => {
          if (state.session) {
            const bank = state.session.sliceBanks.get(bankId);
            if (bank) bank.isLoaded = loaded;
          }
        }),

        // Job management
        addJob: (job) => set((state) => {
          if (state.session) {
            state.session.jobs.push(job);
          }
        }),
        
        updateJob: (jobId, updates) => set((state) => {
          if (state.session) {
            const job = state.session.jobs.find(j => j.id === jobId);
            if (job) Object.assign(job, updates);
          }
        }),

        // Transport
        setIsPlaying: (playing) => set({ isPlaying: playing }),
        setCurrentBeat: (beat) => set({ currentBeat: beat }),
        setMasterVolume: (volume) => set({ masterVolume: Math.max(0, Math.min(1, volume)) }),

        // Sequencer
        setSequencerConfig: (config) => set((state) => {
          Object.assign(state.sequencerConfig, config);
        }),
        
        addRule: (rule) => set((state) => {
          state.rules.push(rule);
        }),
        
        updateRule: (ruleId, updates) => set((state) => {
          const rule = state.rules.find(r => r.id === ruleId);
          if (rule) Object.assign(rule, updates);
        }),
        
        removeRule: (ruleId) => set((state) => {
          state.rules = state.rules.filter(r => r.id !== ruleId);
        }),

        // Error
        setError: (error) => set({ error }),

        // Reset
        reset: () => set(initialState),
      })
    ),
    { name: 'loop-forge-session' }
  )
);

// =============================================================================
// SELECTORS
// =============================================================================

export const selectSelectedStem = (state: SessionStore) => 
  state.session?.stems.find(s => s.id === state.selectedStemId);

export const selectSelectedSliceBank = (state: SessionStore) =>
  state.selectedSliceBankId ? state.session?.sliceBanks.get(state.selectedSliceBankId) : null;

export const selectActiveStems = (state: SessionStore) => {
  if (!state.session) return [];
  const hasSolo = state.session.stems.some(s => s.solo);
  return state.session.stems.filter(s => hasSolo ? s.solo : !s.muted);
};
