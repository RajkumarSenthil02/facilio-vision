import type { DataProvider } from './dataProvider';
import type { Asset, AssetSearch, ListQuery, PageResult } from './types';

// Fixtures mirror the shape (and flavor) of the real org's seeded demo data so
// switching ?mock=1 on/off doesn't change what the UI has to handle. Note the
// real-world quirk is preserved: assets parent to ANY BaseSpace level via
// spaceId (asset 3006 parents straight to site 1001).

const sites = [
  { id: 1001, name: 'Greenfield Business Park', description: 'Mixed-use office park with two towers and a central admin block.', siteType: 'Office', moduleState: 'active', qrVal: 'facilio_1001' },
  { id: 1002, name: 'Lakeside Manufacturing Plant', description: 'Heavy-industry facility with a production wing and utility block.', siteType: 'Compound', moduleState: 'active', qrVal: 'facilio_1002' },
  { id: 1003, name: 'Harborview Medical Center', description: 'Regional hospital campus, three wards and a diagnostics wing.', siteType: 'Hospital', moduleState: 'active', qrVal: 'facilio_1003' },
];

const buildings = [
  { id: 1501, name: 'Tower A', siteId: 1001 },
  { id: 1502, name: 'Tower B', siteId: 1001 },
  { id: 1503, name: 'Production Wing', siteId: 1002 },
  { id: 1504, name: 'Ward B', siteId: 1003 },
];

const floors = [
  { id: 1801, name: 'Floor 3', buildingId: 1501, siteId: 1001 },
  { id: 1802, name: 'Ground Floor', buildingId: 1501, siteId: 1001 },
  { id: 1803, name: 'Line Deck', buildingId: 1503, siteId: 1002 },
];

const spaces = [
  { id: 2001, name: 'Open Office 3F', siteId: 1001, buildingId: 1501, floorId: 1801, spaceType: 'Office' },
  { id: 2002, name: 'Server Room', siteId: 1001, buildingId: 1501, floorId: 1802, spaceType: 'Room' },
  { id: 2003, name: 'Line 1', siteId: 1002, buildingId: 1503, floorId: 1803, spaceType: 'Area' },
  { id: 2004, name: 'Pump House', siteId: 1002, spaceType: 'Room' },
  { id: 2005, name: 'Ward B Corridor', siteId: 1003, buildingId: 1504, spaceType: 'Corridor' },
];

const assets: Asset[] = [
  { id: 3001, name: 'AHU-03', category: 'HVAC', spaceId: 2001, spaceName: 'Open Office 3F', qrVal: 'facilio_3001' },
  { id: 3002, name: 'UPS-A2', category: 'Electrical', spaceId: 2002, spaceName: 'Server Room', qrVal: 'facilio_3002' },
  { id: 3003, name: 'Conveyor Motor M-114', category: 'Mechanical', spaceId: 2003, spaceName: 'Line 1', qrVal: 'facilio_3003' },
  { id: 3004, name: 'Feed Pump P-07', category: 'Plumbing', spaceId: 2004, spaceName: 'Pump House', qrVal: 'facilio_3004' },
  { id: 3005, name: 'Isolation Room AHU', category: 'HVAC', spaceId: 2005, spaceName: 'Ward B Corridor', qrVal: 'facilio_3005' },
  // Parented directly to a site — the case that breaks naive "assets by space" scoping.
  { id: 3006, name: 'Campus Chiller CH-01', category: 'HVAC', spaceId: 1001, spaceName: 'Greenfield Business Park', qrVal: 'facilio_3006' },
];

const workOrders = [
  { id: 4001, subject: 'AHU-03 vibration above threshold', status: 'Open', priority: 'High', siteId: 1001, assignedTo: 'Priya', dueDate: '2026-08-15T17:00:00Z', createdTime: '2026-08-12T09:14:00Z' },
  { id: 4002, subject: 'Quarterly UPS battery inspection', status: 'Open', priority: 'Medium', siteId: 1001, assignedTo: 'Arun', dueDate: '2026-08-20T12:00:00Z', createdTime: '2026-08-10T08:00:00Z' },
  { id: 4003, subject: 'Conveyor M-114 belt replacement', status: 'In Progress', priority: 'High', siteId: 1002, assignedTo: 'Raj', dueDate: '2026-08-14T10:00:00Z', createdTime: '2026-08-11T15:40:00Z' },
  { id: 4004, subject: 'Pump P-07 seal leak', status: 'On Hold', priority: 'Low', siteId: 1002, dueDate: '2026-08-28T09:00:00Z', createdTime: '2026-08-09T11:05:00Z' },
  { id: 4005, subject: 'Isolation room pressure check', status: 'Closed', priority: 'High', siteId: 1003, assignedTo: 'Priya', dueDate: '2026-08-08T16:00:00Z', createdTime: '2026-08-05T07:30:00Z' },
];

const LATENCY_MS = 150;

function delay<T>(value: T): Promise<T> {
  return new Promise((resolve) => setTimeout(() => resolve(value), LATENCY_MS));
}

function paginate<T>(rows: T[], query: ListQuery = {}): Promise<PageResult<T>> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 50;
  const start = (page - 1) * pageSize;
  return delay({
    data: rows.slice(start, start + pageSize),
    page,
    pageSize,
    ...(query.includeCount ? { totalCount: rows.length } : {}),
  });
}

/** Mirror of realProvider's scope resolution, over fixtures. */
function scopeSpaceIds(search: AssetSearch): number[] | undefined {
  const scope = search.scope;
  if (!scope || (!scope.siteId && !scope.buildingId && !scope.floorId)) return undefined;

  const ids = new Set<number>();
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

export const mockProvider: DataProvider = {
  async getCurrentUser() {
    return {
      user: { uid: 1, email: 'mock@facilio.com', name: 'Mock User', username: 'mock' },
      org: { orgId: 2915 },
    };
  },
  login() {
    // no-op: mock mode never leaves the page
  },
  logout() {
    // no-op
  },

  listSites: (q) => paginate(sites, q),
  listBuildings: () => delay([...buildings]),
  listFloors: () => delay([...floors]),
  listAllSpaces: () => delay([...spaces]),

  async searchAssets(search: AssetSearch = {}) {
    const ids = scopeSpaceIds(search);
    const text = search.text?.trim().toLowerCase();
    return delay(
      assets.filter((a) => {
        if (ids && !ids.includes(a.spaceId ?? -1)) return false;
        if (text && !a.name.toLowerCase().includes(text)) return false;
        return true;
      }),
    );
  },

  async getAsset(id: number) {
    return delay(assets.find((a) => a.id === id) ?? null);
  },

  listWorkOrders: (q) => paginate(workOrders, q),
};
