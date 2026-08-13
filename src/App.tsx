import { useEffect, useMemo, useState } from 'react';
import { PersistQueryClientProvider } from '@tanstack/react-query-persist-client';
import AuthGate from './auth/AuthGate';
import TabShell from './shell/TabShell';
import { detectEmbed } from './shell/embed';
import { installGlobalErrorHandlers, onGlobalError } from './shell/globalErrors';
import { createAppQueryClient, createPersistOptions } from './api/queryClient';
import { LocationProvider } from './state/LocationContext';

installGlobalErrorHandlers();

export default function App() {
  const [globalError, setGlobalError] = useState<string | null>(null);
  const embed = detectEmbed();

  const queryClient = useMemo(createAppQueryClient, []);
  const persistOptions = useMemo(() => createPersistOptions(), []);

  useEffect(() => onGlobalError(setGlobalError), []);

  return (
    <PersistQueryClientProvider client={queryClient} persistOptions={persistOptions}>
      <div className={embed.embedded ? 'app embedded' : 'app'}>
        {globalError && (
          <div className="global-error-banner" role="alert">
            <span>{globalError}</span>
            <button onClick={() => setGlobalError(null)} aria-label="Dismiss">
              ×
            </button>
          </div>
        )}
        <AuthGate embedded={embed.embedded}>
          {() => (
            <LocationProvider>
              <TabShell />
            </LocationProvider>
          )}
        </AuthGate>
      </div>
    </PersistQueryClientProvider>
  );
}
