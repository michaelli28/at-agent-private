# What the checker covers, and what was cut

## Retired: Section2Evaluator (decided 2026-09-19)

`evaluation/src/operable/Section2Evaluator.ts` sits untracked in the root checkout and was never committed on any branch. It is not ported, and the root file is left untouched.

- **Its 2.1.2 check** flags five Tab presses whose observation text doesn't change. That is the identical-text collision that the Tab walk (backendNodeId identity) and F4 remove. It is also limited to one-element cycles, and it reads the old agent's trace format.
- **Its other checks** (2.4.1 bypass, 2.4.2 page title, 2.4.4 link purpose, 2.4.5 multiple ways, 2.4.6 headings/labels) are static checks outside the keyboard claim.
  - axe-core already runs `bypass`, `document-title`, `link-name`, `label` and `empty-heading` alongside the checker.
  - 2.4.5 has no axe equivalent and is not covered.

## Retired: the 2.4.3 focus-order rule (decided 2026-09-19)

`DynamicEvaluator.checkFocusOrder` flagged a page when a focus identity repeated inside a four-event window. On a real page that is wrap-around, which every page does (bench/probes/wrap/RESULT.md). It is deleted rather than repaired: WCAG 2.4.3 is about whether the focus ORDER preserves meaning, which a repetition test over a keypress sequence cannot decide. Nothing replaces it.

- **Recall lost — one page.** The pre-fix baseline scores 2.4.3 detection `1/1 · 1.00 [0.21, 1.00]` on a single page (bench/results/cd3b122/REPORT-baseline.md:41), identified by bench/SPOTCHECK.md:113-116 as BAD's `before/survey`, SC 2.4.3 on `#page #ev`, technique F85, reader A only. After the cut that row reads `0/1`. The row stays in the report; it is not deleted.
- **What that recall cost.** The same rule scored `7/7 · 1.00 [0.65, 1.00]` false alarms on clean pages (bench/results/cd3b122/REPORT-baseline.md:52) — seven false positives for one true one.
- **No substitute.** axe contributed `0/1` on 2.4.3 in the baseline (bench/results/cd3b122/REPORT-baseline.md:41). Whether axe-core ships any 2.4.3 rule at all is unverified.
- **The dead `checkFocusIndicator` config flag went with the class.** It was never read. WCAG 2.4.7 is covered by `packages/accessibility/src/focus-indicator.ts`, driven by the Tab walk.

## What the 2.1.2 and 3.2.1 verdicts do not establish (decided 2026-09-19)

- **A backward-armed trap is not covered.** A page is judged from one forward Tab walk; a second walk runs only when the forward verdict is not a clean pass. A handler that traps only on reverse entry is invisible.
- **A trap needing two Escape presses reads as inescapable.** The probe presses Escape exactly once, in `runEscapeProbe` (packages/accessibility/src/tab-walk.ts).
- **Shift+Tab is never independent evidence.** Escape is pressed before the probe key, so only the conjunction "Escape failed AND the opposite key failed" is meaningful.
- **F55 ships with no recorded dev fixture.** `focusLostOnArrival` is false on all 8 dev bases (bench/corpus/dev/labels.json) and on all 27 variants recorded at cd3b122, because no operator in bench/corpus/dev/operators.ts produced it when they were seeded. The focus-removed rule is proven only on synthetic and inline fixtures until the M7 blur-on-focus operator lands and a fresh dev-variant run carries one.
- **A same-document SPA route change is not seen.** The URL rule needs `location.href` to change.
- **One observation, one criterion.** An F55 failure also fails 2.1.1 and 2.4.7; those stay with the gap detector and the focus-indicator check, so 3.2.1 recall is not counted three times.
- **A context change that arrives after the 150 ms settle is refused, not reported** — a timer cannot be told from a focus handler. Those presses are listed as `url-changed-after-settle`.
- **An `undetermined` verdict counts as a miss.** It stays in both denominators and is printed as its own count beside the rate, so the before/after comparison stays like-for-like. A judge that refuses to decide must not be able to buy precision by shrinking the denominator it is scored on.
