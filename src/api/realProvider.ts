import { vibe } from './vibe';
import { cmms, chunk, fetchAllPages, inFilter, rowsOf } from './facilioHelpers';
import type { DataProvider } from './dataProvider';
import type {
  Asset,
  AssetSearch,
  Building,
  Floor,
  ListQuery,
  LocationScope,
  PageResult,
  Site,
  Space,
  WorkOrder,
} from './types';

// Payload keys verified against the action input schemas
// (`facilio connections schemas facilio-cmms.list-sites ...`, 2026-08-13).
function toPayload(query: ListQuery = {}): Record<string, unknown> {
  const payload: Record<string, unknown> = {};
  if (query.page !== undefined) payload.page = query.page;
  if (query.pageSize !== undefined) payload.page_size = query.pageSize;
  if (query.filters !== undefined) payload.filters = query.filters;
  if (query.sortBy !== undefined) payload.sort_by = query.sortBy;
  if (query.sortOrder !== undefined) payload.sort_order = query.sortOrder;
  if (query.select !== undefined) payload.select = query.select;
  if (query.expand !== undefined) payload.expand = query.expand;
  if (query.includeCount !== undefined) payload.include_count = query.includeCount;
  return payload;
}

async function list<T>(actionSlug: string, query?: ListQuery): Promise<PageResult<T>> {
  const res = await cmms<T[]>(actionSlug, toPayload(query));
  return {
    data: rowsOf<T>(res.data),
    page: res.pagination?.page ?? query?.page ?? 1,
    pageSize: res.pagination?.pageSize ?? query?.pageSize ?? 50,
    ...(query?.includeCount && typeof res.count === 'number' ? { totalCount: res.count } : {}),
  };
}

// ---- raw row shapes (lookups expanded to nested {id,name} records) ----

interface RawBuilding {
  id: number;
  name: string;
  site?: { id?: number };
}

interface RawFloor {
  id: number;
  name: string;
  building?: { id?: number };
  site?: { id?: number };
}

interface RawSpace {
  id: number;
  name: string;
  site?: { id?: number };
  building?: { id?: number };
  floor?: { id?: number };
  spaceType?: string;
}

interface RawAsset {
  id: number;
  name: string;
  category?: { id?: number; name?: string } | string;
  space?: { id?: number; name?: string };
  qrVal?: string;
}

function toAsset(row: RawAsset): Asset {
  return {
    id: row.id,
    name: row.name,
    category: typeof row.category === 'string' ? row.category : row.category?.name,
    spaceId: row.space?.id,
    spaceName: row.space?.name,
    qrVal: row.qrVal,
  };
}

const ASSET_SELECT = 'id,name,category,space,qrVal';

// Scope resolution needs the whole space tree; memoize briefly so typing in
// the asset search box doesn't refetch the org's spaces per keystroke.
// (react-query also caches at the searchAssets level.)
let spacesMemo: { at: number; promise: Promise<Space[]> } | null = null;
const SPACES_MEMO_MS = 60_000;

function allSpacesCached(): Promise<Space[]> {
  if (!spacesMemo || Date.now() - spacesMemo.at > SPACES_MEMO_MS) {
    const promise = realProvider.listAllSpaces();
    spacesMemo = { at: Date.now(), promise };
    promise.catch(() => {
      // Never cache a failure.
      if (spacesMemo?.promise === promise) spacesMemo = null;
    });
  }
  return spacesMemo.promise;
}

/**
 * Assets attach to the location tree through `space` ONLY — there is no site
 * field on assets, and an asset's space pointer can target ANY BaseSpace level
 * (many orgs parent assets directly to the site). Scoping therefore means:
 * take the scope roots themselves plus every space under them, and filter
 * assets by `space` IN that id set. (Pattern lifted from ppm-asset-tagging.)
 */
async function resolveScopeSpaceIds(scope: LocationScope | undefined): Promise<number[] | undefined> {
  if (!scope || (!scope.siteId && !scope.buildingId && !scope.floorId)) return undefined;

  const spaces = await allSpacesCached();
  const ids = new Set<number>();

  // Narrower scopes win: floor > building > site.
  if (scope.floorId) {
    ids.add(scope.floorId);
    for (const s of spaces) if (s.floorId === scope.floorId) ids.add(s.id);
  } else if (scope.buildingId) {
    ids.add(scope.buildingId);
    for (const s of spaces) {
      if (s.buildingId === scope.buildingId) {
        ids.add(s.id);
        if (s.floorId) ids.add(s.floorId);
      }
    }
  } else if (scope.siteId) {
    ids.add(scope.siteId);
    for (const s of spaces) {
      if (s.siteId === scope.siteId) {
        ids.add(s.id);
        if (s.buildingId) ids.add(s.buildingId);
        if (s.floorId) ids.add(s.floorId);
      }
    }
  }
  return [...ids];
}

export const realProvider: DataProvider = {
  getCurrentUser: () => vibe.getCurrentUser(),
  login: () => vibe.login(),
  logout: () => vibe.logout(),

  listSites: (q) => list<Site>('list-sites', q),

  async listBuildings(): Promise<Building[]> {
    const rows = await fetchAllPages<RawBuilding>('list-buildings', {
      select: 'id,name,site',
      expand: 'site',
    });
    return rows.map((b) => ({ id: b.id, name: b.name, siteId: b.site?.id }));
  },

  async listFloors(): Promise<Floor[]> {
    const rows = await fetchAllPages<RawFloor>('list-floors', {
      select: 'id,name,building,site',
      expand: 'building,site',
    });
    return rows.map((f) => ({
      id: f.id,
      name: f.name,
      buildingId: f.building?.id,
      siteId: f.site?.id,
    }));
  },

  async listAllSpaces(): Promise<Space[]> {
    const rows = await fetchAllPages<RawSpace>('list-spaces', {
      select: 'id,name,site,building,floor',
      expand: 'site,building,floor',
    });
    return rows.map((s) => ({
      id: s.id,
      name: s.name,
      siteId: s.site?.id,
      buildingId: s.building?.id,
      floorId: s.floor?.id,
      spaceType: s.spaceType,
    }));
  },

  async searchAssets(search: AssetSearch = {}): Promise<Asset[]> {
    const spaceIds = await resolveScopeSpaceIds(search.scope);
    const filters: string[] = [];
    if (search.text?.trim()) filters.push(`name(contains)=${search.text.trim()}`);

    // Unscoped: one paged fetch.
    if (!spaceIds) {
      const rows = await fetchAllPages<RawAsset>('list-assets', {
        select: ASSET_SELECT,
        expand: 'space',
        ...(filters.length ? { filters: filters.join('&') } : {}),
      });
      return rows.map(toAsset);
    }

    if (!spaceIds.length) return [];

    // Scoped: the filters string is a URL parameter — keep each IN list short.
    const parts = await Promise.all(
      chunk(spaceIds, 50).map((part) =>
        fetchAllPages<RawAsset>('list-assets', {
          select: ASSET_SELECT,
          expand: 'space',
          filters: [...filters, inFilter('space', part)].join('&'),
        }),
      ),
    );
    return parts.flat().map(toAsset);
  },

  async getAsset(id: number): Promise<Asset | null> {
    const res = await cmms<RawAsset[]>('list-assets', {
      select: ASSET_SELECT,
      expand: 'space',
      filters: inFilter('id', [id]),
    });
    const row = rowsOf<RawAsset>(res.data)[0];
    return row ? toAsset(row) : null;
  },

  listWorkOrders: (q) => list<WorkOrder>('list-work-orders', q),
};
