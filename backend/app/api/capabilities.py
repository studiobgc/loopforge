from __future__ import annotations

import os

from fastapi import APIRouter

router = APIRouter(prefix="/capabilities", tags=["Capabilities"])


@router.get("")
async def get_capabilities():
    max_upload_mb = int(os.getenv("LOOPFORGE_MAX_UPLOAD_MB", "250"))
    return {
        "api_version": "2",
        "features": {
            "moments": True,
            "slices": True,
            "bounce": True,
            "job_cancel": True,
            "quick_mode": os.environ.get("LOOPFORGE_QUICK_MODE") == "1",
            "stem_separation": True,
        },
        "limits": {
            "max_upload_mb": max_upload_mb,
        },
        "formats": {
            "audio": [".mp3", ".wav", ".flac", ".m4a", ".ogg", ".aiff"],
        },
    }
