// Composition cases the template change must keep working, run against one
// bundle (?bundle=baseline|patched). Each case renders a Rocket component,
// interacts with it, and records what the DOM says; check.mjs compares the
// two bundles and asserts the expected values.
const bundle = new URLSearchParams(location.search).get("bundle") || "baseline";
const { rocket } = await import(`/dist/${bundle}.js`);
const results = {};
const txt = s => [...document.querySelectorAll(s)].map(e => e.textContent).join(",");
const frame = () => new Promise(r => requestAnimationFrame(() => setTimeout(r, 0)));

// 1. Nested html templates with local signals at every level.
rocket("case-nested", {
  mode: "light",
  setup({ $$ }) { $$.a = 1; $$.b = 2; },
  render: ({ html }) => {
    const inner = html`<span class="b" data-text="$$b"></span><button class="incb" data-on:click="$$b++">b</button>`;
    const mid = html`<p class="mid"><span class="a" data-text="$$a"></span>${inner}</p>`;
    return html`<div class="outer">${mid}${["x", 1, null, true]}<button class="inca" data-on:click="$$a++">a</button></div>`;
  }
});
// 2. A Node made outside the template (document.createElement), with a
//    local-signal binding, composed into it: it must still be scoped.
rocket("case-foreign", {
  mode: "light",
  setup({ $$ }) { $$.n = 5; },
  render: ({ html }) => {
    const el = document.createElement("span");
    el.className = "n";
    el.setAttribute("data-text", "$$n");
    const btn = document.createElement("button");
    btn.className = "incn";
    btn.setAttribute("data-on:click", "$$n++");
    return html`<div>${el}${btn}</div>`;
  }
});
// 3. A list mixing template output and a foreign node in one iterable.
rocket("case-mixed", {
  mode: "light",
  setup({ $$ }) { $$.m = 0; },
  render: ({ html }) => {
    const foreign = document.createElement("i");
    foreign.className = "f";
    foreign.setAttribute("data-text", "$$m");
    return html`<ul>${[html`<li class="t" data-text="$$m + 10"></li>`, foreign]}</ul><button class="incm" data-on:click="$$m++">m</button>`;
  }
});
// 4. svg output composed into html.
rocket("case-svg", {
  mode: "light",
  setup({ $$ }) { $$.r = 3; },
  render: ({ html, svg }) => html`<div>${svg`<svg width="10" height="10"><circle class="c" cx="5" cy="5" data-attr:r="$$r"></circle></svg>`}<button class="incr" data-on:click="$$r++">r</button></div>`
});
// 5. Re-render with new data (a second render() call): output morphs and
//    bindings still work.
rocket("case-rerender", {
  mode: "light",
  setup({ $$, render }) {
    $$.k = 0;
    setTimeout(() => render({}, ["p", "q", "r"]), 0);
  },
  render: ({ html }, items = ["p"]) => html`<ol>${items.map(i => html`<li class="item"><span>${i}</span><b data-text="$$k"></b></li>`)}</ol><button class="inck" data-on:click="$$k++">k</button>`
});

// 6–7. Hosts in the page before their component is defined (what the
//    pending-host observer watches for): one inserted as markup into an
//    existing element, one with a child appended after it was inserted.
//    Once defined, both render, bind their local signal, and project their
//    children (bound to a page signal).
const holder = document.createElement("div");
holder.setAttribute("data-signals", "{g: 'G'}");
document.body.append(holder);
await frame();
holder.innerHTML = `<late-a><i class="ca" data-text="$g"></i></late-a>`;
const lateB = document.createElement("late-b");
holder.append(lateB);
await frame();
const child = document.createElement("i");
child.className = "cb";
child.setAttribute("data-text", "$g + '!'");
lateB.append(child);
await frame();
results.lateBeforeDefine = [txt(".ca"), txt(".cb")];
rocket("late-a", { mode: "light", setup({ $$ }) { $$.v = "A"; }, render: ({ html }) => html`<b class="la" data-text="$$v"></b><slot></slot>` });
rocket("late-b", { mode: "light", setup({ $$ }) { $$.w = "B"; }, render: ({ html }) => html`<b class="lb" data-text="$$w"></b><slot></slot>` });
await frame(); await frame();
results.lateAfterDefine = [txt(".la"), txt(".lb"), txt(".ca"), txt(".cb")];

for (const tag of ["case-nested", "case-foreign", "case-mixed", "case-svg", "case-rerender"]) document.body.append(document.createElement(tag));
await frame(); await frame();
const $ = s => document.querySelector(s);
results.nestedBefore = [txt(".a"), txt(".b"), $(".outer").textContent];
$(".inca").click(); $(".incb").click(); await frame();
results.nestedAfter = [txt(".a"), txt(".b")];
results.foreignBefore = txt(".n");
$(".incn").click(); await frame();
results.foreignAfter = txt(".n");
results.mixedBefore = [txt(".t"), txt(".f")];
$(".incm").click(); await frame();
results.mixedAfter = [txt(".t"), txt(".f")];
results.svgBefore = $(".c").getAttribute("r");
$(".incr").click(); await frame();
results.svgAfter = $(".c").getAttribute("r");
await frame();
results.rerender = [document.querySelectorAll(".item").length, txt(".item span")];
$(".inck").click(); await frame();
results.rerenderAfter = txt(".item b");
results.html = [...document.body.children].map(e => e.innerHTML).join("\n");
window.__result = results;
