# Builds og-overlay.svg: the mark and wordmark, with text outlined from the site's fonts.
# Usage: python3 scripts/posters/og-overlay.py node_modules > scripts/posters/og-overlay.svg (needs fonttools, brotli)
import sys
from fontTools.ttLib import TTFont
from fontTools.varLib.instancer import instantiateVariableFont
from fontTools.pens.svgPathPen import SVGPathPen
from fontTools.pens.transformPen import TransformPen

nm = sys.argv[1]
serif = TTFont(f"{nm}/@fontsource/instrument-serif/files/instrument-serif-latin-400-normal.woff2")
mono = instantiateVariableFont(
    TTFont(f"{nm}/@fontsource-variable/martian-mono/files/martian-mono-latin-wght-normal.woff2"), {"wght": 400}
)


def outline(font, text, size, x, y, tracking=0.0):
    s = size / font["head"].unitsPerEm
    glyphs = font.getGlyphSet()
    cmap = font.getBestCmap()
    pen = SVGPathPen(glyphs)
    for ch in text:
        g = cmap[ord(ch)]
        glyphs[g].draw(TransformPen(pen, (s, 0, 0, -s, x, y)))
        x += glyphs[g].width * s + tracking * size
    return pen.getCommands(), x


W, H = 1200, 630
ACCENT, INK, NIGHT = "#e8915f", "#eef1f4", "#2c2424"
left, base, size = 96, 214, 132

# Proportions follow the header: a 22 px mark box beside 26 px type, the disc filling 76% of the box,
# centred on the serif's line box.
hhea = serif["hhea"]
centre = base - (hhea.ascent + hhea.descent) / 2 / serif["head"].unitsPerEm * size
box = 0.846 * size
cx = left + box / 2
r = box / 2 * 0.76

name_d, end = outline(serif, "falsy", size, left + box + 0.2 * size, base)
tld = size / 2
# The mono full stop sits mid-cell, so pull it in to read as one word.
tld_d, _ = outline(mono, ".dev", tld, end - 0.16 * tld, base, tracking=0.04)
who_d, _ = outline(mono, "JUSTIN POWELL", 22, left + box / 2 - r, base + 76, tracking=0.14)

k = r / 38
day = (
    f"M{cx:.2f} {centre - r:.2f}A{r:.2f} {r:.2f} 0 0 1 {cx:.2f} {centre + r:.2f}"
    f"A{11 * k:.2f} {r:.2f} 0 0 1 {cx:.2f} {centre - r:.2f}Z"
)

print(f'''<svg xmlns="http://www.w3.org/2000/svg" width="{W}" height="{H}" viewBox="0 0 {W} {H}">
<circle cx="{cx:.2f}" cy="{centre:.2f}" r="{r:.2f}" fill="{NIGHT}"/>
<path d="{day}" fill="{ACCENT}"/>
<circle cx="{cx:.2f}" cy="{centre:.2f}" r="{r:.2f}" fill="none" stroke="{ACCENT}" stroke-opacity=".4" stroke-width="{3 * k:.2f}"/>
<path d="{name_d}" fill="{INK}"/>
<path d="{tld_d}" fill="{ACCENT}"/>
<path d="{who_d}" fill="{INK}" fill-opacity=".7"/>
</svg>''')
