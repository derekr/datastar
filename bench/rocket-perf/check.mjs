// Correctness: each patched build (either fix alone, and both) must render
// the same DOM as the baseline for every benchmark scenario, and keep the composition cases in
// pages/check.js working (including a Node made outside the template, which
// the template change deliberately still scopes).
//
// usage: node check.mjs
import assert from "node:assert/strict";
import { chromium } from "playwright";
import { serve } from "./server.mjs";

const { url, close } = await serve();
const browser = await chromium.launch();
const errors = [];
async function load(path) {
  const page = await browser.newPage();
  page.on("pageerror", e => errors.push(`${path}: ${e.message.split("\n")[0]} ${decodeURIComponent(e.message).match(/"value":"([^"]*)"/)?.[1] ?? ""}`));
  await page.goto(url + path);
  await page.waitForFunction(() => window.__result, null, { timeout: 120000 });
  const r = await page.evaluate(() => ({ ...window.__result, dom: document.body.innerHTML }));
  await page.close();
  return r;
}
let failed = 0;
const ok = (name, fn) => {
  try {
    fn();
    console.log("ok  ", name);
  } catch (e) {
    failed++;
    console.log("FAIL", name, "\n", e.message);
  }
};
try {
  const scenarios = [
    "scenario=tree&nodes=300&depth=1",
    "scenario=tree&nodes=300&depth=14",
    "scenario=tree&nodes=300&depth=14&signals=1",
    "scenario=rows&rows=100&cells=5"
  ];
  const base = {};
  for (const s of scenarios) base[s] = await load(`/pages/bench.html?bundle=baseline&${s}`);
  const { html: ha, ...ra } = await load("/pages/check.html?bundle=baseline");
  for (const v of ["template-only", "observer-only", "patched", "issue-1227"]) {
    for (const s of scenarios) {
      const b = await load(`/pages/bench.html?bundle=${v}&${s}`);
      ok(`${v}: same DOM as baseline, ${s} (${b.elements} elements)`, () => assert.equal(b.dom, base[s].dom));
    }
    const { html: hb, ...rb } = await load(`/pages/check.html?bundle=${v}`);
    ok(`${v}: composition cases give the same results and DOM as baseline`, () => {
      assert.deepEqual({ ...rb, dom: undefined }, { ...ra, dom: undefined });
      assert.equal(hb, ha);
    });
    ok(`${v}: nested templates: local signals bound and reactive`, () => {
      assert.deepEqual(rb.nestedBefore, ["1", "2", "12bx1a"]);
      assert.deepEqual(rb.nestedAfter, ["2", "3"]);
    });
    ok(`${v}: foreign node still scoped and reactive`, () => assert.deepEqual([rb.foreignBefore, rb.foreignAfter], ["5", "6"]));
    ok(`${v}: mixed iterable, both items reactive`, () => assert.deepEqual([rb.mixedBefore, rb.mixedAfter], [["10", "0"], ["11", "1"]]));
    ok(`${v}: svg in html bound`, () => assert.deepEqual([rb.svgBefore, rb.svgAfter], ["3", "4"]));
    ok(`${v}: hosts in the page before define: upgrade, bind, project children`, () => {
      assert.deepEqual(rb.lateAfterDefine, ["A", "B", "G", "G!"]);
    });
    ok(`${v}: re-render morphs and stays bound`, () => {
      assert.deepEqual(rb.rerender, [3, "p,q,r"]);
      assert.equal(rb.rerenderAfter, "1,1,1");
    });
  }
  ok("no page errors", () => assert.deepEqual(errors, []));
} finally {
  await browser.close();
  close();
}
process.exit(failed ? 1 : 0);
