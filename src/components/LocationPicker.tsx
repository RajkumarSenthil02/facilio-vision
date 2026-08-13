import { useBuildings, useFloors, useSites } from '../api/hooks';
import DsSelect from './DsSelect';
import { useLocationScope } from '../state/LocationContext';

const ALL = '';

/**
 * Site → building → floor cascade on DS selects (standing rule: no native
 * controls). Every level is optional — picking just a site is a valid scope.
 * Selections persist for the session (LocationContext).
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
      <DsSelect
        label="Site"
        value={String(scope.siteId ?? ALL)}
        placeholder="All sites"
        options={[
          { value: ALL, label: 'All sites' },
          ...siteOptions.map((s) => ({ value: String(s.id), label: s.name })),
        ]}
        onChange={(raw) => {
          const id = raw ? Number(raw) : undefined;
          const site = siteOptions.find((s) => s.id === id);
          setLocation({ scope: { siteId: id }, names: { site: site?.name } });
        }}
      />

      <DsSelect
        label="Building"
        value={String(scope.buildingId ?? ALL)}
        placeholder="All buildings"
        disabled={!scope.siteId}
        options={[
          { value: ALL, label: 'All buildings' },
          ...buildingOptions.map((b) => ({ value: String(b.id), label: b.name })),
        ]}
        onChange={(raw) => {
          const id = raw ? Number(raw) : undefined;
          const building = buildingOptions.find((b) => b.id === id);
          setLocation({
            scope: { siteId: scope.siteId, buildingId: id },
            names: { site: names.site, building: building?.name },
          });
        }}
      />

      <DsSelect
        label="Floor"
        value={String(scope.floorId ?? ALL)}
        placeholder="All floors"
        disabled={!scope.buildingId}
        options={[
          { value: ALL, label: 'All floors' },
          ...floorOptions.map((f) => ({ value: String(f.id), label: f.name })),
        ]}
        onChange={(raw) => {
          const id = raw ? Number(raw) : undefined;
          const floor = floorOptions.find((f) => f.id === id);
          setLocation({
            scope: { siteId: scope.siteId, buildingId: scope.buildingId, floorId: id },
            names: { site: names.site, building: names.building, floor: floor?.name },
          });
        }}
      />

      {(scope.siteId || scope.buildingId || scope.floorId) && (
        <button className="link-btn" onClick={clearLocation}>
          Clear
        </button>
      )}
      {loading && <span className="muted small">Loading locations…</span>}
    </div>
  );
}
