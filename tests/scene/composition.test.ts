import { describe, expect, it } from 'vitest';
import { keepsClear, limbHeightAt, limbOnScreen, solveFraming } from '../../src/scene/composition';

const BODY = { radiusKm: 3396.19, altKm: 200, fovDeg: 50 };

// The home hero (label, name, and lede) and header, as laid out at each viewport size.
function page(w: number, h: number) {
  const gutter = Math.min(96, Math.max(16, w * 0.06));
  const top = 64 + Math.min(140, Math.max(48, h * 0.12));
  return {
    aspect: w / h,
    text: { left: gutter / w, right: Math.min(gutter + 704, w - gutter) / w, top: top / h, bottom: (top + 260) / h },
    headerBottom: 64 / h,
  };
}

const VIEWPORTS: [number, number][] = [
  [1440, 900],
  [1920, 1080],
  [2560, 1080],
  [1280, 720],
  [1024, 768],
  [768, 1024],
];

describe('framing', () => {
  it('banks right to drop the horizon on the left', () => {
    const limb = limbOnScreen({ ...BODY, aspect: 1.6 }, { tiltDeg: 12, rollDeg: 10 });
    expect(limbHeightAt(limb, 0.05)).toBeGreaterThan(limbHeightAt(limb, 0.95) + 0.1);
  });

  it.each(VIEWPORTS)('keeps the limb glow out of the text and header at %ix%i', (w, h) => {
    const p = page(w, h);
    const framing = solveFraming({ ...BODY, ...p });
    const limb = limbOnScreen({ ...BODY, aspect: p.aspect }, framing);
    expect(keepsClear(limb, p.text, p.headerBottom)).toBe(true);
    expect(framing.rollDeg).toBeGreaterThanOrEqual(0);
    // The planet still fills the open side of the page.
    expect(limbHeightAt(limb, 1)).toBeLessThan(0.75);
  });

  it('rises toward the upper right on a laptop screen', () => {
    const p = page(1440, 900);
    const limb = limbOnScreen({ ...BODY, aspect: p.aspect }, solveFraming({ ...BODY, ...p }));
    expect(limbHeightAt(limb, 0.1)).toBeGreaterThan(limbHeightAt(limb, 0.9));
  });
});
