import { useState, useEffect, useCallback, useRef } from 'react';

interface HealthStatus {
  backend: boolean;
  lastCheck: Date | null;
  reconnecting: boolean;
}

const HEALTH_CHECK_INTERVAL = 15000; // 15 seconds (less aggressive)
const BACKEND_URL = '/api/health';
const FAILURE_THRESHOLD = 3; // Require 3 consecutive failures before showing offline

export function useHealthCheck(onReconnect?: () => void) {
  const [status, setStatus] = useState<HealthStatus>({
    backend: true, // Assume healthy initially
    lastCheck: null,
    reconnecting: false,
  });
  
  const wasOfflineRef = useRef(false);
  const checkingRef = useRef(false);
  const failureCountRef = useRef(0);

  const checkHealth = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 8000); // 8s timeout
      
      const response = await fetch(BACKEND_URL, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      const isHealthy = response.ok;
      
      if (isHealthy) {
        failureCountRef.current = 0; // Reset on success
        
        // If we were offline and now online, trigger reconnect callback
        if (wasOfflineRef.current) {
          console.log('[HealthCheck] Backend reconnected!');
          wasOfflineRef.current = false;
          setTimeout(() => onReconnect?.(), 500);
        }
        
        setStatus({
          backend: true,
          lastCheck: new Date(),
          reconnecting: false,
        });
      } else {
        failureCountRef.current++;
        if (failureCountRef.current >= FAILURE_THRESHOLD) {
          wasOfflineRef.current = true;
          setStatus({
            backend: false,
            lastCheck: new Date(),
            reconnecting: true,
          });
        }
      }
    } catch (error) {
      failureCountRef.current++;
      
      // Only show offline after multiple consecutive failures
      if (failureCountRef.current >= FAILURE_THRESHOLD) {
        console.log('[HealthCheck] Backend offline (after retries)');
        wasOfflineRef.current = true;
        
        setStatus({
          backend: false,
          lastCheck: new Date(),
          reconnecting: true,
        });
      }
    } finally {
      checkingRef.current = false;
    }
  }, [onReconnect]);

  useEffect(() => {
    // Delayed initial check (give backend time to start)
    const initialTimeout = setTimeout(checkHealth, 2000);
    
    // Periodic checks
    const interval = setInterval(checkHealth, HEALTH_CHECK_INTERVAL);
    
    return () => {
      clearTimeout(initialTimeout);
      clearInterval(interval);
    };
  }, [checkHealth]);

  return status;
}
