import { useState, useEffect, useCallback, useRef } from 'react';

interface HealthStatus {
  backend: boolean;
  lastCheck: Date | null;
  reconnecting: boolean;
}

const HEALTH_CHECK_INTERVAL = 5000; // 5 seconds
const BACKEND_URL = '/api/health';

export function useHealthCheck(onReconnect?: () => void) {
  const [status, setStatus] = useState<HealthStatus>({
    backend: true, // Assume healthy initially
    lastCheck: null,
    reconnecting: false,
  });
  
  const wasOfflineRef = useRef(false);
  const checkingRef = useRef(false);

  const checkHealth = useCallback(async () => {
    if (checkingRef.current) return;
    checkingRef.current = true;
    
    try {
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 3000);
      
      const response = await fetch(BACKEND_URL, {
        signal: controller.signal,
      });
      clearTimeout(timeoutId);
      
      const isHealthy = response.ok;
      
      // If we were offline and now online, trigger reconnect callback
      if (wasOfflineRef.current && isHealthy) {
        console.log('[HealthCheck] Backend reconnected!');
        wasOfflineRef.current = false;
        setTimeout(() => onReconnect?.(), 500);
      }
      
      setStatus({
        backend: isHealthy,
        lastCheck: new Date(),
        reconnecting: false,
      });
      
      if (!isHealthy) {
        wasOfflineRef.current = true;
      }
    } catch (error) {
      console.log('[HealthCheck] Backend offline');
      wasOfflineRef.current = true;
      
      setStatus({
        backend: false,
        lastCheck: new Date(),
        reconnecting: true,
      });
      
      // Try to trigger restart via helper endpoint
      try {
        await fetch('/api/restart', { method: 'POST' }).catch(() => {});
      } catch {
        // Ignore - helper might not be running
      }
    } finally {
      checkingRef.current = false;
    }
  }, [onReconnect]);

  useEffect(() => {
    // Initial check
    checkHealth();
    
    // Periodic checks
    const interval = setInterval(checkHealth, HEALTH_CHECK_INTERVAL);
    
    return () => clearInterval(interval);
  }, [checkHealth]);

  return status;
}
