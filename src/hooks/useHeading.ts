// THE one orientation source for the whole app (stage 1 of the AR pose
// pipeline). Sensor lane lifted from asset-lens src/ar/ArSpace.tsx —
// tuning constants preserved verbatim: EMA A=0.25, 0.4° deadband.
//
//  - iOS: DeviceOrientationEvent.requestPermission() gate (call
//    enableArOrientation() from a USER GESTURE), then webkitCompassHeading.
//  - Others: 'deviceorientationabsolute' when available (compass-referenced),
//    else 'deviceorientation', heading = 360 - alpha.
//  - pitch = clamp(beta - 90, -90, 90)  (beta 90 = phone held upright).
//
// Stage-2 smoothing (the render-time damped follower) lives in src/ar/ArSpace.
import { useEffect, useState } from 'react';

export interface Orientation {
  /** 0-360 compass heading. */
  heading: number;
  /** -90..90, 0 = phone upright facing the horizon. */
  pitch: number;
  /** false until the first sensor event lands. */
  ok: boolean;
}

const raw: Orientation = { heading: 0, pitch: 0, ok: false };
const smoothed: Orientation = { heading: 0, pitch: 0, ok: false };

/**
 * A short history of recent smoothed readings, for PLACEMENT only.
 *
 * The EMA is tuned for a calm-looking live overlay, which means it still
 * carries the odd outlier — and a marker is written once, from a single
 * instant, and lives forever. Taking the median of the last moment's readings
 * throws those outliers away without adding lag to the render path.
 */
const HISTORY = 12;
const history: Array<{ heading: number; pitch: number; at: number }> = [];
let listening = false;

function ingest(headingIn: number | null, beta: number | null) {
  if (headingIn == null || beta == null) return;
  const rawH = (headingIn + 360) % 360;
  const rawP = Math.max(-90, Math.min(90, beta - 90));
  raw.heading = rawH;
  raw.pitch = rawP;
  raw.ok = true;
  if (!smoothed.ok) {
    smoothed.heading = rawH;
    smoothed.pitch = rawP;
    smoothed.ok = true;
    pushHistory();
    return;
  }
  // EMA low-pass + deadband: raw compass jitters ±2-8° — untreated it reads
  // as the card "swimming" around its point.
  const dH = ((rawH - smoothed.heading + 540) % 360) - 180;
  const dP = rawP - smoothed.pitch;
  const A = 0.25;
  if (Math.abs(dH) > 0.4) smoothed.heading = (smoothed.heading + dH * A + 360) % 360;
  if (Math.abs(dP) > 0.4) smoothed.pitch = smoothed.pitch + dP * A;
  pushHistory();
}

/** Keeps the placement window fed. Cheap: a bounded ring of primitives. */
function pushHistory(): void {
  history.push({ heading: smoothed.heading, pitch: smoothed.pitch, at: Date.now() });
  if (history.length > HISTORY) history.shift();
}

function onDeviceOrientation(e: DeviceOrientationEvent) {
  const webkit = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
  const heading = typeof webkit === 'number' ? webkit : e.alpha != null ? 360 - e.alpha : null;
  ingest(heading, e.beta);
}

function startListening() {
  if (listening) return;
  listening = true;
  // Android exposes the compass-referenced stream on the *absolute* event.
  const evt =
    'ondeviceorientationabsolute' in window ? 'deviceorientationabsolute' : 'deviceorientation';
  window.addEventListener(evt, onDeviceOrientation as EventListener, true);
}

/**
 * iOS needs a user-gesture permission; Android just starts. Safe to call
 * repeatedly — returns false when denied/unavailable.
 */
export async function enableArOrientation(): Promise<boolean> {
  const DOE = (
    globalThis as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }
  ).DeviceOrientationEvent;
  try {
    if (DOE && typeof DOE.requestPermission === 'function') {
      const res = await DOE.requestPermission();
      if (res !== 'granted') return false;
    }
    startListening();
    return true;
  } catch {
    return false;
  }
}

/** Stage-1 smoothed pose (the one the AR layer consumes). Live object — read, never mutate. */
/** Circular median — bearings wrap, so a plain median is wrong near north. */
function circularMedian(values: number[]): number {
  const base = values[0];
  const unwrapped = values.map((v) => base + (((v - base + 540) % 360) - 180));
  const sorted = [...unwrapped].sort((a, b) => a - b);
  const mid = sorted[Math.floor(sorted.length / 2)];
  return ((mid % 360) + 360) % 360;
}

/**
 * The reading to WRITE INTO a survey: the median of the last ~600ms.
 * Returns null when the compass is not answering, exactly like arOrientation's
 * `ok:false` — placement must never invent a bearing.
 */
export function placementOrientation(
  now = Date.now(),
): { heading: number; pitch: number; samples: number } | null {
  if (!smoothed.ok) return null;
  const recent = history.filter((h) => now - h.at <= 600);
  if (recent.length === 0) {
    return { heading: smoothed.heading, pitch: smoothed.pitch, samples: 1 };
  }
  const pitches = recent.map((h) => h.pitch).sort((a, b) => a - b);
  return {
    heading: circularMedian(recent.map((h) => h.heading)),
    pitch: pitches[Math.floor(pitches.length / 2)],
    samples: recent.length,
  };
}

export function arOrientation(): Orientation {
  return smoothed;
}

/** Unsmoothed sensor pose, for diagnostics. */
export function rawOrientation(): Orientation {
  return raw;
}

/**
 * React view of the smoothed pose, sampled at `sampleMs` — for chrome text
 * (compass readouts, sweep progress). The 60fps hot path must NOT use this;
 * it reads arOrientation() inside the rAF loop instead.
 */
export function useHeading(sampleMs = 250): Orientation {
  const [pose, setPose] = useState<Orientation>(() => ({ ...smoothed }));
  useEffect(() => {
    const t = setInterval(() => {
      setPose((prev) =>
        prev.heading === smoothed.heading && prev.pitch === smoothed.pitch && prev.ok === smoothed.ok
          ? prev
          : { ...smoothed },
      );
    }, sampleMs);
    return () => clearInterval(t);
  }, [sampleMs]);
  return pose;
}

/** TEST ONLY: force the pose (null heading = back to "no sensor yet"). */
export function setOrientationForTest(heading: number | null, pitch = 0): void {
  if (heading == null) {
    raw.ok = false;
    smoothed.ok = false;
    return;
  }
  const h = ((heading % 360) + 360) % 360;
  raw.heading = h;
  raw.pitch = pitch;
  raw.ok = true;
  smoothed.heading = h;
  smoothed.pitch = pitch;
  smoothed.ok = true;
}
