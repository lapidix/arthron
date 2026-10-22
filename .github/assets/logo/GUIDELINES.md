# arthron — logo guidelines

## The logo

**Idea:** a client stacked from plugins. Two graphite plates are the client; the teal plate between them is a plugin, slid
part-way into the stack. The same teal plate is the crossbar of the **t** in the wordmark.

**Versions:** horizontal lockup (primary) · stacked lockup · symbol · wordmark.

## Files

| Use | Light background | Dark background | One colour |
|---|---|---|---|
| Horizontal lockup (primary) | `arthron-lockup.svg` | `arthron-lockup-dark.svg` | `arthron-lockup-black.svg`, `arthron-lockup-white.svg` |
| Stacked lockup | `arthron-lockup-stacked.svg` | `arthron-lockup-stacked-dark.svg` | — |
| Symbol | `arthron-symbol.svg` | `arthron-symbol-dark.svg` | `arthron-symbol-black.svg`, `arthron-symbol-white.svg` |
| Wordmark | `arthron-wordmark.svg` | `arthron-wordmark-dark.svg` | `arthron-wordmark-black.svg` |
| Favicon (16–32 px) | `arthron-favicon.svg` | `arthron-favicon-dark.svg` | — |
| App / avatar icon | `arthron-app-icon.svg` (rounded tile), `icon-512.png` (full bleed) | | |
| GitHub social preview | `social-preview.png` (1280 × 640) | | |

The SVGs are the masters. The wordmark is drawn as paths, so no font is needed to display it.

## Clear space

Keep free space of at least **one x-height of the wordmark** (the height of the lowercase **a**) on every side. For the
symbol alone, use the thickness of two plates.

## Minimum size

| Version | Screen | Print |
|---|---|---|
| Horizontal lockup | 120 px wide | 30 mm wide |
| Stacked lockup | 72 px wide | 18 mm wide |
| Symbol | 24 px | 8 mm |
| Below 24 px | use the favicon: the symbol's three plates without the edge highlights, scaled to fill the canvas | — |

## Colour

The palette is Tailwind's zinc and teal.

| Role | Name | HEX | RGB |
|---|---|---|---|
| Plates, light background: top / left / right face | zinc 600 / 800 / 950 | `#52525b` / `#27272a` / `#09090b` | 82 82 91 / 39 39 42 / 9 9 11 |
| Plates, dark background: top / left / right face | zinc 100 / 300 / 500 | `#f4f4f5` / `#d4d4d8` / `#71717a` | 244 244 245 / 212 212 216 / 113 113 122 |
| Plugin plate: top / left / right face | teal 400 / 500 / 700 | `#2dd4bf` / `#14b8a6` / `#0f766e` | 45 212 191 / 20 184 166 / 15 118 110 |
| Wordmark on light / dark | zinc 900 / zinc 100 | `#18181b` / `#f4f4f5` | 24 24 27 / 244 244 245 |
| **t** crossbar on light / dark | teal 500 / teal 400 | `#14b8a6` / `#2dd4bf` | 20 184 166 / 45 212 191 |
| Background, dark | zinc 950 | `#09090b` | 9 9 11 |

CMYK and Pantone values are not set yet; proof them before anything goes to print. For one-colour printing,
embroidery or engraving, use the `-black` / `-white` files: the plates are separated by real cut-outs, not by tints.

**Approved pairs:** colour version on white or light grey · dark version on zinc 950 or similar dark grounds · one-colour
black on light grounds · one-colour white on dark grounds or photos.

## Construction

- True isometric (30°). Three plates, each 120 × 120 with a 14 corner radius, 22 thick, 12 apart. The teal plate is slid
  44 along one axis, which reads as down-right on screen.
- One light from the top left: top face lightest, left face middle, right face darkest. A thin highlight runs along the
  front edges of each top face.
- Wordmark: custom geometric lowercase. Round letters overshoot the baseline and x-height, horizontals are 10 % thinner
  than stems, and the ends of the **t** and **r** are cut at 30°, the angle of the symbol.
- Horizontal lockup: the symbol is 168 high on a 256-high canvas, the wordmark's x-height band is centred on it, and the
  gap between them is 0.3 × the symbol height.

## Don'ts

Don't stretch, squash or rotate the logo · don't change the slide direction or the size of the teal plate · don't
recolour outside the palette · don't add shadows, outlines or glows · don't rearrange or resize the parts of a lockup ·
don't use the colour version on a busy background (use one colour) · don't retype the wordmark in a font.
