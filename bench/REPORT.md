# Phase 3 — re-measuring the keyboard checker on held-out pages

**Status: DRAFT.** `test-bad` is complete; `test-live` was still running when this draft was
written, and the precision section is waiting on blind labelling that only a human can do. Every
section below says which of those it is. Nothing here should be quoted until the pending parts close.

Run: `bench/results/722307b/` — one run, one browser session, both columns from the same walk.
Data rendered by `bench/report.ts` at `a2edf72` (later than the run; the report is a rendering of
recorded data, and the results schema did not change between the two).

---

## 🧑 In Plain English

**What this is:** Michael built a tool that checks whether a website can be used with a keyboard
alone. This measures how good it actually is, on websites it was never built or tuned against.

**Why it matters:** anyone can claim their checker works. The only way to know is to try it on
pages it has never seen, decided in advance, and report whatever comes out — including the parts
that look bad.

**What we found so far:** on the held-out pages, the rebuilt checker stopped a class of false alarm
the old one produced, and started catching a fault the old one structurally could not. But the most
striking number from earlier testing — "the old checker cried wolf on every single page" — **turns
out to be an artifact of the small practice pages**, not a fact about the old checker. On real
pages it cried wolf far less often. That correction is the most important result in this document,
and it argues against the headline we were expecting to write.

---

## 1. What was measured, and what the two columns mean

Two columns, produced in **one run over one set of pages**, so neither can move because a live page
changed between runs:

- **before** — the frozen pre-fix detectors (`bench/legacy-detectors.ts`), replayed over the same
  Tab walk the new judges read.
- **after** — the same shared gap detector, plus the two new judges (2.1.2 keyboard trap, 3.2.1
  context change).

The **gap detector is identical in both columns**. So 2.1.1, 2.4.7 and 4.1.2 cannot differ between
them, and none of the delta below is a gap fix. Only 2.1.2, 2.4.3 and 3.2.1 can move.

An `undetermined` verdict counts as a **miss**, never a pass, in both denominators.

---

## 2. Detection — held-out W3C BAD pages (8 pages, 1 cluster)

Pages whose published report says the criterion **fails**. Did the checker flag it?

| criterion | pages | before | after   | axe-core | note                                                            |
| --------- | ----- | ------ | ------- | -------- | --------------------------------------------------------------- |
| 2.1.1     | 4     | 1/4    | 1/4     | 0/4      | shared gap detector — cannot differ                             |
| 2.1.2     | 0     | n/a    | n/a     | n/a      | **no BAD page fails 2.1.2 at all**                              |
| 2.4.3     | 1     | 1/1    | 0/1     | 0/1      | **scope cut** — rule deleted, not replaced                      |
| 2.4.7     | 4     | 1/4    | 1/4     | 0/4      | shared gap detector — cannot differ                             |
| 3.2.1     | 4     | 0/4    | **4/4** | 0/4      | see the caveat below — the before column is 0 _by construction_ |
| 4.1.2     | 4     | 4/4    | 4/4     | 4/4      | shared; axe matches                                             |

**The 3.2.1 result is not the improvement it looks like.** The old DynamicEvaluator could only fire
after an agent `navigate` action, and a scripted Tab walk never produces one. Its before column is
therefore **0 by construction, not by measurement** — it was never capable of scoring above zero on
this harness. "0/4 → 4/4" must never be quoted as a fourfold improvement. The honest statement is:
_the new judge detects 4 of 4; the old one could not be measured here at all._

**2.1.2 detection cannot be measured on this set.** Not one of the 8 BAD pages has a keyboard trap.
Every claim that the checker _detects_ traps rests on the 6 seeded dev variants (6/6) — which are
synthetic pages we built. That is a real limit on the headline.

---

## 3. False alarms — pages clean for the criterion

| criterion | pages | before  | after   | bound on the after column               |
| --------- | ----- | ------- | ------- | --------------------------------------- |
| 2.1.1     | 4     | 0/4     | 0/4     | rule of 3 ≤ 0.75 · exact 1-sided ≤ 0.53 |
| 2.1.2     | 8     | 1/8     | **0/8** | rule of 3 ≤ 0.38 · exact 1-sided ≤ 0.31 |
| 2.4.3     | 7     | **7/7** | **0/7** | rule of 3 ≤ 0.43 · exact 1-sided ≤ 0.35 |
| 2.4.7     | 4     | 0/4     | 0/4     | rule of 3 ≤ 0.75 · exact 1-sided ≤ 0.53 |
| 3.2.1     | 4     | 0/4     | 0/4     | rule of 3 ≤ 0.75 · exact 1-sided ≤ 0.53 |
| 4.1.2     | 4     | 0/4     | 0/4     | rule of 3 ≤ 0.75 · exact 1-sided ≤ 0.53 |

Wilson intervals in `REPORT-baseline.md` are **two-sided**; the exact one-sided Clopper–Pearson
bound is tighter and is the strongest claim a zero count supports. At n=20 these are 16.1% and
13.9% respectively. **With only 8 pages in one cluster, every bound here is wide** — "0 false
alarms" on 8 pages is consistent with a true rate as high as ~31%.

The 2.4.3 row is a **scope cut, not a repair**: the focus-order rule was deleted. It bought back
7/7 false alarms at the cost of the single detection it had. That trade is deliberate and is
recorded in `COVERAGE.md`; it must be presented as a deletion, never as an improved rule.

---

## 4. The finding that changes the headline

Earlier dev-set testing produced a dramatic number: the old checker false-alarmed on 2.1.2 on
**35 of 35** non-trap pages, and the new judge on **0 of 35**. On the held-out BAD pages the same
comparison is **1 of 8 → 0 of 8**.

That is not noise. The old rule fires when the last 5·L focus-identity strings are one block of L
strings repeated 5 times, for any L ≤ 10 — i.e. when the page's Tab cycle _repeats inside a
ten-element window_. Measured directly:

| page set                  | Tab stops (F) | identity cycle length | old checker false-alarmed |
| ------------------------- | ------------- | --------------------- | ------------------------- |
| dev (hand-built + seeded) | 1–12          | **1–9** (all ≤ 10)    | **35/35**                 |
| held-out BAD (real pages) | 46–61         | **0** (no cycle ≤ 10) | **1/8**                   |

`identical-links` is the proof: 12 Tab stops but an identity cycle of **1**, because identical
links collapse to one identity — it fired at press 5.

**Consequence:** the old checker's false-alarm rate is a function of how repetitive a page's focus
sequence is, not of how broken the page is. Small or repetitive pages trip it almost always; large
varied pages rarely do. **The 35/35 figure is a property of our practice corpus and must not be
the headline.** The held-out figure is the honest one.

This is exactly what holding a set out is for, and it is the strongest argument in this document
that the process worked.

---

## 5. Live sites — PENDING

`test-live` (20 sites drawn under the pre-registered rule) was still running when this draft was
written. Numbers, plus the same per-criterion tables, go here.

## 6. Precision, grouped by component — PENDING (needs blind labelling)

The brief requires precision to be scored **blind**: a shuffled mix of flags with the producing
version hidden, grouped by component so that many copies of one component count once.

`bench/blind-labels.ts` builds that worklist (`BLIND-LABELS.md`, source stripped; the mapping back
to source is in `BLIND-LABELS.key.json`, which must not be opened until labelling is finished).
Drive it with:

```
npx tsx bench/spotcheck-ui.ts --file bench/BLIND-LABELS.md --port 4175
```

Until those labels exist, **no precision number can be stated** — flags are not labelled truth.

The brief also asks for a test–retest κ from re-labelling 20 items after 24 hours. That has not
been done and is not scheduled.

---

## 7. What this does NOT establish

- **2.1.2 detection on real pages.** No held-out BAD page contains a trap; detection evidence is
  entirely from 6 synthetic seeded variants.
- **3.2.1 improvement.** The before column is structurally zero on this harness, so no ratio
  between the columns is meaningful.
- **2.4.7.** The focus-indicator check (`packages/accessibility/src/focus-indicator.ts`) is built,
  exported and tested, but is **not wired into the harness**. The 2.4.7 row scores only the gap
  detector's `not_focusable` mapping, so it **understates** the current checker. Decided
  deliberately; recorded in `COVERAGE.md`.
- **A single aggregate precision number.** None is computed. Any headline "X → Y" must name which
  criteria it aggregates and must state that 2.4.3 contributes a deletion, not a fix.
- **The label key itself.** 20 of 20 spot-checked labels were agreed, which bounds the key's error
  rate at roughly **15% (rule of three)** — loosely, not tightly. No notes were recorded against
  the 20, so the file carries verdicts without the observations behind them.
- **Anything about clustering.** All 8 BAD pages are one site, so they are not independent;
  intervals are reported beside cluster counts and McNemar is never computed.

## 8. Reproducing this

```
npx tsx bench/run.ts test-bad          # then test-live
npx tsx bench/report.ts 722307b        # writes REPORT-baseline.md beside the summaries
npx tsx bench/blind-labels.ts 722307b --sample 10
```

Evidence class for every number above: **local run, real headless Chromium, one machine**. No
verdict in this document has been observed in an activated browser, and no LLM agent was run.
