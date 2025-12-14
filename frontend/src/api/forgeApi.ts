import axios, { AxiosProgressEvent } from 'axios';
import { ForgeSession, ProcessingConfig, LoopViewModel } from '../types/forge';

const API_BASE = '/api/forge';

// Configure axios instance with proper timeouts and error handling
const apiClient = axios.create({
    baseURL: API_BASE,
    timeout: 600000, // 10 minutes for large uploads + analysis
    // DO NOT set Content-Type for multipart/form-data - axios sets it automatically with boundary
    // Retry configuration
    validateStatus: (status) => status < 500, // Don't throw on 4xx errors
    maxContentLength: Infinity,
    maxBodyLength: Infinity,
});

// Request interceptor for better error handling
apiClient.interceptors.request.use(
    (config) => {
        return config;
    },
    (error) => {
        return Promise.reject(error);
    }
);

// Response interceptor for error handling
apiClient.interceptors.response.use(
    (response) => {
        return response;
    },
    (error) => {
        // Enhanced error handling
        if (error.code === 'ECONNABORTED') {
            error.message = 'Request timeout - file may be too large or server is slow';
        } else if (error.code === 'ERR_NETWORK' || error.code === 'ECONNREFUSED') {
            error.message = 'Cannot connect to server - make sure the backend is running';
        } else if (error.response) {
            // Server responded with error
            error.message = error.response.data?.detail || error.response.data?.message || error.message;
        }
        return Promise.reject(error);
    }
);

// Health check with retry logic
async function checkBackendHealth(maxRetries = 3): Promise<boolean> {
    for (let i = 0; i < maxRetries; i++) {
        try {
            const response = await axios.get('/api/health', {
                timeout: 2000,
                validateStatus: () => true // Don't throw on any status
            });
            if (response.status === 200) {
                return true;
            }
        } catch (error) {
            if (i < maxRetries - 1) {
                await new Promise(resolve => setTimeout(resolve, 1000)); // Wait 1s between retries
            }
        }
    }
    return false;
}

export const forgeApi = {
    async checkHealth(): Promise<boolean> {
        return await checkBackendHealth();
    },

    async createSession(): Promise<string> {
        const res = await apiClient.post('/forge-complete');
        return res.data.session_id;
    },

    async uploadFiles(
        files: File[], 
        onProgress?: (progress: number) => void
    ): Promise<ForgeSession> {
        // Pre-flight health check
        const isHealthy = await checkBackendHealth(2);
        if (!isHealthy) {
            throw new Error('Backend server is not responding. Please restart the backend server and try again.');
        }

        const formData = new FormData();
        
        // Validate files before upload
        if (!files || files.length === 0) {
            throw new Error('No files provided');
        }
        
        // Append files to FormData
        files.forEach((f, idx) => {
            if (!f || !f.name) {
                throw new Error(`Invalid file at index ${idx}`);
            }
            formData.append('files', f, f.name);
        });

        // Calculate total size for progress tracking
        const totalSize = files.reduce((sum, f) => sum + f.size, 0);
        let uploadedSize = 0;
        let lastProgressUpdate = 0;

        // Start simulated progress immediately (proxy may delay real progress events)
        let simulatedProgress = 5;
        const progressInterval = setInterval(() => {
            if (onProgress && simulatedProgress < 75) {
                simulatedProgress += 2;
                if (simulatedProgress > lastProgressUpdate) {
                    onProgress(simulatedProgress);
                }
            }
        }, 500);

        try {
            console.log(`[UPLOAD] Starting upload of ${files.length} files (${(totalSize / 1024 / 1024).toFixed(2)} MB total)`);
            
            // Immediate feedback
            if (onProgress) onProgress(5);
            
            const res = await apiClient.post('/forge-complete', formData, {
                timeout: 600000, // 10 minutes for large files
                maxContentLength: Infinity,
                maxBodyLength: Infinity,
                headers: {},
                onUploadProgress: (progressEvent: AxiosProgressEvent) => {
                    clearInterval(progressInterval); // Stop simulated progress once real progress starts
                    if (progressEvent.total && onProgress) {
                        const uploadProgress = (progressEvent.loaded / progressEvent.total) * 80;
                        uploadedSize = progressEvent.loaded;
                        lastProgressUpdate = Math.min(uploadProgress, 80);
                        console.log(`[UPLOAD] Progress: ${uploadProgress.toFixed(1)}%`);
                        onProgress(lastProgressUpdate);
                    } else if (progressEvent.loaded && onProgress) {
                        uploadedSize = progressEvent.loaded;
                        const estimatedProgress = Math.min((uploadedSize / (totalSize || 1)) * 80, 80);
                        lastProgressUpdate = estimatedProgress;
                        console.log(`[UPLOAD] Progress (estimated): ${estimatedProgress.toFixed(1)}%`);
                        onProgress(estimatedProgress);
                    }
                },
            });
            
            clearInterval(progressInterval);
            
            console.log('[UPLOAD] Upload completed successfully');

            // After upload completes, simulate analysis progress
            if (onProgress) {
                // Simulate analysis progress from 80-95%
                for (let i = 80; i <= 95; i += 5) {
                    await new Promise(resolve => setTimeout(resolve, 200));
                    onProgress(i);
                }
            }

            return res.data;
        } catch (error: any) {
            clearInterval(progressInterval);
            // Enhanced error reporting
            if (error.response?.status === 413) {
                throw new Error('File too large - maximum size exceeded');
            } else if (error.response?.status === 400) {
                throw new Error(`Invalid file: ${error.message}`);
            } else if (error.code === 'ECONNABORTED') {
                throw new Error('Upload timeout - files may be too large. Try smaller files or check your connection.');
            }
            throw error;
        }
    },

    async startProcessing(sessionId: string, config: ProcessingConfig): Promise<void> {
        const params = new URLSearchParams();

        // Dual-anchor system
        if (config.rhythm_anchor_filename) params.append('rhythm_anchor_filename', config.rhythm_anchor_filename);
        if (config.harmonic_anchor_filename) params.append('harmonic_anchor_filename', config.harmonic_anchor_filename);
        if (config.target_bpm) params.append('target_bpm', config.target_bpm.toString());
        if (config.target_key) params.append('target_key', config.target_key);
        if (config.target_mode) params.append('target_mode', config.target_mode);

        params.append('roles', JSON.stringify(config.roles));
        params.append('enabled_presets', config.enabled_presets.join(','));
        params.append('crops', JSON.stringify(config.crops));

        if (config.quality) params.append('quality', config.quality);
        if (config.vocal_settings) params.append('vocal_settings', JSON.stringify(config.vocal_settings));

        await apiClient.post(`/forge-complete/${sessionId}/process`, null, {
            params,
            timeout: 10000, // 10s timeout for starting processing (should be quick)
        });
    },

    async getStatus(sessionId: string): Promise<ForgeSession> {
        const res = await apiClient.get(`/forge-complete/${sessionId}/status`, {
            timeout: 3000, // 3s timeout - shorter to detect hangs faster
            signal: AbortSignal.timeout(3000), // Abort after 3s
        });
        return res.data;
    },

    async mutateLoop(sessionId: string, filename: string, texture: string): Promise<any> {
        const res = await axios.post(`${API_BASE}/forge-complete/${sessionId}/mutate`, null, {
            params: { filename, texture }
        });
        return res.data;
    },

    async evolveTrack(sessionId: string, filename: string, tags: string[]): Promise<LoopViewModel> {
        const res = await fetch(`${API_BASE}/evolve`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ session_id: sessionId, filename, tags })
        })
        if (!res.ok) throw new Error('Evolution failed')
        return res.json()
    },

    getStreamUrl(sessionId: string, filename: string): string {
        return `${API_BASE}/stream/${sessionId}/${filename}`;
    },

    getDownloadUrl(sessionId: string): string {
        return `${API_BASE}/download-complete/${sessionId}`;
    },

    async exportLoops(sessionId: string, loops: { filename: string, crop_start: number, crop_end: number }[]): Promise<Blob> {
        const res = await axios.post(`${API_BASE}/export`, {
            session_id: sessionId,
            loops
        }, {
            responseType: 'blob'
        });
        return res.data;
    },

    // Groove Transfer API
    async extractGroove(sessionId: string, filename: string, bpm: number, subdivision: string = '16th'): Promise<any> {
        const res = await axios.post(`${API_BASE}/groove/extract`, {
            session_id: sessionId,
            filename,
            bpm,
            subdivision
        });
        return res.data;
    },

    async applyGroove(
        sessionId: string,
        sourceFilename: string,
        targetFilename: string,
        sourceBpm: number,
        targetBpm: number,
        strength: number = 1.0,
        subdivision: string = '16th'
    ): Promise<any> {
        const res = await axios.post(`${API_BASE}/groove/apply`, {
            session_id: sessionId,
            source_filename: sourceFilename,
            target_filename: targetFilename,
            source_bpm: sourceBpm,
            target_bpm: targetBpm,
            strength,
            subdivision
        });
        return res.data;
    },

    async analyzeGrooveCompatibility(
        sessionId: string,
        filenameA: string,
        filenameB: string,
        bpmA: number,
        bpmB: number
    ): Promise<any> {
        const res = await axios.post(`${API_BASE}/groove/compatibility`, {
            session_id: sessionId,
            filename_a: filenameA,
            filename_b: filenameB,
            bpm_a: bpmA,
            bpm_b: bpmB
        });
        return res.data;
    },

    // Phrase Detection API
    async detectPhrases(sessionId: string, filename: string, bpm?: number): Promise<any> {
        const res = await axios.post(`${API_BASE}/phrases/detect`, {
            session_id: sessionId,
            filename,
            bpm
        });
        return res.data;
    }
};
