// Renders the Fe-male icon (iron's periodic-table tile over the word "male")
// as flat PNGs. Run with: npm run icons
import { Resvg } from "@resvg/resvg-js";
import { writeFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const PAPER = "#fff8ef";
const PINK = "#f5aec6";
const ACCENT = "#b00075";
const INK = "#3d1e22";

const TILE = { x: 88, y: 22, size: 336 };
const MALE_BASELINE = 490;
const MALE_TRACKING = -0.028; // letter-spacing, in em

const FONT = {
  loadSystemFonts: false,
  fontFiles: ["ArchivoBlack-Regular.ttf", "SpaceMono-Bold.ttf"].map((f) => fileURLToPath(new URL(`fonts/${f}`, import.meta.url))),
  defaultFontFamily: "Archivo Black",
};

const maleText = (x, size) =>
  `<text x="${x}" y="${MALE_BASELINE}" font-family="Archivo Black" font-size="${size}" letter-spacing="${MALE_TRACKING * size}" fill="${INK}">male</text>`;

// Size and place "male" so its inked edges line up exactly with the tile's
// left and right edges (measured from the glyph outlines, not the font's
// advance widths, which include side bearings).
function fitMale() {
  const probe = 100;
  const bbox = new Resvg(
    `<svg xmlns="http://www.w3.org/2000/svg" width="2000" height="600">${maleText(0, probe)}</svg>`,
    { font: FONT },
  ).getBBox();
  const size = (probe * TILE.size) / bbox.width;
  const x = TILE.x - (bbox.x * size) / probe;
  return { size, x };
}
const male = fitMale();

// `scale` shrinks the artwork toward the centre (maskable icons need a safe zone).
function svg(scale = 1) {
  const t = `translate(256 256) scale(${scale}) translate(-256 -256)`;
  return `<svg xmlns="http://www.w3.org/2000/svg" width="512" height="512" viewBox="0 0 512 512">
  <rect width="512" height="512" fill="${PINK}"/>
  <g transform="${t}">
    <rect x="${TILE.x}" y="${TILE.y}" width="${TILE.size}" height="${TILE.size}" rx="36" fill="${ACCENT}"/>
    <text x="120" y="90" font-family="Space Mono" font-weight="bold" font-size="42" fill="${PAPER}">26</text>
    <text x="256" y="298" text-anchor="middle" font-family="Archivo Black" font-size="226" letter-spacing="-6" fill="${PAPER}">Fe</text>
    ${maleText(male.x, male.size)}
  </g>
</svg>`;
}

function render(markup, size, file) {
  const png = new Resvg(markup, { fitTo: { mode: "width", value: size }, font: FONT }).render().asPng();
  writeFileSync(new URL(`../public/icons/${file}`, import.meta.url), png);
  console.log("wrote", file);
}

// Phones round the corners and may overlay a browser badge, so the artwork
// sits inside a generous pink margin. Maskable icons get cropped to a circle
// (safe zone: 80% diameter), so they get even more.
const PADDED = 0.72;
const MASKABLE = 0.62;

render(svg(PADDED), 1024, "icon-1024.png");
render(svg(PADDED), 512, "icon-512.png");
render(svg(PADDED), 192, "icon-192.png");
render(svg(PADDED), 180, "apple-touch-icon.png");
render(svg(MASKABLE), 512, "maskable-512.png");
render(svg(MASKABLE), 192, "maskable-192.png");
