// The AR stage (roadmap 5): a REAL camera surface with survey markers
// anchored to compass directions.
//
// Mobile-native HUD (matches the reference AR screen). The stage fills its
// pane exactly (height:100%, no 100vh, no page scroll) and lays chrome out in
// thumb-reachable bands:
//   top-left     site chip (40px, 15px) → the site picker sheet
//   top-right    vertical rail of 56px squares — Voice · AI fault · AR toggle
//                (the AR button keeps the accessible name "AR on"/"AR off":
//                the camera contract and the smoke tests read it)
//   top-centre   exactly ONE state chip, below it the standpoint banner
//   middle       dark translucent hint pills, tappable when they carry an action
//   bottom       52px primary + secondary action row, above the app dock
//   sheets       the shared Sheet primitive — they scroll internally, never the page
//
// What is real now: the camera feed (src/components/camera), the recognition
// loop (src/vision/scanLoop), presence via standpoint QR + visual
// relocalization, and marker bearings corrected by the relocalization Δ:
//   abs = (sweep[0].heading + marker.heading + relocΔ + 360) % 360
import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
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
import Sheet from '../components/Sheet';
import Icon from '../components/Icon';
import LocationPicker from '../components/LocationPicker';
import VoiceSheet from './VoiceSheet';
import { useScanLoop } from '../vision/scanLoop';
import { describeEntry, resolveCode } from '../vision/codes';
import { stampStopByCode } from '../rounds/roundsStore';
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

type SheetId = 'markers' | 'note' | 'fault' | 'legs' | 'site' | 'stand' | 'voice' | null;

/**
 * The shared Sheet primitive, named for assistive tech.
 *
 * Sheet owns the dialog root but takes no label prop (it is frozen for this
 * workstream), and a `role="dialog"` gets no accessible name from its
 * contents — so the name is stamped on the mounted root instead of nesting a
 * second dialog inside it.
 */
function ArSheet(props: {
  label: string;
  open: boolean;
  title?: ReactNode;
  onClose(): void;
  footer?: ReactNode;
  size?: 'auto' | 'tall';
  children: ReactNode;
}) {
  const { label, open, ...rest } = props;
  const host = useRef<HTMLDivElement>(null);
  useEffect(() => {
    host.current?.querySelector('.sheet-root')?.setAttribute('aria-label', label);
  });
  if (!open) return null;
  return (
    <div ref={host} className="ar-sheet-host">
      <Sheet open {...rest} />
    </div>
  );
}

const MicIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <rect x="9" y="3" width="6" height="11" rx="3" />
    <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
  </svg>
);

const SparkleIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l1.9 5.1L19 10l-5.1 1.9L12 17l-1.9-5.1L5 10l5.1-1.9z" />
    <path d="M18.5 15.5l.8 2.2 2.2.8-2.2.8-.8 2.2-.8-2.2-2.2-.8 2.2-.8z" />
  </svg>
);

const ArIcon = () => (
  <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
    <path d="M12 3l8 4.5v9L12 21l-8-4.5v-9z" />
    <path d="M12 12l8-4.5M12 12v9M12 12L4 7.5" />
  </svg>
);

export default function ARScreen() {
  const { scope, names } = useLocationScope();
  const queryClient = useQueryClient();

  // The camera is LIVE ON OPEN — this is a camera-first app, not a page with a
  // camera on it. getUserMedia may be called without a gesture (the browser
  // shows its own permission prompt); only iOS motion-sensor access needs one,
  // which is handled by the first-gesture effect below.
  const [arOn, setArOn] = useState(true);
  const [presence, setPresence] = useState<Presence | null>(null);
  const [focusAssetId, setFocusAssetId] = useState<number | null>(null);
  const [guide, setGuide] = useState<{ heading: number; name: string } | null>(null);
  const [sheet, setSheet] = useState<SheetId>(null);
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

    // A scanned sticker is proof of presence for an active round's stop (7.2).
    void stampStopByCode(code).catch(() => undefined);

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

  // iOS gates motion sensors behind a user gesture. The camera does not need
  // one, so rather than holding the whole stage hostage to a tap, we arm the
  // sensors on the FIRST touch anywhere in the stage — by which time the user
  // is already looking at a live camera.
  useEffect(() => {
    if (!arOn) return;
    let done = false;
    const arm = () => {
      if (done) return;
      done = true;
      void enableArOrientation();
    };
    window.addEventListener('pointerdown', arm, { once: true, passive: true });
    window.addEventListener('touchstart', arm, { once: true, passive: true });
    return () => {
      window.removeEventListener('pointerdown', arm);
      window.removeEventListener('touchstart', arm);
    };
  }, [arOn]);

  const toggleAr = () => {
    const next = !arOn;
    setArOn(next);
    if (next) void enableArOrientation();
    if (!next) {
      setGuide(null);
      setSheet(null);
    }
  };

  /**
   * Compass-only fallback: no code to scan and no visual match, so the user
   * names the standpoint. Same forced presence the "registered against a
   * survey but no enrolled heading" QR branch already produces — Δ is 0, so
   * bearings are raw compass bearings and presence never decays.
   */
  const standAt = (survey: Survey) => {
    const reloc = relocRef.current;
    reloc.current = { surveyId: survey.id, delta: 0, score: 1 };
    reloc.lastMatchAt = Date.now();
    setPresence({ surveyId: survey.id, delta: 0, via: 'qr', forced: true });
    setSheet(null);
    setHint(`Compass-only at ${survey.name} — bearings are uncorrected`);
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


  const markerCount = arOn && !minimized ? markers.length : 0;

  return (
    <div className="ar-stage">
      {/* The real camera, full-bleed inside the stage. Its unavailable/paused
          states render here as centred cards, never as a whole-screen error. */}
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

      {/* top band: site chip left, action rail right, both clear of the notch */}
      <div className="ar-top">
        <button className="ar-chip-site" onClick={() => setSheet('site')}>
          <span className="txt">{names.site ?? 'All sites'}</span>
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" style={{ opacity: 0.75 }} aria-hidden="true">
            <path d="M6 9l6 6 6-6" />
          </svg>
        </button>

        <div className="ar-rail">
          <button
            className={sheet === 'voice' ? 'ar-rail-btn mic live' : 'ar-rail-btn mic'}
            aria-label="Voice"
            onClick={() => setSheet(sheet === 'voice' ? null : 'voice')}
          >
            <MicIcon />
          </button>
          <button className="ar-rail-btn ai" aria-label="Raise fault with AI" onClick={openFault}>
            <SparkleIcon />
          </button>
          <button
            className={arOn ? 'ar-rail-btn on' : 'ar-rail-btn'}
            aria-label={arOn ? 'AR on' : 'AR off'}
            aria-pressed={arOn}
            onClick={toggleAr}
          >
            <ArIcon />
          </button>
        </div>
      </div>

      {/* exactly ONE state chip, top-centre */}
      <div className="ar-state-row">
        <span className={stateChip.cls}>
          <span className="ar-state-dot" />
          <span className="txt">{stateChip.text}</span>
        </span>
      </div>

      {/* Standpoint banner — outranks floor/site once we know where we are */}
      {arOn && activeSurvey && (
        <div className="ar-standpoint">
          <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" />
          </svg>
          {activeSurvey.name} · {markers.length} marker{markers.length === 1 ? '' : 's'}
        </div>
      )}

      {/* markers, positioned by the ArSpace node registry */}
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

      {arOn && activeSurvey && !minimized && (
        <StandpointMarker
          label={activeSurvey.name}
          relocalizing={presence?.via !== 'qr'}
          style={{ left: '50%', top: '72%', transform: 'translateX(-50%)' }}
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

      {/* The camera is the content — chrome never sits in the middle of it.
          The state chip up top already says what we are doing ("Looking for a
          standpoint…"), so the only thing worth surfacing here is the ACTION,
          as one compact chip tucked under the top band. */}
      <div className="ar-hints">
        {arOn && minimized && (
          <button className="ar-pill ar-pill-action" onClick={() => setBoardMinimized(false)}>
            Restore markers ({markers.length})
          </button>
        )}
        {arOn && !presence && (
          <button className="ar-pill ar-pill-action" onClick={() => setSheet('stand')}>
            {camera.state === 'unavailable' ? 'Pick a standpoint' : 'Show markers anyway'}
          </button>
        )}
      </div>

      {/* bottom band: candidates, the toast, then the 52px action row */}
      <div className="ar-bottom">
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

        {hint && (
          <div className="ar-toast" role="status">
            {hint}
          </div>
        )}

        <div className="ar-actions">
          <button
            className="ar-action ar-action-primary"
            onClick={() => setSheet(activeSurvey ? 'note' : 'stand')}
          >
            <Icon name="pin" /> Pin note here
          </button>
          <button
            className={sheet === 'markers' ? 'ar-action ar-action-secondary active' : 'ar-action ar-action-secondary'}
            onClick={() => setSheet(sheet === 'markers' ? null : 'markers')}
          >
            Markers
            <span className="ar-dock-badge">{markerCount}</span>
          </button>
        </div>
      </div>

      {/* ---- sheets: they scroll internally, the stage never does ---- */}

      <ArSheet
        label="Site"
        open={sheet === 'site'}
        title="Where are you working?"
        onClose={() => setSheet(null)}
      >
        <LocationPicker />
      </ArSheet>

      <ArSheet
        label="Pick a standpoint"
        open={sheet === 'stand'}
        title="Pick a standpoint"
        onClose={() => setSheet(null)}
      >
        <p className="ar-sheet-note">
          Compass-only: markers are placed on raw compass bearings, so they drift until you
          scan the standpoint code.
        </p>
        {surveys.length === 0 && (
          <p className="empty-card">No surveys yet — capture one from the Surveys tab.</p>
        )}
        {surveys.map((survey) => (
          <button key={survey.id} className="row-card" onClick={() => standAt(survey)}>
            <span>
              <span className="row-card-title">{survey.name}</span>
              <span className="row-card-meta">
                {survey.spaceName ?? 'No space'} · {survey.markers.length} marker
                {survey.markers.length === 1 ? '' : 's'}
              </span>
            </span>
            <span className="row-badge">Stand here</span>
          </button>
        ))}
      </ArSheet>

      {/* marker index — one row per marker, each with a GUIDE action */}
      <ArSheet
        label="Marker index"
        open={sheet === 'markers'}
        title="Markers"
        onClose={() => setSheet(null)}
        size="tall"
        footer={
          activeSurvey ? (
            <button className="btn-quiet grow" onClick={() => setBoardMinimized(!minimized)}>
              {minimized ? 'Restore marker board' : 'Minimize marker board'}
            </button>
          ) : (
            <button className="btn-cta" onClick={() => setSheet('stand')}>
              Pick a standpoint
            </button>
          )
        }
      >
        {!activeSurvey && (
          <p className="ar-sheet-note">
            Scan a standpoint code (or let the camera recognize the spot) to load its markers.
          </p>
        )}
        {activeSurvey && (
          <>
            <p className="mi-group">{activeSurvey.name}</p>
            {markers.map((marker) => (
              <div key={marker.id} className="mi-row">
                <span className="lbl">
                  <span className="txt">{marker.label}</span>
                  <span className="meta">
                    <span className="kind">
                      {marker.assetId ? 'asset' : marker.note ? 'note' : 'label'}
                    </span>
                    <span className="deg">
                      {Math.round(markerAbsBearing(activeSurvey, marker, presence?.delta ?? 0))}°
                    </span>
                  </span>
                </span>
                <button className="btn-quiet" onClick={() => guideToMarker(marker)}>
                  Guide
                </button>
              </div>
            ))}
          </>
        )}
      </ArSheet>

      <ArSheet
        label="Pin a note"
        open={sheet === 'note'}
        title="Pin a note here"
        onClose={() => setSheet(null)}
        footer={
          <button className="btn-cta" disabled={!noteText.trim()} onClick={() => void pinNote()}>
            Save note
          </button>
        }
      >
        <label className="field">
          <span>Note</span>
          <textarea
            rows={4}
            value={noteText}
            onChange={(e) => setNoteText(e.target.value)}
            placeholder="What should the next technician know?"
          />
        </label>
      </ArSheet>

      <ArSheet
        label="Raise a fault"
        open={sheet === 'fault'}
        title="Raise a fault"
        onClose={() => setSheet(null)}
        footer={
          <button
            className="btn-cta"
            disabled={fault.busy || !fault.subject.trim()}
            onClick={() => void submitFault()}
          >
            Create work order
          </button>
        }
      >
        {fault.busy && <p className="ar-sheet-note">Reading the frame…</p>}
        {!fault.busy && !fault.fromPhoto && (
          <p className="ar-sheet-note">No camera frame available — describe the fault yourself.</p>
        )}
        {fault.fromPhoto && <p className="ar-sheet-note">Drafted from the current camera frame.</p>}
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
            rows={4}
            value={fault.description}
            onChange={(e) => setFault((f) => ({ ...f, description: e.target.value }))}
          />
        </label>
      </ArSheet>

      <ArSheet label="Route" open={sheet === 'legs'} title="Route" onClose={() => setSheet(null)}>
        <ol className="leg-list">
          {legs.map((leg) => (
            <li key={leg.toSurveyId}>{leg.text}</li>
          ))}
        </ol>
        <p className="leg-note">
          The last metres are not a leg — scan the standpoint code there and the arrow takes over.
        </p>
      </ArSheet>

      <ArSheet
        label="Voice"
        open={sheet === 'voice'}
        title="Voice"
        onClose={() => setSheet(null)}
        size="tall"
      >
        <VoiceSheet
          assetInView={
            focusAsset.data ? { id: focusAsset.data.id, name: focusAsset.data.name } : undefined
          }
          captureFrame={() => camera.snap()}
          onUiAction={(verb) => {
            if (verb === 'minimize') setBoardMinimized(true);
            if (verb === 'expand') setBoardMinimized(false);
            if (verb === 'clear') setGuide(null);
          }}
        />
      </ArSheet>

      {/* in-view work orders for the focused asset */}
      {focusAsset.data && (
        <aside className="ar-side-panel">
          <div className="ar-side-panel-hd">
            <h3>{focusAsset.data.name}</h3>
            <button className="ar-sheet-x" aria-label="Close asset panel" onClick={() => setFocusAssetId(null)}>
              ✕
            </button>
          </div>
          <div className="ar-side-panel-bd scroll-y">
            <div className="row-actions">
              <button className="btn-quiet grow" onClick={() => directionTo(focusAsset.data as Asset)}>
                Direction
              </button>
              <button className="btn-quiet grow" onClick={openFault}>
                Raise a fault
              </button>
            </div>
            <WorkOrderPanel asset={focusAsset.data} />
          </div>
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
    </div>
  );
}
