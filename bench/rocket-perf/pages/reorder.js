// The reproduction from starfederation/datastar#1227: no Rocket component on
// the page, only the bundle loaded. Fill a table with `rows` rows of 8 cells,
// then reverse them with replaceChildren over the same nodes, which queues one
// removal record per row. Times the reorder until the observers have run.
//
//   ?bundle=baseline|patched|...&rows=500
const q = new URLSearchParams(location.search);
const bundle = q.get("bundle") || "baseline";
const n = +(q.get("rows") || 500);
await import(`/dist/${bundle}.js`);
const tbody = document.getElementById("rows");
const row = i => {
  const tr = document.createElement("tr");
  for (let c = 0; c < 8; c++) tr.insertCell().textContent = i + "." + c;
  return tr;
};
tbody.replaceChildren(...Array.from({ length: n }, (_, i) => row(i)));
await new Promise(r => setTimeout(r));
const t0 = performance.now();
tbody.replaceChildren(...[...tbody.rows].reverse());
await new Promise(r => setTimeout(r));
window.__result = { bundle, scenario: "reorder", ms: +(performance.now() - t0).toFixed(1), items: tbody.rows.length };
