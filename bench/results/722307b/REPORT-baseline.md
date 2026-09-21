# Baseline report — 722307b

Two columns over one run. BEFORE is the old checker ONLY where the two can differ (2.1.2, 2.4.3, 3.2.1): the legacy KeyboardTrapDetector and DynamicEvaluator replayed over this run's scripted Tab walk. Its remaining criteria come from the current post-fix gap detector and are identical in both columns. AFTER = the same gap detector plus the 2.1.2 and 3.2.1 judges reading that same walk. axe-core alongside for comparison. Regenerate with `npx tsx bench/report.ts 722307b`.

> **INCOMPLETE**: test-live has complete:false (the run died or is still going); its numbers cover 0 pages only.

| set | complete | pages | clusters | tools not ok | commit | browser | axe-core | run at |
|---|---|---|---|---|---|---|---|---|
| test-bad | yes | 8 | 1 | 0 | 722307b | headless-shell 143.0.7499.4 | 4.11.0 | 2026-09-21T04:48:58.087Z |
| test-live | NO | 0 | 0 | 0 | 722307b | headless-shell 143.0.7499.4 | 4.11.0 | 2026-09-21T05:02:23.042Z |

Method notes (from the run):

- 3.2.1 in the old DynamicEvaluator fires only when an agent 'navigate' action follows a focus event; a scripted Tab walk never produces one, so the legacy baseline cannot report 3.2.1 on any page.
- Per page the tools run in the order gaps, axe, walk (the legacy replay reuses that walk), each in its own fresh context and load: goto domcontentloaded + 3000 ms settle, the gap detector's own load.
- Legacy trap: detectTrap() is replayed after every walk press; trapped is its verdict after the last press, and firstTrappedPress is the first press where it said trapped (report.ts scores a page flagged if it ever did, as the agent latches trapDetected).
- Legacy trap trigger: detectTrap() says trapped once the last 5·L identity strings are one block of L strings repeated 5 times, for any L ≤ 10 (maxHistorySize 50 / minCycleCount 5). It is a property of the string sequence, not of F: a clean page whose headless-shell Tab cycle (every stop, then body on the wrap) is at most 10 strings long fires at press 5·L, and identity collisions shorten the cycle, so identical id-less links fire as a 1-string cycle after five in a row and a repeating group of strings fires on pages with many more stops.
- The legacy identity is rebuilt from each press's immediate read (the walk's step.immediate: top-level document.activeElement as soon as keyboard.press resolves, with no settle), which is when executeTab reads it; focus a page script moves later is not seen, and focus inside frames or shadow roots shows as the container.
- Walk trap (the new checker): judgeKeyboardTrap over this walk. pass = focus reached the end of the page, or it was confined but Escape or the opposite Tab key got out (a correct modal). fail = confined with neither key escaping. undetermined = the walk errored, F is only a lower bound, the focusable count changed mid-walk, or no release probe ran; an undetermined verdict is scored as a miss, never as a pass. contextChange is judgeContextChange (3.2.1 incl. F55) over the same walk. The legacy detector's verdicts are reported as-is, unchanged, from the frozen copy in bench/legacy-detectors.ts.
- Gaps run their own Tab walk on their own load (tabWalk: true). F3 needs it: without a walk the detector never emits not_focusable at all, so a run without it reports 0 not_focusable whatever the page does. That is a SECOND walk per page, separate from the one the judges read, and it roughly doubles the per-page keyboard cost.
- Each page's gaps run records the detector's own keyboard evidence (tools.gaps.findings.keyboard): whether the walk ran, whether not_focusable was assessed, and the reasons if it was not. A page where it was NOT assessed is scored undetermined for 2.1.1 and 2.4.7 in BOTH columns -- a miss, never a pass -- and drops the rule-of-three bound there, because the only gap type carrying those criteria could not be emitted at all. Without this record a check that could not run is indistinguishable in the report from a check that ran and found nothing.
- Gaps come from the CURRENT post-fix detector (F1/F2/F3/F9 landed at 6b7abff and c1f94b2: hidden elements are filtered, reachability comes from the Tab walk). The same gap findings feed both the before and the after column, so the before/after delta isolates the keyboard rules and takes no credit for the gap fixes; those were measured separately against cd3b122.

Scoring (this report):

- Legacy trap: a page counts as flagged if detectTrap() ever said trapped during the walk (firstTrappedPress), because the agent latches trapDetected on the first checkTrap that fires (packages/agent/src/agent.ts:91-92). "clear at end" marks pages where it no longer said trapped after the last press.

- Evidence class: every walk in these summaries ran in the headless shell (executableBasename chrome-headless-shell, 8 walks); no 2.1.2 or 3.2.1 verdict in this report has ever been observed in an activated browser.

## Headline: before → after

One run, one set of pages, one browser session: the before column replays the frozen pre-fix detectors (bench/legacy-detectors.ts) over the same walk the judges read, so neither column can move because a live page changed between runs. The two columns read the same walk but not the same facts: the walk now records an idle baseline, an end-of-walk focusable count and a corrected focusLost that only the judges consume. That IS the fix — the old rule is scored on the signal it was written for, the new rule on the signal the walk now records — but it means this before column is not byte-comparable to the one published at cd3b122.

The gap detector sits UNCHANGED in both columns, so none of the delta below is a gap fix; those were measured separately against cd3b122. 2.1.1, 2.4.7, 4.1.2 come from the gaps alone and are identical in both columns, so they are not repeated here.

2.1.2 has no detection row to improve on: no BAD page's report fails 2.1.2, so its detection cell is n/a in both columns and the whole 2.1.2 delta is false alarms.

| criterion | table | before (frozen legacy + gaps) | after (judges + gaps) | source of the change |
|---|---|---|---|---|
| 2.1.2 | detection | n/a | n/a | the keyboard-trap judge replaces the periodicity rule |
| 2.1.2 | false alarms | 1/8 · 0.13 [0.02, 0.47] | 0/8 · 0.00 [0.00, 0.32] · rule of 3 ≤ 0.38 | the keyboard-trap judge replaces the periodicity rule |
| 2.4.3 | detection | 1/1 · 1.00 [0.21, 1.00] | 0/1 · 0.00 [0.00, 0.79] | SCOPE CUT — rule deleted |
| 2.4.3 | false alarms | 7/7 · 1.00 [0.65, 1.00] | 0/7 · 0.00 [0.00, 0.35] · rule of 3 ≤ 0.43 | SCOPE CUT — rule deleted |
| 3.2.1 | detection | 0/4 · 0.00 [0.00, 0.49] | 4/4 · 1.00 [0.51, 1.00] | the context-change judge replaces the DynamicEvaluator's 3.2.1 — whose before column is 0 BY CONSTRUCTION, not by measurement: it could only fire after a 'navigate' event, which a scripted Tab walk never produces (bench/legacy.ts) |
| 3.2.1 | false alarms | 0/4 · 0.00 [0.00, 0.49] · rule of 3 ≤ 0.75 | 0/4 · 0.00 [0.00, 0.49] · rule of 3 ≤ 0.75 | the context-change judge replaces the DynamicEvaluator's 3.2.1 — whose before column is 0 BY CONSTRUCTION, not by measurement: it could only fire after a 'navigate' event, which a scripted Tab walk never produces (bench/legacy.ts) |

## test-bad — W3C BAD demo pages (headline)

Truth: page-level results in bench/corpus/test/bad-labels.json (two independent readers of the W3C evaluation reports). 8 pages from 1 cluster: the Wilson intervals treat pages as independent, which pages of one site are not, so they are too narrow.

Before is frozen ONLY on 2.1.2, 2.4.3 and 3.2.1. Its other criteria (1.1.1, 2.1.1, 2.4.7, 4.1.2) come from the CURRENT post-fix gap detector and are identical in the after column, so no part of the before/after delta is a gap fix. Before = current gap detector (criteria from each gap's wcag list, i.e. GAP_WCAG_MAPPING) + legacy trap detector (2.1.2) + legacy DynamicEvaluator (by criterion), replayed over THIS run's walk (bench/legacy.ts). After = the same gap detector + the 2.1.2 and 3.2.1 judges reading the same walk. axe = violations through their wcagNNN tags.

Cells: flagged/pages · rate [Wilson 95%]; a zero false-alarm count adds the rule-of-three 95% upper bound (3/pages). `· N undetermined` counts evaluable pages the judge refused to decide: they stay in the denominator and score as misses, so refusing to judge can never buy detection. On a clean page a refusal scores like a correct pass, so the false-alarm cell also prints `(worst case ...)`, the rate if every refusal had been a false alarm, and drops the rule-of-three bound (which assumes every page was observed). See bench/COVERAGE.md. `(N excluded: tool error)` is a different thing — the tool never ran on those pages at all.

Each page counts once per criterion: a detection target where its report fails the criterion, a clean page where its report passes it. The page counts (`4 before, 4 after`) are the W3C BAD site's OWN before/after demo pages — not the two checker columns.

### Detection: pages whose report fails the criterion — flagged?

| SC | report says Fail | before flagged | before: flagged by (pages) | after flagged | after: flagged by (pages) | axe flagged | axe: rules (pages) |
|---|---|---|---|---|---|---|---|
| 2.1.1 | 4 pages (4 before, 0 after) / 1 cluster | 1/4 · 0.25 [0.05, 0.70] | gap:not_focusable ×1 | 1/4 · 0.25 [0.05, 0.70] | gap:not_focusable ×1 | 0/4 · 0.00 [0.00, 0.49] | — |
| 2.1.2 | 0 pages | n/a | — | n/a | — | n/a | — |
| 2.4.3 | 1 page (1 before, 0 after) / 1 cluster | 1/1 · 1.00 [0.21, 1.00] | legacy-dynamic:2.4.3 ×1 | 0/1 · 0.00 [0.00, 0.79] | — | 0/1 · 0.00 [0.00, 0.79] | — |
| 2.4.7 | 4 pages (4 before, 0 after) / 1 cluster | 1/4 · 0.25 [0.05, 0.70] | gap:not_focusable ×1 | 1/4 · 0.25 [0.05, 0.70] | gap:not_focusable ×1 | 0/4 · 0.00 [0.00, 0.49] | — |
| 3.2.1 | 4 pages (4 before, 0 after) / 1 cluster | 0/4 · 0.00 [0.00, 0.49] | — | 4/4 · 1.00 [0.51, 1.00] | judge-context-change ×4 | 0/4 · 0.00 [0.00, 0.49] | — |
| 4.1.2 | 4 pages (4 before, 0 after) / 1 cluster | 4/4 · 1.00 [0.51, 1.00] | gap:no_accessible_name ×4 | 4/4 · 1.00 [0.51, 1.00] | gap:no_accessible_name ×4 | 4/4 · 1.00 [0.51, 1.00] | link-name ×4, select-name ×4, label ×1 |

2.4.3 has no after-column detector: the focus-order rule was deleted rather than repaired, and nothing replaces it (bench/COVERAGE.md). Its row stays, scored at zero, so the cost of the cut stays visible.

### False alarms: pages whose report passes the criterion (clean for it) — flagged?

| SC | report says Pass | before flagged | before: flagged by (pages) | after flagged | after: flagged by (pages) | axe flagged | axe: rules (pages) |
|---|---|---|---|---|---|---|---|
| 2.1.1 | 4 pages (0 before, 4 after) / 1 cluster | 0/4 · 0.00 [0.00, 0.49] · rule of 3 ≤ 0.75 | — | 0/4 · 0.00 [0.00, 0.49] · rule of 3 ≤ 0.75 | — | 0/4 · 0.00 [0.00, 0.49] · rule of 3 ≤ 0.75 | — |
| 2.1.2 | 8 pages (4 before, 4 after) / 1 cluster | 1/8 · 0.13 [0.02, 0.47] | legacy-trap ×1 | 0/8 · 0.00 [0.00, 0.32] · rule of 3 ≤ 0.38 | — | 0/8 · 0.00 [0.00, 0.32] · rule of 3 ≤ 0.38 | — |
| 2.4.3 | 7 pages (3 before, 4 after) / 1 cluster | 7/7 · 1.00 [0.65, 1.00] | legacy-dynamic:2.4.3 ×7 | 0/7 · 0.00 [0.00, 0.35] · rule of 3 ≤ 0.43 | — | 0/7 · 0.00 [0.00, 0.35] · rule of 3 ≤ 0.43 | — |
| 2.4.7 | 4 pages (0 before, 4 after) / 1 cluster | 0/4 · 0.00 [0.00, 0.49] · rule of 3 ≤ 0.75 | — | 0/4 · 0.00 [0.00, 0.49] · rule of 3 ≤ 0.75 | — | 0/4 · 0.00 [0.00, 0.49] · rule of 3 ≤ 0.75 | — |
| 3.2.1 | 4 pages (0 before, 4 after) / 1 cluster | 0/4 · 0.00 [0.00, 0.49] · rule of 3 ≤ 0.75 | — | 0/4 · 0.00 [0.00, 0.49] · rule of 3 ≤ 0.75 | — | 0/4 · 0.00 [0.00, 0.49] · rule of 3 ≤ 0.75 | — |
| 4.1.2 | 4 pages (0 before, 4 after) / 1 cluster | 0/4 · 0.00 [0.00, 0.49] · rule of 3 ≤ 0.75 | — | 0/4 · 0.00 [0.00, 0.49] · rule of 3 ≤ 0.75 | — | 0/4 · 0.00 [0.00, 0.49] · rule of 3 ≤ 0.75 | — |

#### Per page (F/P = report fails/passes the criterion; O = the before column flags it, C = the after column flags it, U = after is undetermined for it, A = axe flags it, – = not flagged, E = tool error)

| page | 2.1.1 | 2.1.2 | 2.4.3 | 2.4.7 | 3.2.1 | 4.1.2 |
|---|---|---|---|---|---|---|
| after/home | P ––– | P ––– | P O–– | P ––– | P ––– | P ––– |
| after/news | P ––– | P ––– | P O–– | P ––– | P ––– | P ––– |
| after/survey | P ––– | P ––– | P O–– | P ––– | P ––– | P ––– |
| after/tickets | P ––– | P ––– | P O–– | P ––– | P ––– | P ––– |
| before/home | F OC– | P O–– | P O–– | F OC– | F –C– | F OCA |
| before/news | F ––– | P ––– | P O–– | F ––– | F –C– | F OCA |
| before/survey | F ––– | P ––– | F O–– | F ––– | F –C– | F OCA |
| before/tickets | F ––– | P ––– | P O–– | F ––– | F –C– | F OCA |

## test-live — pre-registered site draw

Counts only: precision needs the Phase-3 hand labels, which do not exist yet.

| page | walk: F / wraps | gaps: flags / components | legacy trap | walk trap | legacy dynamic | axe: nodes / components | load | tool errors |
|---|---|---|---|---|---|---|---|---|

walk trap = the 2.1.2 judge: — no confinement · "confined, escapable" a correct modal, NOT a violation · "TRAP inescapable" the criterion fails · "undetermined (<reason>)" not judged, and counted as a miss wherever it is scored.

Components (NODENAME + sorted class set, ×copies). Many copies of one component are one defect repeated, not independent findings.


No full-set run at this commit: dev-fixtures, dev-variants, dev-live.

Report generated by bench/report.ts at 722307b.
