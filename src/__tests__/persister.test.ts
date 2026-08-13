// 2.8 acceptance: the persister structurally refuses non-JSON-safe data.
// A Map in the query cache rehydrates as {} and throws on the next .get() —
// a blank screen that only appears on the second load. These tests make that
// class of bug impossible to reintroduce quietly.
import { describe, expect, it } from 'vitest';
import { dehydrate } from '@tanstack/react-query';
import { createAppQueryClient, createPersistOptions, isJsonSafe } from '../api/queryClient';

describe('isJsonSafe', () => {
  it('accepts plain JSON data', () => {
    expect(isJsonSafe(null)).toBe(true);
    expect(isJsonSafe('x')).toBe(true);
    expect(isJsonSafe(42)).toBe(true);
    expect(isJsonSafe([{ a: 1, b: ['x', null] }])).toBe(true);
    expect(isJsonSafe({ nested: { deep: { ok: true } } })).toBe(true);
  });

  it('refuses the liars: Map, Set, Date, class instances, typed arrays, cycles', () => {
    expect(isJsonSafe(new Map([['k', 'v']]))).toBe(false);
    expect(isJsonSafe(new Set([1]))).toBe(false);
    expect(isJsonSafe(new Date())).toBe(false);
    expect(isJsonSafe(new Uint8Array([1, 2]))).toBe(false);
    expect(isJsonSafe(() => {})).toBe(false);
    expect(isJsonSafe(NaN)).toBe(false);
    expect(isJsonSafe(undefined)).toBe(false);
    class Thing {}
    expect(isJsonSafe(new Thing())).toBe(false);

    const cyclic: Record<string, unknown> = {};
    cyclic.self = cyclic;
    expect(isJsonSafe(cyclic)).toBe(false);

    // The killer case: safe-looking object with a Map buried inside
    expect(isJsonSafe({ rows: [], index: new Map() })).toBe(false);
  });
});

describe('persister filter', () => {
  it('dehydrates JSON-safe queries and refuses Map-bearing ones', async () => {
    const client = createAppQueryClient();
    client.setQueryData(['safe'], { rows: [1, 2, 3] });
    client.setQueryData(['unsafe'], { index: new Map([['a', 1]]) });

    const options = createPersistOptions(window.localStorage);
    const dehydrated = dehydrate(client, options.dehydrateOptions);

    const keys = dehydrated.queries.map((q) => q.queryKey[0]);
    expect(keys).toContain('safe');
    expect(keys).not.toContain('unsafe');
  });
});
