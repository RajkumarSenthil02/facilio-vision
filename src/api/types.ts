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

export interface Space {
  id: number;
  name: string;
  siteId?: number;
  spaceType?: string;
}

export interface Asset {
  id: number;
  name: string;
  category?: string;
  siteId?: number;
  spaceId?: number;
  qrVal?: string;
}

export interface WorkOrder {
  id: number;
  subject: string;
  description?: string;
  status?: string;
  priority?: string;
  siteId?: number;
  assignedTo?: string;
  dueDate?: string; // UTC ISO 8601 — convert to local time before rendering
  createdTime?: string;
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
