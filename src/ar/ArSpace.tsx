// Lifted from asset-lens src/ar/ArSpace.tsx (the 3DoF AR keystone), adapted:
// the stage-1 sensor lane (EMA A=0.25, 0.4° deadband) now lives in
// src/hooks/useHeading.ts — this file keeps stage 2 and the layout engine.
// Tuning constants preserved verbatim:
//   render-stage damped follower k=0.16, snap k=0.5 when |Δ|>12°
//   wrap(deg) = ((deg+540)%360)-180              (src/wayfinding/bearing.ts)
//   projection pxPerDegX = innerWidth/60, pxPerDegY = innerHeight/75
//   collision push-down with a 6-iteration guard
//   depth cue scale = max(0.7, 1 - |dx|/140)
//   edge chevrons: off-screen |dx|>55°, band at max(140, innerHeight*0.17),
//     30px apart, MAX 4 per side, flexDirection row-reverse on the left
//   ArGuide captions: |d|<8° straight ahead, |d|>150° behind you, else
//     'N° left/right'; arrival <10°
//
// 3DoF AR space for mobile Safari (no WebXR on iOS): content is anchored to
// a DIRECTION (compass heading + pitch) and the gyro drives its screen
// position at 60fps — turn away and a card slides off-screen, turn back and
// it is exactly where it was left, Vision-Pro-window style. Cards are plain
// HTML, so anything inside them (lists!) scrolls natively. Visual
// re-detection re-anchors cards to the physical spot, correcting drift.
import { useEffect, useLayoutEffect, useRef, type ReactNode } from 'react';
import { arOrientation } from '../hooks/useHeading';
import { bearingToCaption, wrap } from '../wayfinding/bearing';

interface Pose {
  heading: number;
  pitch: number;
  ok: boolean;
}

/** Render-stage damped follower: the pose used for layout glides toward the
 * sensor pose each frame — jitter becomes a subtle ease. */
const smooth: Pose = { heading: 0, pitch: 0, ok: false };
function advanceSmooth() {
  const orient = arOrientation();
  if (!orient.ok) return;
  if (!smooth.ok) {
    smooth.heading = orient.heading;
    smooth.pitch = orient.pitch;
    smooth.ok = true;
    return;
  }
  const dH = wrap(orient.heading - smooth.heading);
  const dP = orient.pitch - smooth.pitch;
  // critically-damped-ish follow; snap when far so fast pans stay responsive
  const k = Math.abs(dH) > 12 || Math.abs(dP) > 12 ? 0.5 : 0.16;
  smooth.heading = (smooth.heading + dH * k + 360) % 360;
  smooth.pitch = smooth.pitch + dP * k;
}

/* ---------- anchored-node registry: the hot path never touches React ----------
 * Re-rendering the AR subtree every animation frame collapsed frame rates on
 * phones and inside the Facilio webview (asset-lens lesson). The loop writes
 * transforms straight to the DOM; React only re-renders when the SET of
 * cards actually changes.
 */
interface ArNode {
  el: HTMLElement;
  edge: HTMLElement | null;
  heading: number;
  pitch: number;
  hidden: boolean;
}
const nodes = new Map<HTMLElement, ArNode>();

/** The wayfinder: one bearing the whole view is pointing the user toward. */
interface GuideNode {
  arrow: HTMLElement;
  text: HTMLElement;
  heading: number;
  onArrive?: () => void;
  arrived: boolean;
}
let guide: GuideNode | null = null;

/** Cards never sink into the candidates row + dock: keep this many px at the
 * bottom of the viewport free of cards (zone E starts at bottom:96px). */
export const DOCK_CLEAR_PX = 104;
/** Cards' anchor line sits at 42% of the viewport height (ArCard base top). */
const CARD_BASE_Y = 0.42;
/** ArGuide arrival threshold (deg). */
const ARRIVE_DEG = 10;

function layout() {
  const pxPerDegX = window.innerWidth / 60;
  const pxPerDegY = window.innerHeight / 75;

  if (guide) {
    // rotate the arrow toward the target and say it in words
    const d = smooth.ok ? wrap(guide.heading - smooth.heading) : 0;
    guide.arrow.style.transform = `rotate(${d.toFixed(1)}deg)`;
    const word = smooth.ok ? bearingToCaption(d) : 'locating…';
    if (guide.text.textContent !== word) guide.text.textContent = word;
    if (smooth.ok && Math.abs(d) < ARRIVE_DEG && !guide.arrived) {
      guide.arrived = true;
      guide.onArrive?.();
    }
  }

  if (!nodes.size) return;
  // Cards at similar bearings used to stack into an unreadable pile, so they
  // are laid out in bearing order and pushed down past whatever already
  // occupies their column.
  const visible: { n: ArNode; x: number; y: number; h: number }[] = [];
  // off-screen chevrons stack in a band of their own, clear of the cards
  const edgeBase = Math.max(140, window.innerHeight * 0.17);
  let edgeL = 0;
  let edgeR = 0;
  for (const n of nodes.values()) {
    const dx = smooth.ok ? wrap(n.heading - smooth.heading) : 0;
    const dy = smooth.ok ? smooth.pitch - n.pitch : 0;
    const off = Math.abs(dx) > 55;
    if (off !== n.hidden) {
      n.hidden = off;
      n.el.style.visibility = off ? 'hidden' : '';
      if (n.edge) n.edge.style.display = off ? 'flex' : 'none';
    }
    if (off) {
      if (n.edge) {
        // park a chevron on the edge it went out of; four per side, then the
        // marker index is the place to look
        const right = dx > 0;
        const slot = right ? edgeR++ : edgeL++;
        if (slot > 3) {
          n.edge.style.display = 'none';
        } else {
          n.edge.style.display = 'flex';
          n.edge.style.left = right ? 'auto' : '6px';
          n.edge.style.right = right ? '6px' : 'auto';
          n.edge.style.top = `${(edgeBase + slot * 30).toFixed(0)}px`;
          n.edge.style.flexDirection = right ? 'row' : 'row-reverse';
        }
      }
      continue;
    }
    visible.push({ n, x: dx * pxPerDegX, y: dy * pxPerDegY, h: n.el.offsetHeight || 64 });
  }

  visible.sort((a, b) => a.x - b.x || a.y - b.y);
  const placed: { x: number; top: number; bottom: number }[] = [];
  for (const v of visible) {
    const w = v.n.el.offsetWidth || 200;
    // hard floor: the candidates row + dock band stays free of cards
    const maxY = window.innerHeight * (1 - CARD_BASE_Y) - DOCK_CLEAR_PX - v.h / 2;
    const overlaps = (p: { x: number; top: number; bottom: number }, y: number) =>
      Math.abs(p.x - v.x) < w * 0.75 && y - v.h / 2 < p.bottom && y + v.h / 2 > p.top;
    let y = Math.min(v.y, maxY);
    for (let guard = 0; guard < 6; guard++) {
      const clash = placed.find((p) => overlaps(p, y));
      if (!clash) break;
      y = clash.bottom + v.h / 2 + 8;
    }
    if (y > maxY) {
      // pushed into the dock band — walk back up past whatever clashes
      y = maxY;
      for (let guard = 0; guard < 6; guard++) {
        const clash = placed.find((p) => overlaps(p, y));
        if (!clash) break;
        y = clash.top - v.h / 2 - 8;
      }
    }
    placed.push({ x: v.x, top: y - v.h / 2, bottom: y + v.h / 2 });
    const dxDeg = v.x / pxPerDegX;
    const scale = Math.max(0.7, 1 - Math.abs(dxDeg) / 140);
    v.n.el.style.transform = `translate(calc(-50% + ${v.x.toFixed(1)}px), calc(-50% + ${y.toFixed(1)}px)) scale(${scale.toFixed(3)})`;
  }
}

/** Full-bleed layer; runs one rAF loop for every anchored card inside it. */
export function ArSpace({ children, active }: { children: ReactNode; active: boolean }) {
  useEffect(() => {
    if (!active) return;
    let raf = 0;
    const loop = () => {
      advanceSmooth();
      layout();
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [active]);
  return (
    <div style={{ position: 'absolute', inset: 0, overflow: 'hidden', pointerEvents: 'none', zIndex: 7 }}>
      {children}
    </div>
  );
}

/** A card fixed at a direction. `onMove` enables drag-to-re-place. */
export function ArCard(props: {
  heading: number;
  pitch: number;
  children: ReactNode;
  /** shown on a screen-edge chevron while this card is out of view */
  edgeLabel?: string;
  onEdgeClick?: () => void;
  onMove?: (dHeading: number, dPitch: number) => void;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const edgeRef = useRef<HTMLButtonElement>(null);
  const dragRef = useRef<{ x: number; y: number; moved: boolean } | null>(null);

  useLayoutEffect(() => {
    const el = ref.current;
    if (!el) return;
    nodes.set(el, {
      el,
      edge: edgeRef.current,
      heading: props.heading,
      pitch: props.pitch,
      hidden: false,
    });
    layout();
    return () => {
      nodes.delete(el);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // drag / re-anchor / Δ correction update the registry in place
  useLayoutEffect(() => {
    const el = ref.current;
    const n = el ? nodes.get(el) : undefined;
    if (!n) return;
    n.heading = props.heading;
    n.pitch = props.pitch;
    layout();
  }, [props.heading, props.pitch]);

  const card = (
    <div
      ref={ref}
      onPointerDown={(e) => {
        if (!props.onMove) return;
        dragRef.current = { x: e.clientX, y: e.clientY, moved: false };
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
      }}
      onPointerMove={(e) => {
        const d = dragRef.current;
        if (!d || !props.onMove) return;
        const mx = e.clientX - d.x;
        const my = e.clientY - d.y;
        if (!d.moved && Math.hypot(mx, my) < 6) return;
        d.moved = true;
        d.x = e.clientX;
        d.y = e.clientY;
        props.onMove(mx / (window.innerWidth / 60), -my / (window.innerHeight / 75));
      }}
      onPointerUp={() => {
        const wasDrag = dragRef.current?.moved;
        dragRef.current = null;
        if (wasDrag) {
          const swallow = (ev: Event) => {
            ev.stopPropagation();
            ev.preventDefault();
          };
          window.addEventListener('click', swallow, { capture: true, once: true });
        }
      }}
      style={{
        position: 'absolute',
        left: '50%',
        top: `${CARD_BASE_Y * 100}%`,
        pointerEvents: 'auto',
        willChange: 'transform',
        touchAction: 'none',
      }}
    >
      {props.children}
    </div>
  );

  if (!props.edgeLabel) return card;
  return (
    <>
      {card}
      <button ref={edgeRef} className="vs-edge" style={{ display: 'none' }} onClick={props.onEdgeClick}>
        <span className="vs-edge-label">{props.edgeLabel}</span>
        <span className="vs-edge-chev" aria-hidden>
          ›
        </span>
      </button>
    </>
  );
}

/** Wayfinder: a persistent arrow pointing at one bearing until it is reached.
 * `onArrive` fires ONCE when the walker centres the target (<10°) — the
 * caller clears the guide and announces arrival. */
export function ArGuide({
  heading,
  name,
  onClear,
  onArrive,
}: {
  heading: number;
  name: string;
  onClear: () => void;
  onArrive?: () => void;
}) {
  const arrowRef = useRef<HTMLSpanElement>(null);
  const textRef = useRef<HTMLSpanElement>(null);
  useLayoutEffect(() => {
    if (!arrowRef.current || !textRef.current) return;
    guide = { arrow: arrowRef.current, text: textRef.current, heading, onArrive, arrived: false };
    layout();
    return () => {
      guide = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [heading]);
  return (
    <div className="vs-guide">
      <span ref={arrowRef} className="vs-guide-arrow" aria-hidden>
        ↑
      </span>
      <span className="vs-guide-body">
        <span className="vs-guide-name">{name}</span>
        <span ref={textRef} className="vs-guide-dir">
          locating…
        </span>
      </span>
      <button className="vs-guide-x" onClick={onClear} aria-label="Stop guiding">
        ✕
      </button>
    </div>
  );
}

// ---- test hooks (jsdom has no sensors and no real rAF cadence) ----

/** TEST ONLY: pin the render-stage pose directly. */
export function __setPoseForTest(heading: number, pitch = 0): void {
  smooth.heading = ((heading % 360) + 360) % 360;
  smooth.pitch = pitch;
  smooth.ok = true;
}

/** TEST ONLY: forget the pose (back to "sensor not started"). */
export function __resetPoseForTest(): void {
  smooth.ok = false;
}

/** TEST ONLY: run one synchronous layout pass. */
export function __layoutForTest(): void {
  layout();
}
