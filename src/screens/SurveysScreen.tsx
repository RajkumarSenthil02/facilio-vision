import { useEffect, useState } from 'react';
import { provider } from '../api/provider';
import type { Site } from '../api/types';

// First consumer of the provider seam — proves screens can render real or
// fixture data without knowing which one they're on.
export default function SurveysScreen() {
  const [sites, setSites] = useState<Site[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    provider
      .listSites({ pageSize: 50 })
      .then((page) => {
        if (!cancelled) setSites(page.data);
      })
      .catch((err: unknown) => {
        // A failed action call is just an error — surface it, never redirect to login.
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  return (
    <section className="screen">
      <h2>Surveys</h2>
      {error && <p className="error">{error}</p>}
      {!error && sites === null && <p className="muted">Loading sites…</p>}
      {sites && sites.length === 0 && <p className="muted">No sites in this org yet.</p>}
      {sites && sites.length > 0 && (
        <ul className="card-list">
          {sites.map((site) => (
            <li key={site.id} className="card">
              <strong>{site.name}</strong>
              {site.siteType && <span className="pill">{site.siteType}</span>}
              {site.description && <p className="muted">{site.description}</p>}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
