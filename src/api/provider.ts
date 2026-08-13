import type { DataProvider } from './dataProvider';
import { mockProvider } from './mockProvider';
import { realProvider } from './realProvider';

/**
 * `?mock=1` selects the fixture provider — the whole app is developable with
 * zero org access. Anything else (including no param) hits the real org.
 *
 * Screens must import { provider } from here and never reach for the SDK —
 * see the seam rule in dataProvider.ts.
 */
export function isMockMode(search: string = window.location.search): boolean {
  return new URLSearchParams(search).get('mock') === '1';
}

// Resolved per property access, not at module eval: modules load before the
// app (or a test) has a URL worth inspecting, and binding the choice at import
// time silently pins the real provider.
export const provider: DataProvider = new Proxy({} as DataProvider, {
  get(_target, prop: keyof DataProvider) {
    const active = isMockMode() ? mockProvider : realProvider;
    return active[prop];
  },
});
