// Flame-chart screenshots of profiles/*.trace.json in Chrome DevTools'
// own Performance panel. Chromium serves its bundled DevTools frontend from
// the remote-debugging port; the script opens it, loads each trace through
// the panel's "Load trace…" button and screenshots the result. Writes
// results/flame-*.png.
//
// usage: node screenshots.mjs   (after profile.mjs)
import { spawn } from "node:child_process";
import { mkdirSync, readdirSync } from "node:fs";
import { chromium } from "playwright";
import { serve } from "./server.mjs";

const PORT = 9333;
mkdirSync("results", { recursive: true });
const { url, close } = await serve();
// A Chromium to serve the frontend, and a browser to look at it.
const host = spawn(chromium.executablePath(), ["--headless=new", "--no-sandbox", `--remote-debugging-port=${PORT}`, "--no-first-run", "about:blank"], { stdio: "ignore" });
const browser = await chromium.launch();
try {
  let version;
  for (let i = 0; i < 50 && !version; i++) {
    try {
      version = await (await fetch(`http://127.0.0.1:${PORT}/json/version`)).json();
    } catch {
      await new Promise(r => setTimeout(r, 200));
    }
  }
  if (!version) throw new Error(`Chromium did not open its debugging port ${PORT}`);
  const page = await browser.newPage({ viewport: { width: 1600, height: 1100 }, deviceScaleFactor: 1 });
  for (const file of readdirSync("profiles").filter(f => f.endsWith(".trace.json")).sort()) {
    // The file input behind the panel's own "Load trace…" button.
    await page.goto(`http://127.0.0.1:${PORT}/devtools/devtools_app.html?panel=timeline`);
    await page.getByRole("button", { name: /load trace/i }).waitFor({ timeout: 30000 });
    await page.locator("input[type=file]").setInputFiles(`profiles/${file}`);
    await page.waitForTimeout(10000);
    // Dismiss the first-run shortcuts card and the annotations sidebar.
    // (Escape closes the card; with no card it would open the console drawer.)
    if (await page.getByText("Keyboard shortcuts for flamechart").isVisible()) await page.keyboard.press("Escape");
    const sidebar = page.getByRole("button", { name: /hide sidebar/i });
    if (await sidebar.count()) await sidebar.first().click();
    const drawer = page.getByRole("button", { name: /close drawer/i });
    if (await drawer.count()) await drawer.first().click();
    await page.waitForTimeout(500);
    const name = file.replace(".trace.json", "");
    await page.screenshot({ path: `results/flame-${name}.png` });
    // Bottom-up: self time per function across the whole render.
    await page.getByRole("tab", { name: "Bottom-up" }).click();
    await page.waitForTimeout(1500);
    await page.screenshot({ path: `results/bottom-up-${name}.png` });
    console.log("wrote", `results/{flame,bottom-up}-${name}.png`);
  }
} finally {
  await browser.close();
  host.kill();
  close();
}
