#!/usr/bin/env python3
"""
Health check script to verify backend is running and responsive.
Can be used by monitoring tools or startup scripts.
"""
import sys
import requests
import time

def check_backend(max_retries=3, retry_delay=1):
    """Check if backend is healthy."""
    url = "http://localhost:8000/api/health"
    
    for attempt in range(max_retries):
        try:
            response = requests.get(url, timeout=2)
            if response.status_code == 200:
                print("✅ Backend is healthy")
                return True
        except requests.exceptions.RequestException as e:
            if attempt < max_retries - 1:
                time.sleep(retry_delay)
            else:
                print(f"❌ Backend health check failed: {e}")
                return False
    
    return False

if __name__ == "__main__":
    success = check_backend()
    sys.exit(0 if success else 1)

