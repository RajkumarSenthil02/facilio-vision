import { useBuildings, useFloors, useSites } from '../api/hooks';
import { useLocationScope } from '../state/LocationContext';

/**
 * Site → building → floor cascade. Every level is optional — picking just a
 * site is a valid scope. Selections persist for the session (LocationContext).
 */
export default function LocationPicker() {
  const { scope, names, setLocation, clearLocation } = useLocationScope();
  const sites = useSites();
  const buildings = useBuildings();
  const floors = useFloors();

  const siteOptions = sites.data ?? [];
  const buildingOptions = (buildings.data ?? []).filter(
    (b) => !scope.siteId || b.siteId === scope.siteId,
  );
  const floorOptions = (floors.data ?? []).filter(
    (f) => !scope.buildingId || f.buildingId === scope.buildingId,
  );

  const loading = sites.isLoading || buildings.isLoading || floors.isLoading;

  return (
    <div className="location-picker">
      <label>
        <span className="muted small">Site</span>
        <select
          value={scope.siteId ?? ''}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : undefined;
            const site = siteOptions.find((s) => s.id === id);
            setLocation({
              scope: { siteId: id },
              names: { site: site?.name },
            });
          }}
        >
          <option value="">All sites</option>
          {siteOptions.map((s) => (
            <option key={s.id} value={s.id}>
              {s.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="muted small">Building</span>
        <select
          value={scope.buildingId ?? ''}
          disabled={!scope.siteId}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : undefined;
            const building = buildingOptions.find((b) => b.id === id);
            setLocation({
              scope: { siteId: scope.siteId, buildingId: id },
              names: { site: names.site, building: building?.name },
            });
          }}
        >
          <option value="">All buildings</option>
          {buildingOptions.map((b) => (
            <option key={b.id} value={b.id}>
              {b.name}
            </option>
          ))}
        </select>
      </label>

      <label>
        <span className="muted small">Floor</span>
        <select
          value={scope.floorId ?? ''}
          disabled={!scope.buildingId}
          onChange={(e) => {
            const id = e.target.value ? Number(e.target.value) : undefined;
            const floor = floorOptions.find((f) => f.id === id);
            setLocation({
              scope: { siteId: scope.siteId, buildingId: scope.buildingId, floorId: id },
              names: { site: names.site, building: names.building, floor: floor?.name },
            });
          }}
        >
          <option value="">All floors</option>
          {floorOptions.map((f) => (
            <option key={f.id} value={f.id}>
              {f.name}
            </option>
          ))}
        </select>
      </label>

      {(scope.siteId || scope.buildingId || scope.floorId) && (
        <button className="link-btn" onClick={clearLocation}>
          Clear
        </button>
      )}
      {loading && <span className="muted small">Loading locations…</span>}
    </div>
  );
}
