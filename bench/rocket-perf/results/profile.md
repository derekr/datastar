### tree, 1,400 items, depth 14

One render, unthrottled, unminified builds (render time 372.7 ms baseline, 301.8 ms patched). Total time (ms) in each function and everything it calls:

| Function | Baseline | Patched |
| --- | ---: | ---: |
| `resolveMarkers` | 70 | 37 |
| `rewriteDataAttributes` | 76 | 17 |
| `subtreeUsesScopedSignals` | 48 | 10 |
| `#rewriteScopedDataAttributes` | 127 | 29 |
| `markPendingRocketHosts` | 19 | 8 |
| `#render` | 275 | 209 |
| `apply` | 22 | 25 |

Top self time (ms), baseline:

| Function | Baseline | Patched |
| --- | ---: | ---: |
| `rewriteDataAttributes` | 75 | 17 |
| `subtreeUsesScopedSignals` | 48 | 10 |
| `resolveMarkers` | 46 | 28 |
| `applyEls` | 39 | 45 |
| `markPendingRocketHosts` | 16 | 7 |
| `appendChild` | 14 | 17 |
| `closest` | 12 | 17 |
| `importNode` | 11 | 17 |
| `#indexActionHosts` | 5 | 7 |
| `#rewriteScopedDataAttributes` | 3 | 2 |

### data-for, 400 rows x 7 cells

One render, unthrottled, unminified builds (render time 3420 ms baseline, 656.7 ms patched). Total time (ms) in each function and everything it calls:

| Function | Baseline | Patched |
| --- | ---: | ---: |
| `rewriteDataAttributes` | 46 | 42 |
| `#rewriteScopedDataAttributes` | 1 | 1 |
| `markPendingRocketHosts` | 2615 | 33 |
| `initRocketFors` | 177 | 153 |
| `#render` | 3 | 3 |
| `apply` | 181 | 166 |

Top self time (ms), baseline:

| Function | Baseline | Patched |
| --- | ---: | ---: |
| `markPendingRocketHosts` | 2202 | 29 |
| `querySelectorAll` | 259 | 10 |
| `MutationObserver.observe.subtree` | 175 | 29 |
| `get` | 169 | 11 |
| `applyEls` | 85 | 79 |
| `compileExpression` | 83 | 66 |
| `applyAttributePlugin` | 48 | 46 |
| `update2` | 39 | 41 |
| `observe` | 32 | 42 |
| `rewriteDataAttributes` | 29 | 23 |

