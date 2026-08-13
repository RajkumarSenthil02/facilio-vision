// The QR-origin invariant — the reason the code scan is now MANDATORY at
// survey creation: markers must land on the same PHYSICAL spots on load,
// whatever the loading device's compass thinks north is.
import { describe, expect, it } from 'vitest';
import { Relocalizer } from '../ar/relocalize';
import { markerAbsBearing } from '../ar/presence';
import type { Survey } from '../api/types';

const survey = (extra: Partial<Survey>): Survey => ({
  id: 'sv-1',
  name: 'Pump room — door',
  geo: null,
  sweep: [{ heading: 100, pitch: 0, vec: { q: '', s: 1, dim: 0 } }],
  markers: [{ id: 'm1', label: 'AHU-03', heading: 30, pitch: 0, assetId: 1 }],
  modelId: 'luma64-v0',
  createdAt: '2026-08-01T00:00:00.000Z',
  ...extra,
});

describe('QR as the survey origin', () => {
  it('a compass disagreeing by 20° between visits is cancelled exactly by the scan', () => {
    // ENROLMENT: the code physically sits at true 140°; the authoring phone's
    // compass frame called that 140 (its sweep base was 100, marker at +30 →
    // marker's true spot reads 130 in that frame).
    const s = survey({ qrCode: 'ws-07', qrHeading: 140 });

    // LOAD: a different phone whose compass reads EVERYTHING +20°. Facing the
    // same physical code, it reports bearing 160.
    const reloc = new Relocalizer();
    const hit = reloc.confirmByQr([s], 'ws-07', 160);
    expect(hit?.id).toBe('sv-1');
    expect(reloc.current?.delta).toBe(20);

    // The marker renders at 100+30+20 = 150 in THIS phone's frame — which is
    // the same physical direction the authoring phone called 130. The +20
    // disagreement is gone from every marker at once.
    expect(markerAbsBearing(s, s.markers[0], reloc.current!.delta)).toBe(150);
  });

  it('without an enrolled heading there is no Δ source — delta stays 0', () => {
    const s = survey({ qrCode: 'ws-07', qrHeading: undefined });
    const reloc = new Relocalizer();
    reloc.confirmByQr([s], 'ws-07', 160);
    expect(reloc.current?.delta).toBe(0);
  });

  it('a code shared by two standpoints identifies neither', () => {
    const a = survey({ id: 'a', qrCode: 'dup' });
    const b = survey({ id: 'b', qrCode: 'dup' });
    const reloc = new Relocalizer();
    expect(reloc.confirmByQr([a, b], 'dup', 90)).toBeNull();
    expect(reloc.current).toBeNull();
  });

  it('Δ wraps correctly across north', () => {
    const s = survey({ qrCode: 'q', qrHeading: 350 });
    const reloc = new Relocalizer();
    reloc.confirmByQr([s], 'q', 10); // 20° clockwise of the enrolled bearing
    expect(reloc.current?.delta).toBe(20);
  });
});
