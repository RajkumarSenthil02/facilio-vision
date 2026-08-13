// Surveys registry (roadmap 5): the standpoints this org has surveyed, their
// enrolled QR labels, and the marker list of each one. Authoring happens in
// the full-screen Place-Assets overlay; this screen is the library around it.
//
// Codes live in ONE registry (src/vision/codes) keyed by the normalized code —
// enrolling here and scanning in the AR stage must agree, so this screen never
// writes the 'codes' collection by hand.
import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { appStore } from '../api/appStore';
import type { Survey } from '../api/types';
import { QrCode, printQrLabel } from '../ar/QrCode';
import { getCodeEntry, linkCode, unlinkCode } from '../vision/codes';
import { normalizeCode } from '../vision/qr';
import PlaceAssetsScreen from './PlaceAssetsScreen';
import '../ar/arspace.css';

function useSurveys() {
  return useQuery({
    queryKey: ['surveys'],
    queryFn: () =>
      appStore
        .kvList<Survey>('surveys', 'survey.', 200)
        .then((rows) =>
          rows
            .map((r) => r.value)
            .filter((s) => s && Array.isArray(s.markers))
            .sort((a, b) => (a.createdAt < b.createdAt ? 1 : -1)),
        ),
  });
}

export default function SurveysScreen() {
  const surveys = useSurveys();
  const [openId, setOpenId] = useState<string | null>(null);
  const [authoring, setAuthoring] = useState(false);

  const selected = useMemo(
    () => (surveys.data ?? []).find((s) => s.id === openId) ?? null,
    [surveys.data, openId],
  );

  if (authoring) {
    return (
      <PlaceAssetsScreen onClose={() => setAuthoring(false)} onSaved={(id) => setOpenId(id)} />
    );
  }

  if (selected) {
    return <SurveyDetail survey={selected} onBack={() => setOpenId(null)} />;
  }

  return (
    <section className="screen">
      <div className="sv-toolbar">
        <h2>Surveys</h2>
        <button className="btn btn-primary" onClick={() => setAuthoring(true)}>
          Place assets (AR survey)
        </button>
      </div>

      {surveys.isLoading && <p className="muted">Loading surveys…</p>}
      {surveys.isError && <p className="error">{(surveys.error as Error).message}</p>}
      {surveys.data?.length === 0 && (
        <p className="muted">
          No standpoints yet. “Place assets (AR survey)” walks a 360° sweep and pins markers
          around you.
        </p>
      )}

      {surveys.data && surveys.data.length > 0 && (
        <ul className="card-list">
          {surveys.data.map((survey) => (
            <li key={survey.id} className="card">
              <button className="card-btn" onClick={() => setOpenId(survey.id)}>
                <strong>{survey.name}</strong>
                <span className="sv-badges">
                  {survey.qrCode && <span className="pill">QR enrolled</span>}
                  <span className="pill">
                    {survey.markers.length} marker{survey.markers.length === 1 ? '' : 's'}
                  </span>
                </span>
              </button>
              <p className="sv-meta">
                <span>{survey.spaceName ?? 'Unscoped'}</span>
                <span>{survey.sweep.length} sweep frames</span>
                <span>{new Date(survey.createdAt).toLocaleString()}</span>
                {survey.geo && <span>geotagged</span>}
              </p>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}

function SurveyDetail({ survey, onBack }: { survey: Survey; onBack: () => void }) {
  const queryClient = useQueryClient();
  const [hint, setHint] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [photoUrl, setPhotoUrl] = useState<string | null>(null);
  const qrBoxRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    let on = true;
    if (survey.standpointFileId) {
      void appStore
        .getPhotoUrl(survey.standpointFileId)
        .then((url) => {
          if (on) setPhotoUrl(url);
        })
        .catch(() => {
          /* a missing standpoint photo is not an error worth shouting about */
        });
    }
    return () => {
      on = false;
    };
  }, [survey.standpointFileId]);

  const generateCode = async () => {
    if (busy) return;
    setBusy(true);
    try {
      const code = normalizeCode(`fv-sv-${survey.id}`);
      const existing = await getCodeEntry(code);
      if (existing && existing.surveyId !== survey.id) {
        setHint('That code already identifies something else — a code points at exactly one thing.');
        return;
      }
      await appStore.kvPut('surveys', `survey.${survey.id}`, { ...survey, qrCode: code });
      await linkCode(code, { type: 'survey', surveyId: survey.id });
      await queryClient.invalidateQueries({ queryKey: ['surveys'] });
      setHint('QR generated — print it and stick it at this standpoint.');
    } finally {
      setBusy(false);
    }
  };

  const print = () => {
    const svg = qrBoxRef.current?.querySelector('svg')?.outerHTML;
    if (!svg || !survey.qrCode) return;
    printQrLabel({
      code: survey.qrCode,
      title: survey.name,
      subtitle: survey.spaceName,
      svg,
    });
  };

  const remove = async () => {
    if (busy) return;
    setBusy(true);
    try {
      if (survey.qrCode) await unlinkCode(survey.qrCode);
      await appStore.kvDelete('surveys', `survey.${survey.id}`);
      await queryClient.invalidateQueries({ queryKey: ['surveys'] });
      onBack();
    } finally {
      setBusy(false);
    }
  };

  const base = survey.sweep[0]?.heading ?? 0;

  return (
    <section className="screen">
      <div className="sv-detail-head">
        <button className="btn btn-secondary" onClick={onBack}>
          ← Surveys
        </button>
        <h2>{survey.name}</h2>
      </div>

      <p className="sv-meta">
        <span>{survey.spaceName ?? 'Unscoped'}</span>
        <span>{survey.sweep.length} sweep frames</span>
        <span>model {survey.modelId}</span>
        <span>{new Date(survey.createdAt).toLocaleString()}</span>
        {survey.geo && (
          <span>
            {survey.geo.lat.toFixed(5)}, {survey.geo.lng.toFixed(5)} ±{survey.geo.accuracy}m
          </span>
        )}
      </p>

      <div className="sv-qr-block">
        <div ref={qrBoxRef}>
          {survey.qrCode ? (
            <QrCode value={survey.qrCode} />
          ) : (
            <p className="muted small">No standpoint QR enrolled yet.</p>
          )}
        </div>
        <div>
          {survey.qrCode && (
            <p className="muted small">
              Code <strong>{survey.qrCode}</strong>
              {survey.qrHeading != null ? ` · enrolled facing ${Math.round(survey.qrHeading)}°` : ''}
            </p>
          )}
          <div className="row">
            {!survey.qrCode && (
              <button className="btn btn-primary" disabled={busy} onClick={() => void generateCode()}>
                Generate QR
              </button>
            )}
            {survey.qrCode && (
              <button className="btn btn-secondary" onClick={print}>
                Print label
              </button>
            )}
            <button className="btn btn-secondary sv-danger" disabled={busy} onClick={() => void remove()}>
              Delete survey
            </button>
          </div>
        </div>
        {photoUrl && <img className="sv-standpoint-photo" src={photoUrl} alt="Standpoint" />}
      </div>

      {hint && <p className="muted small">{hint}</p>}

      <h3>Markers</h3>
      {survey.markers.length === 0 && <p className="muted">No markers on this standpoint.</p>}
      {survey.markers.length > 0 && (
        <table className="sv-marker-table">
          <thead>
            <tr>
              <th>Marker</th>
              <th>Kind</th>
              <th>Bearing</th>
              <th>Pitch</th>
            </tr>
          </thead>
          <tbody>
            {survey.markers.map((marker) => (
              <tr key={marker.id}>
                <td>{marker.label}</td>
                <td>{marker.assetId ? 'asset' : marker.note ? 'note' : 'label'}</td>
                {/* stored relative to sweep frame 0; the absolute reading is
                    what a compass shows at survey time */}
                <td className="deg">
                  {Math.round(marker.heading)}° rel · {Math.round((base + marker.heading) % 360)}° abs
                </td>
                <td className="deg">{Math.round(marker.pitch)}°</td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </section>
  );
}
