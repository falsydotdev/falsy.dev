export interface Feature {
  id: string;
  name: string;
  lat: number; // planetocentric, degrees north
  lon: number; // degrees east, 0 to 360
}

// Planetocentric coordinates, east-positive, matching the MOLA terrain.
export const MARS_FEATURES: Feature[] = [
  { id: 'olympus-mons', name: 'Olympus Mons', lat: 18.65, lon: 226.2 },
  { id: 'valles-marineris', name: 'Valles Marineris', lat: -13.9, lon: 300.8 },
  { id: 'noctis-labyrinthus', name: 'Noctis Labyrinthus', lat: -6.9, lon: 257.8 },
  { id: 'arsia-mons', name: 'Arsia Mons', lat: -8.26, lon: 238.9 },
  { id: 'pavonis-mons', name: 'Pavonis Mons', lat: 1.48, lon: 247.0 },
  { id: 'ascraeus-mons', name: 'Ascraeus Mons', lat: 11.92, lon: 255.92 },
  { id: 'elysium-mons', name: 'Elysium Mons', lat: 25.02, lon: 147.21 },
  { id: 'gale-crater', name: 'Gale Crater', lat: -5.4, lon: 137.8 },
  { id: 'jezero-crater', name: 'Jezero Crater', lat: 18.38, lon: 77.58 },
  { id: 'hellas-planitia', name: 'Hellas Planitia', lat: -42.4, lon: 70.5 },
];
