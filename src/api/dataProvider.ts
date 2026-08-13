import type {
  Asset,
  AssetSearch,
  Building,
  CurrentUser,
  Floor,
  ListQuery,
  PageResult,
  Site,
  Space,
  WorkOrder,
} from './types';

/**
 * The provider seam. Every screen talks to this interface and nothing else —
 * no `vibe.*` calls, no `executeAction`, no fetch to Facilio outside src/api.
 * (Enforced by src/__tests__/provider-seam.test.ts.)
 *
 * Two implementations:
 *   - mockProvider  — fixtures, zero org access needed  (?mock=1)
 *   - realProvider  — @facilio/vibe-sdk executeAction against facilio-cmms
 */
export interface DataProvider {
  /** null means signed out (the SDK's representation of a 401). May throw on network failure. */
  getCurrentUser(): Promise<CurrentUser | null>;
  /** Redirects the browser to identity-service (no-op in mock). */
  login(): void;
  logout(): void;

  // ---- portfolio reads (Phase 2.1) ----
  listSites(query?: ListQuery): Promise<PageResult<Site>>;
  listBuildings(): Promise<Building[]>;
  listFloors(): Promise<Floor[]>;
  /**
   * Every space in the org with ancestry attached. Fetched whole (paged
   * underneath) because asset scoping needs the full tree; cache behind
   * react-query, don't call in a loop.
   */
  listAllSpaces(): Promise<Space[]>;
  /** Scope-aware asset search — resolves the scope to space ids internally. */
  searchAssets(search?: AssetSearch): Promise<Asset[]>;
  getAsset(id: number): Promise<Asset | null>;

  // ---- work orders (Phase 2.2+, stubs allowed until PR-B2) ----
  listWorkOrders(query?: ListQuery): Promise<PageResult<WorkOrder>>;
}
