/**
 * useProjects - Hook for project/session management
 * 
 * List sessions, delete sessions, job management
 */

import { useState, useCallback, useEffect } from 'react';
import { api, Session, Job } from '../../../api/client';

interface ProjectsState {
  recentSessions: Session[];
  isLoading: boolean;
}

export function useProjects() {
  const [state, setState] = useState<ProjectsState>({
    recentSessions: [],
    isLoading: false,
  });

  // Load recent sessions
  const loadRecentSessions = useCallback(async (limit: number = 20) => {
    setState(s => ({ ...s, isLoading: true }));
    try {
      const result = await api.listSessions(limit);
      setState(s => ({ ...s, recentSessions: result.sessions, isLoading: false }));
      return result.sessions;
    } catch (e) {
      console.error('Failed to load sessions:', e);
      setState(s => ({ ...s, isLoading: false }));
      return [];
    }
  }, []);

  // Delete session
  const deleteSession = useCallback(async (sessionId: string) => {
    try {
      await api.deleteSession(sessionId);
      setState(s => ({
        ...s,
        recentSessions: s.recentSessions.filter(sess => sess.id !== sessionId),
      }));
      return true;
    } catch (e) {
      console.error('Failed to delete session:', e);
      return false;
    }
  }, []);

  // Get job status
  const getJobStatus = useCallback(async (jobId: string): Promise<Job | null> => {
    try {
      return await api.getJob(jobId);
    } catch (e) {
      console.error('Failed to get job:', e);
      return null;
    }
  }, []);

  // List jobs for session
  const listJobs = useCallback(async (sessionId: string): Promise<Job[]> => {
    try {
      const result = await api.listJobs(sessionId);
      return result.jobs;
    } catch (e) {
      console.error('Failed to list jobs:', e);
      return [];
    }
  }, []);

  // Cancel job
  const cancelJob = useCallback(async (jobId: string): Promise<boolean> => {
    try {
      await api.cancelJob(jobId);
      return true;
    } catch (e) {
      console.error('Failed to cancel job:', e);
      return false;
    }
  }, []);

  // Load on mount
  useEffect(() => {
    loadRecentSessions();
  }, [loadRecentSessions]);

  return {
    ...state,
    loadRecentSessions,
    deleteSession,
    getJobStatus,
    listJobs,
    cancelJob,
  };
}
