// A scene kind describes geometry; a category describes what may replace it.
// Keep category separate from room/use role so a similarly sized table, vanity
// or wardrobe cannot be recommended for the wrong piece of furniture.
export const FURNITURE_CATEGORIES = Object.freeze({
  wardrobe: 'Wardrobe',
  table: 'Table',
  desk: 'Desk',
  chair: 'Chair',
  vanity: 'Vanity / dressing table',
  sofa: 'Sofa',
  coffee_table: 'Coffee table',
  low_cabinet: 'Low cabinet',
  bed: 'Bed',
  cabinet: 'Cabinet',
  shelf: 'Shelf',
  locker: 'Locker',
  stool: 'Stool',
  counter: 'Counter',
  phone_booth: 'Phone booth',
  equipment: 'Equipment',
  display: 'Display fixture',
});

const KIND = Object.freeze({
  wardrobe: ['wardrobe', 'wardrobe', 'Wardrobe'],
  table: ['table', 'table', 'Table'],
  diningTable: ['table', 'dining-table', 'Dining table'],
  desk: ['desk', 'workstation', 'Workstation desk'],
  bench2: ['desk', 'workstation', 'Two-person bench'],
  cubicle: ['desk', 'workstation', 'Screened workstation'],
  manager: ['desk', 'workstation', 'Manager desk'],
  chair: ['chair', 'task-chair', 'Task chair'],
  homeChair: ['chair', 'chair', 'Chair'],
  meetingChair: ['chair', 'meeting-chair', 'Meeting chair'],
  diningChair: ['chair', 'dining-chair', 'Dining chair'],
  lactationChair: ['chair', 'lounge-chair', 'Lounge chair'],
  vanity: ['vanity', 'vanity', 'Vanity / dressing table'],
  sofa: ['sofa', 'sofa', 'Sofa'],
  coffeeTable: ['coffee_table', 'coffee-table', 'Coffee table'],
  lowCabinet: ['low_cabinet', 'low-cabinet', 'Low cabinet'],
  bed: ['bed', 'bed', 'Bed'],
  meeting: ['table', 'meeting-table', 'Meeting table'],
  meetingModular: ['table', 'meeting-table', 'Modular meeting table'],
  pantryTable: ['table', 'pantry-table', 'Pantry table'],
  sideTable: ['table', 'side-table', 'Side table'],
  dining4: ['table', 'dining-set', 'Dining set footprint'],
  lounge2: ['sofa', 'lounge-set', 'Lounge set footprint'],
  phone: ['phone_booth', 'phone-booth', 'Phone booth'],
  cabinet: ['cabinet', 'storage-cabinet', 'Storage cabinet'],
  shelf: ['shelf', 'storage-shelf', 'Storage shelf'],
  locker: ['locker', 'storage-locker', 'Locker'],
  barStool: ['stool', 'bar-stool', 'Bar stool'],
  pantryCounter: ['counter', 'pantry-counter', 'Pantry counter'],
  coffeeBar: ['counter', 'coffee-bar', 'Coffee bar'],
  reception: ['counter', 'reception-desk', 'Reception desk'],
  printer: ['equipment', 'printer', 'Printer'],
  serverRack: ['equipment', 'server-rack', 'Server rack'],
  videoScreen: ['equipment', 'video-screen', 'Video screen'],
  displayPlinth: ['display', 'display-plinth', 'Display plinth'],
});

const CATEGORY_ROLE = Object.freeze({
  wardrobe: 'wardrobe', table: 'table', desk: 'desk', chair: 'chair',
  vanity: 'vanity', sofa: 'sofa', coffee_table: 'coffee-table',
  low_cabinet: 'low-cabinet', bed: 'bed', cabinet: 'storage-cabinet',
  shelf: 'storage-shelf', locker: 'storage-locker', stool: 'stool',
  counter: 'counter', phone_booth: 'phone-booth', equipment: 'equipment',
  display: 'display',
});

const ROLE_CATEGORY = Object.freeze(Object.fromEntries([
  ...Object.entries(CATEGORY_ROLE).map(([category, role]) => [role, category]),
  ...Object.values(KIND).map(([category, role]) => [role, category]),
]));
export const FURNITURE_ROLES = Object.freeze(Object.keys(ROLE_CATEGORY));

export function sceneFurnitureType(kind) {
  const known = KIND[kind];
  return known ? { category: known[0], role: known[1], label: known[2] }
    : { category: null, role: `other:${kind}`, label: `Furniture · ${kind}` };
}

export function normalizeFurnitureCategory(value) {
  const key = typeof value === 'string' ? value.trim().toLowerCase().replace(/[ -]/g, '_') : '';
  return Object.hasOwn(FURNITURE_CATEGORIES, key) ? key : null;
}

export function categoryForRole(role) {
  return ROLE_CATEGORY[role] || normalizeFurnitureCategory(role) || null;
}

export function defaultRoleForCategory(category) {
  return CATEGORY_ROLE[category] || null;
}
