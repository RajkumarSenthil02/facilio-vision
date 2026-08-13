// Presence model + decay policy. Decision logic lifted from the watchdog in
// asset-lens src/screens/ScanScreen.tsx:332-355, extracted pure so the
// timings are testable without a camera:
//   - markers belong to the PLACE: without fresh proof of presence they hide
//   - a scanned physical sticker (qr) is far stronger proof than indoor GPS,
//     so it lives 180s vs 20s for visual matches, and the geo distance gate
//     applies ONLY to non-QR presence with an accurate fix (<50m), >100m out
//   - forced presence (no usable Δ source, e.g. room codes) never decays
import type { GeoFix, Survey, SurveyMarker } from '../api/types';
import { haversineMeters } from '../wayfinding/geo';

export interface Presence {
  surveyId: string;
  /** Heading offset to apply to marker directions (relocalization Δ). */
  delta: number;
  /** No usable Δ/decay source — opened by explicit user intent; never decays. */
  forced?: boolean;
  via?: 'qr' | 'visual';
}

export const QR_STALE_MS = 180_000;
export const VISUAL_STALE_MS = 20_000;
export const GEO_TRIP_METERS = 100;
export const GEO_ACCURACY_GATE_M = 50;

export type DecayVerdict = { decayed: false } | { decayed: true; reason: 'left-area' | 'stale' };

export function presenceDecayCheck(args: {
  presence: Presence;
  survey: Survey | undefined;
  fix: GeoFix | null;
  /** Relocalizer.lastMatchAt (epoch ms) — 0 means "no proof recorded". */
  lastMatchAt: number;
  now: number;
}): DecayVerdict {
  const { presence, survey, fix, lastMatchAt, now } = args;
  if (presence.forced) return { decayed: false };
  const isQr = presence.via === 'qr';
  const tooFar =
    !isQr && survey?.geo && fix && fix.accuracy < GEO_ACCURACY_GATE_M
      ? haversineMeters(survey.geo, fix) > GEO_TRIP_METERS
      : false;
  if (tooFar) return { decayed: true, reason: 'left-area' };
  const staleMs = isQr ? QR_STALE_MS : VISUAL_STALE_MS;
  if (lastMatchAt > 0 && now - lastMatchAt > staleMs) return { decayed: true, reason: 'stale' };
  return { decayed: false };
}

/**
 * Absolute render bearing for a survey marker. Markers are stored RELATIVE
 * TO SWEEP FRAME 0 (see src/api/types.ts):
 *   abs = (sweep[0].heading + marker.heading + relocΔ + 360) % 360
 */
export function markerAbsBearing(survey: Survey, marker: SurveyMarker, delta: number): number {
  return ((survey.sweep[0]?.heading ?? 0) + marker.heading + delta + 360) % 360;
}
