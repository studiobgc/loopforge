/**
 * JobQueue - Real-time job queue visualization with cancel support
 */

import React, { useState, useEffect } from 'react';
import { X, RefreshCw, AlertCircle, CheckCircle, Clock, Loader } from 'lucide-react';
import { api, Job } from '../../api/client';

interface JobQueueProps {
  sessionId: string | null;
  onJobComplete?: (job: Job) => void;
}

const STATUS_ICONS: Record<string, React.ReactNode> = {
  pending: <Clock size={12} className="ba-job-icon pending" />,
  running: <Loader size={12} className="ba-job-icon running" />,
  completed: <CheckCircle size={12} className="ba-job-icon completed" />,
  failed: <AlertCircle size={12} className="ba-job-icon failed" />,
  cancelled: <X size={12} className="ba-job-icon cancelled" />,
};

export const JobQueue: React.FC<JobQueueProps> = ({ sessionId, onJobComplete }) => {
  const [jobs, setJobs] = useState<Job[]>([]);
  const [isLoading, setIsLoading] = useState(false);

  // Poll for job updates
  useEffect(() => {
    if (!sessionId) {
      setJobs([]);
      return;
    }

    const fetchJobs = async () => {
      try {
        const result = await api.listJobs(sessionId);
        const newJobs = result.jobs;
        
        // Check for newly completed jobs
        newJobs.forEach(job => {
          const oldJob = jobs.find(j => j.id === job.id);
          if (oldJob && oldJob.status === 'running' && job.status === 'completed') {
            onJobComplete?.(job);
          }
        });
        
        setJobs(newJobs);
      } catch (e) {
        console.error('Failed to fetch jobs:', e);
      }
    };

    fetchJobs();
    const interval = setInterval(fetchJobs, 2000);
    return () => clearInterval(interval);
  }, [sessionId, onJobComplete]);

  const handleCancel = async (jobId: string) => {
    try {
      await api.cancelJob(jobId);
      setJobs(jobs.map(j => j.id === jobId ? { ...j, status: 'cancelled' as const } : j));
    } catch (e) {
      console.error('Failed to cancel job:', e);
    }
  };

  const handleRetry = async (jobId: string) => {
    setIsLoading(true);
    try {
      // Retry endpoint exists in backend
      await fetch(`/api/jobs/${jobId}/retry`, { method: 'POST' });
      // Refresh jobs
      if (sessionId) {
        const result = await api.listJobs(sessionId);
        setJobs(result.jobs);
      }
    } catch (e) {
      console.error('Failed to retry job:', e);
    }
    setIsLoading(false);
  };

  const activeJobs = jobs.filter(j => j.status === 'pending' || j.status === 'running');
  const recentJobs = jobs.filter(j => j.status !== 'pending' && j.status !== 'running').slice(0, 5);

  if (jobs.length === 0) return null;

  return (
    <div className="ba-job-queue">
      {activeJobs.length > 0 && (
        <div className="ba-job-section">
          <h4>Active Jobs</h4>
          {activeJobs.map(job => (
            <div key={job.id} className={`ba-job-item ${job.status}`}>
              {STATUS_ICONS[job.status]}
              <div className="ba-job-info">
                <span className="ba-job-type">{job.job_type}</span>
                {job.stage && <span className="ba-job-stage">{job.stage}</span>}
              </div>
              {job.status === 'running' && (
                <div className="ba-job-progress">
                  <div className="ba-job-progress-bar" style={{ width: `${job.progress}%` }} />
                  <span>{Math.round(job.progress)}%</span>
                </div>
              )}
              {(job.status === 'pending' || job.status === 'running') && (
                <button 
                  className="ba-btn-icon-sm" 
                  onClick={() => handleCancel(job.id)}
                  title="Cancel job"
                >
                  <X size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}

      {recentJobs.length > 0 && (
        <div className="ba-job-section ba-job-section-history">
          <h4>Recent</h4>
          {recentJobs.map(job => (
            <div key={job.id} className={`ba-job-item ${job.status}`}>
              {STATUS_ICONS[job.status]}
              <span className="ba-job-type">{job.job_type}</span>
              {job.status === 'failed' && (
                <button 
                  className="ba-btn-icon-sm" 
                  onClick={() => handleRetry(job.id)}
                  disabled={isLoading}
                  title="Retry job"
                >
                  <RefreshCw size={10} />
                </button>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
};
