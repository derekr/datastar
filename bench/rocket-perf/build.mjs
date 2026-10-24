// Builds the Rocket bundle five ways with the same esbuild settings, each
// minified (what the benchmark measures) and unminified (so profiles name
// functions):
//   baseline       library/src at BASE_REF (default origin/develop: Datastar
//                  v1.0.4 + Rocket beta.2)
//   template-only  baseline + this tree's rocket/template.ts (fix 1 alone)
//   observer-only  baseline + this tree's rocket/runtime.ts (fix 2 alone)
//   patched        this working tree (both fixes)
//   issue-1227     baseline + patches/issue-1227.patch, the observer fix
//                  proposed in starfederation/datastar#1227, for comparison
//
// usage: node build.mjs [BASE_REF]
import { execSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { build } from "esbuild";

const here = path.dirname(fileURLToPath(import.meta.url));
const repo = path.resolve(here, "../..");
const base = process.argv[2] || "origin/develop";
const out = path.join(here, "dist");
mkdirSync(out, { recursive: true });

const tmp = mkdtempSync(path.join(tmpdir(), "rocket-baseline-"));
execSync(`git archive ${base} library | tar -x -C ${tmp}`, { cwd: repo, stdio: "inherit" });

// Each fix is confined to one file, so a fix alone is the baseline with
// that one file from this tree.
const withFile = (name, file) => {
  const dir = path.join(tmp, name);
  cpSync(path.join(tmp, "library"), dir, { recursive: true });
  cpSync(path.join(repo, "library", file), path.join(dir, file));
  return dir;
};
const withPatch = (name, patch) => {
  const dir = path.join(tmp, name);
  cpSync(path.join(tmp, "library"), dir, { recursive: true });
  execSync(`patch -s -p2 < ${path.join(here, "patches", patch)}`, { cwd: dir, stdio: "inherit" });
  return dir;
};
const variants = {
  baseline: path.join(tmp, "library"),
  "template-only": withFile("template-only", "src/rocket/template.ts"),
  "observer-only": withFile("observer-only", "src/rocket/runtime.ts"),
  patched: path.join(repo, "library"),
  "issue-1227": withPatch("issue-1227", "issue-1227.patch")
};
for (const [name, lib] of Object.entries(variants))
  for (const minify of [true, false])
    await build({
      entryPoints: [path.join(lib, "src/bundles/datastar-rocket.ts")],
      tsconfig: path.join(lib, "tsconfig.json"),
      bundle: true,
      format: "esm",
      minify,
      define: { ALIAS: "null" },
      outfile: path.join(out, `${name}${minify ? "" : ".dev"}.js`),
      logLevel: "warning"
    });
rmSync(tmp, { recursive: true, force: true });
console.log(`built dist/{baseline,template-only,observer-only,patched,issue-1227}{,.dev}.js (baseline = ${base} ${execSync(`git rev-parse --short ${base}`, { cwd: repo }).toString().trim()})`);
