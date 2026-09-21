# Phase 3 — re-measuring the keyboard checker on held-out pages

Run: **`bench/results/74c4349/`** — both held-out sets, one commit, one browser session.
Generated tables: `bench/results/74c4349/REPORT-baseline.md` (regenerate with
`npx tsx bench/report.ts 74c4349`).

**One section is still open.** Precision needs blind hand-labelling that only a human can do
(§6). Everything else below is final: whatever this run recorded is the answer, and no held-out
set will be re-run to improve a number.

---

## 🧑 In Plain English

**What this is:** Michael built a tool that checks whether a website can be used with a keyboard
alone. This measures how good it actually is, on websites it was never built or tuned against.

**Why it matters:** anyone can claim their checker works. The only way to know is to try it on
pages chosen in advance, once, and report whatever comes out.

**What we found:** on 20 real websites, the old checker raised a false-alarm-shaped flag about
keyboard traps on **12 of 18** pages it could evaluate. The rebuilt checker raised **none**. A
second rule that fired on **every single page** (18 of 18) was deleted outright rather than
repaired. Those are the two results worth quoting — with the caveat in §4 that "flag" is not yet
"false alarm", because confirming that needs labelling nobody has done yet.

**The honest bit:** the big demo-site numbers are much less impressive than the live ones, and a
figure we were ready to headline earlier turned out to be an artifact of our own practice pages.
Both are written up below rather than quietly dropped.

---

## 1. What was measured, and what the two columns mean

Two columns, produced in **one run over one set of pages**, so neither can move because a live
page changed between runs:

- **before** — the frozen pre-fix detectors (`bench/legacy-detectors.ts`), replayed over the same
  Tab walk the new judges read.
- **after** — the same shared gap detector, plus the two new judges (2.1.2 keyboard trap, 3.2.1
  context change).

The **gap detector is identical in both columns**, so 2.1.1, 2.4.7 and 4.1.2 cannot differ between
them and none of the delta is a gap fix. Only **2.1.2, 2.4.3 and 3.2.1** can move.

An `undetermined` verdict counts as a **miss**, never a pass, in both denominators. A page whose
Tab walk never assessed `not_focusable` is undetermined for 2.1.1 and 2.4.7 in _both_ columns — it
was not observed, and counting it clean is how an unrun check scores like a passing one.

**Run health.** `test-bad`: 8/8 pages, zero tool errors. `test-live`: 20/20 pages, 9 not-ok tool
runs out of 80 — two sites timed out at the network, two exhausted the 20-minute page budget. All
recorded per page. 18 of 20 live pages are evaluable for the before/after comparison.

---

## 2. W3C BAD demo pages — detection (8 pages, 1 cluster)

Pages whose published report says the criterion **fails**. Did the checker flag it?

| criterion | pages | before | after   | axe-core | note                                       |
| --------- | ----- | ------ | ------- | -------- | ------------------------------------------ |
| 2.1.1     | 4     | 1/4    | 1/4     | 0/4      | shared gap detector — cannot differ        |
| 2.1.2     | 0     | n/a    | n/a     | n/a      | **no BAD page fails 2.1.2 at all**         |
| 2.4.3     | 1     | 1/1    | 0/1     | 0/1      | **scope cut** — rule deleted, not replaced |
| 2.4.7     | 4     | 1/4    | 1/4     | 0/4      | shared gap detector — cannot differ        |
| 3.2.1     | 4     | 0/4    | **4/4** | 0/4      | before is 0 _by construction_ — see below  |
| 4.1.2     | 4     | 4/4    | 4/4     | 4/4      | shared; axe matches                        |

**The 3.2.1 result is not the improvement it looks like.** The old DynamicEvaluator could only fire
after an agent `navigate` action, and a scripted Tab walk never produces one. Its before column is
**0 by construction, not by measurement**. Never quote "0/4 → 4/4" as a fourfold improvement. The
honest statement: _the new judge detects 4 of 4; the old one could not be measured here at all._

**2.1.2 detection cannot be measured on this set.** Not one of the 8 BAD pages contains a keyboard
trap. Every claim that the checker _detects_ traps rests on 6 seeded synthetic variants (6/6). That
is a real limit on the headline.

---

## 3. W3C BAD demo pages — false alarms

Pages the published report marks **clean** for the criterion.

| criterion | pages | before  | after   |
| --------- | ----- | ------- | ------- |
| 2.1.1     | 4     | 0/4     | 0/4     |
| 2.1.2     | 8     | 1/8     | **0/8** |
| 2.4.3     | 7     | **7/7** | **0/7** |
| 2.4.7     | 4     | 0/4     | 0/4     |
| 3.2.1     | 4     | 0/4     | 0/4     |
| 4.1.2     | 4     | 0/4     | 0/4     |

**With 8 pages in one cluster every bound here is wide.** "0 false alarms on 8 pages" is consistent
with a true rate around 31%. The generated report prints three upper bounds per zero cell and they
do **not** agree, because they answer different questions: the Wilson interval is two-sided and
approximate, the rule of three approximates a one-sided bound, and Clopper–Pearson is exact
one-sided with guaranteed coverage. Exact is **not** always the smallest — at n=20 it is 13.9%
against Wilson's 16.1%, but at n=4 it is 52.7% against 49.0%. Quote the exact one-sided bound as the
defensible claim; do not pick whichever number is smallest per row.

The 2.4.3 row is a **scope cut, not a repair**: the focus-order rule was deleted. It removed 7/7
false alarms at the cost of the single detection it had. Present it as a deletion.

---

## 4. Live sites — the result worth quoting (18 evaluable of 20)

| criterion | before            | after                     | what changed                             |
| --------- | ----------------- | ------------------------- | ---------------------------------------- |
| 2.1.2     | **12/18 flagged** | **0/18** (2 undetermined) | periodicity rule → keyboard-trap judge   |
| 2.4.3     | **18/18 flagged** | 0/18                      | **rule deleted**                         |
| 3.2.1     | 0/18              | 2/18                      | before could not fire on a scripted walk |

> **These are FLAG COUNTS, not precision.** No published labels exist for live sites, so whether
> those 12 are false alarms is exactly what §6 decides. Do not write "false alarm" here yet.

**Why the old rule fired so often — and why our earlier explanation was wrong.**

The old rule reports a trap once the last 5·L focus-identity strings are one block of L strings
repeated 5 times, for any L ≤ 10 — i.e. when the focus sequence **repeats inside a ten-element
window**.

An earlier draft of this report claimed that made it a small-page phenomenon, citing 35/35 false
alarms on our hand-built dev pages against 1/8 on the BAD pages. **That explanation does not
survive the live data.** The live pages where it fired have 32 to 467 Tab stops, and
`noticiasdealava.eus` — 467 stops — fired at press **5**:

| page                | Tab stops (F) | fired at press |
| ------------------- | ------------- | -------------- |
| noticiasdealava.eus | 467           | 5              |
| ixi.ru              | 43            | 14             |
| anime.nexus         | 160           | 17             |
| beardo.in           | 250           | 17             |
| lionbridge.com      | 162           | 18             |
| fashionbeans.com    | 209           | 147            |

Firing at press 5 means an effective cycle length of **one**: five consecutive elements with
identical focus identities. What predicts the rule firing is not how big a page is but whether it
contains a **run of identical, indistinguishable controls** — and real sites are full of them
(repeated "read more" links, icon rows, pagination). The W3C BAD demo pages are the unusual ones:
hand-authored, every control distinct, so the rule rarely trips there.

That correction moves the finding from "our practice corpus was misleading" to something stronger:
**the old rule misfires on ordinary real-world markup, and the demo site understated how often.**

_(An earlier draft also cited end-of-walk cycle length as proof no qualifying cycle ever occurred on
BAD pages. That was wrong — `before/home` fired at press 19 and had cleared by the end of the walk.
The recorded `cycleLength` is an end state, not a maximum.)_

---

## 5. What the walk could not assess

`not_focusable` is the only gap type a Tab walk gates, and it carries 2.1.1 and 2.4.7. On
**6 of 20 live pages** it could not be assessed:

| reason                  | pages | meaning                                                       |
| ----------------------- | ----- | ------------------------------------------------------------- |
| `focusables-incomplete` | 4     | a cross-origin frame or closed shadow root may hide Tab stops |
| `walk-error`            | 1     | the page budget was exhausted                                 |
| `no-wrap`               | 1     | focus was confined, so the walk never completed a cycle       |

On the BAD set: 0 of 8. Those six pages are scored **undetermined** for 2.1.1 and 2.4.7 in both
columns and drop the rule-of-three bound there. Before this run recorded the evidence, all six
would have been counted as clean.

---

## 6. Precision, grouped by component — OPEN, needs blind labelling

The brief requires precision to be scored **blind**: a shuffled mix of flags with the producing
version hidden, grouped by component so many copies of one component count once.

`bench/blind-labels.ts` builds that worklist with the source stripped; the mapping back to source is
in `BLIND-LABELS.key.json`, **which must not be opened until labelling is finished**.

```
npx tsx bench/blind-labels.ts 74c4349 --sample 10 --origin http://127.0.0.1:4175
npx tsx bench/spotcheck-ui.ts --file bench/BLIND-LABELS.md --port 4175
```

Verified blind after the fixes: no source occupies a contiguous block, every criterion renders as a
dotted success-criterion number, each page-level criterion has exactly one wording whoever raised
it, and all local URLs point at the reviewer's own port.

**Until those labels exist, no precision number can be stated** — 349 gap flags were raised across
the live pages, and a flag is not a defect. The brief also asks for a test–retest κ from re-labelling
20 items after 24 hours; that has not been done.

---

## 7. What this does NOT establish

- **2.1.2 detection on real pages.** No held-out page is known to contain a trap; detection evidence
  is 6 synthetic seeded variants.
- **That the 12 live 2.1.2 flags are false.** That is §6's job.
- **3.2.1 as an improvement ratio.** The before column is structurally zero on this harness.
- **2.4.7.** The focus-indicator check is built, exported and tested but **not wired into the
  harness**, so 2.4.7 scores only the gap detector's `not_focusable` mapping and **understates** the
  checker. Deliberate; recorded in `COVERAGE.md`.
- **Any single aggregate precision number.** None is computed. A headline "X → Y" must name which
  criteria it aggregates and state that 2.4.3 contributes a deletion, not a fix.
- **A tight bound on the label key.** 20 of 20 spot-checked labels were agreed, but the draw is
  **quota-stratified, not a simple random sample** (8 of 78, 2 of 41, 6 of 48, 4 of 182 — sampling
  fractions 2.2% to 12.5%), so the rule of three does not apply to the pooled 20. Valid 95% upper
  bounds _per stratum_: dev element labels **31.2%**, dev page flags **77.6%**, BAD page-level
  **39.3%**, BAD element mappings **52.7%**. The spot-check shows the key is not grossly wrong; it
  does not bound its error rate tightly. No notes were recorded against the 20, so the file carries
  verdicts without the observations behind them.
- **Independence.** All 8 BAD pages are one site. Intervals are reported beside cluster counts and
  McNemar is never computed.

## 8. Instrument failures, disclosed

- **The first live run was invalid and was discarded.** At `722307b` the browser died during
  `ekdromi.gr`; one browser serves the whole set, so the remaining 14 pages could not open a context
  and were recorded as tool errors while the run still reported `complete` and exited 0 — **5 of 20
  pages actually measured**. `liveBrowser()` now relaunches a dead browser and records it in the
  summary's notes. Both sets were re-run from scratch at `74c4349`. No detector rule changed between
  the two runs, so this is a repaired instrument, not a retuned one.
  `bench/results/722307b/test-live` is left on disk as evidence; **do not cite it**.
- **`test-bad` reproduced identically** across the two runs, cell for cell.

## 9. Reproducing this

```
npx tsx bench/run.ts test-bad
npx tsx bench/run.ts test-live
npx tsx bench/report.ts 74c4349
```

Evidence class for every number above: **local run, real headless Chromium, one machine**. No
verdict here has been observed in an activated browser, and no LLM agent was run.
