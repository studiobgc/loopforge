"""
Jobs API Routes

Query and manage background processing jobs.
"""

from fastapi import APIRouter, HTTPException

from ..core.database import get_db
from ..core.models import Job, JobStatus

router = APIRouter(prefix="/jobs", tags=["Jobs"])


@router.get("/{job_id}")
async def get_job(job_id: str):
    """Get job status and details"""
    db = get_db()
    
    with db.session() as session:
        job = session.query(Job).filter(Job.id == job_id).first()
        if not job:
            raise HTTPException(404, "Job not found")
        
        return job.to_dict()


@router.get("")
async def list_jobs(
    session_id: str = None,
    status: str = None,
    limit: int = 50,
):
    """List jobs, optionally filtered by session or status"""
    db = get_db()
    
    with db.session() as session:
        query = session.query(Job)
        
        if session_id:
            query = query.filter(Job.session_id == session_id)
        
        if status:
            try:
                status_enum = JobStatus(status)
                query = query.filter(Job.status == status_enum)
            except ValueError:
                pass
        
        jobs = query.order_by(Job.created_at.desc()).limit(limit).all()
        
        return {
            "jobs": [j.to_dict() for j in jobs],
            "count": len(jobs),
        }


@router.post("/{job_id}/cancel")
async def cancel_job(job_id: str):
    """Cancel a job (pending or running)

    Note: cancelling a RUNNING job will prevent it from being recovered/retried
    on server restart. It does not forcibly interrupt an in-flight thread.
    """
    db = get_db()
    
    with db.session() as session:
        job = session.query(Job).filter(Job.id == job_id).first()
        if not job:
            raise HTTPException(404, "Job not found")
        
        if job.status not in (JobStatus.PENDING, JobStatus.RUNNING):
            raise HTTPException(400, f"Cannot cancel job with status {job.status}")
        
        job.status = JobStatus.CANCELLED
        session.commit()
        
        return {"cancelled": job_id}


@router.post("/{job_id}/retry")
async def retry_job(job_id: str):
    """Retry a failed job"""
    db = get_db()
    
    with db.session() as session:
        job = session.query(Job).filter(Job.id == job_id).first()
        if not job:
            raise HTTPException(404, "Job not found")
        
        if job.status != JobStatus.FAILED:
            raise HTTPException(400, f"Cannot retry job with status {job.status}")
        
        job.status = JobStatus.PENDING
        job.error_message = None
        job.error_traceback = None
        job.retry_count += 1
        session.commit()
        
        return {"retried": job_id, "attempt": job.retry_count}
