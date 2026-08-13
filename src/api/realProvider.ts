import { createVibe } from '@facilio/vibe-sdk';
import type { DataProvider } from './dataProvider';
import type { ListQuery, PageResult } from './types';

// The ONLY file that touches the Vibe SDK. serverURL defaults to
// window.location.origin, so cookies flow with no config on the deployed app.
const vibe = createVibe();

const CONNECTION = 'facilio-cmms';

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

// Response envelope (verified by executing list-sites):
// { pagination: {page, pageSize}, data: [...], success, count }
function toPageResult<T>(raw: unknown, query: ListQuery = {}): PageResult<T> {
  const res = (raw ?? {}) as {
    data?: T[];
    count?: number;
    pagination?: { page?: number; pageSize?: number };
  };
  return {
    data: Array.isArray(res.data) ? res.data : [],
    page: res.pagination?.page ?? query.page ?? 1,
    pageSize: res.pagination?.pageSize ?? query.pageSize ?? 50,
    ...(query.includeCount && typeof res.count === 'number' ? { totalCount: res.count } : {}),
  };
}

async function list<T>(actionSlug: string, query?: ListQuery): Promise<PageResult<T>> {
  const raw = await vibe.executeAction(CONNECTION, actionSlug, toPayload(query));
  return toPageResult<T>(raw, query);
}

export const realProvider: DataProvider = {
  getCurrentUser: () => vibe.getCurrentUser(),
  login: () => vibe.login(),
  logout: () => vibe.logout(),
  listSites: (q) => list('list-sites', q),
  listSpaces: (q) => list('list-spaces', q),
  listAssets: (q) => list('list-assets', q),
  listWorkOrders: (q) => list('list-work-orders', q),
};
