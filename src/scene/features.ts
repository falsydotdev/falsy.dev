export interface Feature {
  id: string;
  name: string;
  lat: number; // planetocentric, degrees north
  lon: number; // degrees east, 0 to 360
  // Sun elevation range, in degrees, that a flyover waits for; the default is a low morning or evening Sun.
  sun?: { min: number; max: number };
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

// Selenographic coordinates in the Mean Earth frame that LOLA and LROC maps use, east-positive.
export const MOON_FEATURES: Feature[] = [
  { id: 'tycho', name: 'Tycho', lat: -43.31, lon: 348.64 },
  { id: 'copernicus', name: 'Copernicus', lat: 9.62, lon: 339.92 },
  { id: 'aristarchus', name: 'Aristarchus', lat: 23.73, lon: 312.51 },
  { id: 'plato', name: 'Plato', lat: 51.62, lon: 350.62 },
  { id: 'clavius', name: 'Clavius', lat: -58.62, lon: 345.27 },
  { id: 'theophilus', name: 'Theophilus', lat: -11.45, lon: 26.28 },
  { id: 'tranquility-base', name: 'Tranquility Base', lat: 0.67, lon: 23.47 },
  { id: 'mons-huygens', name: 'Mons Huygens', lat: 19.92, lon: 357.14 },
  { id: 'mare-orientale', name: 'Mare Orientale', lat: -19.87, lon: 265.33 },
  { id: 'tsiolkovskiy', name: 'Tsiolkovskiy', lat: -20.4, lon: 129.1 },
  { id: 'daedalus', name: 'Daedalus', lat: -5.9, lon: 179.4 },
];
