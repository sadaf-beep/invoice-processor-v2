import { FormatProfile, DEFAULT_COLUMNS, DEFAULT_INSTRUCTIONS, LICENSE_BASE_COLUMNS, TVA_PO_COLUMNS, TVA_PO_INSTRUCTIONS } from '../types';

const DEFAULT_PROFILE_ID: Record<'asset' | 'license', string> = {
  asset: '__default_asset__',
  license: '__default_license__',
};

function factoryDefault(family: 'asset' | 'license'): FormatProfile {
  return family === 'asset'
    ? { id: DEFAULT_PROFILE_ID.asset, name: 'Default', family: 'asset', columns: DEFAULT_COLUMNS, instructions: DEFAULT_INSTRUCTIONS }
    : { id: DEFAULT_PROFILE_ID.license, name: 'Default', family: 'license', columns: LICENSE_BASE_COLUMNS, instructions: '', licenseLayout: 'base' };
}

// Client formats that ship with the app itself (not something a user has to
// build once and hope survives) — always present in the dropdown, even on a
// fresh browser with empty localStorage. Reserved ids like Default's, but
// distinct named entries rather than the pre-selected baseline. Editing one
// and saving in place persists that edit to localStorage (same mechanism as
// any other profile); resetting clears the override and falls back to this
// factory version.
const BUILTIN_PROFILES: FormatProfile[] = [
  { id: '__builtin_tva_po_processing__', name: 'TVA PO Processing', family: 'asset', columns: TVA_PO_COLUMNS, instructions: TVA_PO_INSTRUCTIONS },
];

// Plain localStorage CRUD — no server, no sync across browsers/devices.
// That's a deliberate v1 tradeoff: it ships without any new infrastructure
// (Supabase is being deferred for now), at the cost of profiles only being
// visible in the browser that created them. Worth moving to a shared store
// later if profiles need to be visible across a team.
const STORAGE_KEY = 'invoiceintel.formatProfiles.v1';

function readAll(): FormatProfile[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    return raw ? JSON.parse(raw) : [];
  } catch {
    return [];
  }
}

function writeAll(profiles: FormatProfile[]): void {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(profiles));
}

export function listProfiles(family: 'asset' | 'license'): FormatProfile[] {
  const saved = readAll();
  const builtins = BUILTIN_PROFILES.filter((p) => p.family === family).map(
    (factory) => saved.find((p) => p.id === factory.id) ?? factory
  );
  const custom = saved
    .filter((p) => p.family === family && !isReservedProfileId(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
  return [...builtins, ...custom];
}

export function saveProfile(profile: FormatProfile): void {
  const all = readAll();
  const idx = all.findIndex((p) => p.id === profile.id);
  if (idx >= 0) all[idx] = profile;
  else all.push(profile);
  writeAll(all);
}

export function deleteProfile(id: string): void {
  writeAll(readAll().filter((p) => p.id !== id));
}

// "Default" is a real, editable profile too (reserved id) — not a hardcoded
// constant — so end users can customize the base fields themselves instead
// of only being able to layer named alternates on top of a fixed baseline.
// Falls back to the original factory columns/instructions until customized.
export function getDefaultProfile(family: 'asset' | 'license'): FormatProfile {
  const saved = readAll().find((p) => p.id === DEFAULT_PROFILE_ID[family]);
  return saved ?? factoryDefault(family);
}

export function saveDefaultProfile(family: 'asset' | 'license', updates: Partial<Pick<FormatProfile, 'columns' | 'instructions' | 'licenseLayout'>>): FormatProfile {
  const profile: FormatProfile = { ...getDefaultProfile(family), ...updates };
  saveProfile(profile);
  return profile;
}

export function resetDefaultProfile(family: 'asset' | 'license'): void {
  deleteProfile(DEFAULT_PROFILE_ID[family]);
}

export function isDefaultProfileId(id: string): boolean {
  return id === DEFAULT_PROFILE_ID.asset || id === DEFAULT_PROFILE_ID.license;
}

export function isBuiltinProfileId(id: string): boolean {
  return BUILTIN_PROFILES.some((p) => p.id === id);
}

// Reserved ids (Default + built-ins) can never actually disappear from the
// dropdown — deleting one just clears any saved customization, so the next
// listProfiles()/getDefaultProfile() call falls back to the factory version.
export function isReservedProfileId(id: string): boolean {
  return isDefaultProfileId(id) || isBuiltinProfileId(id);
}

// Clears a built-in profile's saved customization, reverting it to the
// factory columns/instructions it shipped with (same mechanism as
// resetDefaultProfile — deleteProfile is a no-op if it was never customized).
export function resetBuiltinProfile(id: string): void {
  deleteProfile(id);
}
