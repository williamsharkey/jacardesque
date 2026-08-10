#!/usr/bin/env node
// Headless Chrome smoke test via puppeteer-core.

import { createServer } from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
// Resolve from repo root node_modules
const puppeteer = require(join(
  dirname(fileURLToPath(import.meta.url)),
  "../../node_modules/puppeteer-core",
));

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, "..");
const chrome =
  process.env.CHROME ||
  "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome";

const mime = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".mjs": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".md": "text/plain; charset=utf-8",
};

function startServer() {
  return new Promise((resolve) => {
    const server = createServer(async (req, res) => {
      try {
        let path = decodeURIComponent(req.url.split("?")[0]);
        if (path === "/") path = "/index.html";
        const file = join(root, path);
        if (!file.startsWith(root)) {
          res.writeHead(403);
          res.end();
          return;
        }
        const data = await readFile(file);
        res.writeHead(200, { "Content-Type": mime[extname(file)] || "application/octet-stream" });
        res.end(data);
      } catch {
        res.writeHead(404);
        res.end("not found");
      }
    });
    server.listen(0, "127.0.0.1", () => resolve({ server, port: server.address().port }));
  });
}

async function main() {
  const { server, port } = await startServer();
  const base = `http://127.0.0.1:${port}`;
  const browser = await puppeteer.launch({
    executablePath: chrome,
    headless: true,
    args: [
      "--no-sandbox",
      "--disable-gpu",
      "--autoplay-policy=no-user-gesture-required",
    ],
  });

  const page = await browser.newPage();
  const errors = [];
  page.on("pageerror", (e) => errors.push(String(e)));
  page.on("console", (msg) => {
    if (msg.type() === "error") errors.push("console: " + msg.text());
  });

  try {
    // --- App page ---
    await page.goto(base + "/", { waitUntil: "networkidle0", timeout: 15000 });
    await page.waitForSelector(".score-canvas", { timeout: 10000 });
    await page.waitForSelector(".transport", { timeout: 5000 });

    const play = await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => /Play|Stop/.test(x.textContent));
      return b ? b.textContent : null;
    });
    if (play !== "Play") throw new Error("expected Play button, got " + play);

    // Click Play (user gesture for audio)
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent === "Play");
      b.click();
    });

    await page.waitForFunction(
      () => [...document.querySelectorAll("button")].some((b) => b.textContent === "Stop"),
      { timeout: 5000 },
    );

    // Let sequencer schedule a bit
    await new Promise((r) => setTimeout(r, 1500));

    const status = await page.evaluate(() => {
      const app = window.__jacquard;
      return {
        text: document.querySelector(".status")?.textContent || "",
        playing: [...document.querySelectorAll("button")].some((b) => b.textContent === "Stop"),
        panels: document.querySelectorAll(".panel").length,
        title: document.querySelector(".panel-title")?.textContent,
        seqPlaying: !!app?.sequencer?.isPlaying,
        runners: app?.sequencer?.runners?.length ?? 0,
        sample: app?.audio?.pollSample?.() ?? -1,
        audioReady: !!app?.audio?.ready,
        activeVoices: app?.audio?.status?.activeVoices ?? -1,
        queued: app?.audio?.status?.queuedNotes ?? -1,
      };
    });

    if (!status.playing || !status.seqPlaying) {
      throw new Error("not playing after click: " + JSON.stringify(status));
    }
    if (status.runners < 1) throw new Error("no runners: " + JSON.stringify(status));
    if (status.panels < 1) throw new Error("no panels");
    // After 1.5s of the sample score there should be audible activity.
    if (status.activeVoices < 1 && status.queued < 1) {
      // One more second — first buffer may have just drained
      await new Promise((r) => setTimeout(r, 1000));
      const again = await page.evaluate(() => ({
        active: window.__jacquard.audio.status.activeVoices,
        queued: window.__jacquard.audio.status.queuedNotes,
        sample: window.__jacquard.audio.pollSample(),
        next: window.__jacquard.sequencer.runners.map((r) => r.nextSample),
      }));
      if (again.active < 1 && again.queued < 1) {
        throw new Error("no audio activity while playing: " + JSON.stringify({ status, again }));
      }
    }
    // Cursor move + double click note place
    await page.click(".score-canvas");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowRight");
    await page.keyboard.press("ArrowDown");

    // Select CHAN head at sample score (1,3) roughly - click cell for CHAN of main lane
    // Use tile panel: move to free rail and place note via button
    await page.evaluate(() => {
      const noteBtn = [...document.querySelectorAll("button")].find((b) => b.textContent === "NOTE");
      if (noteBtn) noteBtn.click();
      else {
        // If not placeable, click New lane or just skip
        const nl = [...document.querySelectorAll("button")].find((b) => b.textContent === "New lane");
        if (nl) nl.click();
      }
    });

    // Stop
    await page.evaluate(() => {
      const b = [...document.querySelectorAll("button")].find((x) => x.textContent === "Stop");
      b?.click();
    });
    await page.waitForFunction(
      () => [...document.querySelectorAll("button")].some((b) => b.textContent === "Play"),
      { timeout: 3000 },
    );

    // --- Selftest page (audio worklet path) ---
    await page.goto(base + "/selftest.html", { waitUntil: "networkidle0", timeout: 15000 });
    await page.waitForFunction(
      () => document.title === "PASS" || document.title.startsWith("FAIL"),
      { timeout: 15000 },
    );
    const self = await page.evaluate(() => ({
      title: document.title,
      log: document.getElementById("log")?.textContent || "",
    }));

    if (self.title !== "PASS") {
      throw new Error("selftest " + self.title + "\n" + self.log);
    }

    console.log("browser-smoke: PASS");
    console.log("  app status:", status.text);
    console.log("  selftest:", self.log.split("\n").filter(Boolean).slice(-6).join(" | "));
    if (errors.length) console.log("  page errors (non-fatal):", errors.slice(0, 5));
  } finally {
    await browser.close();
    server.close();
  }
}

main().catch((e) => {
  console.error("browser-smoke: FAIL\n", e);
  process.exit(1);
});
