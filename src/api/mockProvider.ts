import type { DataProvider } from './dataProvider';
import type { ListQuery, PageResult } from './types';

// Fixtures mirror the shape (and flavor) of the real org's seeded demo data so
// switching ?mock=1 on/off doesn't change what the UI has to handle.

const sites = [
  { id: 1001, name: 'Greenfield Business Park', description: 'Mixed-use office park with two towers and a central admin block.', siteType: 'Office', moduleState: 'active', qrVal: 'facilio_1001' },
  { id: 1002, name: 'Lakeside Manufacturing Plant', description: 'Heavy-industry facility with a production wing and utility block.', siteType: 'Compound', moduleState: 'active', qrVal: 'facilio_1002' },
  { id: 1003, name: 'Harborview Medical Center', description: 'Regional hospital campus, three wards and a diagnostics wing.', siteType: 'Hospital', moduleState: 'active', qrVal: 'facilio_1003' },
];

const spaces = [
  { id: 2001, name: 'Tower A — Floor 3', siteId: 1001, spaceType: 'Floor' },
  { id: 2002, name: 'Tower A — Server Room', siteId: 1001, spaceType: 'Room' },
  { id: 2003, name: 'Production Wing — Line 1', siteId: 1002, spaceType: 'Area' },
  { id: 2004, name: 'Utility Block — Pump House', siteId: 1002, spaceType: 'Room' },
  { id: 2005, name: 'Ward B — Corridor', siteId: 1003, spaceType: 'Corridor' },
];

const assets = [
  { id: 3001, name: 'AHU-03', category: 'HVAC', siteId: 1001, spaceId: 2001, qrVal: 'facilio_3001' },
  { id: 3002, name: 'UPS-A2', category: 'Electrical', siteId: 1001, spaceId: 2002, qrVal: 'facilio_3002' },
  { id: 3003, name: 'Conveyor Motor M-114', category: 'Mechanical', siteId: 1002, spaceId: 2003, qrVal: 'facilio_3003' },
  { id: 3004, name: 'Feed Pump P-07', category: 'Plumbing', siteId: 1002, spaceId: 2004, qrVal: 'facilio_3004' },
  { id: 3005, name: 'Isolation Room AHU', category: 'HVAC', siteId: 1003, spaceId: 2005, qrVal: 'facilio_3005' },
];

const workOrders = [
  { id: 4001, subject: 'AHU-03 vibration above threshold', status: 'Open', priority: 'High', siteId: 1001, assignedTo: 'Priya', dueDate: '2026-08-15T17:00:00Z', createdTime: '2026-08-12T09:14:00Z' },
  { id: 4002, subject: 'Quarterly UPS battery inspection', status: 'Open', priority: 'Medium', siteId: 1001, assignedTo: 'Arun', dueDate: '2026-08-20T12:00:00Z', createdTime: '2026-08-10T08:00:00Z' },
  { id: 4003, subject: 'Conveyor M-114 belt replacement', status: 'In Progress', priority: 'High', siteId: 1002, assignedTo: 'Raj', dueDate: '2026-08-14T10:00:00Z', createdTime: '2026-08-11T15:40:00Z' },
  { id: 4004, subject: 'Pump P-07 seal leak', status: 'On Hold', priority: 'Low', siteId: 1002, dueDate: '2026-08-28T09:00:00Z', createdTime: '2026-08-09T11:05:00Z' },
  { id: 4005, subject: 'Isolation room pressure check', status: 'Closed', priority: 'High', siteId: 1003, assignedTo: 'Priya', dueDate: '2026-08-08T16:00:00Z', createdTime: '2026-08-05T07:30:00Z' },
];

const LATENCY_MS = 150;

function paginate<T>(rows: T[], query: ListQuery = {}): Promise<PageResult<T>> {
  const page = query.page ?? 1;
  const pageSize = query.pageSize ?? 50;
  const start = (page - 1) * pageSize;
  const result: PageResult<T> = {
    data: rows.slice(start, start + pageSize),
    page,
    pageSize,
    ...(query.includeCount ? { totalCount: rows.length } : {}),
  };
  return new Promise((resolve) => setTimeout(() => resolve(result), LATENCY_MS));
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
  listSpaces: (q) => paginate(spaces, q),
  listAssets: (q) => paginate(assets, q),
  listWorkOrders: (q) => paginate(workOrders, q),
};
