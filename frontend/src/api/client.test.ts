/**
 * Tests for the LoopForge API client.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import axios from 'axios';
import { api } from './client';

// Mock axios
vi.mock('axios', () => ({
  default: {
    create: vi.fn(() => ({
      get: vi.fn(),
      post: vi.fn(),
      delete: vi.fn(),
    })),
  },
}));

describe('LoopForgeClient', () => {
  let mockHttp: any;

  beforeEach(() => {
    mockHttp = (axios.create as any)();
    // Replace the internal http instance
    (api as any).http = mockHttp;
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  describe('getCapabilities', () => {
    it('should fetch capabilities from /api/capabilities', async () => {
      const mockCapabilities = {
        api_version: '2.0',
        features: { separation: true, moments: true },
        limits: { max_upload_mb: 500 },
        formats: { audio: ['wav', 'mp3', 'flac'] },
      };

      mockHttp.get.mockResolvedValue({ data: mockCapabilities });

      const result = await api.getCapabilities();

      expect(mockHttp.get).toHaveBeenCalledWith('/api/capabilities');
      expect(result).toEqual(mockCapabilities);
    });
  });

  describe('getSession', () => {
    it('should fetch session by ID', async () => {
      const mockSession = {
        id: 'session-123',
        name: 'Test Session',
        bpm: 120,
        key: 'Am',
        stems: [],
        jobs: [],
      };

      mockHttp.get.mockResolvedValue({ data: mockSession });

      const result = await api.getSession('session-123');

      expect(mockHttp.get).toHaveBeenCalledWith('/api/sessions/session-123');
      expect(result).toEqual(mockSession);
    });
  });

  describe('listSessions', () => {
    it('should list recent sessions with default limit', async () => {
      const mockSessions = { sessions: [] };
      mockHttp.get.mockResolvedValue({ data: mockSessions });

      const result = await api.listSessions();

      expect(mockHttp.get).toHaveBeenCalledWith('/api/sessions', { params: { limit: 20 } });
      expect(result).toEqual(mockSessions);
    });

    it('should list sessions with custom limit', async () => {
      const mockSessions = { sessions: [] };
      mockHttp.get.mockResolvedValue({ data: mockSessions });

      await api.listSessions(50);

      expect(mockHttp.get).toHaveBeenCalledWith('/api/sessions', { params: { limit: 50 } });
    });
  });

  describe('deleteSession', () => {
    it('should delete session by ID', async () => {
      mockHttp.delete.mockResolvedValue({});

      await api.deleteSession('session-123');

      expect(mockHttp.delete).toHaveBeenCalledWith('/api/sessions/session-123');
    });
  });

  describe('getJob', () => {
    it('should fetch job by ID', async () => {
      const mockJob = {
        id: 'job-456',
        session_id: 'session-123',
        job_type: 'separation',
        status: 'completed',
        progress: 100,
      };

      mockHttp.get.mockResolvedValue({ data: mockJob });

      const result = await api.getJob('job-456');

      expect(mockHttp.get).toHaveBeenCalledWith('/api/jobs/job-456');
      expect(result).toEqual(mockJob);
    });
  });

  describe('listJobs', () => {
    it('should list jobs for a session', async () => {
      const mockJobs = { jobs: [] };
      mockHttp.get.mockResolvedValue({ data: mockJobs });

      const result = await api.listJobs('session-123');

      expect(mockHttp.get).toHaveBeenCalledWith('/api/jobs', { params: { session_id: 'session-123' } });
      expect(result).toEqual(mockJobs);
    });
  });

  describe('cancelJob', () => {
    it('should cancel a job', async () => {
      mockHttp.post.mockResolvedValue({ data: { cancelled: 'job-456' } });

      const result = await api.cancelJob('job-456');

      expect(mockHttp.post).toHaveBeenCalledWith('/api/jobs/job-456/cancel');
      expect(result).toEqual({ cancelled: 'job-456' });
    });
  });

  describe('URL builders', () => {
    it('should build stem download URL', () => {
      const url = api.getStemDownloadUrl('session-123', 'drums');
      expect(url).toBe('/api/assets/session/session-123/download/drums');
    });

    it('should build all stems download URL', () => {
      const url = api.getAllStemsDownloadUrl('session-123');
      expect(url).toBe('/api/assets/session/session-123/download-all');
    });

    it('should build source peaks URL', () => {
      const url = api.getSourcePeaksUrl('session-123');
      expect(url).toBe('/api/assets/session/session-123/source/peaks');
    });

    it('should build asset peaks URL', () => {
      const url = api.getAssetPeaksUrl('asset-789');
      expect(url).toBe('/api/assets/asset-789/peaks');
    });

    it('should build WebSocket URL', () => {
      const url = api.getWebSocketUrl('session-123');
      expect(url).toBe('/api/ws/session-123');
    });
  });

  describe('createSliceBank', () => {
    it('should create slice bank with all parameters', async () => {
      const mockBank = {
        id: 'bank-123',
        source_filename: 'drums.wav',
        role: 'drums',
        num_slices: 16,
        slices: [],
      };

      mockHttp.post.mockResolvedValue({ data: mockBank });

      const result = await api.createSliceBank('session-123', '/path/to/drums.wav', 'drums', 120, 'Am');

      expect(mockHttp.post).toHaveBeenCalledWith('/api/slices/banks', {
        session_id: 'session-123',
        stem_path: '/path/to/drums.wav',
        role: 'drums',
        bpm: 120,
        key: 'Am',
      });
      expect(result).toEqual(mockBank);
    });
  });

  describe('generateSequence', () => {
    it('should generate sequence with defaults', async () => {
      const mockSequence = {
        sequence_id: 'seq-123',
        slice_bank_id: 'bank-123',
        duration_beats: 16,
        bpm: 120,
        mode: 'sequential',
        num_events: 16,
        events: [],
      };

      mockHttp.post.mockResolvedValue({ data: mockSequence });

      await api.generateSequence({
        sessionId: 'session-123',
        sliceBankId: 'bank-123',
      });

      expect(mockHttp.post).toHaveBeenCalledWith('/api/slices/sequences/generate', expect.objectContaining({
        session_id: 'session-123',
        slice_bank_id: 'bank-123',
        duration_beats: 16,
        bpm: 120,
        mode: 'sequential',
      }));
    });
  });

  describe('searchSlicesByText', () => {
    it('should search slices by text query', async () => {
      const mockResults = {
        query: 'punchy kick',
        results: [{ slice_index: 0, score: 0.95 }],
        total_searched: 16,
      };

      mockHttp.post.mockResolvedValue({ data: mockResults });

      const result = await api.searchSlicesByText('bank-123', 'punchy kick', 4);

      expect(mockHttp.post).toHaveBeenCalledWith('/api/embeddings/search/text', {
        slice_bank_id: 'bank-123',
        query: 'punchy kick',
        top_k: 4,
      });
      expect(result).toEqual(mockResults);
    });
  });
});

describe('Type definitions', () => {
  it('should have correct Session type shape', () => {
    const session: import('./client').Session = {
      id: 'test',
      name: 'Test',
      source_filename: 'test.wav',
      bpm: 120,
      key: 'Am',
      duration_seconds: 180,
      created_at: '2024-01-01',
      stems: [],
      jobs: [],
    };
    expect(session.id).toBe('test');
  });

  it('should have correct Job type shape', () => {
    const job: import('./client').Job = {
      id: 'job-1',
      session_id: 'session-1',
      job_type: 'separation',
      status: 'completed',
      progress: 100,
      stage: 'Done',
      created_at: '2024-01-01',
      started_at: '2024-01-01',
      completed_at: '2024-01-01',
      output_paths: {},
      error_message: null,
    };
    expect(job.status).toBe('completed');
  });

  it('should have correct SliceBank type shape', () => {
    const bank: import('./client').SliceBank = {
      id: 'bank-1',
      source_filename: 'drums.wav',
      role: 'drums',
      num_slices: 16,
      total_duration: 4.0,
      slices: [],
      statistics: {
        mean_energy: 0.5,
        max_energy: 1.0,
        energy_variance: 0.1,
      },
    };
    expect(bank.num_slices).toBe(16);
  });
});
