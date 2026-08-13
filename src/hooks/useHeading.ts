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
  /** True when the heading is north-referenced; false = arbitrary session origin. */
  absolute: boolean;
}

const raw: Orientation = { heading: 0, pitch: 0, ok: false, absolute: false };
const smoothed: Orientation = { heading: 0, pitch: 0, ok: false, absolute: false };

const DEG = 180 / Math.PI;
const RAD = Math.PI / 180;

/**
 * Where the REAR CAMERA is actually looking, from all three axes.
 *
 * The old maths used two: heading from alpha, pitch from `beta - 90`. That is
 * only true while the phone is held bolt upright and unrolled. Tilt it
 * sideways to fit a pump in frame — gamma ≠ 0 — and beta swings wildly while
 * the camera has barely moved, so the marker was written down metres from
 * where the technician was pointing. Held in landscape (beta ≈ 0) it read a
 * 90° dive at the floor.
 *
 * So: build the device→world rotation R = Rz(a)Rx(b)Ry(g) (the DeviceOrientation
 * spec's own composition, world = East/North/Up), and take the camera's view
 * axis, which is the device's -Z. Azimuth and elevation then hold at every
 * attitude, which is the whole point.
 */
export function lookAngles(
  alphaDeg: number,
  betaDeg: number,
  gammaDeg: number,
): { azimuth: number; elevation: number } {
  const a = alphaDeg * RAD;
  const b = betaDeg * RAD;
  const g = gammaDeg * RAD;
  const cA = Math.cos(a);
  const sA = Math.sin(a);
  const cB = Math.cos(b);
  const sB = Math.sin(b);
  const cG = Math.cos(g);
  const sG = Math.sin(g);

  // -1 × the third column of R: the outward normal of the screen, negated.
  const east = -(cA * sG + sA * sB * cG);
  const north = -(sA * sG - cA * sB * cG);
  const up = -(cB * cG);

  return {
    azimuth: ((Math.atan2(east, north) * DEG) % 360 + 360) % 360,
    elevation: Math.asin(Math.max(-1, Math.min(1, up))) * DEG,
  };
}

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

function ingest(alpha: number | null, beta: number | null, gamma: number | null, absolute: boolean) {
  if (alpha == null || beta == null) return;
  const { azimuth, elevation } = lookAngles(alpha, beta, gamma ?? 0);
  const rawH = azimuth;
  const rawP = Math.max(-90, Math.min(90, elevation));
  raw.heading = rawH;
  raw.pitch = rawP;
  raw.ok = true;
  raw.absolute = absolute;
  smoothed.absolute = absolute;
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

/**
 * Absolute readings win, and once one has landed the relative stream is
 * ignored — otherwise the two events fight and the heading flickers between
 * two frames of reference.
 */
let haveAbsolute = false;

function onDeviceOrientation(e: DeviceOrientationEvent) {
  const webkit = (e as unknown as { webkitCompassHeading?: number }).webkitCompassHeading;
  if (typeof webkit === 'number' && !Number.isNaN(webkit)) {
    // iOS: alpha has an arbitrary origin, webkitCompassHeading is the
    // north-referenced version of it. Convert, then use the same maths.
    haveAbsolute = true;
    ingest((360 - webkit) % 360, e.beta, e.gamma, true);
    return;
  }
  if (e.absolute) {
    haveAbsolute = true;
    ingest(e.alpha, e.beta, e.gamma, true);
    return;
  }
  if (haveAbsolute) return;
  // No compass reference. The pose is still USABLE: every marker is stored
  // relative to its survey's sweep, so a stable arbitrary origin places
  // markers correctly against each other within the session. It is flagged
  // `absolute: false` so nothing claims it points at true north.
  ingest(e.alpha, e.beta, e.gamma, false);
}

export type OrientationStatus = 'idle' | 'waiting' | 'live' | 'denied' | 'unsupported';
let permission: 'unknown' | 'granted' | 'denied' = 'unknown';

function startListening() {
  if (listening) return;
  listening = true;
  // Android exposes the compass-referenced stream on the *absolute* event;
  // both are attached because a device may only answer on one of them.
  if ('ondeviceorientationabsolute' in window) {
    window.addEventListener('deviceorientationabsolute', onDeviceOrientation as EventListener, true);
  }
  window.addEventListener('deviceorientation', onDeviceOrientation as EventListener, true);
}

/** What the AR layer should SAY about the sensor, rather than guessing. */
export function orientationStatus(): OrientationStatus {
  if (smoothed.ok) return 'live';
  if (permission === 'denied') return 'denied';
  if (!listening) return 'idle';
  return typeof window !== 'undefined' && 'DeviceOrientationEvent' in window
    ? 'waiting'
    : 'unsupported';
}

/**
 * iOS needs a user-gesture permission; Android just starts. Safe to call
 * repeatedly — and it must be, because a technician who dismissed the prompt
 * once has to be able to ask for it again from the banner rather than being
 * locked out of placement for the rest of the session.
 */
export async function enableArOrientation(): Promise<boolean> {
  const DOE = (
    globalThis as { DeviceOrientationEvent?: { requestPermission?: () => Promise<string> } }
  ).DeviceOrientationEvent;
  try {
    if (DOE && typeof DOE.requestPermission === 'function') {
      const res = await DOE.requestPermission();
      if (res !== 'granted') {
        permission = 'denied';
        return false;
      }
      permission = 'granted';
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
    history.length = 0;
    return;
  }
  const h = ((heading % 360) + 360) % 360;
  raw.heading = h;
  raw.pitch = pitch;
  raw.ok = true;
  raw.absolute = true;
  smoothed.heading = h;
  smoothed.pitch = pitch;
  smoothed.ok = true;
  smoothed.absolute = true;
}
