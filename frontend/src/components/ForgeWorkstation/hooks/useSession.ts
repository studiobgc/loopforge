/**
 * useSession - Hook for session management
 * 
 * Handles upload, polling, WebSocket updates, and session state
 */

import { useState, useCallback, useRef, useEffect } from 'react';
import { api, Session, Moment } from '../../../api/client';

interface SessionState {
  session: Session | null;
  isProcessing: boolean;
  processingStage: string;
  processingProgress: number;
  moments: Moment[];
  error: string | null;
}

export function useSession() {
  const [state, setState] = useState<SessionState>({
    session: null,
    isProcessing: false,
    processingStage: '',
    processingProgress: 0,
    moments: [],
    error: null,
  });

  const wsRef = useRef<WebSocket | null>(null);

  // Connect WebSocket for real-time updates
  const connectWebSocket = useCallback((sessionId: string) => {
    if (wsRef.current) wsRef.current.close();
    
    const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
    const ws = new WebSocket(`${protocol}//${window.location.host}/api/ws/${sessionId}`);
    
    ws.onmessage = (event) => {
      const data = JSON.parse(event.data);
      if (data.type === 'job_progress') {
        setState(s => ({
          ...s,
          processingProgress: data.progress,
          processingStage: data.stage,
        }));
      }
      if (data.type === 'moments_ready') {
        setState(s => ({ ...s, moments: data.moments }));
      }
    };
    
    wsRef.current = ws;
  }, []);

  // Upload file and start processing
  const uploadFile = useCallback(async (file: File): Promise<Session | null> => {
    setState(s => ({
      ...s,
      isProcessing: true,
      processingStage: 'Uploading...',
      processingProgress: 0,
      error: null,
    }));

    try {
      const result = await api.upload(file, {
        autoSeparate: true,
        autoAnalyze: true,
        onProgress: (percent) => {
          setState(s => ({ ...s, processingProgress: percent * 0.2 }));
        },
      });

      connectWebSocket(result.session_id);
      
      setState(s => ({
        ...s,
        processingStage: 'Separating stems...',
        processingProgress: 20,
      }));

      // Poll for completion
      const pollSession = async (): Promise<Session> => {
        const sess = await api.getSession(result.session_id);
        if (sess.stems && sess.stems.length > 0) {
          return sess;
        }
        await new Promise(r => setTimeout(r, 2000));
        return pollSession();
      };

      const session = await pollSession();
      
      setState(s => ({
        ...s,
        session,
        isProcessing: false,
        processingProgress: 100,
      }));

      return session;

    } catch (e) {
      setState(s => ({
        ...s,
        error: e instanceof Error ? e.message : 'Upload failed',
        isProcessing: false,
      }));
      return null;
    }
  }, [connectWebSocket]);

  // Load existing session
  const loadSession = useCallback(async (sessionId: string): Promise<Session | null> => {
    try {
      const session = await api.getSession(sessionId);
      setState(s => ({ ...s, session, error: null }));
      return session;
    } catch (e) {
      setState(s => ({
        ...s,
        error: e instanceof Error ? e.message : 'Failed to load session',
      }));
      return null;
    }
  }, []);

  // Detect moments
  const detectMoments = useCallback(async (audioPath: string) => {
    try {
      const result = await api.detectMoments(audioPath, 'balanced');
      const moments = result.moments.map(m => ({
        type: m.type,
        start: m.start_time,
        end: m.end_time,
        confidence: m.confidence,
        energy: m.energy,
        brightness: m.brightness,
        label: m.label,
      }));
      setState(s => ({ ...s, moments }));
      return moments;
    } catch (e) {
      console.error('Moment detection failed:', e);
      return [];
    }
  }, []);

  // Clear session
  const clearSession = useCallback(() => {
    if (wsRef.current) wsRef.current.close();
    setState({
      session: null,
      isProcessing: false,
      processingStage: '',
      processingProgress: 0,
      moments: [],
      error: null,
    });
  }, []);

  // Clear error
  const clearError = useCallback(() => {
    setState(s => ({ ...s, error: null }));
  }, []);

  // Cleanup on unmount
  useEffect(() => {
    return () => {
      if (wsRef.current) wsRef.current.close();
    };
  }, []);

  return {
    ...state,
    uploadFile,
    loadSession,
    detectMoments,
    clearSession,
    clearError,
  };
}
