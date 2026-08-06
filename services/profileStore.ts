import { FormatProfile, DEFAULT_COLUMNS, DEFAULT_INSTRUCTIONS, LICENSE_BASE_COLUMNS } from '../types';

const DEFAULT_PROFILE_ID: Record<'asset' | 'license', string> = {
  asset: '__default_asset__',
  license: '__default_license__',
};

function factoryDefault(family: 'asset' | 'license'): FormatProfile {
  return family === 'asset'
    ? { id: DEFAULT_PROFILE_ID.asset, name: 'Default', family: 'asset', columns: DEFAULT_COLUMNS, instructions: DEFAULT_INSTRUCTIONS }
    : { id: DEFAULT_PROFILE_ID.license, name: 'Default', family: 'license', columns: LICENSE_BASE_COLUMNS, instructions: '', licenseLayout: 'base' };
}

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
  return readAll()
    .filter((p) => p.family === family && !isDefaultProfileId(p.id))
    .sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base' }));
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
