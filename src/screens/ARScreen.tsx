// The AR stage (roadmap 5): a REAL camera surface with survey markers
// anchored to compass directions.
//
// Zones (Dock HUD design direction 1b) are unchanged from the preview stage:
//   A+B+C  one 38px top bar — context chip · ONE state chip · AR toggle
//   —      standpoint banner (outranks floor/site once localized)
//   D      marker space (now the gyro-driven ArSpace registry, not slots)
//   E      candidates row (fed by the live scan loop)
//   F      dock
//
// What is real now: the camera feed (src/components/camera), the recognition
// loop (src/vision/scanLoop), presence via standpoint QR + visual
// relocalization, and marker bearings corrected by the relocalization Δ:
//   abs = (sweep[0].heading + marker.heading + relocΔ + 360) % 360
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { provider } from '../api/provider';
import { appStore } from '../api/appStore';
import { draftWorkOrder } from '../api/agents';
import { useAsset, useAssetSearch } from '../api/hooks';
import { useLocationScope } from '../state/LocationContext';
import type { Asset, SiteGeo, Survey, SurveyMarker, WorkOrder } from '../api/types';
import { ArCard, ArGuide, ArSpace } from '../ar/ArSpace';
import { AssetTag, NoteTag, StandpointMarker } from '../ar/markers';
import type { MarkerStatus } from '../ar/markers';
import { markerAbsBearing, presenceDecayCheck, type Presence } from '../ar/presence';
import { Relocalizer } from '../ar/relocalize';
import { getEmbedFn, EMBED_MODEL_ID } from '../ar/embedding';
import { dequantize, l2Normalize } from '../vision/quantize';
import { CameraView } from '../components/camera/CameraView';
import { CodeSheet } from '../components/camera/CodeSheets';
import { useCamera } from '../components/camera/useCamera';
import { useScanLoop } from '../vision/scanLoop';
import { describeEntry, resolveCode } from '../vision/codes';
import WorkOrderPanel from '../components/WorkOrderPanel';
import { useGeoFix } from '../hooks/useGeoFix';
import { arOrientation, enableArOrientation } from '../hooks/useHeading';
import { indoorLegs, mapsDirectionsUrl, type WayLeg } from '../wayfinding/legs';
import '../styles/ar.css';
import '../ar/arspace.css';

const OPEN_STATUSES = ['open', 'submitted', 'assigned', 'work in progress', 'in progress'];
const PLANNED_STATUSES = ['on hold', 'scheduled', 'pre-open', 'preopen', 'yet to start'];

const HINT_COPY: Record<string, string> = {
  dark: 'Too dark — find more light',
  blur: 'Hold steady — image is blurry',
  moving: 'Hold still…',
};

const EMPTY_SURVEYS: Survey[] = [];

/** WO roll-up → the one colour a marker is allowed to vary. */
function summarize(workOrders: WorkOrder[]) {
  let open = 0;
  let planned = 0;
  for (const wo of workOrders) {
    const s = (wo.status ?? '').toLowerCase();
    if (OPEN_STATUSES.includes(s)) open++;
    else if (PLANNED_STATUSES.includes(s)) planned++;
  }
  const status: MarkerStatus = open > 0 ? 'red' : planned > 0 ? 'amber' : 'green';
  return { open, planned, status };
}

function dotClass(status: MarkerStatus): string {
  return status === 'red' ? 'st-red' : status === 'amber' ? 'st-amber' : 'st-green';
}

/** Best-effort spoken arrival cue — absent in jsdom and older webviews. */
function speak(text: string) {
  try {
    const synth = (window as { speechSynthesis?: SpeechSynthesis }).speechSynthesis;
    if (synth && typeof SpeechSynthesisUtterance === 'function') {
      synth.speak(new SpeechSynthesisUtterance(text));
    }
  } catch {
    /* speech is a bonus, never a dependency */
  }
}

interface FaultDraft {
  subject: string;
  description: string;
  busy: boolean;
  fromPhoto: boolean;
}

type Sheet = 'markers' | 'note' | 'fault' | 'legs' | null;

export default function ARScreen() {
  const { scope, names } = useLocationScope();
  const queryClient = useQueryClient();

  const [arOn, setArOn] = useState(false);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [focusAssetId, setFocusAssetId] = useState<number | null>(null);
  const [guide, setGuide] = useState<{ heading: number; name: string } | null>(null);
  const [sheet, setSheet] = useState<Sheet>(null);
  const [codeSheet, setCodeSheet] = useState<string | null>(null);
  const [hint, setHint] = useState<string | null>(null);
  const [minimized, setMinimized] = useState(false);
  const [noteText, setNoteText] = useState('');
  const [legs, setLegs] = useState<WayLeg[]>([]);
  const [fault, setFault] = useState<FaultDraft>({
    subject: '',
    description: '',
    busy: false,
    fromPhoto: false,
  });

  const relocRef = useRef<Relocalizer>(new Relocalizer());
  const getFix = useGeoFix(arOn);

  const camera = useCamera(arOn);
  const scan = useScanLoop({ camera, siteId: scope.siteId, enabled: arOn });

  // ---- data ----

  const surveysQuery = useQuery({
    queryKey: ['surveys'],
    queryFn: () =>
      appStore
        .kvList<Survey>('surveys', 'survey.', 200)
        .then((rows) => rows.map((r) => r.value).filter((s) => s && Array.isArray(s.markers))),
  });
  const surveys = surveysQuery.data ?? EMPTY_SURVEYS;

  const activeSurvey = useMemo(
    () => (presence ? (surveys.find((s) => s.id === presence.surveyId) ?? null) : null),
    [presence, surveys],
  );
  const markers = activeSurvey?.markers ?? [];

  const markerAssetIds = useMemo(
    () => markers.map((m) => m.assetId).filter((id): id is number => typeof id === 'number'),
    [markers],
  );

  const workOrders = useQuery({
    queryKey: ['workorders', 'ar', markerAssetIds.join(',')],
    queryFn: () => provider.listWorkOrdersForAssets(markerAssetIds),
    enabled: markerAssetIds.length > 0,
  });

  const byAsset = useMemo(() => {
    const map = new Map<number, WorkOrder[]>();
    for (const wo of workOrders.data ?? []) {
      if (!wo.resourceId) continue;
      map.set(wo.resourceId, [...(map.get(wo.resourceId) ?? []), wo]);
    }
    return map;
  }, [workOrders.data]);

  const assets = useAssetSearch({ scope });
  const assetName = useCallback(
    (id: number) => (assets.data ?? []).find((a) => a.id === id)?.name ?? `Asset #${id}`,
    [assets.data],
  );
  const focusAsset = useAsset(focusAssetId);

  // ---- board minimize/restore, persisted per site ----

  const boardKey = `board.${scope.siteId ?? 'none'}`;
  const board = useQuery({
    queryKey: ['settings', boardKey],
    queryFn: () => appStore.kvGet<{ minimized?: boolean }>('settings', boardKey),
  });
  useEffect(() => {
    if (board.data) setMinimized(board.data.minimized === true);
  }, [board.data]);
  const setBoardMinimized = (next: boolean) => {
    setMinimized(next);
    void appStore.kvPut('settings', boardKey, { minimized: next });
  };

  // ---- relocalizer: reload sweeps when surveys change, KEEP presence ----
  // A background ['surveys'] refetch must never evict the standpoint the
  // technician is standing at, so the current fix is carried across load().
  useEffect(() => {
    const reloc = relocRef.current;
    const keepCurrent = reloc.current;
    const keepMatchAt = reloc.lastMatchAt;
    reloc.load(surveys, EMBED_MODEL_ID);
    reloc.current = keepCurrent;
    reloc.lastMatchAt = keepMatchAt;
  }, [surveys]);

  // ---- transient hints ----
  useEffect(() => {
    if (!hint) return;
    const t = setTimeout(() => setHint(null), 4000);
    return () => clearTimeout(t);
  }, [hint]);

  // ---- QR lane: standpoint codes confirm presence, asset codes focus ----
  const lastQrAt = useRef(0);
  useEffect(() => {
    const qrHit = scan.qrHit;
    if (!qrHit || qrHit.at === lastQrAt.current) return;
    lastQrAt.current = qrHit.at;
    const code = qrHit.code;
    const reloc = relocRef.current;
    const orient = arOrientation();

    const duplicates = Relocalizer.duplicatesFor(surveys, code);
    if (duplicates.length > 1) {
      setHint('That code is enrolled on more than one standpoint — fix it in Surveys');
      return;
    }
    const standpoint = reloc.confirmByQr(surveys, code, orient.ok ? orient.heading : undefined);
    if (standpoint) {
      setPresence({ surveyId: standpoint.id, delta: reloc.current?.delta ?? 0, via: 'qr' });
      setHint(`Standpoint confirmed — ${standpoint.name}`);
      return;
    }

    void (async () => {
      const res = await resolveCode(code);
      if (res.kind === 'target' && res.entry.type === 'asset' && res.entry.assetId) {
        setFocusAssetId(res.entry.assetId);
        return;
      }
      if (res.kind === 'target' && res.entry.type === 'survey' && res.entry.surveyId) {
        const hit = surveys.find((s) => s.id === res.entry.surveyId);
        if (hit) {
          // registered against a survey but with no enrolled heading: no Δ
          // source, so presence is forced (explicit intent) and never decays
          reloc.current = { surveyId: hit.id, delta: 0, score: 1 };
          reloc.lastMatchAt = Date.now();
          setPresence({ surveyId: hit.id, delta: 0, via: 'qr', forced: true });
          setHint(`Standpoint confirmed — ${hit.name}`);
          return;
        }
      }
      if (res.kind === 'target') {
        setHint(`Code points at ${describeEntry(res.entry)}`);
        return;
      }
      setCodeSheet(code); // unknown / conflict → the registry sheets
    })();
  }, [scan.qrHit, surveys]);

  // asset lock from the vision lane focuses the asset panel
  useEffect(() => {
    if (scan.locked) setFocusAssetId(scan.locked.assetId);
  }, [scan.locked]);

  // ---- visual relocalization lane (real camera only) ----
  useEffect(() => {
    if (!arOn || camera.state !== 'live' || surveys.length === 0) return;
    let busy = false;
    const timer = setInterval(() => {
      if (busy) return;
      busy = true;
      void (async () => {
        try {
          const fc = camera.frameCanvasRef.current;
          const video = camera.videoRef.current;
          const src: CanvasImageSource | null =
            fc && fc.width
              ? fc
              : video && video.readyState >= 2 && video.videoWidth
                ? video
                : null;
          const orient = arOrientation();
          if (!src || !orient.ok) return;
          const quant = await getEmbedFn()(src);
          const cur = relocRef.current.observe(l2Normalize(dequantize(quant)), orient.heading);
          if (!cur) return;
          setPresence((prev) =>
            prev && prev.surveyId === cur.surveyId
              ? { ...prev, delta: cur.delta }
              : { surveyId: cur.surveyId, delta: cur.delta, via: 'visual' },
          );
        } catch {
          /* a missed frame is not an error */
        } finally {
          busy = false;
        }
      })();
    }, 1500);
    return () => clearInterval(timer);
  }, [arOn, camera.state, camera.frameCanvasRef, camera.videoRef, surveys.length]);

  // ---- presence decay watchdog ----
  useEffect(() => {
    if (!presence) return;
    const timer = setInterval(() => {
      const verdict = presenceDecayCheck({
        presence,
        survey: surveys.find((s) => s.id === presence.surveyId),
        fix: getFix(),
        lastMatchAt: relocRef.current.lastMatchAt,
        now: Date.now(),
      });
      if (!verdict.decayed) return;
      relocRef.current.reset();
      setPresence(null);
      setGuide(null);
      setHint(
        verdict.reason === 'left-area'
          ? 'You have left this area — markers hidden'
          : 'Presence went stale — rescan the standpoint code',
      );
    }, 2000);
    return () => clearInterval(timer);
  }, [presence, surveys, getFix]);

  // ---- actions ----

  const toggleAr = () => {
    const next = !arOn;
    setArOn(next);
    // iOS gates motion sensors behind a user gesture — THIS click is it.
    if (next) void enableArOrientation();
    if (!next) {
      setGuide(null);
      setSheet(null);
    }
  };

  const startGuide = (heading: number, name: string) => {
    setGuide({ heading, name });
    setSheet(null);
  };

  const guideToMarker = (marker: SurveyMarker) => {
    if (!activeSurvey || !presence) return;
    startGuide(markerAbsBearing(activeSurvey, marker, presence.delta), marker.label);
  };

  /** Direction for an asset: in-view guide when localized, legs/maps otherwise. */
  const directionTo = (asset: Asset) => {
    const host = surveys.find((s) => s.markers.some((m) => m.assetId === asset.id));
    if (host) {
      const marker = host.markers.find((m) => m.assetId === asset.id) as SurveyMarker;
      if (presence && presence.surveyId === host.id) {
        startGuide(markerAbsBearing(host, marker, presence.delta), asset.name);
        return;
      }
      const planned = indoorLegs(surveys, getFix(), host.id);
      setLegs(planned);
      if (planned.length > 0) setSheet('legs');
      setHint(
        `${asset.name} is mapped at ${host.name} — scan that standpoint's code to be guided in view`,
      );
      return;
    }
    void (async () => {
      const siteId = scope.siteId;
      const geo = siteId
        ? await appStore.kvGet<SiteGeo>('settings', `sitegeo.${siteId}`)
        : null;
      if (!geo) {
        setHint('No survey marker and no site coordinates for this asset');
        return;
      }
      // Deep link only — the google-maps connection is deliberately not called.
      window.open(mapsDirectionsUrl(geo.lat, geo.lng), '_blank', 'noopener');
    })();
  };

  const pinNote = async () => {
    const text = noteText.trim();
    if (!activeSurvey || !text) return;
    const orient = arOrientation();
    const base = activeSurvey.sweep[0]?.heading ?? 0;
    const delta = presence?.delta ?? 0;
    // stored RELATIVE to sweep frame 0, with the Δ correction removed again
    const rel = ((orient.ok ? orient.heading : base) - delta - base + 360) % 360;
    const marker: SurveyMarker = {
      id: `m-${Date.now().toString(36)}-${Math.floor(Math.random() * 1296).toString(36)}`,
      label: text.slice(0, 60),
      note: text,
      heading: rel,
      pitch: orient.ok ? orient.pitch : 0,
    };
    const next: Survey = { ...activeSurvey, markers: [...activeSurvey.markers, marker] };
    await appStore.kvPut('surveys', `survey.${activeSurvey.id}`, next);
    await queryClient.invalidateQueries({ queryKey: ['surveys'] });
    setNoteText('');
    setSheet(null);
    setHint('Note pinned at this standpoint');
  };

  const openFault = () => {
    setSheet('fault');
    setFault({ subject: '', description: '', busy: true, fromPhoto: false });
    void (async () => {
      try {
        const blob = await camera.snap();
        if (blob) {
          const fileId = await appStore.uploadPhoto(blob, `fault-${Date.now()}.jpg`);
          const context = [
            focusAsset.data?.name ? `Asset: ${focusAsset.data.name}` : '',
            activeSurvey ? `Standpoint: ${activeSurvey.name}` : '',
            names.site ? `Site: ${names.site}` : '',
          ]
            .filter(Boolean)
            .join(' · ');
          const draft = await draftWorkOrder(fileId, context || 'Field fault report');
          setFault({
            subject: draft.subject,
            description: draft.description,
            busy: false,
            fromPhoto: true,
          });
          return;
        }
      } catch {
        /* no frame / agent unavailable → the plain form below */
      }
      setFault((f) => ({ ...f, busy: false }));
    })();
  };

  const submitFault = async () => {
    const subject = fault.subject.trim();
    if (!subject) return;
    setFault((f) => ({ ...f, busy: true }));
    try {
      await provider.createWorkOrder({
        subject,
        description: fault.description.trim() || undefined,
        siteId: scope.siteId,
        resourceId: focusAssetId ?? undefined,
      });
      await queryClient.invalidateQueries({ queryKey: ['workorders'] });
      setSheet(null);
      setFault({ subject: '', description: '', busy: false, fromPhoto: false });
      setHint('Work order raised');
    } catch (err) {
      setFault((f) => ({ ...f, busy: false }));
      setHint(err instanceof Error ? err.message : String(err));
    }
  };

  // ---- derived chrome ----

  const stateChip = !arOn
    ? { cls: 'ar-state idle', text: 'AR paused' }
    : presence
      ? {
          cls: 'ar-state locked',
          text: `Localized · ${activeSurvey?.name ?? presence.surveyId}${presence.via === 'qr' ? ' · QR' : ''}`,
        }
      : camera.state === 'unavailable'
        ? { cls: 'ar-state failed', text: 'Camera unavailable' }
        : scan.hint
          ? { cls: 'ar-state verifying', text: HINT_COPY[scan.hint] ?? scan.hint }
          : { cls: 'ar-state verifying', text: 'Looking for a standpoint…' };

  return (
    <div className="ar-stage">
      {/* Zone D background: the real camera, full-bleed inside the stage. Its
          unavailable/paused states render here, never as a whole-screen error. */}
      <div className="ar-camera-slot">
        {arOn && (
          <CameraView
            videoRef={camera.videoRef}
            frameCanvasRef={camera.frameCanvasRef}
            state={camera.state}
            onResume={() => void camera.resume()}
          />
        )}
      </div>
      <div className="ar-scrim" />

      {/* Zones A+B+C: the single top bar */}
      <div className="ar-topbar">
        <button className="ar-context" title="Change site in Portfolio">
          {names.site ?? 'All sites'}
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" style={{ opacity: 0.7 }} aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>
        <span className="ar-topbar-divider" />
        <span className={stateChip.cls}>
          <span className="ar-state-dot" />
          <span className="txt">{stateChip.text}</span>
        </span>
        <button className={arOn ? 'ar-toggle on' : 'ar-toggle'} onClick={toggleAr}>
          {arOn ? 'AR on' : 'AR off'}
        </button>
      </div>

      {/* Standpoint banner — outranks floor/site once we know where we are */}
      {arOn && activeSurvey && (
        <div className="ar-standpoint">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" />
          </svg>
          {activeSurvey.name} · {markers.length} marker{markers.length === 1 ? '' : 's'}
        </div>
      )}

      {/* Zone D: markers, positioned by the ArSpace node registry */}
      {arOn && !minimized && (
        <ArSpace active={arOn}>
          {activeSurvey &&
            presence &&
            markers.map((marker) => {
              const abs = markerAbsBearing(activeSurvey, marker, presence.delta);
              const summary = summarize(
                marker.assetId ? (byAsset.get(marker.assetId) ?? []) : [],
              );
              return (
                <ArCard
                  key={marker.id}
                  heading={abs}
                  pitch={marker.pitch}
                  edgeLabel={marker.label}
                  onEdgeClick={() => startGuide(abs, marker.label)}
                >
                  {marker.assetId ? (
                    <AssetTag
                      name={marker.label}
                      sub={activeSurvey.spaceName}
                      status={summary.status}
                      openCount={summary.open}
                      plannedCount={summary.planned}
                      selected={focusAssetId === marker.assetId}
                      onClick={() => setFocusAssetId(marker.assetId ?? null)}
                    />
                  ) : (
                    <NoteTag text={marker.label} onClick={() => startGuide(abs, marker.label)} />
                  )}
                </ArCard>
              );
            })}
        </ArSpace>
      )}

      {arOn && minimized && (
        <button className="ar-board-restore" onClick={() => setBoardMinimized(false)}>
          Restore markers ({markers.length})
        </button>
      )}

      {arOn && activeSurvey && !minimized && (
        <StandpointMarker
          label={activeSurvey.name}
          relocalizing={presence?.via !== 'qr'}
          style={{ left: '50%', top: '78%', transform: 'translateX(-50%)' }}
        />
      )}

      {arOn && guide && (
        <ArGuide
          heading={guide.heading}
          name={guide.name}
          onClear={() => setGuide(null)}
          onArrive={() => {
            const arrived = `${guide.name} is in front of you`;
            speak(arrived);
            setHint(arrived);
            setGuide(null);
          }}
        />
      )}

      <div className="ar-crosshair" aria-hidden="true">
        <span className="n" />
        <span className="s" />
        <span className="w" />
        <span className="e" />
      </div>

      {/* Zone E: candidates from the scan loop */}
      {arOn && scan.candidates.length > 0 && (
        <div className="ar-candidates">
          {scan.candidates.slice(0, 3).map((candidate, index) => {
            const summary = summarize(byAsset.get(candidate.assetId) ?? []);
            return (
              <button
                key={candidate.assetId}
                className={index === 0 ? 'ar-candidate top' : 'ar-candidate'}
                onClick={() => setFocusAssetId(candidate.assetId)}
              >
                <span className={`dot ${dotClass(summary.status)}`} />
                {assetName(candidate.assetId)}
                <span className="score">{Math.round(candidate.score * 100)}%</span>
              </button>
            );
          })}
        </div>
      )}

      {/* Zone F: dock */}
      <div className="ar-dock">
        <button
          className={sheet === 'markers' ? 'ar-dock-btn active' : 'ar-dock-btn'}
          onClick={() => setSheet(sheet === 'markers' ? null : 'markers')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h10" />
          </svg>
          Markers
          <span className="ar-dock-badge">{arOn && !minimized ? markers.length : 0}</span>
        </button>
        <button
          className={sheet === 'note' ? 'ar-dock-btn active' : 'ar-dock-btn'}
          disabled={!activeSurvey}
          onClick={() => setSheet(sheet === 'note' ? null : 'note')}
        >
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M5 4h9l5 5v11H5z" />
            <path d="M14 4v5h5" />
          </svg>
          Pin note
        </button>
        <button className={sheet === 'fault' ? 'ar-dock-btn active' : 'ar-dock-btn'} onClick={openFault}>
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 3l9 16H3z" />
            <path d="M12 9v5M12 17h.01" />
          </svg>
          Raise fault
        </button>
      </div>

      {/* marker index — one row per marker, each with a GUIDE action */}
      {sheet === 'markers' && (
        <div className="ar-sheet" role="dialog" aria-label="Marker index">
          <div className="ar-sheet-hd">
            <h3>Markers</h3>
            <button className="ar-sheet-x" aria-label="Close marker index" onClick={() => setSheet(null)}>
              ✕
            </button>
          </div>
          <div className="ar-sheet-bd">
            {!activeSurvey && (
              <p className="muted small">
                Scan a standpoint code (or let the camera recognize the spot) to load its markers.
              </p>
            )}
            {activeSurvey && (
              <>
                <p className="mi-group">{activeSurvey.name}</p>
                {markers.map((marker) => (
                  <div key={marker.id} className="mi-row">
                    <span className="lbl">{marker.label}</span>
                    <span className="kind">{marker.assetId ? 'asset' : marker.note ? 'note' : 'label'}</span>
                    <span className="meta">
                      {Math.round(markerAbsBearing(activeSurvey, marker, presence?.delta ?? 0))}°
                    </span>
                    <button className="btn btn-secondary" onClick={() => guideToMarker(marker)}>
                      Guide
                    </button>
                  </div>
                ))}
                <button className="btn btn-secondary" onClick={() => setBoardMinimized(!minimized)}>
                  {minimized ? 'Restore marker board' : 'Minimize marker board'}
                </button>
              </>
            )}
          </div>
        </div>
      )}

      {sheet === 'note' && (
        <div className="ar-sheet" role="dialog" aria-label="Pin a note">
          <div className="ar-sheet-hd">
            <h3>Pin a note here</h3>
            <button className="ar-sheet-x" aria-label="Close note" onClick={() => setSheet(null)}>
              ✕
            </button>
          </div>
          <div className="ar-sheet-bd">
            <label className="field">
              <span>Note</span>
              <textarea
                rows={3}
                value={noteText}
                onChange={(e) => setNoteText(e.target.value)}
                placeholder="What should the next technician know?"
              />
            </label>
            <button className="btn btn-primary" disabled={!noteText.trim()} onClick={() => void pinNote()}>
              Save note
            </button>
          </div>
        </div>
      )}

      {sheet === 'fault' && (
        <div className="ar-sheet" role="dialog" aria-label="Raise a fault">
          <div className="ar-sheet-hd">
            <h3>Raise a fault</h3>
            <button className="ar-sheet-x" aria-label="Close fault" onClick={() => setSheet(null)}>
              ✕
            </button>
          </div>
          <div className="ar-sheet-bd">
            {fault.busy && <p className="muted small">Reading the frame…</p>}
            {!fault.busy && !fault.fromPhoto && (
              <p className="muted small">No camera frame available — describe the fault yourself.</p>
            )}
            {fault.fromPhoto && <p className="muted small">Drafted from the current camera frame.</p>}
            <label className="field">
              <span>Subject</span>
              <input
                value={fault.subject}
                onChange={(e) => setFault((f) => ({ ...f, subject: e.target.value }))}
                placeholder="What is wrong?"
              />
            </label>
            <label className="field">
              <span>Description</span>
              <textarea
                rows={3}
                value={fault.description}
                onChange={(e) => setFault((f) => ({ ...f, description: e.target.value }))}
              />
            </label>
            <button
              className="btn btn-primary"
              disabled={fault.busy || !fault.subject.trim()}
              onClick={() => void submitFault()}
            >
              Create work order
            </button>
          </div>
        </div>
      )}

      {sheet === 'legs' && (
        <div className="ar-sheet" role="dialog" aria-label="Route">
          <div className="ar-sheet-hd">
            <h3>Route</h3>
            <button className="ar-sheet-x" aria-label="Close route" onClick={() => setSheet(null)}>
              ✕
            </button>
          </div>
          <div className="ar-sheet-bd">
            <ol className="leg-list">
              {legs.map((leg) => (
                <li key={leg.toSurveyId}>{leg.text}</li>
              ))}
            </ol>
            <p className="leg-note">
              The last metres are not a leg — scan the standpoint code there and the arrow takes over.
            </p>
          </div>
        </div>
      )}

      {/* in-view work orders for the focused asset */}
      {focusAsset.data && (
        <aside className="ar-side-panel">
          <div className="ar-side-panel-hd">
            <h3>{focusAsset.data.name}</h3>
            <button className="ar-sheet-x" aria-label="Close asset panel" onClick={() => setFocusAssetId(null)}>
              ✕
            </button>
          </div>
          <div className="row-actions">
            <button className="btn btn-secondary" onClick={() => directionTo(focusAsset.data as Asset)}>
              Direction
            </button>
            <button className="btn btn-secondary" onClick={openFault}>
              Raise a fault
            </button>
          </div>
          <WorkOrderPanel asset={focusAsset.data} />
        </aside>
      )}

      {codeSheet && (
        <CodeSheet
          code={codeSheet}
          siteId={scope.siteId}
          onClose={() => setCodeSheet(null)}
          onLinked={(entry) => setHint(`QR linked: ${describeEntry(entry)}`)}
        />
      )}

      {hint && (
        <div className="ar-hint" role="status">
          {hint}
        </div>
      )}
    </div>
  );
}
