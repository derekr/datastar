Time in ms, median (min–max) of 7 runs. data-for: render, as in summary.md. Reorder: one replaceChildren of the same rows, reversed, until the observers have run (the issue's own reproduction).

| Scenario | Baseline | #1227's change | This branch's change |
| --- | ---: | ---: | ---: |
| data-for, 100 rows x 7 cells | 281 (223–335) | 136 (110–184) | 152 (117–194) |
| data-for, 400 rows x 7 cells | 2,316 (2,106–2,643) | 446 (386–464) | 419 (395–625) |
| data-for, 800 rows x 7 cells | 9,693 (9,458–10,526) | 948 (811–1,016) | 918 (793–1,150) |
| #1227 reorder, 250 rows x 8 cells | 269 (237–450) | 31 (15–34) | 34 (30–51) |
| #1227 reorder, 500 rows x 8 cells | 1,018 (860–1,129) | 70 (55–95) | 81 (55–90) |
| #1227 reorder, 1000 rows x 8 cells | 3,940 (3,467–4,178) | 117 (105–160) | 125 (106–178) |
