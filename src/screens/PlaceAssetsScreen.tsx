// Survey authoring (roadmap phase 5): full-screen overlay opened from the
// Surveys tab. Setup → guided 360° sweep → optional standpoint-QR enrolment
// → crosshair marker placement → save to appStore KV 'surveys'.
//
// Camera: the live feed comes from src/components/camera (WS-A). Sweep frames
// are embedded off that feed; with no camera (desktop/?mock=1) they fall back
// to the deterministic synthetic embedding — the survey geometry (headings,
// markers, Δ math) is real either way.
import { useEffect, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { appStore } from '../api/appStore';
import { useAssetSearch } from '../api/hooks';
import { isMockMode } from '../api/provider';
import type { Asset, CodeEntry, Survey, SurveyMarker, SweepFrame } from '../api/types';
import { getEmbedFn, syntheticVec, EMBED_MODEL_ID } from '../ar/embedding';
import { ArCard, ArSpace } from '../ar/ArSpace';
import { AssetTag, NoteTag } from '../ar/markers';
import DsSelect from '../components/DsSelect';
import LocationPicker from '../components/LocationPicker';
import { CameraView } from '../components/camera/CameraView';
import { useCamera } from '../components/camera/useCamera';
import { getCodeEntry, linkCode, unlinkCode } from '../vision/codes';
import { useScanLoop } from '../vision/scanLoop';
import { normalizeCode } from '../vision/qr';
import { useGeoFix } from '../hooks/useGeoFix';
import { arOrientation, enableArOrientation, useHeading } from '../hooks/useHeading';
import { wrap } from '../wayfinding/bearing';
import { useLocationScope } from '../state/LocationContext';
import '../styles/ar.css';
import '../ar/arspace.css';

/** Test/integration seam: overrides the camera as the sweep-frame source. */
let sweepFrameSource: (() => CanvasImageSource | null) | null = null;
export function setSweepFrameSource(fn: (() => CanvasImageSource | null) | null): void {
  sweepFrameSource = fn;
}

const MAX_FRAMES = 12;
/** ≥8 frames required live; 4 are enough in mock (no sensors to sweep with). */
function minFrames(): number {
  return isMockMode() ? 4 : 8;
}
/** Auto-capture cadence: one frame every ~30° of heading change. */
const CAPTURE_STEP_DEG = 28;

type Step = 'setup' | 'sweep' | 'qr' | 'markers';

interface MarkerDraft {
  rel: number;
  pitch: number;
}

let markerSeq = 0;

export default function PlaceAssetsScreen({
  onClose,
  onSaved,
}: {
  onClose: () => void;
  onSaved?: (surveyId: string) => void;
}) {
  const mock = isMockMode();
  const queryClient = useQueryClient();
  const { scope, names } = useLocationScope();
  const getFix = useGeoFix(true);
  const pose = useHeading(150);

  const [step, setStep] = useState<Step>('setup');
  const [name, setName] = useState('');
  const [frames, setFrames] = useState<SweepFrame[]>([]);
  const [markers, setMarkers] = useState<SurveyMarker[]>([]);
  const [qrCode, setQrCode] = useState<string | null>(null);
  const [qrHeading, setQrHeading] = useState<number | undefined>(undefined);
  const [codeInput, setCodeInput] = useState('');
  const [conflict, setConflict] = useState<{ code: string; entry: CodeEntry } | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Mock stand-in for the device heading: rotated by explicit buttons.
  const [mockHeading, setMockHeading] = useState(0);
  const [markerForm, setMarkerForm] = useState<MarkerDraft | null>(null);
  const busyRef = useRef(false);

  // The live feed runs from the sweep step onward (setup is a plain form).
  const camera = useCamera(step === 'sweep' || step === 'qr' || step === 'markers');
  const cameraFrame = (): CanvasImageSource | null => {
    const fc = camera.frameCanvasRef.current;
    if (fc && fc.width) return fc;
    const video = camera.videoRef.current;
    return video && video.readyState >= 2 && video.videoWidth ? video : null;
  };

  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 3600);
    return () => clearTimeout(t);
  }, [hint]);

  const currentHeading = (): number => {
    if (mock) return mockHeading;
    const o = arOrientation();
    return o.ok ? o.heading : 0;
  };
  const currentPitch = (): number => {
    if (mock) return 0;
    const o = arOrientation();
    return o.ok ? o.pitch : 0;
  };

  const captureFrame = async (heading: number, pitch: number) => {
    if (busyRef.current) return;
    busyRef.current = true;
    try {
      const src = sweepFrameSource?.() ?? cameraFrame();
      const vec = src ? await getEmbedFn()(src) : syntheticVec(heading);
      setFrames((prev) =>
        prev.length >= MAX_FRAMES ? prev : [...prev, { heading, pitch, vec }],
      );
    } finally {
      busyRef.current = false;
    }
  };

  // Live guided sweep: auto-capture a frame every ~30° of heading change.
  useEffect(() => {
    if (step !== 'sweep' || mock) return;
    if (!pose.ok || frames.length >= MAX_FRAMES) return;
    const last = frames[frames.length - 1];
    if (!last || Math.abs(wrap(pose.heading - last.heading)) >= CAPTURE_STEP_DEG) {
      void captureFrame(pose.heading, pose.pitch);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, mock, pose, frames]);

  const sweepDone = frames.length >= minFrames();

  // Standpoint step: a sticker held up to the camera enrolls itself.
  const scan = useScanLoop({ camera, siteId: scope.siteId, enabled: step === 'qr' });
  const lastScanAt = useRef(0);
  useEffect(() => {
    if (step !== 'qr' || !scan.qrHit || scan.qrHit.at === lastScanAt.current) return;
    lastScanAt.current = scan.qrHit.at;
    setCodeInput(scan.qrHit.code);
    void enrollCode(scan.qrHit.code);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [scan.qrHit, step]);

  const enrollCode = async (raw: string) => {
    const code = normalizeCode(raw);
    if (!code) return;
    // A code identifies exactly ONE thing — check the app-wide registry
    // (src/vision/codes, same keys the scanner reads) and never guess when it
    // already points elsewhere.
    const entry = await getCodeEntry(code);
    if (entry) {
      setConflict({ code, entry });
      return;
    }
    acceptCode(code);
  };

  const acceptCode = (code: string) => {
    setQrCode(code);
    // The device heading while FACING the QR — scanning it later gives Δ instantly.
    const o = arOrientation();
    setQrHeading(mock ? mockHeading : o.ok ? o.heading : undefined);
    setConflict(null);
    setHint(`Code ${code} will be this survey's standpoint`);
  };

  /** Conflict resolution: relink the code here, unlinking the other survey. */
  const relinkConflict = async () => {
    if (!conflict) return;
    const { code, entry } = conflict;
    if (entry.type === 'survey' && entry.surveyId) {
      const other = await appStore.kvGet<Survey>('surveys', `survey.${entry.surveyId}`);
      if (other?.qrCode === code) {
        await appStore.kvPut('surveys', `survey.${entry.surveyId}`, {
          ...other,
          qrCode: undefined,
          qrHeading: undefined,
        });
      }
    }
    await unlinkCode(code);
    acceptCode(code);
  };

  const placeMarkerHere = () => {
    // Direction FROZEN AT THE MOMENT OF THE TAP so the phone can be lowered
    // to type. Stored relative to sweep frame 0.
    const base = frames[0]?.heading ?? 0;
    const rel = (currentHeading() - base + 360) % 360;
    setMarkerForm({ rel, pitch: currentPitch() });
  };

  const addMarker = (m: Omit<SurveyMarker, 'id'>) => {
    setMarkers((prev) => [...prev, { ...m, id: `m-${Date.now().toString(36)}-${markerSeq++}` }]);
    setMarkerForm(null);
  };

  const moveMarker = (id: string, dHeading: number, dPitch: number) => {
    setMarkers((prev) =>
      prev.map((m) =>
        m.id === id
          ? {
              ...m,
              heading: (m.heading + dHeading + 360) % 360,
              pitch: Math.max(-90, Math.min(90, m.pitch + dPitch)),
            }
          : m,
      ),
    );
  };

  const save = async () => {
    if (saving) return;
    setSaving(true);
    try {
      const id = `sv-${Date.now().toString(36)}${Math.floor(Math.random() * 1296).toString(36)}`;
      const survey: Survey = {
        id,
        name: name.trim() || 'Untitled survey',
        siteId: scope.siteId,
        buildingId: scope.buildingId,
        floorId: scope.floorId,
        spaceName: names.floor ?? names.building ?? names.site,
        geo: getFix(), // null is fine — indoors is the normal case
        qrCode: qrCode ?? undefined,
        qrHeading: qrCode ? qrHeading : undefined,
        sweep: frames,
        markers,
        modelId: EMBED_MODEL_ID,
        createdAt: new Date().toISOString(),
      };
      await appStore.kvPut('surveys', `survey.${id}`, survey);
      if (qrCode) await linkCode(qrCode, { type: 'survey', surveyId: id });
      await queryClient.invalidateQueries({ queryKey: ['surveys'] });
      onSaved?.(id);
      onClose();
    } catch (err) {
      setHint(err instanceof Error ? err.message : String(err));
      setSaving(false);
    }
  };

  const sweepBase = frames[0]?.heading ?? 0;
  const stepLabel =
    step === 'setup' ? '1 · Setup' : step === 'sweep' ? '2 · Sweep' : step === 'qr' ? '3 · Standpoint QR' : '4 · Markers';

  return (
    <div className="pa-stage" role="dialog" aria-label="Place assets — AR survey">
      <div className="pa-topbar">
        <h2>Place assets (AR survey)</h2>
        <span className="pa-step">{stepLabel}</span>
        <button className="ar-toggle" onClick={onClose}>
          Close
        </button>
      </div>

      <div className="pa-body">
        {/* Camera mount — the live feed is the backdrop from the sweep on. */}
        <div id="pa-camera-slot" className="ar-camera-slot">
          {step !== 'setup' && (
            <CameraView
              videoRef={camera.videoRef}
              frameCanvasRef={camera.frameCanvasRef}
              state={camera.state}
              onResume={() => void camera.resume()}
            />
          )}
        </div>

        {step === 'setup' && (
          <div className="pa-sheet">
            <h3>New survey point</h3>
            <label className="field">
              <span>Name</span>
              <input
                value={name}
                onChange={(e) => setName(e.target.value)}
                placeholder="e.g. WS-01 · Pump room door"
                autoFocus
              />
            </label>
            <LocationPicker />
            <button
              className="btn btn-primary"
              disabled={!name.trim()}
              onClick={() => {
                void enableArOrientation(); // iOS gate — this click is the user gesture
                setStep('sweep');
              }}
            >
              Start sweep
            </button>
          </div>
        )}

        {step === 'sweep' && (
          <>
            <div className="pa-sheet">
              <h3>Guided sweep</h3>
              <div className="pa-progress">
                <div className="bar">
                  <span style={{ width: `${Math.min(100, (frames.length / minFrames()) * 100)}%` }} />
                </div>
                <span className="n">
                  {frames.length}/{minFrames()}+
                </span>
              </div>
              <p className="muted small">
                Turn slowly on the spot — a frame is captured about every 30° of heading change
                (up to {MAX_FRAMES}). Markers will be stored relative to the first frame.
              </p>
              {mock && (
                <button
                  className="btn btn-secondary"
                  onClick={() => {
                    void captureFrame(mockHeading, 0);
                    setMockHeading((h) => (h + 30) % 360);
                  }}
                >
                  Capture frame (mock)
                </button>
              )}
              <button className="btn btn-primary" disabled={!sweepDone} onClick={() => setStep('qr')}>
                Continue
              </button>
            </div>
            {!mock && !pose.ok && (
              <p className="pa-hint" style={{ position: 'absolute', bottom: 12, left: 0, right: 0 }}>
                Waiting for the compass — if nothing happens, re-tap Start sweep to grant motion access.
              </p>
            )}
          </>
        )}

        {step === 'qr' && (
          <div className="pa-sheet">
            <h3>Standpoint QR (optional)</h3>
            <p className="muted small">
              Stick a label at this spot and enroll it while FACING it — scanning it later opens
              this survey instantly with an exact heading correction. Hold the label up to the
              camera, or type its code.
            </p>
            <div className="ar-code-row">
              <input
                value={codeInput}
                onChange={(e) => setCodeInput(e.target.value)}
                placeholder="Code on the label"
                aria-label="Standpoint code"
              />
              <button className="btn btn-secondary" onClick={() => void enrollCode(codeInput)}>
                Enroll
              </button>
            </div>
            {qrCode && (
              <p className="muted small">
                Enrolled: <strong>{qrCode}</strong>
                {qrHeading != null ? ` (facing ${Math.round(qrHeading)}°)` : ''}
              </p>
            )}
            {conflict && (
              <div className="kit-card" role="alertdialog" aria-label="Code conflict">
                <div className="kit-card-bd">
                  <p className="small">
                    <strong>{conflict.code}</strong> already identifies{' '}
                    {conflict.entry.type === 'survey'
                      ? 'another survey standpoint'
                      : `a ${conflict.entry.type}`}
                    . A code must point at exactly one thing.
                  </p>
                  <div className="row">
                    <button className="btn btn-secondary" onClick={() => void relinkConflict()}>
                      Relink it here
                    </button>
                    <button className="btn btn-secondary" onClick={() => setConflict(null)}>
                      Use a different code
                    </button>
                  </div>
                </div>
              </div>
            )}
            <button className="btn btn-primary" onClick={() => setStep('markers')}>
              {qrCode ? 'Continue' : 'Skip'}
            </button>
          </div>
        )}

        {step === 'markers' && (
          <>
            <ArSpace active>
              {markers.map((m) => (
                <ArCard
                  key={m.id}
                  heading={(sweepBase + m.heading) % 360}
                  pitch={m.pitch}
                  onMove={(dh, dp) => moveMarker(m.id, dh, dp)}
                >
                  {m.assetId ? (
                    <AssetTag name={m.label} sub="drag to adjust" status="green" />
                  ) : (
                    <NoteTag text={m.label} />
                  )}
                </ArCard>
              ))}
            </ArSpace>

            <div className="ar-crosshair" aria-hidden="true">
              <span className="n" />
              <span className="s" />
              <span className="w" />
              <span className="e" />
            </div>

            {mock && (
              <div style={{ position: 'absolute', top: 10, left: 10, display: 'flex', gap: 6, zIndex: 5 }}>
                <button className="ar-toggle" onClick={() => setMockHeading((h) => (h + 330) % 360)}>
                  ⟲ 30°
                </button>
                <span className="pa-step" style={{ alignSelf: 'center' }}>{mockHeading}°</span>
                <button className="ar-toggle" onClick={() => setMockHeading((h) => (h + 30) % 360)}>
                  ⟳ 30°
                </button>
              </div>
            )}

            <div className="pa-marker-chips">
              {markers.map((m) => (
                <span key={m.id} className="pa-chip">
                  {m.label} · {Math.round(m.heading)}°
                  <button aria-label={`Delete ${m.label}`} onClick={() => setMarkers((prev) => prev.filter((x) => x.id !== m.id))}>
                    ✕
                  </button>
                </span>
              ))}
            </div>

            {markerForm && (
              <MarkerForm
                draft={markerForm}
                scopeSiteId={scope.siteId}
                onCancel={() => setMarkerForm(null)}
                onAdd={addMarker}
              />
            )}
          </>
        )}

        {hint && <div className="ar-hint" role="status">{hint}</div>}
      </div>

      {step === 'markers' && (
        <div className="pa-foot">
          <button className="btn btn-secondary" onClick={placeMarkerHere}>
            Place marker here
          </button>
          <button className="btn btn-primary" disabled={saving} onClick={() => void save()}>
            {saving ? 'Saving…' : `Save survey (${markers.length})`}
          </button>
        </div>
      )}
    </div>
  );
}

// ---- marker form: asset (search picker) | note | plain label ----

function MarkerForm({
  draft,
  scopeSiteId,
  onCancel,
  onAdd,
}: {
  draft: MarkerDraft;
  scopeSiteId: number | undefined;
  onCancel: () => void;
  onAdd: (m: Omit<SurveyMarker, 'id'>) => void;
}) {
  const [kind, setKind] = useState<'asset' | 'note' | 'label'>('asset');
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Asset | null>(null);

  const search = useAssetSearch(
    { text: text.trim(), scope: scopeSiteId ? { siteId: scopeSiteId } : undefined },
    kind === 'asset' && text.trim().length > 0,
  );

  const canAdd = kind === 'asset' ? picked !== null : text.trim().length > 0;

  const submit = () => {
    if (!canAdd) return;
    if (kind === 'asset' && picked) {
      onAdd({ label: picked.name, heading: draft.rel, pitch: draft.pitch, assetId: picked.id });
    } else if (kind === 'note') {
      onAdd({ label: text.trim().slice(0, 60), note: text.trim(), heading: draft.rel, pitch: draft.pitch });
    } else {
      onAdd({ label: text.trim(), heading: draft.rel, pitch: draft.pitch });
    }
  };

  return (
    <div className="pa-sheet" role="dialog" aria-label="New marker">
      <h3>
        Marker at {Math.round(draft.rel)}° / {Math.round(draft.pitch)}°
      </h3>
      <DsSelect
        label="Type"
        value={kind}
        options={[
          { value: 'asset', label: 'Asset' },
          { value: 'note', label: 'Note' },
          { value: 'label', label: 'Label' },
        ]}
        onChange={(v) => {
          setKind(v as 'asset' | 'note' | 'label');
          setPicked(null);
        }}
      />
      <label className="field">
        <span>{kind === 'asset' ? 'Search assets' : kind === 'note' ? 'Note' : 'Label text'}</span>
        <input
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setPicked(null);
          }}
          placeholder={kind === 'asset' ? 'Type to search…' : 'Text shown on the marker'}
          autoFocus
        />
      </label>
      {kind === 'asset' && text.trim() && (
        <div className="pa-asset-results">
          {search.isLoading && <p className="muted small">Searching…</p>}
          {(search.data ?? []).slice(0, 6).map((a) => (
            <button key={a.id} className={picked?.id === a.id ? 'sel' : ''} onClick={() => setPicked(a)}>
              {a.name}
              {a.spaceName ? ` — ${a.spaceName}` : ''}
            </button>
          ))}
          {search.data && search.data.length === 0 && <p className="muted small">No assets match.</p>}
        </div>
      )}
      <div className="row">
        <button className="btn btn-primary" disabled={!canAdd} onClick={submit}>
          Add marker
        </button>
        <button className="btn btn-secondary" onClick={onCancel}>
          Cancel
        </button>
      </div>
    </div>
  );
}
