# Phase 3 — re-measuring the keyboard checker on held-out pages

Run: **`bench/results/74c4349/`** — both held-out sets at one commit, one `run.ts` invocation each.
Generated tables: `bench/results/74c4349/REPORT-baseline.md` (regenerate with
`npx tsx bench/report.ts 74c4349`).

**One thing is deferred, not missing.** Precision scored by hand-labelling is not part of this
measurement (§6 says why, and why the result below does not rest on it). Everything else is final:
whatever this run recorded is the answer, and no held-out set will be re-run to improve a number.

---

## 🧑 In Plain English

**What this is:** Michael built a tool that checks whether a website can be used with a keyboard
alone. This measures how good it actually is, on websites it was never built or tuned against.

**Why it matters:** anyone can claim their checker works. The only way to know is to try it on
pages chosen in advance, take one scored run, and report whatever comes out.

**What we found:** on 20 real websites, the old checker raised a false-alarm-shaped flag about
keyboard traps on **12 of 18** pages it could evaluate — on 9 of those 12 the flag cleared again
before the walk ended. The rebuilt checker raised **none on the 16 pages it could judge**, and
declined to decide the other 2. A second rule that fired on **every single page** (18 of 18) was
deleted outright rather than repaired — which also means the tool no longer catches the one
focus-order problem the old rule did catch. Those are the two results worth quoting.

Both deleted rules are bound by their own definitions to fire on ordinary pages — one trips as soon
as the same control recurs within a few consecutive Tab stops, which icon rows and repeated "read
more" links do constantly — so the case for deleting them does not rest on anyone's opinion. That
is an argument about the **rules**, not a scored result about the individual flags. And no page in
this test is known to contain a real keyboard trap, so the rebuilt check has never been observed to
fire on a real page: this run could not have caught it failing to detect one. What is still
unmeasured is how often the **rebuilt** checker is right when it does raise something; that needs
hand-labelling, and §6 explains why the one attempt at it measured nothing.

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
trap. Every claim that the checker _detects_ traps rests on 6 seeded synthetic variants (6/6) —
recorded on a different set at a different commit, where the legacy detector scored the same 6/6 and
every cell is daggered as "not evidence the seeded change was seen" (§7). So this set gives the
2.1.2 comparison **no opportunity to fail**: there is nothing here for a trap detector to find, and
a checker that never fires would score identically. That is a real limit on the headline.

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

**And treat even that bound as optimistic.** It is a plain binomial bound on the raw page count,
which assumes 8 independent pages — the assumption §7 explicitly denies, since all 8 BAD pages are
one site. No cluster correction is applied anywhere in this report. The numbers above are therefore
anticonservative: the true bound is wider than printed, by an amount this run cannot estimate from
one cluster.

The 2.4.3 row is a **scope cut, not a repair**: the focus-order rule was deleted. It removed 7/7
false alarms at the cost of the single detection it had. Present it as a deletion.

---

## 4. Live sites — the result worth quoting (18 evaluable of 20)

| criterion | before            | after                             | what changed                             |
| --------- | ----------------- | --------------------------------- | ---------------------------------------- |
| 2.1.2     | **12/18 flagged** | **0/16 judged** · worst case 2/18 | periodicity rule → keyboard-trap judge   |
| 2.4.3     | **18/18 flagged** | 0/18                              | **rule deleted**                         |
| 3.2.1     | 0/18              | 2/17 judged (1 undetermined)      | before could not fire on a scripted walk |

> **These are FLAG COUNTS, not precision.** No published labels exist for live sites, so whether
> those 12 are false alarms is not settled by a label. §6 makes the mechanical case; these columns
> stay flag counts.

**The after column is quoted on the pages it judged, not on 18.** §1's rule — an `undetermined`
verdict is a miss, never a pass — applies here too, so folding the refusals into a `0/18` would be
the very error §1 forbids. 2.1.2 has 2 undetermined and 3.2.1 has 1; the "worst case" column is the
rate if every refusal had been a false alarm.

**"Flagged" means the rule fired at some press, not that the page ended trapped.** The agent latches
`trapDetected` on the first `checkTrap` that fires (`packages/agent/src/agent.ts:91-92`), so a page
counts as flagged if `detectTrap()` ever said trapped during the walk. Only **3 of the 12** were
still trapped at the end of it — `zelesta.nl`, `ironplanet.com`, `vdc.ru`; the other 9 had cleared.

**The two undetermined pages are `ekdromi.gr` (`walk-error`) and `zelesta.nl`
(`focusables-changed`) — and `zelesta.nl` is the case against this table.** It is the one live page
whose own telemetry looks like a real confinement (`wraps: 0`, `suspectedTrap: true`, the only such
page in the set), it is the `no-wrap` page of §5, it is one of the 3 the legacy rule still called
trapped at the end of the walk — and the rebuilt judge returned `undetermined`, not `pass`. So the
single live page that most argues the old flag was RIGHT is the page the new checker declined to
decide. §6's mechanical case explicitly scopes around it; §7 records what that costs.

**This table covers only the three criteria that can move.** The same run raised **349 gap flags**
and the 2 context-change flags above on these pages, none of them validated — see §6.

**Why the old rule fired so often — and why our earlier explanation was wrong.**

The old rule reports a trap once the last 5·L focus-identity strings are one block of L strings
repeated 5 times, for any L ≤ 10 — i.e. when the focus sequence **cycles with a period of at most
ten elements**. Ten bounds the repeating unit, not the window: the span the rule inspects is 5·L,
up to 50 elements (`maxHistorySize: 50`, `minCycleCount: 5` in `bench/legacy-detectors.ts`).

An earlier draft of this report claimed that made it a small-page phenomenon, citing 35/35 false
alarms on our hand-built dev pages against 1/8 on the BAD pages. **That explanation does not
survive the live data.** All 12 live pages where it fired are below; they have 32 to ≥467 Tab stops,
and `noticiasdealava.eus` — ≥467 stops — fired at press **5**:

| page                  | Tab stops (F) | fired at press | cycle L | still trapped at end |
| --------------------- | ------------- | -------------- | ------- | -------------------- |
| noticiasdealava.eus   | ≥467          | 5              | 1       | no                   |
| ixi.ru                | 43            | 14             | 1       | no                   |
| anime.nexus           | 160           | 17             | 2       | no                   |
| beardo.in             | 250           | 17             | 1       | no                   |
| lionbridge.com        | ≥162          | 18             | 2       | no                   |
| zelesta.nl            | 151           | 20             | 4       | **yes**              |
| ironplanet.com        | ≥81           | 22             | 1       | **yes**              |
| dfbocai.net           | 68            | 28             | 1       | no                   |
| vdc.ru                | 32            | 60             | 2       | **yes**              |
| infinity-tracking.com | 142           | 71             | 1       | no                   |
| afad.gov.tr           | ≥177          | 75             | 1       | no                   |
| fashionbeans.com      | 209           | 147            | 2       | no                   |

_≥F: a cross-origin frame or closed shadow root may hide Tab stops, so F is a lower bound — the
same mark the generated table carries. F is also not stable between runs: `noticiasdealava.eus`
recorded 490 at `cd3b122` and 467 here, and within this run its focusable count moved 467 → 454
during the walk. The firing press is far more stable than F, which is the point._

Firing at press 5 means an effective cycle length of **one**: five consecutive elements with
identical focus identities. That is the commonest route — 7 of the 12 fired at L=1 — but not the
only one; the other 5 fired on a repeating multi-element block (L=2, and L=4 on `zelesta.nl`). What
predicts the rule firing is not how big a page is but whether the focus sequence contains a **short
repeating run** — and real sites are full of them (repeated "read more" links, icon rows,
pagination). The W3C BAD demo pages are the unusual ones: hand-authored, every control distinct, so
the rule rarely trips there.

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
| `no-wrap`               | 1     | the walk never completed a focus cycle                        |

These reasons come from the **gap detector's own Tab walk**, which is a second walk per page,
separate from the one the judges read (§1). The two can disagree: the judges' walk recorded
`fIncomplete` on a fifth page, `noticiasdealava.eus`, which is why §4 prints its F as a lower bound.

On the BAD set: 0 of 8. **Five** of those six — `afad.gov.tr`, `ekdromi.gr`, `ironplanet.com`,
`lionbridge.com`, `zelesta.nl` — are inside both columns' evaluable 18, and are scored
**undetermined** for 2.1.1 and 2.4.7 in both, dropping the rule-of-three bound there. The sixth,
`topjobs.lk`, never ran the Tab walk or the legacy replay at all, so it is excluded from both
columns as a tool error rather than scored — it is one of the two pages behind "18 evaluable of 20".
Before this run recorded the evidence, the five would have been counted as clean, and `topjobs.lk`'s
gap output — two flags, no `not_focusable` — would have read clean to anyone consuming it.

`no-wrap` is `zelesta.nl`. The gap detector's walk saw no wrap; the judges' walk returned
`confined: false` with `reason: focusables-changed`. The two walks describe the same page
differently, and §4 and §7 both turn on it.

---

## 6. Precision by human label — not established, and the headline does not rest on it

Human-labelled precision was attempted once and is **not** part of this measurement. One 58-item
blind worklist was drawn from the 436 collapsed flag groups at `74c4349` and labelled in full; every
item came back **agree**. The sheet measures nothing, because the claims it put to the reviewer were
not the ones the detectors made:

| criterion | what the detector asserted                                                                                                 | what the worklist asked                                                        |
| --------- | -------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 2.4.3     | "focus returned to previously visited element within short sequence" (`bench/legacy-detectors.ts:251`) — ordinary wrapping | "this page takes focus through its controls in an **illogical order**"         |
| 2.1.2     | the last 5·L focus-identity strings repeat — "a property of the string sequence, not of F" (`bench/legacy.ts:16`)          | "keyboard focus **gets stuck somewhere** on this page and cannot be moved out" |

Neither question can be answered "no" about a real page, so agreement was the honest answer to both
and carries no information. Against the 13 BAD-page items — the only subset with published labels —
the sheet scores 10 of 13, exactly what an unconditional "agree" scores. The reviewer answered what
was asked; the instrument was wrong. `bench/blind-labels.ts` has been repaired — the three
**page-level** claims now name what would make them FALSE, and the worklist asks a reviewer who
agrees to record what they saw. Two limits on that repair: the component-level claims
(`describeGap`, 26 of the 58 items in this draw) still name no falsifier, and the note rule is
instruction to the reviewer, not a constraint the instrument enforces — `bench/spotcheck-ui.ts`
accepts and records an `agree` with an empty note. **The repaired instrument has never been
administered.** The answers are kept at `bench/BLIND-LABELS-answers.json` as the record, and **no
precision figure is quoted from them**.

**The before→after result in §3 and §4 does not depend on this.** Both deleted rules are shown to be
false-alarm generators by their own definitions and by the walk telemetry, with no human judgement
in the loop:

- The legacy **2.4.3** rule fires when focus returns to a previously visited element within a short
  sequence — that is what wrapping _is_. It fired on 18 of 18 evaluable live pages and 8 of 8 BAD
  pages, and W3C's published labels mark 7 of those 8 BAD pages **clean** for 2.4.3. A rule that
  fires on every page cannot be discriminating between them.
- The legacy **2.1.2** rule is explicitly "a property of the string sequence, not of F" — a short
  repeating run of focus identities trips it, so repeated indistinguishable controls (icon rows,
  pagination, "read more" links) fire it on clean pages. On 11 of the 12 live pages it flagged, the
  recorded Tab walk still reached the browser's end-of-tab-order state — focus falling off the
  document — 3 to 60 times, with `focusLost: 0` on 10 of the 11 (`fashionbeans.com` recorded 5). A
  page where forward Tab keeps reaching the end of the document is not holding focus captive.

  Three limits on that telemetry, stated rather than left for a reader to find. **`wraps` and
  `suspectedTrap` are one fact, not two** — `suspectedTrap` is defined as `!steps.some(s =>
s.wrapped)` (`packages/accessibility/src/tab-walk.ts:657`), so quoting both overstates the
  evidence. **A high wrap count does not rule out a trap**, and the repo says so on the very line
  that computes it: "a page that wrapped early and then opened a trapping dialog is invisible to
  `suspectedTrap`" (`packages/accessibility/src/tab-walk.ts:659`), echoed at
  `packages/accessibility/src/keyboard-trap.ts:94` and `:15` ("Repetition alone
  is never evidence"). `vdc.ru` is the clearest case against reading wraps as laps: 60 wraps in 170
  presses with F=32 cannot be 60 traversals of a 32-stop cycle. **And the walk is forward-only** —
  `directionsWalked: ["forward"]` and `release: "not-probed"` on all 12, so no key was ever tested
  for release and a trap armed only on reverse entry is out of scope (`bench/COVERAGE.md:23`).

  **The 12th page is `zelesta.nl`, and it does not fit the pattern.** It is the one live page with
  `wraps: 0` and `suspectedTrap: true`, the legacy rule still called it trapped at the end of the
  walk, and the rebuilt judge returned `undetermined`, not `pass`. The argument above is made about
  11 pages and excludes the one page that most looks like a genuine confinement.

So the **deleted rules** were mechanically bound to misfire — which is a claim about the rules, not
a verdict on each of the 12 flags they raised (§7). What remains unmeasured is the _positive_
precision of what the rebuilt checker now raises — the 349 live gap flags and the 2 new 3.2.1
detections. Quantifying that needs a valid labelling pass, which is deferred, along with the
test–retest κ the brief asks for.

---

## 7. What this does NOT establish

- **2.1.2 detection on real pages.** No held-out page is known to contain a trap; detection evidence
  is 6 synthetic seeded variants — and that 6/6 is weaker than it reads. It was recorded on the
  `dev-variants` set at a different commit (`bench/results/118bb99/REPORT-baseline.md:43`), not in
  this run; the legacy detector scored the identical **6/6 → 6/6** on it; and every cell carries
  that table's own dagger, "the unmodified base page already carries the same flag, so that Y is not
  evidence the seeded change was seen." §9 does not reproduce it.
- **That this run could have caught a 2.1.2 regression.** There is **no positive control**. No BAD
  page fails 2.1.2 (§2) and no live page is known to contain a trap, so every cell the 2.1.2 result
  rests on has "no flag" as its correct answer — a checker hardwired to return `pass` reproduces
  §4's 2.1.2 row exactly. What distinguishes "fixed" from "stopped looking" is not in this run.
- **That the 12 live 2.1.2 flags are false.** §6 shows the rule that raised them was bound to
  misfire, and the walk telemetry contradicts 11 of the 12 — but no published label exists for a
  live site, so this is a strong mechanical case, not a scored result. The 12th, `zelesta.nl`, is
  the one that argues the other way, and the rebuilt judge declined to decide it.
- **Anything about reverse-entry traps.** All 12 walks are `directionsWalked: ["forward"]` with
  `release: "not-probed"`, so the confinement-and-Escape logic — the part that would actually
  adjudicate a trap — never executed on a live page in this measurement (`bench/COVERAGE.md:23`).
- **That the 3.2.1 rule was designed blind to the test set.** `bench/COVERAGE.md:37` records that the F55
  rule "was chosen knowing how the BAD pages fail" — focus removed on arrival is how all four W3C
  Before-and-After pages fail 3.2.1 — and calls it "the most attackable fact in the project".
  `bench/COVERAGE.md:42` records that the 2.4.3 deletion "was decided with held-out numbers in hand". No
  BAD page was opened and no BAD output read, but §2's 4/4 is produced by exactly that rule, and
  this report should not be read without those two disclosures.
- **3.2.1 as an improvement ratio.** The before column is structurally zero on this harness.
- **2.4.7.** The focus-indicator check is built, exported and tested but **not wired into the
  harness**, so 2.4.7 scores only the gap detector's `not_focusable` mapping and **understates** the
  checker. Deliberate; recorded in `COVERAGE.md`.
- **Any single aggregate precision number.** None is computed. A headline "X → Y" must name which
  criteria it aggregates and state that 2.4.3 contributes a deletion, not a fix.
- **A tight bound on the label key.** 20 of 20 spot-checked labels were agreed, but the draw is
  **quota-stratified, not a simple random sample** (8 of 78, 2 of 41, 6 of 48, 4 of 182 — sampling
  fractions 2.2% to 12.5%), so the rule of three does not apply to the pooled 20. Only two of the
  four strata are single uniform draws and carry a valid binomial upper bound: dev page flags
  **77.6%** (2 of 41) and BAD page-level **39.3%** (6 of 48). The other two are themselves quota
  sub-draws (`bench/spotcheck.ts:419`, `planDraws()`), so the same objection applies _inside_ them
  and their bounds — dev element labels 31.2%, BAD element mappings 52.7% — are not valid as
  printed. The spot-check shows the key is not grossly wrong; it does not bound its error rate
  tightly. No notes were recorded against the 20 — every verdict is a bare `agree` — so the file
  carries verdicts without the observations behind them, the same defect §6 diagnoses in the
  58-item pass.
- **Independence.** All 8 BAD pages are one site. Intervals are reported beside cluster counts and
  McNemar is never computed.

## 8. Instrument failures, disclosed

- **The post-fix instrument's first live run was invalid and was discarded.** At `722307b` the
  browser died during `ekdromi.gr`; one browser serves the whole set, so the remaining 14 pages could
  not open a context and were recorded as tool errors while the run still reported `complete` and
  exited 0 — **5 of 20 pages actually measured**. `liveBrowser()` now relaunches a dead browser and
  records it in the summary's notes (that path was never exercised in the reported run — neither
  summary's notes carries a relaunch entry). Both sets were re-run from scratch at `74c4349`. No
  detector rule changed between the two runs, so this is a repaired instrument, not a retuned one.
  `bench/results/722307b/test-live` is left on disk as evidence; **do not cite it**.
- **An earlier live run exists on disk and is not this measurement.** `bench/results/cd3b122/` holds
  a complete 20-page `test-live` from 2026-09-19 — 78 of 80 tool runs ok, better than this run's
  71 of 80, on the same pinned inputs. It is not a discarded re-roll of the reported numbers and was
  not chosen against: it ran at an **earlier detector**, before the gap fixes (4133 live gap flags
  there against 349 here), so it measures different code. It is named here because a report whose
  standing rule is "no held-out set will be re-run to improve a number" should not leave an earlier
  full run of the same 20 sites undisclosed. It also supplies unused before-column stability
  evidence: 10 of the 12 legacy firings land on the identical press across the two runs.
- **The first blind labelling pass measured nothing, because the worklist asked the wrong
  questions.** Each page-level item restated its flag as a WCAG accusation far broader than what the
  detector observed — "an illogical order" for a rule that fires on ordinary focus wrapping, "focus
  gets stuck somewhere" for a rule that is "a property of the string sequence, not of F"
  (`bench/legacy.ts:16`). Neither can be answered "no" about a real page, and all 58 items came back
  `agree`. Against the published W3C labels on the 13 BAD-page items the sheet scores 10 of 13,
  exactly what an unconditional "agree" scores. `bench/blind-labels.ts` has been repaired: the three
  page-level claims are now falsifiable and name what would make them FALSE. The component-level
  claims are not, and the repaired instrument has not been administered — see §6 for both limits.
  The answers are kept at `bench/BLIND-LABELS-answers.json` as the record of the attempt; **do not
  cite them as precision**. See §6. This is an instrument failure, like the browser death above —
  the reviewer answered the questions that were put to them, and the recording path itself is
  covered by 15 tests in `bench/spotcheck-ui.test.ts` (verdict recovery, idempotent rewrites,
  append-only generations, no verdict carried onto the following item): the answers were captured
  as given. The questions were wrong, not the recording.
- **`test-bad` reproduced identically** across the two runs, cell for cell.
- **The spot-check in §7 has the same shape as the pass this section condemns.** All 20 verdicts are
  `agree` with every note empty (`bench/spotcheck-answers.json`). §6's argument — that uniform
  agreement with no observations behind it carries no information — is not obviously weaker when
  applied to the spot-check, and §7's bullet should be read with that in mind.

## 9. Reproducing this

```
git checkout 74c4349          # the run commit; this report was written later
npx tsx bench/fetch-bad.ts    # materialises the pinned W3C BAD copy (bench/vendor/ is gitignored)
npx tsx bench/run.ts test-bad
npx tsx bench/run.ts test-live
npx tsx bench/report.ts 74c4349
```

Three things that block a literal re-run, stated so nobody rediscovers them. `run.ts` **refuses to
start while anything outside `bench/results/` is uncommitted**, untracked files included, and it
stamps results with the tree's current HEAD (`bench/results/<shortSha>/`, or `<shortSha>-dirty`) —
so the `74c4349` directory only reappears from that commit. `bench/report.ts` has changed twice
since the run (`3573a3f`, `793ac59`), so regenerating today runs a different generator than produced
the checked-in `REPORT-baseline.md`. And the 6/6 seeded-trap figure quoted in §2 and §7 is on the
`dev-variants` set at `118bb99`, which none of these commands touches.

Evidence class for every number above: **local run, one machine, `chrome-headless-shell`
143.0.7499.4** (Playwright 1.57.0, axe-core 4.11.0, Node v24.10.0). Not "headless Chromium"
generically: `bench/probes/wrap/RESULT.md` records that wrap behaviour differs between headless
shell, new headless and headed Chromium, and the before column's flag counts are a function of wrap
behaviour — so they would plausibly differ in another browser mode. No verdict here has been
observed in an activated browser, and no LLM agent was run.
