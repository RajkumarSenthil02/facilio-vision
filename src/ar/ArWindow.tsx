/**
 * ArWindow — a visionOS-style window ANCHORED IN SPACE at an asset marker.
 *
 * This replaces the screen-fixed side panel: the full work surface — work
 * order list, work order summary, task execution, status transitions, AI —
 * lives on the glass window that floats where the asset physically is. The
 * anatomy follows visionOS: a title bar, vibrancy-tiered text on a blurred
 * glass material, capsule actions, an ornament floating OUTSIDE the top edge
 * for the "leave AR" deep link, and a bottom grabber that drags to expand.
 *
 * Navigation is a stack INSIDE the window (home → work orders → one work
 * order), visionOS-style progressive disclosure rather than new layers.
 */
import { useRef, useState } from 'react';
import {
  useChangeWorkOrderStatus,
  useSetTaskStatus,
  useWorkOrderStatuses,
  useWorkOrdersForAsset,
  useWorkOrderTasks,
} from '../api/hooks';
import { briefAsset } from '../api/agents';
import type { Asset, WorkOrder } from '../api/types';
import DsSelect from '../components/DsSelect';
import Icon from '../components/Icon';
import './visionGlass.css';

type View = { kind: 'home' } | { kind: 'wos' } | { kind: 'wo'; wo: WorkOrder };

/** Status → the one colour that varies (Atom families, tuned for glass). */
function statusTone(status?: string): 'open' | 'prog' | 'done' | 'hold' {
  const s = (status ?? '').toLowerCase();
  if (['resolved', 'closed'].includes(s)) return 'done';
  if (['in progress', 'work in progress', 'processing'].includes(s)) return 'prog';
  if (['on hold', 'overdue', 'incomplete'].includes(s)) return 'hold';
  return 'open';
}

const BODY_MIN = 180;
const BODY_MAX = () => Math.round(window.innerHeight * 0.52);

export default function ArWindow({
  asset,
  openCount,
  plannedCount,
  woUrl,
  assetUrl,
  onMinimize,
  onVoice,
  onFault,
  onNavigate,
}: {
  asset: Asset;
  openCount: number;
  plannedCount: number;
  /** Deep-link template results — null hides the ornament. */
  woUrl: (id: number) => string | null;
  assetUrl: (id: number) => string | null;
  onMinimize(): void;
  onVoice(): void;
  onFault(): void;
  onNavigate(): void;
}) {
  const [view, setView] = useState<View>({ kind: 'home' });
  const [bodyH, setBodyH] = useState(240);
  const workOrders = useWorkOrdersForAsset(asset.id);
  const drag = useRef<{ y: number; h: number } | null>(null);

  const [brief, setBrief] = useState<{ busy: boolean; text: string | null }>({
    busy: false,
    text: null,
  });
  const runBrief = () => {
    if (brief.busy) return;
    setBrief({ busy: true, text: null });
    void briefAsset(asset, workOrders.data ?? [])
      .then((text) => setBrief({ busy: false, text }))
      .catch(() => setBrief({ busy: false, text: null }));
  };

  const link =
    view.kind === 'wo' ? woUrl(view.wo.id) : assetUrl(asset.id);

  const title =
    view.kind === 'home' ? asset.name : view.kind === 'wos' ? 'Work orders' : `#${view.wo.id}`;

  return (
    <div className="vg-anchor">
      {/* ornament: floats OUTSIDE the window's top edge, visionOS-style */}
      {link && (
        <a className="vg-ornament" href={link} target="_blank" rel="noopener noreferrer">
          <Icon name="external" size={14} />
          {view.kind === 'wo' ? 'Open summary in Facilio' : 'Open in Facilio'}
        </a>
      )}

      <aside className="vg-window" role="complementary" aria-label={asset.name}>
        <header className="vg-bar">
          {view.kind !== 'home' && (
            <button
              className="vg-icon-btn"
              aria-label="Back"
              onClick={() => setView(view.kind === 'wo' ? { kind: 'wos' } : { kind: 'home' })}
            >
              <Icon name="chevron-left" size={18} />
            </button>
          )}
          <h3 className="vg-title">{title}</h3>
          <button className="vg-icon-btn" aria-label={`Minimize ${asset.name}`} onClick={onMinimize}>
            <span className="vg-minus" aria-hidden="true" />
          </button>
        </header>

        <div className="vg-body scroll-y" style={{ maxHeight: bodyH }}>
          {view.kind === 'home' && (
            <>
              <div className="vg-chip-row">
                {openCount > 0 && <span className="vg-chip t-open">{openCount} open</span>}
                {plannedCount > 0 && <span className="vg-chip t-hold">{plannedCount} planned</span>}
                {openCount === 0 && plannedCount === 0 && (
                  <span className="vg-chip t-done">No open work</span>
                )}
                {asset.spaceName && <span className="vg-chip t-plain">{asset.spaceName}</span>}
              </div>

              <button className="vg-row vg-row-primary" onClick={() => setView({ kind: 'wos' })}>
                <Icon name="list" size={18} />
                <span className="vg-row-main">Work orders</span>
                <span className="vg-row-meta">
                  {workOrders.isLoading ? '…' : (workOrders.data?.length ?? 0)}
                </span>
                <Icon name="chevron-right" size={16} className="vg-row-chev" />
              </button>

              <div className="vg-action-grid">
                <button className="vg-action" onClick={onFault}>
                  <Icon name="alert" size={18} />
                  Raise fault
                </button>
                <button className="vg-action" onClick={onVoice}>
                  <Icon name="mic" size={18} />
                  Voice
                </button>
                <button className="vg-action" onClick={onNavigate}>
                  <Icon name="compass" size={18} />
                  Direction
                </button>
                <button className="vg-action" onClick={runBrief} disabled={brief.busy}>
                  <Icon name="sparkle" size={18} />
                  {brief.busy ? 'Briefing…' : 'AI brief'}
                </button>
              </div>

              {(brief.busy || brief.text) && (
                <div className="vg-brief" role="status">
                  {brief.busy ? 'Reading the asset’s open work…' : brief.text}
                </div>
              )}
            </>
          )}

          {view.kind === 'wos' && (
            <>
              {workOrders.isLoading && <p className="vg-dim">Loading work orders…</p>}
              {workOrders.data?.length === 0 && (
                <p className="vg-dim">Nothing raised against this asset yet.</p>
              )}
              {workOrders.data?.map((wo) => (
                <button key={wo.id} className="vg-row" onClick={() => setView({ kind: 'wo', wo })}>
                  <span className={`vg-dot t-${statusTone(wo.status)}`} />
                  <span className="vg-row-main">
                    <span className="vg-row-title">{wo.subject}</span>
                    <span className="vg-row-sub">
                      #{wo.id}
                      {wo.status ? ` · ${wo.status}` : ''}
                    </span>
                  </span>
                  <Icon name="chevron-right" size={16} className="vg-row-chev" />
                </button>
              ))}
            </>
          )}

          {view.kind === 'wo' && <WoDetail wo={view.wo} assetId={asset.id} />}
        </div>

        {/* the visionOS grabber: drag to give the window more room */}
        <div
          className="vg-grabber"
          role="separator"
          aria-label="Resize window"
          onPointerDown={(e) => {
            drag.current = { y: e.clientY, h: bodyH };
            (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
          }}
          onPointerMove={(e) => {
            if (!drag.current) return;
            const next = drag.current.h + (e.clientY - drag.current.y);
            setBodyH(Math.max(BODY_MIN, Math.min(BODY_MAX(), next)));
          }}
          onPointerUp={() => {
            drag.current = null;
          }}
          onDoubleClick={() => setBodyH((h) => (h > 300 ? 240 : BODY_MAX()))}
        >
          <span />
        </div>
      </aside>
    </div>
  );
}

/** One work order, in place: summary, checklist execution, status actions —
 * the same moves as the Facilio summary page, without leaving the camera. */
function WoDetail({ wo, assetId }: { wo: WorkOrder; assetId: number }) {
  const tasks = useWorkOrderTasks(wo.id);
  const setTask = useSetTaskStatus(wo.id);
  const statuses = useWorkOrderStatuses();
  const changeStatus = useChangeWorkOrderStatus(assetId);
  const done = (tasks.data ?? []).filter((t) => t.closed).length;

  return (
    <div className="vg-detail">
      <div className="vg-detail-head">
        <span className="vg-row-title">{wo.subject}</span>
        <span className={`vg-chip t-${statusTone(wo.status)}`}>{wo.status ?? 'Unknown'}</span>
      </div>
      {wo.description && <p className="vg-dim">{wo.description}</p>}
      <dl className="vg-meta">
        {wo.priority && (
          <>
            <dt>Priority</dt>
            <dd>{wo.priority}</dd>
          </>
        )}
        {wo.assignedTo && (
          <>
            <dt>Assignee</dt>
            <dd>{wo.assignedTo}</dd>
          </>
        )}
        {wo.dueDate && (
          <>
            <dt>Due</dt>
            <dd>{new Date(wo.dueDate).toLocaleString()}</dd>
          </>
        )}
      </dl>

      <h4 className="vg-section">
        Tasks
        {tasks.data && tasks.data.length > 0 && (
          <span className="vg-row-meta">
            {done}/{tasks.data.length}
          </span>
        )}
      </h4>
      {tasks.isLoading && <p className="vg-dim">Loading tasks…</p>}
      {tasks.data?.length === 0 && <p className="vg-dim">No checklist on this work order.</p>}
      {tasks.data?.map((task) => (
        <div key={task.id} className={task.closed ? 'vg-task closed' : 'vg-task'}>
          <button
            className={task.closed ? 'task-check on' : 'task-check'}
            aria-label={`${task.closed ? 'Reopen' : 'Complete'}: ${task.subject}`}
            disabled={setTask.isPending}
            onClick={() => setTask.mutate({ taskId: task.id, closed: !task.closed })}
          >
            {task.closed && (
              <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="3" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                <path d="M4 12l5 5L20 6" />
              </svg>
            )}
          </button>
          <span>{task.subject}</span>
        </div>
      ))}
      {setTask.isError && <p className="vg-err">{(setTask.error as Error).message}</p>}

      <h4 className="vg-section">Status</h4>
      <DsSelect
        label="Move to"
        value=""
        placeholder={wo.status ?? 'Select status'}
        options={(statuses.data ?? [])
          .filter((s) => s.label !== wo.status)
          .map((s) => ({ value: s.value, label: s.label }))}
        onChange={(status) => changeStatus.mutate({ workOrderId: wo.id, status })}
      />
      {changeStatus.isPending && <p className="vg-dim">Updating status…</p>}
      {changeStatus.isError && <p className="vg-err">{(changeStatus.error as Error).message}</p>}
    </div>
  );
}
