// The observer change here (observer-only) next to the one proposed in
// starfederation/datastar#1227 (issue-1227), on this benchmark's data-for
// rows and on that issue's reorder reproduction. Same method as run.mjs:
// builds interleaved, order alternating every round, a fresh page per run.
// Writes results/compare-1227.md.
//
// usage: node compare-1227.mjs [rounds=7]
import { writeFileSync } from "node:fs";
import { chromium } from "playwright";
import { serve } from "./server.mjs";

const ROUNDS = +(process.argv[2] || 7);
const POINTS = [
  ...[100, 400, 800].map(n => [`data-for, ${n} rows x 7 cells`, `bench.html?scenario=rows&rows=${n}&cells=5`]),
  ...[250, 500, 1000].map(n => [`#1227 reorder, ${n} rows x 8 cells`, `reorder.html?rows=${n}`])
];
const BUNDLES = ["baseline", "issue-1227", "observer-only"];

const { url, close } = await serve();
const browser = await chromium.launch();
async function once(page, bundle) {
  const ctx = await browser.newContext();
  const p = await ctx.newPage();
  await p.goto(`${url}/pages/${page}&bundle=${bundle}`);
  await p.waitForFunction(() => window.__result, null, { timeout: 600000, polling: 200 });
  const r = await p.evaluate(() => window.__result);
  await ctx.close();
  return r.ms;
}
const median = xs => [...xs].sort((a, b) => a - b)[xs.length >> 1];
const fmt = n => Math.round(n).toLocaleString("en-US");
const lines = [
  `Time in ms, median (min–max) of ${ROUNDS} runs. data-for: render, as in summary.md. Reorder: one replaceChildren of the same rows, reversed, until the observers have run (the issue's own reproduction).`,
  "",
  "| Scenario | Baseline | #1227's change | This branch's change |",
  "| --- | ---: | ---: | ---: |"
];
try {
  for (const [label, page] of POINTS) {
    await once(page, "baseline"); // warm-up
    const ms = Object.fromEntries(BUNDLES.map(b => [b, []]));
    for (let i = 0; i < ROUNDS; i++)
      for (const b of i % 2 ? [...BUNDLES].reverse() : BUNDLES) ms[b].push(await once(page, b));
    const cell = b => `${fmt(median(ms[b]))} (${fmt(Math.min(...ms[b]))}–${fmt(Math.max(...ms[b]))})`;
    lines.push(`| ${label} | ${BUNDLES.map(cell).join(" | ")} |`);
    console.log(lines.at(-1));
  }
} finally {
  await browser.close();
  close();
}
writeFileSync("results/compare-1227.md", lines.join("\n") + "\n");
