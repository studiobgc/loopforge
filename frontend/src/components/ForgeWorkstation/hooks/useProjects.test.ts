/**
 * Tests for useProjects hook
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useProjects } from './useProjects';

// Mock API
vi.mock('../../../api/client', () => ({
  api: {
    listSessions: vi.fn().mockResolvedValue({
      sessions: [
        { id: 'sess-1', name: 'Project 1', source_filename: 'track1.mp3', bpm: 120 },
        { id: 'sess-2', name: 'Project 2', source_filename: 'track2.wav', bpm: 140 },
      ],
    }),
    deleteSession: vi.fn().mockResolvedValue(undefined),
    getJob: vi.fn().mockResolvedValue({
      id: 'job-123',
      status: 'completed',
      progress: 100,
    }),
    listJobs: vi.fn().mockResolvedValue({
      jobs: [
        { id: 'job-1', job_type: 'separation', status: 'completed' },
        { id: 'job-2', job_type: 'analysis', status: 'running' },
      ],
    }),
    cancelJob: vi.fn().mockResolvedValue({ cancelled: 'job-123' }),
  },
}));

describe('useProjects', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('should load recent sessions on mount', async () => {
    const { result } = renderHook(() => useProjects());
    
    // Wait for the initial load
    await vi.waitFor(() => {
      expect(result.current.recentSessions).toHaveLength(2);
    });

    expect(result.current.recentSessions[0].id).toBe('sess-1');
  });

  it('should delete session', async () => {
    const { result } = renderHook(() => useProjects());
    
    // Wait for initial load
    await vi.waitFor(() => {
      expect(result.current.recentSessions).toHaveLength(2);
    });

    let deleted: boolean = false;
    await act(async () => {
      deleted = await result.current.deleteSession('sess-1');
    });

    expect(deleted).toBe(true);
    expect(result.current.recentSessions).toHaveLength(1);
    expect(result.current.recentSessions[0].id).toBe('sess-2');
  });

  it('should get job status', async () => {
    const { result } = renderHook(() => useProjects());
    
    let job: any;
    await act(async () => {
      job = await result.current.getJobStatus('job-123');
    });

    expect(job).not.toBeNull();
    expect(job.status).toBe('completed');
  });

  it('should list jobs for session', async () => {
    const { result } = renderHook(() => useProjects());
    
    let jobs: any[] = [];
    await act(async () => {
      jobs = await result.current.listJobs('session-123');
    });

    expect(jobs).toHaveLength(2);
    expect(jobs[0].job_type).toBe('separation');
  });

  it('should cancel job', async () => {
    const { result } = renderHook(() => useProjects());
    
    let cancelled: boolean = false;
    await act(async () => {
      cancelled = await result.current.cancelJob('job-123');
    });

    expect(cancelled).toBe(true);
  });

  it('should handle delete error gracefully', async () => {
    const { api } = await import('../../../api/client');
    vi.mocked(api.deleteSession).mockRejectedValueOnce(new Error('Delete failed'));

    const { result } = renderHook(() => useProjects());
    
    // Wait for initial load
    await vi.waitFor(() => {
      expect(result.current.recentSessions).toHaveLength(2);
    });

    let deleted: boolean = true;
    await act(async () => {
      deleted = await result.current.deleteSession('sess-1');
    });

    expect(deleted).toBe(false);
    // Sessions should remain unchanged
    expect(result.current.recentSessions).toHaveLength(2);
  });
});
