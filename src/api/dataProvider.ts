import type {
  Asset,
  CurrentUser,
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

  listSites(query?: ListQuery): Promise<PageResult<Site>>;
  listSpaces(query?: ListQuery): Promise<PageResult<Space>>;
  listAssets(query?: ListQuery): Promise<PageResult<Asset>>;
  listWorkOrders(query?: ListQuery): Promise<PageResult<WorkOrder>>;
}
