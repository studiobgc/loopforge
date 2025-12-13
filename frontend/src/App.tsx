import { useCallback } from 'react'
import { DAWWorkspace } from './components/daw/DAWWorkspace'
import { useHealthCheck } from './hooks/useHealthCheck'

export default function App() {
  const handleReconnect = useCallback(() => {
    console.log('[App] Backend reconnected, refreshing...');
    // Could trigger a data refresh here if needed
  }, []);

  const health = useHealthCheck(handleReconnect);

  return (
    <>
      {/* Connection status indicator */}
      {!health.backend && (
        <div className="fixed top-0 left-0 right-0 z-[9999] bg-red-600 text-white text-center py-2 text-sm font-medium animate-pulse">
          ⚠️ Backend offline - attempting to reconnect...
        </div>
      )}
      <DAWWorkspace />
    </>
  );
}
