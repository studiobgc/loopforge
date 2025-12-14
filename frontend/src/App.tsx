import { useCallback } from 'react'
import { DAWWorkspace } from './components/daw/DAWWorkspace'
import { useHealthCheck } from './hooks/useHealthCheck'
import { SessionProvider } from './contexts/SessionContext'

/**
 * LoopForge - ONE app, not multiple modes
 * 
 * The app knows what you need based on what you're doing:
 * - Drop audio → it separates
 * - Click stem → see slices
 * - Tap pads → record pattern
 * - Controls appear contextually
 * 
 * No mode switching. No identity crisis.
 */
export default function App() {
  const handleReconnect = useCallback(() => {
    console.log('[App] Backend reconnected');
  }, []);

  const health = useHealthCheck(handleReconnect);

  return (
    <SessionProvider>
      {/* Connection status - only show when offline */}
      {!health.backend && (
        <div className="fixed top-0 left-0 right-0 z-[9999] bg-red-600 text-white text-center py-2 text-sm font-medium animate-pulse">
          ⚠️ Backend offline - reconnecting...
        </div>
      )}
      
      {/* ONE app */}
      <DAWWorkspace />
    </SessionProvider>
  );
}
