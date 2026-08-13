import { QueryClient } from '@tanstack/react-query';
import { createSyncStoragePersister } from '@tanstack/query-sync-storage-persister';
import type { PersistQueryClientOptions } from '@tanstack/react-query-persist-client';

/**
 * Structural JSON-safety check for the persister. A `Map` in the query cache
 * survives JSON.stringify as `{}` and rehydrates as a plain object — the next
 * `.get()` call throws, and the blank screen only appears on the SECOND load.
 * So: anything that wouldn't round-trip JSON.parse(JSON.stringify(x))
 * unchanged is refused persistence outright. The query still works — it just
 * refetches instead of rehydrating.
 */
export function isJsonSafe(value: unknown, seen = new Set<object>()): boolean {
  if (value === null) return true;
  switch (typeof value) {
    case 'string':
    case 'boolean':
      return true;
    case 'number':
      return Number.isFinite(value);
    case 'undefined': // dropped by JSON inside objects; refuse to be strict
    case 'bigint':
    case 'function':
    case 'symbol':
      return false;
  }
  if (typeof value !== 'object') return false;
  if (seen.has(value)) return false; // cycle
  seen.add(value);

  if (Array.isArray(value)) return value.every((v) => isJsonSafe(v, seen));

  // Only plain objects. Map/Set/Date/Blob/TypedArray/class instances all fail
  // here — exactly the values that lie through JSON.stringify.
  const proto = Object.getPrototypeOf(value);
  if (proto !== Object.prototype && proto !== null) return false;

  return Object.values(value).every((v) => isJsonSafe(v, seen));
}

export function createAppQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        // The persisted cache paints instantly; ALWAYS revalidate against the
        // org on mount so nobody acts on yesterday's work order status.
        refetchOnMount: 'always',
        staleTime: 30_000,
        gcTime: 24 * 60 * 60 * 1000, // must outlive the persister's maxAge
        retry: 1,
      },
    },
  });
}

const STORAGE_KEY = 'fv.queryCache';

export function createPersistOptions(
  storage: Storage = window.localStorage,
): Omit<PersistQueryClientOptions, 'queryClient'> {
  return {
    persister: createSyncStoragePersister({ storage, key: STORAGE_KEY }),
    maxAge: 24 * 60 * 60 * 1000,
    dehydrateOptions: {
      shouldDehydrateQuery: (query) =>
        query.state.status === 'success' && isJsonSafe(query.state.data),
    },
  };
}
