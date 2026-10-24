// Where the time goes, before and after: a V8 CPU profile of one render per
// scenario on the unminified builds (so functions keep their names), and a
// Chrome performance trace of the same render that DevTools' Performance
// panel opens (profiles/*.trace.json, also what screenshots.mjs loads).
// Writes results/profile.md.
//
// usage: node profile.mjs
import { mkdirSync, writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { serve } from "./server.mjs";

const SCENARIOS = [
  ["tree", "tree, 1,400 items, depth 14", "scenario=tree&nodes=1400&depth=14"],
  ["rows", "data-for, 400 rows x 7 cells", "scenario=rows&rows=400&cells=5"]
];
// The functions the two changes are about, plus their callers.
const WATCH = ["hypertext", "resolveMarkers", "rewriteDataAttributes", "subtreeUsesScopedSignals", "#rewriteScopedDataAttributes", "markPendingRocketHosts", "initRocketFors", "#render", "apply"];

mkdirSync("profiles", { recursive: true });
mkdirSync("results", { recursive: true });
const { url, close } = await serve();
const browser = await chromium.launch();

async function profile(query, bundle) {
  const ctx = await browser.newContext();
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await cdp.send("Profiler.enable");
  await cdp.send("Profiler.setSamplingInterval", { interval: 50 });
  await page.goto(`${url}/pages/bench.html?bundle=${bundle}.dev&${query}&wait=1`);
  await page.waitForFunction(() => window.__go);
  await cdp.send("Profiler.start");
  await page.evaluate(() => window.__go());
  await page.waitForFunction(() => window.__result, null, { timeout: 600000, polling: 200 });
  const { profile } = await cdp.send("Profiler.stop");
  const result = await page.evaluate(() => window.__result);
  await ctx.close();
  const byId = new Map(profile.nodes.map(n => [n.id, n]));
  const parent = new Map();
  for (const n of profile.nodes) for (const c of n.children || []) parent.set(c, n.id);
  const sampled = {};
  profile.samples.forEach((id, i) => (sampled[id] = (sampled[id] || 0) + (profile.timeDeltas[i] || 0)));
  const name = n => n.callFrame.functionName || "(anonymous)";
  const self = {}, incl = {};
  for (const [id, us] of Object.entries(sampled)) {
    const n = byId.get(+id);
    if (!/^\(/.test(name(n))) self[name(n)] = (self[name(n)] || 0) + us / 1000;
    const seen = new Set();
    for (let cur = +id; cur != null; cur = parent.get(cur)) {
      const k = name(byId.get(cur));
      if (!seen.has(k)) (incl[k] = (incl[k] || 0) + us / 1000), seen.add(k);
    }
  }
  return { result, self, incl };
}

async function trace(query, bundle, file) {
  const ctx = await browser.newContext({ viewport: { width: 1280, height: 800 } });
  const page = await ctx.newPage();
  const cdp = await ctx.newCDPSession(page);
  await page.goto(`${url}/pages/bench.html?bundle=${bundle}.dev&${query}&wait=1`);
  await page.waitForFunction(() => window.__go);
  const events = [];
  cdp.on("Tracing.dataCollected", e => events.push(...e.value));
  const done = new Promise(r => cdp.once("Tracing.tracingComplete", r));
  await cdp.send("Tracing.start", {
    categories: "devtools.timeline,disabled-by-default-devtools.timeline,disabled-by-default-devtools.timeline.frame,v8.execute,disabled-by-default-v8.cpu_profiler,blink.user_timing,loading,toplevel",
    transferMode: "ReportEvents"
  });
  await page.evaluate(() => window.__go());
  await page.waitForFunction(() => window.__result, null, { timeout: 600000, polling: 200 });
  await page.waitForTimeout(200);
  await cdp.send("Tracing.end");
  await done;
  await ctx.close();
  writeFileSync(file, JSON.stringify({ traceEvents: events }));
}

let md = "";
try {
  for (const [key, label, query] of SCENARIOS) {
    const p = {};
    for (const bundle of ["baseline", "patched"]) {
      p[bundle] = await profile(query, bundle);
      await trace(query, bundle, `profiles/${key}-${bundle}.trace.json`);
    }
    md += `### ${label}\n\nOne render, unthrottled, unminified builds (render time ${p.baseline.result.ms} ms baseline, ${p.patched.result.ms} ms patched). Total time (ms) in each function and everything it calls:\n\n| Function | Baseline | Patched |\n| --- | ---: | ---: |\n`;
    for (const f of WATCH) {
      const [a, b] = [p.baseline.incl[f] || 0, p.patched.incl[f] || 0];
      if (a > 1 || b > 1) md += `| \`${f}\` | ${a.toFixed(0)} | ${b.toFixed(0)} |\n`;
    }
    md += `\nTop self time (ms), baseline:\n\n| Function | Baseline | Patched |\n| --- | ---: | ---: |\n`;
    for (const [f, ms] of Object.entries(p.baseline.self).sort((a, b) => b[1] - a[1]).slice(0, 10)) md += `| \`${f}\` | ${ms.toFixed(0)} | ${(p.patched.self[f] || 0).toFixed(0)} |\n`;
    md += "\n";
  }
} finally {
  await browser.close();
  close();
}
writeFileSync("results/profile.md", md);
console.log(md);
