import { ZONES, ZONE_ALIASES } from './zones.ts';

export interface Place {
  lat: number; // degrees north
  lon: number; // degrees east, −180 to 180
}

let table: Map<string, Place> | null = null;

function zones() {
  if (table) return table;
  table = new Map();
  for (const line of ZONES.split('\n')) {
    const [name, lat, lon] = line.split(' ');
    table.set(name, { lat: Number(lat) / 10, lon: Number(lon) / 10 });
  }
  for (const line of ZONE_ALIASES.split('\n')) {
    const [name, target] = line.split(' ');
    table.set(name, table.get(target)!);
  }
  return table;
}

/** The principal city of an IANA timezone, or null for UTC, Etc/* zones, and names the table doesn't know. */
export function zoneCoords(name: string | null | undefined): Place | null {
  return (name && zones().get(name)) || null;
}
