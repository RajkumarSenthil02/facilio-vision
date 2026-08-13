import { useQuery } from '@tanstack/react-query';
import { provider } from './provider';
import type { AssetSearch } from './types';

// All portfolio reads go through these hooks — components never call the
// provider directly for cacheable data, so keys stay consistent app-wide.

export function useSites() {
  return useQuery({
    queryKey: ['sites'],
    queryFn: () => provider.listSites({ pageSize: 200 }).then((p) => p.data),
  });
}

export function useBuildings() {
  return useQuery({
    queryKey: ['buildings'],
    queryFn: () => provider.listBuildings(),
  });
}

export function useFloors() {
  return useQuery({
    queryKey: ['floors'],
    queryFn: () => provider.listFloors(),
  });
}

export function useAssetSearch(search: AssetSearch, enabled = true) {
  return useQuery({
    // Spread the scope into the key — object identity must not matter.
    queryKey: [
      'assets',
      'search',
      search.scope?.siteId ?? null,
      search.scope?.buildingId ?? null,
      search.scope?.floorId ?? null,
      search.text ?? '',
    ],
    queryFn: () => provider.searchAssets(search),
    enabled,
  });
}

export function useAsset(id: number | null) {
  return useQuery({
    queryKey: ['asset', id],
    queryFn: () => provider.getAsset(id as number),
    enabled: id !== null,
  });
}
