/**
 * SessionContext - Shared state between DAW, PitchifyLab, and SketchPad
 * 
 * Enables workflows:
 * - Split in DAW → Send to Pitchify Lab
 * - Multi-sample sketch: Load 3-5 samples, pick stems from each, sequence together
 */

import React, { createContext, useContext, useState, useCallback, ReactNode } from 'react';

export interface SharedStem {
  id: string;
  name: string;
  path: string;
  role: 'drums' | 'bass' | 'vocals' | 'other';
  sessionId: string;
  audioUrl: string;
  audioBuffer?: AudioBuffer;
  detected_key?: string;
  detected_bpm?: number;
}

export interface SharedSession {
  id: string;
  filename: string;
  bpm: number;
  key: string;
  stems: SharedStem[];
  createdAt: Date;
}

// Multi-sample sketch types
export interface SketchSample {
  id: string;
  filename: string;
  sessionId: string;
  audioUrl: string;
  detected_key?: string;
  detected_bpm?: number;
  stems: SharedStem[];
  status: 'uploading' | 'separating' | 'ready' | 'error';
}

export type SketchRole = 'drums' | 'bass' | 'vocals' | 'melody' | 'texture';

export interface SketchAssignment {
  role: SketchRole;
  sampleId: string;
  stemId: string;
  stem: SharedStem;
}

export interface SketchSequence {
  id: string;
  role: SketchRole;
  events: { beat: number; padIndex: number; velocity: number }[];
  bars: number;
}

export interface Sketch {
  id: string;
  name: string;
  targetKey: string;
  targetBpm: number;
  samples: SketchSample[];
  assignments: SketchAssignment[];
  sequences: SketchSequence[];
  createdAt: Date;
}

interface SessionContextType {
  currentSession: SharedSession | null;
  setCurrentSession: (session: SharedSession | null) => void;
  availableStems: SharedStem[];
  addStem: (stem: SharedStem) => void;
  removeStem: (stemId: string) => void;
  selectedStemForPitchify: SharedStem | null;
  sendToPitchifyLab: (stem: SharedStem) => void;
  clearPitchifySelection: () => void;
  // Multi-sample sketch
  currentSketch: Sketch | null;
  createSketch: (name?: string) => Sketch;
  addSampleToSketch: (sample: SketchSample) => void;
  updateSampleStatus: (sampleId: string, status: SketchSample['status'], stems?: SharedStem[]) => void;
  assignStemToRole: (assignment: SketchAssignment) => void;
  removeAssignment: (role: SketchRole) => void;
  addSequence: (sequence: SketchSequence) => void;
  updateSequence: (sequenceId: string, events: SketchSequence['events']) => void;
  setTargetKey: (key: string) => void;
  setTargetBpm: (bpm: number) => void;
  clearSketch: () => void;
}

const SessionContext = createContext<SessionContextType | null>(null);

export const SessionProvider: React.FC<{ children: ReactNode }> = ({ children }) => {
  const [currentSession, setCurrentSession] = useState<SharedSession | null>(null);
  const [availableStems, setAvailableStems] = useState<SharedStem[]>([]);
  const [selectedStemForPitchify, setSelectedStemForPitchify] = useState<SharedStem | null>(null);
  const [currentSketch, setCurrentSketch] = useState<Sketch | null>(null);

  const addStem = useCallback((stem: SharedStem) => {
    setAvailableStems(prev => {
      if (prev.some(s => s.id === stem.id)) return prev;
      return [...prev, stem];
    });
  }, []);

  const removeStem = useCallback((stemId: string) => {
    setAvailableStems(prev => prev.filter(s => s.id !== stemId));
  }, []);

  const sendToPitchifyLab = useCallback((stem: SharedStem) => {
    addStem(stem);
    setSelectedStemForPitchify(stem);
  }, [addStem]);

  const clearPitchifySelection = useCallback(() => {
    setSelectedStemForPitchify(null);
  }, []);

  // Sketch methods
  const createSketch = useCallback((name?: string): Sketch => {
    const sketch: Sketch = {
      id: crypto.randomUUID(),
      name: name || `Sketch ${new Date().toLocaleTimeString()}`,
      targetKey: 'C',
      targetBpm: 120,
      samples: [],
      assignments: [],
      sequences: [],
      createdAt: new Date(),
    };
    setCurrentSketch(sketch);
    return sketch;
  }, []);

  const addSampleToSketch = useCallback((sample: SketchSample) => {
    setCurrentSketch(prev => {
      if (!prev) return prev;
      if (prev.samples.some(s => s.id === sample.id)) return prev;
      return { ...prev, samples: [...prev.samples, sample] };
    });
  }, []);

  const updateSampleStatus = useCallback((sampleId: string, status: SketchSample['status'], stems?: SharedStem[]) => {
    setCurrentSketch(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        samples: prev.samples.map(s => 
          s.id === sampleId ? { ...s, status, stems: stems || s.stems } : s
        ),
      };
    });
  }, []);

  const assignStemToRole = useCallback((assignment: SketchAssignment) => {
    setCurrentSketch(prev => {
      if (!prev) return prev;
      const filtered = prev.assignments.filter(a => a.role !== assignment.role);
      return { ...prev, assignments: [...filtered, assignment] };
    });
  }, []);

  const removeAssignment = useCallback((role: SketchRole) => {
    setCurrentSketch(prev => {
      if (!prev) return prev;
      return { ...prev, assignments: prev.assignments.filter(a => a.role !== role) };
    });
  }, []);

  const addSequence = useCallback((sequence: SketchSequence) => {
    setCurrentSketch(prev => {
      if (!prev) return prev;
      return { ...prev, sequences: [...prev.sequences, sequence] };
    });
  }, []);

  const updateSequence = useCallback((sequenceId: string, events: SketchSequence['events']) => {
    setCurrentSketch(prev => {
      if (!prev) return prev;
      return {
        ...prev,
        sequences: prev.sequences.map(s => s.id === sequenceId ? { ...s, events } : s),
      };
    });
  }, []);

  const setTargetKey = useCallback((key: string) => {
    setCurrentSketch(prev => prev ? { ...prev, targetKey: key } : prev);
  }, []);

  const setTargetBpm = useCallback((bpm: number) => {
    setCurrentSketch(prev => prev ? { ...prev, targetBpm: bpm } : prev);
  }, []);

  const clearSketch = useCallback(() => setCurrentSketch(null), []);

  return (
    <SessionContext.Provider
      value={{
        currentSession,
        setCurrentSession,
        availableStems,
        addStem,
        removeStem,
        selectedStemForPitchify,
        sendToPitchifyLab,
        clearPitchifySelection,
        currentSketch,
        createSketch,
        addSampleToSketch,
        updateSampleStatus,
        assignStemToRole,
        removeAssignment,
        addSequence,
        updateSequence,
        setTargetKey,
        setTargetBpm,
        clearSketch,
      }}
    >
      {children}
    </SessionContext.Provider>
  );
};

export const useSession = (): SessionContextType => {
  const context = useContext(SessionContext);
  if (!context) {
    throw new Error('useSession must be used within a SessionProvider');
  }
  return context;
};

export default SessionContext;
