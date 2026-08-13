import { useEffect, useState } from 'react';
import { vibe } from './vibe.js';

export default function App() {
  const [me, setMe] = useState(undefined); // undefined = still checking, null = signed out
  const [error, setError] = useState(null);

  useEffect(() => {
    // getCurrentUser() is the single source of truth for "is the user signed in?".
    // It returns null when the underlying call 401s.
    vibe
      .getCurrentUser()
      .then(setMe)
      .catch((err) => {
        setError(err.message);
        setMe(null);
      });
  }, []);

  if (me === undefined) {
    return <main className="shell"><p className="muted">Checking session…</p></main>;
  }

  if (me === null) {
    return (
      <main className="shell">
        <h1>Facilio Vision</h1>
        <p className="muted">You need to sign in to continue.</p>
        {error && <p className="error">{error}</p>}
        <button onClick={() => vibe.login()}>Log in</button>
      </main>
    );
  }

  return (
    <main className="shell">
      <header className="bar">
        <h1>Facilio Vision</h1>
        <div className="session">
          <span className="muted">
            {me.user.name || me.user.email} · org {me.org.orgId}
          </span>
          <button onClick={() => vibe.logout()}>Log out</button>
        </div>
      </header>

      {error && <p className="error">{error}</p>}

      {/* ---------------------------------------------------------------
          Build the actual Facilio Vision feature here.
          Read Facilio data with vibe.executeAction(connectionSlug, actionSlug, payload).
          Discover slugs + payload shapes from the CLI, never from memory:
            facilio connections search "<what you need>"
            facilio connections schemas <slug> --with-output
          --------------------------------------------------------------- */}
      <section className="placeholder">
        <p>Scaffold is live and authenticated. Feature work goes here.</p>
      </section>
    </main>
  );
}
