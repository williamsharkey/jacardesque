// Capture README screenshots (Chrome/Chromium via puppeteer-core).
import puppeteer from "puppeteer-core";
import fs from "fs";
import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outDir = path.join(__dirname, "..", "images");
const base = process.env.SHOT_URL || "http://127.0.0.1:8765/";

const chromeCandidates = [
  process.env.CHROME_PATH,
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome",
  "/Applications/Chromium.app/Contents/MacOS/Chromium",
  "/usr/bin/google-chrome",
  "/usr/bin/chromium",
].filter(Boolean);

function findChrome() {
  for (const p of chromeCandidates) {
    if (fs.existsSync(p)) return p;
  }
  return null;
}

async function main() {
  fs.mkdirSync(outDir, { recursive: true });
  const executablePath = findChrome();
  if (!executablePath) {
    console.error("No Chrome found; writing placeholder SVGs instead.");
    writePlaceholders();
    return;
  }

  const browser = await puppeteer.launch({
    executablePath,
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1280, height: 800, deviceScaleFactor: 2 });

  await page.goto(base, { waitUntil: "networkidle0", timeout: 60000 });
  await page.waitForSelector(".score-canvas", { timeout: 15000 });
  // Unlock audio / settle UI
  await page.click(".score-canvas");
  await sleep(400);

  // Ensure factory sketches loaded
  await page.evaluate(() => {
    // Force jump to insert-hall if present
    const app = window.__jacquard;
    if (!app) return;
    try {
      app.store.load?.("insert-hall");
      app.applyProject?.(app.store.load("insert-hall").project, "insert-hall", {});
    } catch (_) { /* ignore */ }
  });
  await sleep(300);

  // Full plane
  await page.screenshot({
    path: path.join(outDir, "01-plane.png"),
    type: "png",
  });

  // Try navigate to insert-hall via UI
  for (let i = 0; i < 30; i++) {
    const title = await page.evaluate(() => {
      return document.querySelector(".sketch-label")?.textContent || "";
    });
    if (/Insert hall|insert/i.test(title)) break;
    await page.evaluate(() => window.__jacquard?.nextSketch?.());
    await sleep(120);
  }
  await sleep(200);
  await page.screenshot({
    path: path.join(outDir, "02-fx-triggers.png"),
    type: "png",
  });

  // Empty ground shell: click empty cell
  await page.evaluate(() => {
    const app = window.__jacquard;
    const view = app?.ui?.view;
    if (!view) return;
    // Pick a free ground cell far from content
    view.setCursor?.({ x: 20, y: 10 });
  });
  // Simulate pointer down on canvas for ground shell
  const canvas = await page.$(".score-canvas");
  const box = await canvas.boundingBox();
  // click lower-right empty-ish area
  await page.mouse.move(box.x + box.width * 0.75, box.y + box.height * 0.7);
  await page.mouse.down();
  await sleep(200);
  await page.screenshot({
    path: path.join(outDir, "03-ground-shell.png"),
    type: "png",
  });
  await page.mouse.up();

  // Keyboard dock
  await page.screenshot({
    path: path.join(outDir, "04-keyboard.png"),
    clip: {
      x: Math.max(0, box.x + box.width / 2 - 380),
      y: 800 - 140,
      width: 760,
      height: 130,
    },
  }).catch(async () => {
    await page.screenshot({ path: path.join(outDir, "04-keyboard.png") });
  });

  await browser.close();
  console.log("Wrote screenshots to", outDir);
}

function writePlaceholders() {
  const mk = (name, title, lines) => {
    const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" width="960" height="540" viewBox="0 0 960 540">
  <rect width="960" height="540" fill="#16161a"/>
  <text x="48" y="64" fill="#f2f2ee" font-family="system-ui,sans-serif" font-size="28" font-weight="700">${title}</text>
  ${lines.map((l, i) => `<text x="48" y="${110 + i * 36}" fill="#a1a1aa" font-family="system-ui,sans-serif" font-size="18">${l}</text>`).join("\n  ")}
  <text x="48" y="500" fill="#6d6a7a" font-family="system-ui,sans-serif" font-size="14">Open the live demo for a live capture · williamsharkey.github.io/jacardesque</text>
</svg>`;
    fs.writeFileSync(path.join(outDir, name.replace(/\.png$/, ".svg")), svg);
  };
  mk("01-plane.png", "Score plane", [
    "Lanes, CHAN heads, notes, FX pedals, adjacency triggers",
    "Transport · sketch browser · dock keyboard",
  ]);
  mk("02-fx-triggers.png", "Insert FX + triggers", [
    "ON / OFF pads · gold param chips · cyan instrument chips",
    "Pedal dim when off · chip dim when not next to a lane",
  ]);
  mk("03-ground-shell.png", "Empty-cell shell", [
    "Left / up / right → create lane (draw a path)",
    "Down one row → create object (FX / META)",
  ]);
  mk("04-keyboard.png", "Dock keyboard", [
    "Click to audition · drag keys onto steps · ‹ › cycle lanes",
  ]);
  console.log("Wrote SVG placeholders to", outDir);
}

function sleep(ms) {
  return new Promise((r) => setTimeout(r, ms));
}

main().catch((e) => {
  console.error(e);
  writePlaceholders();
  process.exit(0);
});
