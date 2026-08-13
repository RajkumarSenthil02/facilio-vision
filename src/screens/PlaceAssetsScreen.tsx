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
import type { Asset, Survey, SurveyMarker, SweepFrame } from '../api/types';
import { getEmbedFn, syntheticVec, EMBED_MODEL_ID } from '../ar/embedding';
import { draftBearing } from '../wayfinding/bearingDraft';
import { ArCard, ArSpace } from '../ar/ArSpace';
import { AssetTag, NoteTag } from '../ar/markers';
import DsSelect from '../components/DsSelect';
import Sheet from '../components/Sheet';
import { CameraView } from '../components/camera/CameraView';
import { useCamera } from '../components/camera/useCamera';
import { linkCode } from '../vision/codes';
import { useGeoFix } from '../hooks/useGeoFix';
import { arOrientation, enableArOrientation, useHeading } from '../hooks/useHeading';
import { wrap } from '../wayfinding/bearing';
import { useLocationScope } from '../state/LocationContext';
import '../styles/ar.css';
import '../ar/arspace.css';
import './surveys.css';

/** Test/integration seam: overrides the camera as the sweep-frame source. */
let sweepFrameSource: (() => CanvasImageSource | null) | null = null;
export function setSweepFrameSource(fn: (() => CanvasImageSource | null) | null): void {
  sweepFrameSource = fn;
}

const MAX_FRAMES = 12;
/** Enough frames to relocalize from: 8 live, 4 in mock (no sensors to sweep). */
function minFrames(): number {
  return isMockMode() ? 4 : 8;
}
/** Auto-capture cadence: one frame every ~30° of heading change. */
const CAPTURE_STEP_DEG = 28;

/**
 * Name it -> sweep -> place markers.
 *
 * The camera is full-bleed on every step and NOTHING covers it: chrome is
 * floating pills over the feed, and the app dock stays visible beneath (the
 * stage stops exactly where the dock begins, which is also why the footer
 * actions are reachable — they used to sit under it).
 *
 * Standpoint QR is optional and lives on the sweep step; it is not a gate.
 */
type Step = 'setup' | 'sweep' | 'markers';

/** What a marker stands for. Work orders and findings are raised in place. */
export type MarkerKind = 'asset' | 'note' | 'workorder' | 'finding';

interface MarkerDraft {
  rel: number;
  pitch: number;
  /** Chosen by the footer button, so the form opens on the right mode. */
  kind: MarkerKind;
  /** False when the compass was silent — the form then asks for the direction. */
  bearingKnown: boolean;
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
  const scopeLabel = names.floor ?? names.building ?? names.site ?? '';
  const getFix = useGeoFix(true);
  const pose = useHeading(150);

  const [step, setStep] = useState<Step>('setup');
  const [name, setName] = useState('');
  const [frames, setFrames] = useState<SweepFrame[]>([]);
  const [markers, setMarkers] = useState<SurveyMarker[]>([]);
  // QR enrolment moved to the survey detail sheet; a new survey saves without one.
  const qrHeading: number | undefined = undefined;
  const [hint, setHint] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  // Mock stand-in for the device heading: rotated by explicit buttons.
  const [mockHeading, setMockHeading] = useState(0);
  const [markerForm, setMarkerForm] = useState<MarkerDraft | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [qrDraft, setQrDraft] = useState('');
  const qrCode: string | null = qrDraft.trim() || null;
  const busyRef = useRef(false);

  // Camera-first: the live feed runs from the moment the overlay opens — the
  // setup sheet sits OVER the lens instead of hiding it behind a form.
  const camera = useCamera(true);
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

  /**
   * null means "the compass is not answering" — NEVER 0.
   *
   * Returning 0 silently gave every marker the same bearing whenever motion
   * access was denied or absent (desktop, or iOS before the permission
   * prompt), so notes stacked on one point AND were saved that way. A wrong
   * bearing that looks placed is worse than no bearing at all.
   */
  const currentHeading = (): number | null => {
    if (mock) return mockHeading;
    const o = arOrientation();
    return o.ok ? o.heading : null;
  };
  const currentPitch = (): number | null => {
    if (mock) return 0;
    const o = arOrientation();
    return o.ok ? o.pitch : null;
  };

  // The stage stops where the dock begins, so the dock stays visible (design)
  // and the footer is never covered. The marker keeps tests honest about which
  // surface owns the screen.
  useEffect(() => {
    document.body.classList.add('pa-open');
    return () => document.body.classList.remove('pa-open');
  }, []);

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


  const placeMarkerHere = (kind: MarkerKind) => {
    // Direction FROZEN AT THE MOMENT OF THE TAP so the phone can be lowered
    // to type. Stored relative to sweep frame 0.
    const base = frames[0]?.heading ?? 0;
    const heading = currentHeading();
    const pitch = currentPitch();

    const { rel, bearingKnown } = draftBearing({
      heading,
      sweepBase: base,
      markerCount: markers.length,
    });
    if (!bearingKnown) setHint('No compass here — set each marker’s direction by hand.');
    setMarkerForm({ rel, pitch: pitch ?? 0, kind, bearingKnown });
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

  return (
    <div className="pa-stage" role="dialog" aria-label="Place assets — AR survey">
      {/* On setup the camera carries the screen and a floating pill is the only
          chrome over it; the step bar returns once the flow is underway. */}
      {step !== 'setup' && (
        <>
          <button className="pa-exit" onClick={onClose}>
            ← Exit survey
          </button>
          <span className={step === 'sweep' ? 'pa-badge sweep' : 'pa-badge'}>
            {step === 'sweep'
              ? `Sweep ${Math.min(frames.length, MAX_FRAMES)}/${MAX_FRAMES}`
              : `${markers.length} marker${markers.length === 1 ? '' : 's'}`}
          </span>
        </>
      )}

      <div className="pa-body">
        {/* Camera mount — the live feed is the backdrop the whole way through. */}
        <div id="pa-camera-slot" className="ar-camera-slot">
          <CameraView
            videoRef={camera.videoRef}
            frameCanvasRef={camera.frameCanvasRef}
            state={camera.state}
            onResume={() => void camera.resume()}
          />
        </div>

        {step === 'setup' && (
          <>
            <button className="pa-exit" onClick={onClose}>
              ← Exit survey
            </button>
            <Sheet open title="New survey point" onClose={onClose}>
              <label className="sv-field">
                <span className="sv-field-label">Survey point name</span>
                <input
                  className="sv-input"
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  placeholder="Survey point name (e.g. AHU room — door side)"
                />
              </label>
              <button
                className="btn-cta"
                disabled={!name.trim()}
                onClick={() => {
                  void enableArOrientation(); // iOS gate — this click is the user gesture
                  setStep('sweep');
                }}
              >
                Start sweep
              </button>
              <p className="sv-help">
                {scopeLabel
                  ? `Saved under ${scopeLabel}. `
                  : 'Saved without a location — set one on the Surveys screen. '}
                Stand where a technician would stand, then turn and tap each asset.
              </p>
            </Sheet>
          </>
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

      {step === 'sweep' && (
        <div className="pa-foot sweep">
          <p className="pa-tip">Rotate slowly in place — frames capture automatically</p>
          <div className="pa-actions">
            <button className="pa-btn dark" onClick={() => setQrOpen(true)}>
              Scan standpoint QR (optional)
            </button>
            <button
              className="pa-btn light"
              disabled={frames.length < minFrames()}
              onClick={() => setStep('markers')}
            >
              Place markers →
            </button>
          </div>
        </div>
      )}

      <Sheet
        open={qrOpen}
        title="Standpoint QR (optional)"
        onClose={() => setQrOpen(false)}
        footer={
          <button className="btn-quiet" style={{ flex: 1 }} onClick={() => setQrOpen(false)}>
            Done
          </button>
        }
      >
        <p className="sv-help" style={{ marginTop: 0 }}>
          Stick a code at this spot and technicians load these markers by scanning it — no
          searching. You can also add one later from the survey's detail sheet.
        </p>
        <label className="sv-field">
          <span className="sv-field-label">Code</span>
          <input
            className="sv-input"
            value={qrDraft}
            onChange={(e) => setQrDraft(e.target.value)}
            placeholder="Scan or type the code"
          />
        </label>
      </Sheet>

      {step === 'markers' && (
        <div className="pa-foot">
          <div className="pa-actions">
            <button className="pa-btn primary" onClick={() => placeMarkerHere('asset')}>
              + Asset
            </button>
            <button className="pa-btn dark" onClick={() => placeMarkerHere('workorder')}>
              Work order
            </button>
            <button className="pa-btn dark" onClick={() => placeMarkerHere('finding')}>
              Finding
            </button>
          </div>
          <div className="pa-actions">
            <button className="pa-btn light" onClick={() => placeMarkerHere('note')}>
              Note
            </button>
            <button className="pa-btn light" disabled={saving} onClick={() => void save()}>
              {saving ? 'Saving…' : `Save survey (${markers.length})`}
            </button>
          </div>
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
  const [kind, setKind] = useState<MarkerKind>(draft.kind);
  const [text, setText] = useState('');
  const [picked, setPicked] = useState<Asset | null>(null);
  // Editable when the compass could not supply it — see placeMarkerHere.
  const [bearing, setBearing] = useState(String(Math.round(draft.rel)));

  const search = useAssetSearch(
    { text: text.trim(), scope: scopeSiteId ? { siteId: scopeSiteId } : undefined },
    kind === 'asset' && text.trim().length > 0,
  );

  const bearingNum = Number(bearing);
  const bearingOk = Number.isFinite(bearingNum) && bearingNum >= 0 && bearingNum < 360;
  const canAdd = (kind === 'asset' ? picked !== null : text.trim().length > 0) && bearingOk;

  const submit = () => {
    if (!canAdd) return;
    const heading = ((bearingNum % 360) + 360) % 360;
    const base = { heading, pitch: draft.pitch };
    if (kind === 'asset' && picked) {
      onAdd({ ...base, label: picked.name, assetId: picked.id });
    } else if (kind === 'note' || kind === 'finding') {
      // A finding is a note the technician wants acted on — same anchor, and
      // the AR panel offers "raise a work order" from it.
      const body = text.trim();
      onAdd({
        ...base,
        label: (kind === 'finding' ? `Finding: ${body}` : body).slice(0, 60),
        note: body,
      });
    } else if (kind === 'workorder') {
      onAdd({ ...base, label: text.trim().slice(0, 60), note: text.trim() });
    } else {
      onAdd({ ...base, label: text.trim() });
    }
  };

  return (
    <div className="pa-sheet" role="dialog" aria-label="New marker">
      <h3>
        {draft.bearingKnown
          ? `Marker at ${Math.round(draft.rel)}° / ${Math.round(draft.pitch)}°`
          : 'New marker — set its direction'}
      </h3>
      {!draft.bearingKnown && (
        <>
          <p className="pa-hint" style={{ padding: 0, textAlign: 'left' }}>
            No compass reading here, so the direction can’t be captured by aiming. Enter it in
            degrees from the survey’s first sweep frame (0 = where you started).
          </p>
          <label className="field">
            <span>Direction (0–359°)</span>
            <input
              inputMode="numeric"
              value={bearing}
              onChange={(e) => setBearing(e.target.value)}
              placeholder="e.g. 90"
            />
          </label>
        </>
      )}
      <DsSelect
        label="Type"
        value={kind}
        options={[
          { value: 'asset', label: 'Asset' },
          { value: 'workorder', label: 'Work order' },
          { value: 'finding', label: 'Finding' },
          { value: 'note', label: 'Note' },
        ]}
        onChange={(v) => {
          setKind(v as MarkerKind);
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
