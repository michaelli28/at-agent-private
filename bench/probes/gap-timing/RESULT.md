# Probe: the gap detector's timing windows (acc-gaps#1, #6)

Run 2026-09-23 on worktree `round2/gaps-timing` @ 925960f (the probe file uncommitted at run time; the detector
unchanged), before the fix. Playwright 1.57.0, `chrome-headless-shell` 143.0.7499.4. One run per row, except
`timer-no-hook` (5). Every page is ours and synthetic, except `modal-*`, which loads the dev base
`bench/corpus/dev/base/modal.html`. No held-out page was opened or run.

## In plain English

**What we checked:** the gap checker reads a page three times: the accessibility tree (what a screen reader
sees), the list of page elements, and a Tab-key walk. It assumes all three see the same page. This probe changes
the page between those reads, at a chosen moment, and records what the checker then reports.
**What we found (before the fix):** a page that reloads or rebuilds itself between the reads gets every link and
button flagged "can't reach with Tab" or "invisible to screen readers", both critical, on a page with no defect.
Content that arrives while the checker is reading is also flagged "invisible to screen readers" (20 to 23 flags in
5 of 5 runs).
**Why it matters:** these are false critical alarms, and nothing in the old output says the page changed.

## How a row is made

The probe wraps the CDP sessions `crawlPageWithGapDetection` opens and acts once, just before or just after the
first CDP call that matches. `hookFired` is true on every hooked row; a hooked row whose hook did not fire would be
void. The walk rows use `tabWalk: { settleMs: 50 }`; `-nowalk` and `timer-no-hook` run no walk.

- `clean`: four controls (two links, a button, a `role=button tabindex=0` div), all reachable and exposed.
- `replace-before-walk` (W2): the page reloads after the crawl, just before the walk marks the document (the walk's
  `window["__atAgentTabWalk"] =` write).
- `replace-in-idle` (W1): the page reloads just after that write, during the walk's idle baseline, which sees it.
- `document-open-before-walk`: `document.open()` and `write()` rewrite the page in the same `Window` before the walk
  marks it.
- `replace-after-ax`, `replace-after-ax-nowalk`: the page reloads just after the accessibility-tree read.
- `timer-no-hook`: no hook. The page appends a named `role=switch` every 5 ms from 2.8 s to 4 s, across the
  detector's 3 s settle.
- `modal-clean`, `modal-replace-before-walk`: the dev modal (the page behind the dialog is aria-hidden, Tab loops in
  the dialog), clean and reloaded as in W2.
- `modal-toast`: a reduced modal whose aria-hidden page holds a toast with an Undo link; the page removes the toast
  by itself on the third keydown. Nothing is replaced.
- `zero-clean`, `zero-replace-before-walk`: a nameless zero-area link Tab reaches and a zero-area div that blurs on
  focus, clean and reloaded as in W2.
- `cost`: the post-walk detach check timed directly over 350 candidates (50 links, 300 clickable divs).

## Results

`crit` = critical, `mod` = moderate, `ser` = serious. Reasons are `keyboard.unassessedReasons`; `[]` means
`not_focusable` was assessed.

| row                         | 925960f (before the fix)                                      |
| --------------------------- | ------------------------------------------------------------- |
| `clean`                     | no gap, `[]`                                                  |
| `replace-before-walk`       | 4 × `not_focusable` crit, `[]`                                |
| `replace-in-idle`           | 4 × `not_focusable` crit, `[]`                                |
| `document-open-before-walk` | 4 × `not_focusable` crit, `[]`                                |
| `replace-after-ax`          | 4 × `missing_from_a11y_tree` crit, `[]`                       |
| `replace-after-ax-nowalk`   | 4 × `missing_from_a11y_tree` crit, `[walk-not-run]`           |
| `timer-no-hook` ×5          | 22, 23, 20, 21, 23 × `missing_from_a11y_tree`, all on late-\* |
| `modal-clean`               | no gap, `[no-wrap]`                                           |
| `modal-replace-before-walk` | no gap, `[no-wrap]`                                           |
| `modal-toast`               | no gap, `[no-wrap]`                                           |
| `zero-clean`                | `zero-link` `no_accessible_name` ser, `[]`                    |
| `zero-replace-before-walk`  | `home`, `about` `not_focusable` crit, `[]`                    |
| `cost`                      | n/a: no detach check at this commit                           |

## What this does NOT show

- How often a real page lands in these windows. W1 and W2 are CDP-call boundaries inside the instrument, so a page
  can only aim at them by chance; the hook makes them deterministic.
- Any browser but Chromium 143 (`chrome-headless-shell`).

## Reproduce

Outside the sandbox (it launches Chromium), from the repository root:

```
npx tsx bench/probes/gap-timing/probe.ts               # every row
npx tsx bench/probes/gap-timing/probe.ts modal-toast   # named rows only
```

The first line printed names the browser and the commit the detector came from.
