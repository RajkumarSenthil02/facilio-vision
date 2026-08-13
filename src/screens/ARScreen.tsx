import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { provider } from '../api/provider';
import { useAssetSearch } from '../api/hooks';
import { useLocationScope } from '../state/LocationContext';
import { AssetTag, MinimizedDot, NoteTag, StandpointMarker, WoPin } from '../ar/markers';
import type { MarkerStatus } from '../ar/markers';
import type { WorkOrder } from '../api/types';
import '../styles/ar.css';

// Dock HUD (design direction 1b): one slim 38px top bar (context · state ·
// AR toggle), markers-only AR space, candidates above a labeled bottom dock.
// The camera feed itself lands in Phase 3; the gyro-driven registry in Phase
// 5 — this stage renders the REAL marker system against real org data so the
// visual language, data plumbing and zones are already in place.

const OPEN_STATUSES = ['open', 'submitted', 'assigned', 'work in progress', 'in progress'];
const PLANNED_STATUSES = ['on hold', 'scheduled', 'pre-open', 'preopen', 'yet to start'];

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

export default function ARScreen() {
  const { scope, names } = useLocationScope();
  const [arOn, setArOn] = useState(true);
  const [selectedId, setSelectedId] = useState<number | null>(null);
  const [minimized, setMinimized] = useState<Set<number>>(new Set());

  const assets = useAssetSearch({ scope });
  const markerAssets = useMemo(() => (assets.data ?? []).slice(0, 3), [assets.data]);

  const workOrders = useQuery({
    queryKey: ['workorders', 'ar', markerAssets.map((a) => a.id)],
    queryFn: () => provider.listWorkOrdersForAssets(markerAssets.map((a) => a.id)),
    enabled: markerAssets.length > 0,
  });

  const byAsset = useMemo(() => {
    const map = new Map<number, WorkOrder[]>();
    for (const wo of workOrders.data ?? []) {
      if (!wo.resourceId) continue;
      map.set(wo.resourceId, [...(map.get(wo.resourceId) ?? []), wo]);
    }
    return map;
  }, [workOrders.data]);

  const toggleMinimized = (id: number) =>
    setMinimized((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });

  // Deterministic zone-D placements for the preview stage (Phase 5 replaces
  // these with the bearing-driven registry). 16px side insets per the grid.
  const SLOTS = [
    { left: '6%', top: '22%' },
    { left: '58%', top: '38%' },
    { left: '12%', top: '56%' },
  ];

  const totalMarkers = markerAssets.length + 3; // + note, pin, standpoint

  return (
    <div className="ar-stage">
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
        <span className={assets.isLoading ? 'ar-state verifying' : 'ar-state idle'}>
          <span className="ar-state-dot" />
          <span className="txt">
            {assets.isLoading ? 'Loading markers…' : 'Preview — camera lands in Phase 3'}
          </span>
        </span>
        <button className={arOn ? 'ar-toggle on' : 'ar-toggle'} onClick={() => setArOn((v) => !v)}>
          {arOn ? 'AR on' : 'AR off'}
        </button>
      </div>

      {/* Context: standpoint banner (outranks floor/site) */}
      {arOn && (
        <div className="ar-standpoint">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M12 21s7-6.3 7-11a7 7 0 1 0-14 0c0 4.7 7 11 7 11z" />
          </svg>
          WS-01 point · {totalMarkers} markers
        </div>
      )}

      {/* Zone D: markers only */}
      {arOn &&
        markerAssets.map((asset, index) => {
          const summary = summarize(byAsset.get(asset.id) ?? []);
          const slot = SLOTS[index % SLOTS.length];
          if (minimized.has(asset.id)) {
            return (
              <MinimizedDot
                key={asset.id}
                label={asset.name}
                status={summary.status}
                style={slot}
                onClick={() => toggleMinimized(asset.id)}
              />
            );
          }
          return (
            <AssetTag
              key={asset.id}
              name={asset.name}
              sub={[asset.category, asset.spaceName].filter(Boolean).join(' · ')}
              status={summary.status}
              openCount={summary.open}
              plannedCount={summary.planned}
              selected={selectedId === asset.id}
              style={slot}
              onClick={() =>
                selectedId === asset.id ? toggleMinimized(asset.id) : setSelectedId(asset.id)
              }
            />
          );
        })}
      {arOn && (
        <>
          <NoteTag text="Belt slipping — check on next PM" style={{ left: '54%', top: '62%' }} />
          <WoPin count={(workOrders.data ?? []).length} status="red" style={{ left: '78%', top: '24%' }} />
          <StandpointMarker label="WS-01" relocalizing style={{ left: '40%', top: '74%' }} />
        </>
      )}

      <div className="ar-crosshair" aria-hidden="true">
        <span className="n" />
        <span className="s" />
        <span className="w" />
        <span className="e" />
      </div>

      {/* Zone E: candidate chips — max 3 + overflow count */}
      {arOn && markerAssets.length > 0 && (
        <div className="ar-candidates">
          {markerAssets.slice(0, 2).map((asset, index) => {
            const summary = summarize(byAsset.get(asset.id) ?? []);
            return (
              <button
                key={asset.id}
                className={index === 0 ? 'ar-candidate top' : 'ar-candidate'}
                onClick={() => setSelectedId(asset.id)}
              >
                <span className={`dot ${summary.status === 'red' ? 'st-red' : summary.status === 'amber' ? 'st-amber' : 'st-green'}`} />
                {asset.name}
                <span className="score">{index === 0 ? '64%' : '41%'}</span>
              </button>
            );
          })}
          {(assets.data?.length ?? 0) > 2 && (
            <span className="ar-candidate">+{(assets.data?.length ?? 0) - 2}</span>
          )}
        </div>
      )}

      {/* Zone F: dock — hidden in embedded mode via CSS */}
      <div className="ar-dock">
        <button className="ar-dock-btn" title="Voice — Phase 8">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <rect x="9" y="2" width="6" height="11" rx="3" />
            <path d="M5 10a7 7 0 0 0 14 0" />
            <path d="M12 17v5" />
          </svg>
          Voice
        </button>
        <button className="ar-dock-btn active">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" aria-hidden="true">
            <path d="M4 7h16M4 12h16M4 17h10" />
          </svg>
          Markers
          <span className="ar-dock-badge">{arOn ? totalMarkers : 0}</span>
        </button>
        <button className="ar-dock-btn" title="Rooms — Phase 4">
          <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="M4 20V9l8-5 8 5v11z" />
            <path d="M10 20v-6h4v6" />
          </svg>
          Rooms
        </button>
      </div>
    </div>
  );
}
