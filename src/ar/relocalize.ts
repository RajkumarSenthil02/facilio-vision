// Lifted from asset-lens src/vision/relocalize.ts (imports adapted to this
// repo; quant helpers temporarily duplicated in src/ar/quant.ts).
//
// Survey re-localization — the precision core. Matching the live frame
// against each survey's 360° sweep tells us (a) which standpoint the viewer
// is at and (b) the heading offset Δ between the device compass NOW and the
// compass at survey time. Applying Δ to marker directions cancels compass
// error entirely (ReLoc-PDR-style visual relocalization, web edition).
import type { Survey } from '../api/types';
import { dequantize, l2Normalize } from './quant';

interface SweepEntry {
  surveyId: string;
  frameHeading: number;
  vec: Float32Array;
}

export class Relocalizer {
  private entries: SweepEntry[] = [];
  private deltas = new Map<string, number[]>();
  current: { surveyId: string; delta: number; score: number } | null = null;
  /** epoch ms of the last visual sweep match — presence confidence */
  lastMatchAt = 0;
  private pendingId: string | null = null;
  private pendingCount = 0;

  load(surveys: Survey[], modelId: string) {
    this.entries = [];
    this.deltas.clear();
    this.current = null;
    for (const s of surveys) {
      if (s.modelId !== modelId) continue;
      for (const f of s.sweep) {
        this.entries.push({
          surveyId: s.id,
          frameHeading: f.heading,
          vec: l2Normalize(dequantize(f.vec)),
        });
      }
    }
  }

  get size() {
    return this.entries.length;
  }

  /** Feed one live frame embedding + the device heading at capture time. */
  observe(
    vec: Float32Array,
    deviceHeading: number,
  ): { surveyId: string; delta: number; score: number } | null {
    if (!this.entries.length) return null;
    const q = l2Normalize(vec);
    let best: { e: SweepEntry; score: number } | null = null;
    for (const e of this.entries) {
      if (e.vec.length !== q.length) continue;
      let dot = 0;
      for (let d = 0; d < q.length; d++) dot += q[d] * e.vec[d];
      if (!best || dot > best.score) best = { e, score: dot };
    }
    if (!best || best.score < 0.52) return this.current;
    this.lastMatchAt = Date.now();
    // require 2 consecutive matches on the same survey before activating
    if (!this.current || this.current.surveyId !== best.e.surveyId) {
      if (this.pendingId === best.e.surveyId) this.pendingCount += 1;
      else {
        this.pendingId = best.e.surveyId;
        this.pendingCount = 1;
      }
      if (this.pendingCount < 2) return this.current;
    }
    const delta = ((deviceHeading - best.e.frameHeading + 540) % 360) - 180;
    const arr = this.deltas.get(best.e.surveyId) ?? [];
    arr.push(delta);
    if (arr.length > 7) arr.shift();
    this.deltas.set(best.e.surveyId, arr);
    // rolling median — robust to single bad matches
    const sorted = [...arr].sort((a, b) => a - b);
    const median = sorted[Math.floor(sorted.length / 2)];
    this.current = { surveyId: best.e.surveyId, delta: median, score: best.score };
    return this.current;
  }

  /** Call when presence should lapse (no matches for a while / moved away). */
  reset() {
    this.current = null;
    this.pendingId = null;
    this.pendingCount = 0;
    this.deltas.clear();
  }

  /** QR standpoint shortcut. If the survey stored the QR's direction, the
   * scanner is facing it now — Δ = (heading now) − (heading at enrollment). */
  confirmByQr(surveys: Survey[], code: string, deviceHeading?: number): Survey | null {
    const matches = surveys.filter((s) => s.qrCode && s.qrCode === code);
    // one code must identify exactly one standpoint — never guess between two
    if (matches.length > 1) return null;
    const hit = matches[0];
    if (hit) {
      const delta =
        hit.qrHeading != null && deviceHeading != null
          ? ((deviceHeading - hit.qrHeading + 540) % 360) - 180
          : this.current?.surveyId === hit.id
            ? this.current.delta
            : 0;
      this.current = { surveyId: hit.id, delta, score: 1 };
      this.lastMatchAt = Date.now();
    }
    return hit ?? null;
  }

  /** Every standpoint sharing a code — drives the disambiguation prompt. */
  static duplicatesFor(surveys: Survey[], code: string): Survey[] {
    return surveys.filter((s) => s.qrCode && s.qrCode === code);
  }
}
