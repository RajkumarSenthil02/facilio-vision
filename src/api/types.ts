// Domain types for the provider seam. Field names mirror the real
// facilio-cmms action responses (verified via `facilio connections execute`)
// so the mock and real providers are interchangeable.

export interface Site {
  id: number;
  name: string;
  description?: string;
  siteType?: string;
  moduleState?: string;
  qrVal?: string;
}

export interface Building {
  id: number;
  name: string;
  siteId?: number;
}

export interface Floor {
  id: number;
  name: string;
  buildingId?: number;
  siteId?: number;
}

/**
 * A BaseSpace row with its ancestry flattened. Assets attach to the location
 * tree through `space` ONLY — an asset's space pointer can target any level
 * (site, building, floor, or space), so scope resolution needs all of these.
 */
export interface Space {
  id: number;
  name: string;
  siteId?: number;
  buildingId?: number;
  floorId?: number;
  spaceType?: string;
}

export interface Asset {
  id: number;
  name: string;
  category?: string;
  /** The BaseSpace the asset parents to — may be a site/building/floor id. */
  spaceId?: number;
  spaceName?: string;
  qrVal?: string;
}

export interface WorkOrder {
  id: number;
  subject: string;
  description?: string;
  /** moduleState label, e.g. "Open" / "Closed" — comes back as a plain string. */
  status?: string;
  priority?: string;
  /** The Space/Asset lookup ("resource") this WO is raised against. */
  resourceId?: number;
  resourceName?: string;
  assignedTo?: string;
  dueDate?: string; // UTC ISO 8601 — convert to local time before rendering
  createdTime?: string;
}

/** One entry of the status catalogue (workorder.moduleState allowed_values). */
export interface WorkOrderStatus {
  label: string;
  /** Internal status name — what change-work-order-status expects. */
  value: string;
}

export interface WorkOrderTask {
  id: number;
  subject: string;
  closed: boolean;
}

export interface WorkOrderDraft {
  subject: string;
  description?: string;
  /** Plain numeric ids — the script lane takes them as-is. */
  siteId?: number;
  resourceId?: number;
}

/** Where the user is working. Narrower fields win (floor > building > site). */
export interface LocationScope {
  siteId?: number;
  buildingId?: number;
  floorId?: number;
}

export interface AssetSearch {
  /** Case-insensitive name match (server-side `name(contains)=`). */
  text?: string;
  scope?: LocationScope;
}

/** Query params shared by every facilio-cmms list action (verified schema). */
export interface ListQuery {
  page?: number;
  pageSize?: number; // max 200
  /** `field(operator)=value` pairs joined by `&`, e.g. `name(contains)=Tower` */
  filters?: string;
  sortBy?: string;
  sortOrder?: 'asc' | 'desc';
  /** Comma-separated field projection */
  select?: string;
  /** Comma-separated lookup fields to hydrate (max 5) */
  expand?: string;
  includeCount?: boolean;
}

export interface PageResult<T> {
  data: T[];
  page: number;
  pageSize: number;
  /** Present only when the query asked for includeCount */
  totalCount?: number;
}

/** Shape of vibe.getCurrentUser() — fields are nested, there is no me.email. */
export interface CurrentUser {
  user: {
    uid: number;
    email: string;
    name: string;
    username: string;
  };
  org: {
    orgId: number;
  };
}
