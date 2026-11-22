// WGS84 Universal Transverse Mercator, Krüger series to fourth order in n (sub-millimetre inside a zone).
const A_AXIS = 6378137;
const F = 1 / 298.257223563;
const K0 = 0.9996;
const N = F / (2 - F);
const A = (A_AXIS / (1 + N)) * (1 + N ** 2 / 4 + N ** 4 / 64);
const ALPHA = [N / 2 - (2 * N ** 2) / 3 + (5 * N ** 3) / 16 + (41 * N ** 4) / 180, (13 * N ** 2) / 48 - (3 * N ** 3) / 5 + (557 * N ** 4) / 1440, (61 * N ** 3) / 240 - (103 * N ** 4) / 140, (49561 * N ** 4) / 161280];
const BETA = [N / 2 - (2 * N ** 2) / 3 + (37 * N ** 3) / 96 - N ** 4 / 360, N ** 2 / 48 + N ** 3 / 15 - (437 * N ** 4) / 1440, (17 * N ** 3) / 480 - (37 * N ** 4) / 840, (4397 * N ** 4) / 161280];
const DELTA = [2 * N - (2 * N ** 2) / 3 - 2 * N ** 3 + (116 * N ** 4) / 45, (7 * N ** 2) / 3 - (8 * N ** 3) / 5 - (227 * N ** 4) / 45, (56 * N ** 3) / 15 - (136 * N ** 4) / 35, (4279 * N ** 4) / 630];
const E_FACTOR = (2 * Math.sqrt(N)) / (1 + N);
const DEG = Math.PI / 180;
const centralMeridian = (zone: number) => (zone * 6 - 183) * DEG;

export function toUtm(latDeg: number, lonDeg: number, zone: number, north = true) {
  const phi = latDeg * DEG;
  const dl = lonDeg * DEG - centralMeridian(zone);
  const s = Math.sin(phi);
  const t = Math.sinh(Math.atanh(s) - E_FACTOR * Math.atanh(E_FACTOR * s));
  const xi = Math.atan2(t, Math.cos(dl));
  const eta = Math.atanh(Math.sin(dl) / Math.sqrt(1 + t * t));
  let x = eta;
  let y = xi;
  ALPHA.forEach((a, i) => {
    const j = 2 * (i + 1);
    x += a * Math.cos(j * xi) * Math.sinh(j * eta);
    y += a * Math.sin(j * xi) * Math.cosh(j * eta);
  });
  return { x: 500000 + K0 * A * x, y: (north ? 0 : 10000000) + K0 * A * y };
}

export function fromUtm(x: number, y: number, zone: number, north = true) {
  const xi = (y - (north ? 0 : 10000000)) / (K0 * A);
  const eta = (x - 500000) / (K0 * A);
  let xp = xi;
  let ep = eta;
  BETA.forEach((b, i) => {
    const j = 2 * (i + 1);
    xp -= b * Math.sin(j * xi) * Math.cosh(j * eta);
    ep -= b * Math.cos(j * xi) * Math.sinh(j * eta);
  });
  const chi = Math.asin(Math.sin(xp) / Math.cosh(ep));
  let phi = chi;
  DELTA.forEach((d, i) => (phi += d * Math.sin(2 * (i + 1) * chi)));
  return { lat: phi / DEG, lon: (centralMeridian(zone) + Math.atan2(Math.sinh(ep), Math.cos(xp))) / DEG };
}
