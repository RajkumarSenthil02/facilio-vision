import { useEffect, useState } from 'react';
import AuthGate from './auth/AuthGate';
import TabShell from './shell/TabShell';
import { detectEmbed } from './shell/embed';
import { installGlobalErrorHandlers, onGlobalError } from './shell/globalErrors';

installGlobalErrorHandlers();

export default function App() {
  const [globalError, setGlobalError] = useState<string | null>(null);
  const embed = detectEmbed();

  useEffect(() => onGlobalError(setGlobalError), []);

  return (
    <div className={embed.embedded ? 'app embedded' : 'app'}>
      {globalError && (
        <div className="global-error-banner" role="alert">
          <span>{globalError}</span>
          <button onClick={() => setGlobalError(null)} aria-label="Dismiss">
            ×
          </button>
        </div>
      )}
      <AuthGate embedded={embed.embedded}>{() => <TabShell />}</AuthGate>
    </div>
  );
}
