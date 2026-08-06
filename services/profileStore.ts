import { FormatProfile } from '../types';

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
    .filter((p) => p.family === family)
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
