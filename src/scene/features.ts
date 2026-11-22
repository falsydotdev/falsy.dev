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

// Seas, straits, and salt flats read by their colour, which a higher Sun shows better than long shadows.
const WATER_SUN = { min: 10, max: 40 };

// Geodetic coordinates, east-positive, as the bake reads its rasters. Spread round the globe so that
// one is near the terminator most of the time; places too small to read from 400 km are left out.
export const EARTH_FEATURES: Feature[] = [
  { id: 'strait-of-dover', name: 'Strait of Dover', lat: 51.0, lon: 1.45, sun: WATER_SUN },
  { id: 'mont-blanc', name: 'Mont Blanc', lat: 45.833, lon: 6.865 },
  { id: 'mount-etna', name: 'Mount Etna', lat: 37.751, lon: 14.993 },
  { id: 'namib-sand-sea', name: 'Namib Sand Sea', lat: -24.75, lon: 15.28 },
  { id: 'nile-delta', name: 'Nile Delta', lat: 30.9, lon: 31.0, sun: WATER_SUN },
  { id: 'kilimanjaro', name: 'Mount Kilimanjaro', lat: -3.067, lon: 37.356 },
  { id: 'mount-elbrus', name: 'Mount Elbrus', lat: 43.355, lon: 42.438 },
  { id: 'strait-of-hormuz', name: 'Strait of Hormuz', lat: 26.57, lon: 56.25, sun: WATER_SUN },
  { id: 'k2', name: 'K2', lat: 35.882, lon: 76.513 },
  { id: 'mount-everest', name: 'Mount Everest', lat: 27.988, lon: 86.925 },
  { id: 'lake-baikal', name: 'Lake Baikal', lat: 53.5, lon: 108.0, sun: WATER_SUN },
  { id: 'mount-kinabalu', name: 'Mount Kinabalu', lat: 6.075, lon: 116.558 },
  { id: 'lake-eyre', name: 'Lake Eyre', lat: -28.372, lon: 137.369, sun: WATER_SUN },
  { id: 'mount-fuji', name: 'Mount Fuji', lat: 35.361, lon: 138.727 },
  { id: 'great-barrier-reef', name: 'Great Barrier Reef', lat: -18.286, lon: 147.7, sun: WATER_SUN },
  { id: 'klyuchevskaya-sopka', name: 'Klyuchevskaya Sopka', lat: 56.056, lon: 160.642 },
  { id: 'aoraki-mount-cook', name: 'Aoraki / Mount Cook', lat: -43.595, lon: 170.142 },
  { id: 'mauna-kea', name: 'Mauna Kea', lat: 19.821, lon: 204.532 },
  { id: 'mount-rainier', name: 'Mount Rainier', lat: 46.853, lon: 238.24 },
  { id: 'grand-canyon', name: 'Grand Canyon', lat: 36.1, lon: 247.89 },
  { id: 'popocatepetl', name: 'Popocatépetl', lat: 19.023, lon: 261.372 },
  { id: 'galapagos-islands', name: 'Galápagos Islands', lat: -0.83, lon: 268.87 },
  { id: 'great-bahama-bank', name: 'Great Bahama Bank', lat: 24.046, lon: 282.349, sun: WATER_SUN },
  { id: 'southern-patagonian-ice-field', name: 'Southern Patagonian Ice Field', lat: -49.92, lon: 286.47 },
  { id: 'aconcagua', name: 'Aconcagua', lat: -32.653, lon: 289.989 },
  { id: 'lake-titicaca', name: 'Lake Titicaca', lat: -15.92, lon: 290.66, sun: WATER_SUN },
  { id: 'scoresby-sound', name: 'Scoresby Sound', lat: 70.5, lon: 335.0 },
  { id: 'vatnajokull', name: 'Vatnajökull', lat: 64.4, lon: 343.2 },
  { id: 'richat-structure', name: 'Richat Structure', lat: 21.124, lon: 348.598 },
  { id: 'strait-of-gibraltar', name: 'Strait of Gibraltar', lat: 35.96, lon: 354.4, sun: WATER_SUN },
];
