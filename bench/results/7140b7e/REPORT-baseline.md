# Baseline report — 7140b7e

Two columns over one run. BEFORE is the old checker ONLY where the two can differ (2.1.2, 2.4.3, 3.2.1): the legacy KeyboardTrapDetector and DynamicEvaluator replayed over this run's scripted Tab walk. Its remaining criteria come from the current post-fix gap detector and are identical in both columns. AFTER = the same gap detector plus the 2.1.2 and 3.2.1 judges reading that same walk. axe-core alongside for comparison. Regenerate with `npx tsx bench/report.ts 7140b7e`.

| set | complete | pages | clusters | tools not ok | commit | browser | axe-core | run at |
|---|---|---|---|---|---|---|---|---|
| dev-fixtures | yes | 8 | 8 | 0 | 7140b7e | headless-shell 143.0.7499.4 | 4.11.0 | 2026-09-20T08:49:20.137Z |
| dev-variants | yes | 33 | 7 | 0 | 7140b7e | headless-shell 143.0.7499.4 | 4.11.0 | 2026-09-20T08:53:11.077Z |

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

- Evidence class: every walk in these summaries ran in the headless shell (executableBasename chrome-headless-shell, 41 walks); no 2.1.2 or 3.2.1 verdict in this report has ever been observed in an activated browser.

## dev-variants — seeded defects (regression only — not a headline number)

Flagged = a gap on the target's data-bench-id (M1–M4, M7), the 2.1.2 verdict (M5), the 3.2.1 verdict (M6). Y flagged · N missed · U undetermined (counted as a miss) · E tool error · · no variant. † the unmodified base page (dev-fixtures, same commit) already carries the same flag, so that Y is not evidence the seeded change was seen.

A cell that changed between the columns prints before→after; an unchanged cell prints once. M1–M4 and M7 read the shared gap detector, so they can never change.

| operator | form | good-operable | identical-links | js-handlers | modal | navbar | three-links |
|---|---|---|---|---|---|---|---|
| M1 | Y | Y | · | Y | Y | Y | · |
| M2 | · | · | · | Y | · | · | · |
| M3 | Y | Y | Y | Y | Y | Y | Y |
| M4 | · | · | · | · | Y | Y | · |
| M5 | Y†→Y | Y†→Y | Y†→Y | Y†→Y | · | Y†→Y | Y†→Y |
| M6 | N→Y | N→Y | N→Y | N→Y | · | N→Y | N→Y |
| M7 | N | Y | Y | Y | · | Y | Y |

Flagged per operator (before → after): M1 5/5 → 5/5 · M2 1/1 → 1/1 · M3 7/7 → 7/7 · M4 2/2 → 2/2 · M5 6/6 → 6/6 · M6 0/6 → 6/6 · M7 5/6 → 5/6.

#### Gap type on the seeded target

Rows: labelled gap type. Columns: targets whose element got a gap of that type (an element can get several); acceptable = at least one reported type is in acceptableGapTypes.

| expected | targets | missing_from_a11y_tree | no_accessible_name | wrong_role | not_focusable | hidden_but_interactive | (no gap) | acceptable |
|---|---|---|---|---|---|---|---|---|
| no_accessible_name | 2 | 0 | 2 | 0 | 0 | 0 | 0 | 2/2 |
| wrong_role | 5 | 0 | 0 | 5 | 0 | 0 | 0 | 5/5 |
| not_focusable | 7 | 0 | 0 | 0 | 6 | 0 | 1 | 6/7 |
| hidden_but_interactive | 7 | 0 | 0 | 0 | 0 | 7 | 0 | 7/7 |

## dev-fixtures — hand-built base pages (regression only)

| page | walk: F / wraps | gaps: flags / components | legacy trap | walk trap | labelled | legacy dynamic | axe: nodes / components | tool errors |
|---|---|---|---|---|---|---|---|---|
| form | 6 / 5 | 0 / 0 | Y @35 (cycle 7) | — | no trap | — | 7 / 3 | — |
| good-operable | 7 / 5 | 0 / 0 | Y @40 (cycle 8) | — | no trap | — | 0 / 0 | — |
| identical-links | 12 / 5 | 0 / 0 | Y @5 (cycle 1) | — | no trap | 2.4.3 | 3 / 3 | — |
| js-handlers | 3 / 6 | 0 / 0 | Y @20 (cycle 4) | — | no trap | 2.4.3 | 4 / 4 | — |
| modal | 8 / 0 | 0 / 0 (not_focusable not assessed: no-wrap) | Y @20 (cycle 4) | confined, escapable via escape-key | escapable trap | 2.4.3 | 0 / 0 | — |
| navbar | 12 / 7 | 0 / 0 | Y @45 (cycle 9) | — | no trap | — | 3 / 2 | — |
| react-div-button | 1 / 7 | 1 / 1 | Y @10 (cycle 2) | — | no trap | 2.4.3 | 0 / 0 | — |
| three-links | 3 / 6 | 0 / 0 | Y @20 (cycle 4) | — | no trap | 2.4.3 | 5 / 3 | — |

walk trap = the 2.1.2 judge: — no confinement · "confined, escapable" a correct modal, NOT a violation · "TRAP inescapable" the criterion fails · "undetermined (<reason>)" not judged, and counted as a miss wherever it is scored.

Components (NODENAME + sorted class set, ×copies). Many copies of one component are one defect repeated, not independent findings.

- **form** — gaps: — · axe: DIV ×5, H1 ×1, HTML ×1
- **good-operable** — gaps: — · axe: —
- **identical-links** — gaps: — · axe: H1 ×1, HTML ×1, UL.grid ×1
- **js-handlers** — gaps: — · axe: DIV.custom-checkbox ×1, H1 ×1, HTML ×1, P ×1
- **modal** — gaps: — · axe: —
- **navbar** — gaps: — · axe: A.nav-link ×2, BUTTON.dropdown-toggle.nav-link ×1
- **react-div-button** — gaps: DIV.add-to-cart ×1 · axe: —
- **three-links** — gaps: — · axe: P ×3, H1 ×1, HTML ×1

No full-set run at this commit: dev-live, test-bad, test-live.

Report generated by bench/report.ts at 74c4349.
