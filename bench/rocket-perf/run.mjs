// Before/after timings: the four builds from build.mjs, interleaved (the
// order alternates every round), a fresh page per run, the median and range
// per point. Writes results/runs.jsonl,
// results/summary.md and results/env.json.
//
// usage: node run.mjs [rounds=5]
import { mkdirSync, writeFileSync, appendFileSync, rmSync } from "node:fs";
import os from "node:os";
import { chromium } from "playwright";
import { serve } from "./server.mjs";

const ROUNDS = +(process.argv[2] || 5);
const POINTS = [
  // [label, query, cpu throttling]
  ...[1, 2, 4, 8, 14, 28].map(d => [`tree, 1,400 items, depth ${d}`, `scenario=tree&nodes=1400&depth=${d}`, 1]),
  ["tree, 1,400 items, depth 14, toggles", "scenario=tree&nodes=1400&depth=14&signals=1", 1],
  ...[100, 200, 400, 800].map(n => [`data-for, ${n} rows x 7 cells`, `scenario=rows&rows=${n}&cells=5`, 1]),
  ["tree, 1,400 items, depth 14", "scenario=tree&nodes=1400&depth=14", 4],
  ["tree, 1,400 items, depth 14, toggles", "scenario=tree&nodes=1400&depth=14&signals=1", 4],
  ["data-for, 400 rows x 7 cells", "scenario=rows&rows=400&cells=5", 4]
];
const BUNDLES = ["baseline", "template-only", "observer-only", "patched"];

mkdirSync("results", { recursive: true });
rmSync("results/runs.jsonl", { force: true });
const { url, close } = await serve();
const browser = await chromium.launch();
writeFileSync(
  "results/env.json",
  JSON.stringify({ date: new Date().toISOString(), chromium: browser.version(), node: process.version, cpu: os.cpus()[0].model, cores: os.cpus().length, platform: `${os.platform()} ${os.release()}`, rounds: ROUNDS }, null, 2) + "\n"
);

async function once(query, bundle, rate) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Emulation.setCPUThrottlingRate", { rate });
  await page.goto(`${url}/pages/bench.html?bundle=${bundle}&${query}`);
  await page.waitForFunction(() => window.__result, null, { timeout: 600000, polling: 500 });
  const r = await page.evaluate(() => window.__result);
  await ctx.close();
  return r;
}

const runs = [];
try {
  for (const [label, query, rate] of POINTS) {
    await once(query, "baseline", 1); // warm-up
    for (let i = 0; i < ROUNDS; i++)
      for (const bundle of i % 2 ? [...BUNDLES].reverse() : BUNDLES) {
        const r = { label, query, cpu: rate, round: i + 1, ...(await once(query, bundle, rate)) };
        runs.push(r);
        appendFileSync("results/runs.jsonl", JSON.stringify(r) + "\n");
        console.log(JSON.stringify(r));
      }
  }
} finally {
  await browser.close();
  close();
}

const med = xs => {
  const s = [...xs].sort((a, b) => a - b);
  return s.length % 2 ? s[s.length >> 1] : (s[s.length / 2 - 1] + s[s.length / 2]) / 2;
};
const fmt = ms => (ms >= 100 ? Math.round(ms).toLocaleString("en-US") : ms.toFixed(1));
const cell = xs => `${fmt(med(xs))} (${fmt(Math.min(...xs))}–${fmt(Math.max(...xs))})`;
let md = `Render time in ms, median (min–max) of ${ROUNDS} runs; speedup = baseline ÷ patched medians.\n\n| Scenario | CPU | Baseline | Fix 1 only (template) | Fix 2 only (observer) | Both (patched) | Speedup |\n| --- | ---: | ---: | ---: | ---: | ---: | ---: |\n`;
for (const [label, query, rate] of POINTS) {
  const by = b => runs.filter(r => r.query === query && r.cpu === rate && r.bundle === b).map(r => r.ms);
  md += `| ${label} | ${rate}x | ${BUNDLES.map(b => cell(by(b))).join(" | ")} | ${(med(by("baseline")) / med(by("patched"))).toFixed(1)}x |\n`;
}
writeFileSync("results/summary.md", md);
console.log("\n" + md);
