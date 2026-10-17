// Canonical physical-plan input for invalidating product placement checks.
// Names, demo prices, source previews and UI state do not affect geometry.
const byId = (a, b) => String(a.id).localeCompare(String(b.id));
const finite = value => Number.isFinite(value) ? value : null;
const bounds = item => [item.id, item.type, item.kind || null,
  finite(item.x), finite(item.y), finite(item.x2), finite(item.y2),
  item.door?.side || null, finite(item.door?.width), finite(item.plannedSeats),
  item.sizeVariant || null, item.zoneId || null, item.roomId || null,
  finite(item.furnitureShift?.dx), finite(item.furnitureShift?.dy), item.furnitureLayout || null,
  Object.entries(item.furnitureItemOffsets || {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([id, offset]) => [id, finite(offset?.dx), finite(offset?.dy)]),
  Object.entries(item.furnitureItemRotations || {}).sort(([a], [b]) => a.localeCompare(b))
    .map(([id, turn]) => [id, finite(turn)])];
const placed = item => [item.id, item.kind, finite(item.x), finite(item.y),
  finite(item.w), finite(item.h), finite(item.z), finite(item.rot || 0),
  item.islandId || null, finite(item.islandSeats), item.zoneId || null,
  item.roomId || null, item.workAreaId || null, item.linkedTo || null];

export function serializeLayout(project, displayItems = null, profilesByInstanceId = null) {
  if (!project || !Number.isFinite(project.w) || !Number.isFinite(project.h) ||
      !Array.isArray(project.objects) || !Array.isArray(project.furniture) ||
      (displayItems != null && !Array.isArray(displayItems)) ||
      (profilesByInstanceId != null && (typeof profilesByInstanceId !== 'object' || Array.isArray(profilesByInstanceId)))) {
    throw new TypeError('Layout revision needs site dimensions, objects and furniture');
  }
  return JSON.stringify({
    version: 1,
    site: [project.w, project.h, project.site?.confirmed === true],
    rules: [finite(project.rules?.main), finite(project.rules?.minor)],
    objects: [...project.objects].sort(byId).map(bounds),
    furniture: [...project.furniture].sort(byId).map(placed),
    displayItems: displayItems == null ? null : [...displayItems].sort(byId).map(placed),
    clearanceProfiles: profilesByInstanceId == null ? null : Object.keys(profilesByInstanceId).sort().map(id => {
      const profile = profilesByInstanceId[id];
      return [id, profile?.verified === true, profile?.candidateId || null,
        profile?.sourceRef || null, profile?.observedAt || null,
        profile?.reviewedBy || null, profile?.reviewedAt || null,
        profile?.dimensionsMm?.width ?? null, profile?.dimensionsMm?.depth ?? null, profile?.dimensionsMm?.height ?? null,
        profile?.clearanceRects || null];
    }),
    workAreas: [...(project.workAreas || [])].sort(byId).map(bounds),
    catalogVersion: project.catalogVersion || null,
  });
}

export async function computeLayoutRevision(project, displayItems = null, profilesByInstanceId = null) {
  const input = new TextEncoder().encode(serializeLayout(project, displayItems, profilesByInstanceId));
  const hash = await globalThis.crypto.subtle.digest('SHA-256', input);
  return `layout-v1:${Array.from(new Uint8Array(hash), byte => byte.toString(16).padStart(2, '0')).join('')}`;
}
