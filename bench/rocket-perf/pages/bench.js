// One scenario per page load, picked by the query string:
//
//   ?bundle=baseline|patched[.dev]  which Rocket build to load (dist/)
//   &scenario=tree   &nodes=1400&depth=14&signals=0|1
//     A Rocket component renders a tree of `nodes` items, `depth` levels
//     deep, each item its own `html` call composed into its parent's (the
//     shape of a threaded comment page). signals=1 gives every item with
//     children a Rocket-local signal and three bindings, as a [-] toggle.
//   &scenario=rows   &rows=400&cells=5
//     A Rocket component renders `rows` rows with <template data-for>, each
//     with a nested data-for of `cells` cells bound to the row (the shape of
//     a live table).
//
// The page times from just before the host element is inserted until the
// first animation frame after every item is in the DOM, and publishes the
// result as window.__result.
const q = new URLSearchParams(location.search);
const bundle = q.get("bundle") || "baseline";
const scenario = q.get("scenario") || "tree";
const { rocket } = await import(`/dist/${bundle}.js`);

function makeTree(nodes, depth) {
  // `nodes` items as chains of `depth`, so every item sits at a known level
  // and total work is the same at every depth.
  const roots = [];
  let id = 0;
  while (id < nodes) {
    let parent = null;
    for (let d = 0; d < depth && id < nodes; d++) {
      const item = { id: id++, user: `user${id % 97}`, text: `Comment ${id}: some text that a comment would carry.`, children: [] };
      if (parent) parent.children.push(item);
      else roots.push(item);
      parent = item;
    }
  }
  return roots;
}

let expected;
let count;
if (scenario === "tree") {
  const nodes = +(q.get("nodes") || 1400);
  const depth = +(q.get("depth") || 14);
  const signals = q.get("signals") === "1";
  const roots = makeTree(nodes, depth);
  const item = (html, c) =>
    html`<li class="comment"><div class="by"><a href="/users/${c.user}">${c.user}</a> 4 years ago</div><div class="text">${c.text}</div>${
      c.children.length ? (signals ? toggle(html, c) : html`<ul class="children">${c.children.map(k => item(html, k))}</ul>`) : null
    }</li>`;
  const toggle = (html, c) =>
    html`<div class="toggle" data-class:open="$$o${c.id}"><a data-on:click="$$o${c.id} = !$$o${c.id}" data-text="$$o${c.id} ? '[-]' : '[+]'">[-]</a></div><ul class="children" data-show="$$o${c.id}">${c.children.map(k => item(html, k))}</ul>`;
  rocket("bench-tree", {
    mode: "light",
    setup({ $$ }) {
      if (!signals) return;
      const open = cs => cs.forEach(c => c.children.length && (($$[`o${c.id}`] = true), open(c.children)));
      open(roots);
    },
    render: ({ html }) => html`<ul class="tree">${roots.map(c => item(html, c))}</ul>`
  });
  expected = nodes;
  count = () => document.querySelectorAll("li.comment").length;
} else {
  const rows = +(q.get("rows") || 400);
  const cells = +(q.get("cells") || 5);
  rocket("bench-rows", {
    mode: "light",
    setup({ $$ }) {
      $$.rows = Array.from({ length: rows }, (_, i) => ({ name: `row${i}`, count: i % 13, cells: Array.from({ length: cells }, (_, j) => `${i}.${j}`) }));
    },
    render: ({ html }) =>
      html`<table><tbody><template data-for="r, i in $$rows"><tr><td class="name" data-text="r.name"></td><td class="count" data-text="r.count"></td><template data-for="c in r.cells"><td class="cell" data-text="c"></td></template></tr></template></tbody></table>`
  });
  expected = rows * (cells + 2);
  count = () => document.querySelectorAll("td").length;
}

const tag = scenario === "tree" ? "bench-tree" : "bench-rows";
// Let Datastar finish starting up before the clock starts. With &wait=1 the
// page waits for window.__go(), so a profiler can be started first.
await new Promise(r => requestAnimationFrame(() => setTimeout(r, 50)));
if (q.get("wait")) await new Promise(r => (window.__go = r));
performance.mark("insert");
const t0 = performance.now();
document.body.append(document.createElement(tag));
const tSync = performance.now() - t0;
await new Promise(function poll(r) {
  if (count() >= expected) requestAnimationFrame(() => r());
  else requestAnimationFrame(() => poll(r));
});
const total = performance.now() - t0;
performance.mark("rendered");
window.__result = { bundle, scenario, ms: +total.toFixed(1), syncMs: +tSync.toFixed(1), items: count(), elements: document.querySelectorAll("*").length };
