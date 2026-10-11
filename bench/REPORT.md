# Phase 3 — re-measuring the keyboard checker on held-out pages

Run: **`bench/results/74c4349/`** — both held-out sets at one commit, one `run.ts` invocation each.
Generated tables: `bench/results/74c4349/REPORT-baseline.md` (regenerate with
`npx tsx bench/report.ts 74c4349`).

**Which checker:** every held-out number in this report describes the checker at `74c4349` plus the
§7 2.1.2 fix. The round-2 to round-4 changes in §10-§12 came later and were not run on held-out
pages. A `file:line` citation that names no commit points into the tree at `4e4a9d6`, the §7 fix's
commit; later commits have moved some of those lines.

**Two things are deferred, not missing:** precision scored by hand-labelling, and the test–retest κ
the brief derives from re-labelling 20 of those items a day later — it depends on the same labelling
(§6 says why the result below does not rest on it). This run also contains no positive control for
the keyboard-trap check; the nearest evidence is on seeded pages at earlier commits (§7).
Everything else is final: whatever this run recorded is the answer, and no held-out set will be
re-run to improve a number.

---

## 🧑 In Plain English

**What this is:** Michael built a tool that checks whether a website can be used with a keyboard
alone. This measures how good it actually is, on websites it was never built or tuned against.

**Why it matters:** anyone can claim their checker works. The only way to know is to try it on
pages chosen in advance, take one scored run, and report whatever comes out.

**What we found:** on the 18 real websites the test could evaluate, the old checker raised a
keyboard-trap alarm on **12** (on 9 of them the alarm had cleared before the walk ended); the
rebuilt checker raised **none on the 16 it could judge** and declined to decide the other 2. One
of the 12 is not clear-cut either way (§4). On another, Chrome's own Tab behaviour bounces focus
between an empty chat-widget frame and the browser's toolbar — a nuisance for a keyboard user, but
not a trap (§6). A second rule that fired on **every single page** (18 of 18) was deleted outright
rather than repaired. On the one demo page that really has a
focus-order problem the tool now raises nothing — but the old rule's flag there was the same one it
raised on every page, so it had not found the problem either. Those are the two results worth
quoting.

Both old rules are bound by their own definitions to fire on ordinary pages. The focus-order rule
trips whenever the same-looking control turns up twice within five Tab stops; the trap rule trips
when five stops in a row look identical, or a short group repeats five times. Rows of icons and
repeated "read more" links produce both constantly. So the case against the old rules does not rest
on anyone's opinion — but it is an argument about the **rules**, not a scored result about each
flag they raised.

No live page in this test is known to contain a real keyboard trap, so this run could not have
caught the rebuilt trap check missing one. The only evidence that it can find a trap at all comes
from practice pages we built and planted traps in — the same pages the check was developed against,
with all six traps made the same way. There it flagged all 6 and none of the 35 without a trap (the
old rule flagged all 41). All six catch focus before the walk has reached every stop the check counted;
the judge as measured passed a trap it meets only after that — on the last stop, among the last few,
or closing after one lap of the page. That is fixed since, except for the cases §7 lists, and
re-judging every recorded walk with the fix changes no verdict (§7). That shows the check is not a constant; it is not a measured detection
rate. What is still unmeasured is how often the **rebuilt** checker is right when it does raise
something on a real site; that needs hand-labelling, and §6 explains why the one attempt at it
measured nothing.

**The honest bit:** the big demo-site numbers are much less impressive than the live ones, and a
figure we were ready to headline earlier (35 of 35 false alarms on our practice pages) came with the
wrong explanation — we blamed our small practice pages, but the live sites show the old rule
misfires on ordinary real-world markup too. Both are written up below rather than quietly dropped.

**Since this run:** four more groups of checker fixes, then five smaller changes, then a change to
how the keyboard walk counts its steps through date and media controls, were tested or measured on
our own pages only, not on any page scored here; §10-§12 list exactly what changed and what it
costs.

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

An `undetermined` verdict stays in every denominator and is never counted as flagged, so refusing to
judge can never buy detection (`bench/report.ts:148-150`). The cost, stated openly: on a false-alarm
or flag count a refusal scores exactly like a clean pass, so those cells also print the worst case —
the rate if every refusal had been a flag. A page whose Tab walk never assessed `not_focusable` is
undetermined for 2.1.1 and 2.4.7 in _both_ columns: it was not observed, and is marked so rather
than silently counted clean.

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

_Every cell predates the round-2 to round-4 fixes (§10-§12) and was not re-run after them._

**The 3.2.1 result is not the improvement it looks like.** The old DynamicEvaluator could only fire
after an agent `navigate` action, and a scripted Tab walk never produces one. Its before column is
**0 by construction, not by measurement**. Never quote "0/4 → 4/4" as a fourfold improvement. The
honest statement: _the new judge detects 4 of 4; the old one could not be measured here at all._

**2.1.2 detection cannot be measured on this set.** Not one of the 8 BAD pages contains a keyboard
trap, so a checker that never fires would score §3's 0/8 exactly. The evidence that the rebuilt
judge can detect a trap is on seeded synthetic pages at earlier commits — 6 of 6 planted traps, no
false trap on 35 other pages — and its limits are in §7. That is a real limit on the headline.

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

_Every cell predates the round-2 to round-4 fixes (§10-§12) and was not re-run after them._

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
false alarms and the 1/1 scored detection — and that detection was raised on the same evidence as
the 7 false alarms (`a | a`, two text-less links a few stops apart; §6), so it had not found the
page's focus-order problem. Present it as a deletion.

---

## 4. Live sites — the result worth quoting (18 evaluable of 20)

| criterion | before                                                | after                                       | what changed                             |
| --------- | ----------------------------------------------------- | ------------------------------------------- | ---------------------------------------- |
| 2.1.2     | **12/18 flagged** · 1 undetermined (worst case 13/18) | **0/18** · 2 undetermined (worst case 2/18) | periodicity rule → keyboard-trap judge   |
| 2.4.3     | **18/18 flagged**                                     | 0/18                                        | **rule deleted**                         |
| 3.2.1     | 0/18                                                  | 2/18 · 1 undetermined (worst case 3/18)     | before could not fire on a scripted walk |

_Every cell predates the round-2 to round-4 fixes (§10-§12) and was not re-run after them._

> **These are FLAG COUNTS, not precision.** No published labels exist for live sites, so whether
> those 12 are false alarms is not settled by a label. §6 makes the mechanical case; these columns
> stay flag counts.

**Undetermined pages stay in the denominator** (§1), so every cell with one prints the worst case
beside the count. In the before column it is `ekdromi.gr`: the page budget cut its walk after press
2,719 of 4,680, and the old rule had not fired by then.

**"Flagged" means the rule fired at some press, not that the page ended trapped.** The old agent
latched `trapDetected` on the first `checkTrap` that fired (`packages/agent/src/agent.ts:91-92` at
`d9e2cb5`, the commit the frozen detectors copy; the latch is gone from the current agent), so a
page counts as flagged if `detectTrap()` ever said trapped during the walk. Only **3 of the 12** were
still trapped at the end of it — `zelesta.nl`, `ironplanet.com`, `vdc.ru`; the other 9 had cleared.

**The two undetermined pages are `ekdromi.gr` (`walk-error`) and `zelesta.nl`
(`focusables-changed`), and `zelesta.nl` is the one flagged page where the evidence is mixed.**
Forward Tab never left a dialog in 765 presses, so it is the only live
page with `wraps: 0`. The flag counted here fired at press 20 inside a 4-stop cookie-consent dialog,
where focus stayed for presses 1–58; it left that dialog only because a discount pop-up took it at
press 59, and no release key was ever tried on the cookie dialog. The release probe ran once, at the end
of the walk, on the pop-up (`escapeReachedAt: 2`; the probe ran on no other live page): Escape did
not move focus, and Shift+Tab reached, on its second press, an element the forward walk had never
seen. Re-running the recorded judge on the recorded walk with only its focusables-changed guard
neutralised calls that **pop-up** escapable — `pass`, released by the opposite key. That is a
counterfactual, not this run's verdict, and it says nothing about the cookie dialog the flag fired
on. The judge declined to decide only because the pop-up added 3 tab stops mid-walk (F 151 → 154).

**This table covers only the three criteria that can move.** The same run raised **347 gap flags**
on these 18 pages (349 across all 20) and context-change flags on 2 of them (`fashionbeans.com`,
`hoolai.com`), none of them validated — see §6.

**Why the old rule fired so often — and why our earlier explanation was wrong.**

The old rule reports a trap once the last 5·L focus-identity strings are one block of L strings
repeated 5 times, for any L ≤ 10 — i.e. when the focus sequence **cycles with a period of at most
ten elements**. Ten bounds the repeating unit, not the window: the span the rule inspects is 5·L,
up to 50 elements (`maxHistorySize: 50`, `minCycleCount: 5` in `bench/legacy-detectors.ts`).

An earlier draft of this report claimed that made it a small-page phenomenon, citing 35/35 false
alarms on our hand-built dev pages against 1/8 on the BAD pages. **That explanation does not
survive the live data.** All 12 live pages where it fired are below; they have 32 to ≥467 Tab stops,
and `noticiasdealava.eus` — ≥467 stops — fired at press **5**:

| page                  | Tab stops (F) | fired at press | cycle L at first fire | still trapped at end |
| --------------------- | ------------- | -------------- | --------------------- | -------------------- |
| noticiasdealava.eus   | ≥467          | 5              | 1                     | no                   |
| ixi.ru                | 43            | 14             | 1                     | no                   |
| anime.nexus           | 160           | 17             | 2                     | no                   |
| beardo.in             | 250           | 17             | 1                     | no                   |
| lionbridge.com        | ≥162          | 18             | 2                     | no                   |
| zelesta.nl            | 151           | 20             | 4                     | **yes**              |
| ironplanet.com        | ≥81           | 22             | 1                     | **yes**              |
| dfbocai.net           | 68            | 28             | 1                     | no                   |
| vdc.ru                | 32            | 60             | 2                     | **yes**              |
| infinity-tracking.com | 142           | 71             | 1                     | no                   |
| afad.gov.tr           | ≥177          | 75             | 1                     | no                   |
| fashionbeans.com      | 209           | 147            | 2                     | no                   |

_≥F: a cross-origin frame or closed shadow root may hide Tab stops, so F is a lower bound — the
same mark the generated table carries. F is also not stable between runs: `noticiasdealava.eus`
recorded 490 at `cd3b122` and 467 here, and within this run its focusable count moved 467 → 454
during the walk. The firing press is far more stable than F, which is the point. "Cycle L at first
fire" is read from the raw file's `legacy.trapByPress`; the generated table's `cycle` is the end
state, which differs (`zelesta.nl`: 4 at first fire, 3 at the end)._

Firing at press 5 means an effective cycle length of **one**: five consecutive elements with
identical focus identities. That is the commonest route — 7 of the 12 fired at L=1 — but not the
only one; the other 5 fired on a repeating multi-element block (L=2, and L=4 on `zelesta.nl`). What
predicts the rule firing is not how big a page is but whether the focus sequence contains a **short
repeating run** — and real sites are full of them (repeated "read more" links, icon rows,
pagination). On the W3C BAD demo pages the trap rule fired only once (`before/home`, press 19): few
of their Tab sequences contain five-fold repeats. Their controls are not all distinct, though —
text-less links collide as the bare identity `a`, which is what fires the 2.4.3 rule on all 8 (§6).

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

_Every cell predates the round-2 to round-4 fixes (§10-§12) and was not re-run after them._

These reasons come from the **gap detector's own Tab walk**, a second walk per page separate from
the one the judges read (recorded in the run's own summary note, `bench/run.ts:96`). The two can
disagree: the judges' walk recorded `fIncomplete` on a fifth page, `noticiasdealava.eus`, which is
why §4 prints its F as a lower bound.

On the BAD set: 0 of 8. **Five** of those six — `afad.gov.tr`, `ekdromi.gr`, `ironplanet.com`,
`lionbridge.com`, `zelesta.nl` — are inside both columns' evaluable 18, and are scored
**undetermined** for 2.1.1 and 2.4.7 in both, dropping the rule-of-three bound there. The sixth,
`topjobs.lk`, is the table's `walk-error` row: its gap-detector walk ran and reached 3,560 elements
before its context was closed, but the page budget was exhausted before the judges' walk started
and the legacy replay was skipped. So it is excluded from both columns as a tool error rather than
scored — it is one of the two pages behind "18 evaluable of 20". Before this run recorded the
evidence, the five would have been counted as clean, and `topjobs.lk`'s gap output — two flags, no
`not_focusable` — would have read clean to anyone consuming it.

`no-wrap` is `zelesta.nl`, and here the two walks agree: neither ever wrapped. The gap walk reached
only 7 elements, the buttons of a cookie dialog and a discount pop-up. The judge's recorded
`confined: false` is not an observation — every `undetermined` verdict carries it
(`packages/accessibility/src/keyboard-trap.ts:156-164`). §4 has the full case.

---

## 6. Precision by human label — not established, and the headline does not rest on it

Human-labelled precision was attempted once and is **not** part of this measurement. One 58-item
blind worklist was drawn from the 436 collapsed flag groups at `74c4349` and labelled in full; every
item came back **agree**. The sheet measures nothing, because the claims it put to the reviewer were
not the ones the detectors made:

| criterion | what the detector asserted                                                                                                                                       | what the worklist asked                                                        |
| --------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| 2.4.3     | "focus returned to previously visited element within short sequence" (`bench/legacy-detectors.ts:251`) — the same-looking control twice within five focus events | "this page takes focus through its controls in an **illogical order**"         |
| 2.1.2     | the last 5·L focus-identity strings repeat — "a property of the string sequence, not of F" (`bench/legacy.ts:16`)                                                | "keyboard focus **gets stuck somewhere** on this page and cannot be moved out" |

Neither question names anything a reviewer could check and find false; each restates the flag as a
page-wide WCAG accusation, so a bare "agree" records no observation. The sheet agreed with all 58,
including the 3 BAD-page items whose published W3C answer is "no" (`before/home` for 2.1.2 and 2.4.3,
`before/news` for 2.4.3). Against the 13 BAD-page items — the only subset with published labels —
the sheet scores 10 of 13, exactly what an unconditional "agree" scores. The reviewer answered what
was asked; the instrument was wrong. `bench/blind-labels.ts` has been repaired — the three
**page-level** claims now name what would make them FALSE, and the worklist asks a reviewer who
agrees to record what they saw. Three limits on that repair: the component-level claims
(`describeGap`, 26 of the 58 items in this draw) still name no falsifier; their wording names the
tool that raised them (each phrase is one of the gap detector's five gap types or an axe rule id, and
no phrase is on both lists), so for those items the source is not hidden; and the note rule is
instruction to the reviewer, not a constraint the instrument enforces — `bench/spotcheck-ui.ts`
accepts and records an `agree` with an empty note. **The repaired instrument has never been
administered.** The answers are kept at `bench/BLIND-LABELS-answers.json` as the record, and **no
precision figure is quoted from them**.

**The before→after result in §3 and §4 does not depend on this.** Both old rules are shown to be
false-alarm generators by their own definitions, with no human judgement in the loop; on 10 of the
12 flagged live pages the walk telemetry is consistent with that, and on an 11th, `vdc.ru`, a
test-informed probe shows why its telemetry looks odd, within the limits below.

- The legacy **2.4.3** rule fires whenever the same focus identity recurs within five consecutive
  focus events (`FOCUS_WINDOW_SIZE = 5`, `bench/legacy-detectors.ts:187`). It therefore acts as a
  wrapping detector only where a whole focus cycle is four stops or fewer — a tiny page or a small
  dialog — and that is rarely what trips it. Replaying the rule over each page's recorded identities:
  on 14 of the 18 evaluable live pages its first firing was two _different_ elements sharing an
  identity string, and on 16 of 18 it came before the walk had wrapped at all (`noticiasdealava.eus`
  fired at press 2 and first wrapped at press 470). The other 4 fired on one element revisited — a
  cookie banner on `ekdromi.gr`, the 4-stop cookie dialog on `zelesta.nl`, an `iframe` on two pages.
  On all 8 BAD pages it fired at press 3 on two text-less links (`a | a`), 7 of them pages W3C marks
  **clean** for 2.4.3. A rule that fires on every page, on the same evidence, cannot be
  discriminating between them.
- The legacy **2.1.2** rule is explicitly "a property of the string sequence, not of F" — five
  identical focus identities in a row, or a block of up to ten repeated five times, trips it, so
  repeated indistinguishable controls (icon rows, pagination, "read more" links) fire it on clean
  pages. On 10 of the 12 live pages it flagged, the recorded Tab walk still reached the browser's
  end-of-tab-order state — focus falling off the document — 3 to 8 times, with `focusLost: 0` on 9
  of the 10 (`fashionbeans.com` recorded 5). Forward Tab that keeps reaching the end of the document
  was not holding focus captive at those presses.

  Limits on that telemetry. **`wraps` and `suspectedTrap` are one fact, not two:** `suspectedTrap`
  is `error ? null : !steps.some((s) => s.wrapped)` (`packages/accessibility/src/tab-walk.ts:657`),
  so this report quotes only `wraps`. **A wrap count does not rule out a trap**, as the comment
  beside that line says: "a page that wrapped early and then opened a trapping dialog is invisible
  to suspectedTrap" (`packages/accessibility/src/tab-walk.ts:658-659`; also
  `packages/accessibility/src/keyboard-trap.ts:93-94`). And every judged walk is forward-only (§7).

  **`vdc.ru`'s loop is real browser behaviour, and not a trap.** Its 60 "wraps" are not laps: from
  press 51 to 170, forward Tab alternated between a chat-widget iframe (Tab reached only the frame's
  own body) and the outside of the document, and never again reached any of the 50 stops it had
  visited before. That loop is what the old rule fired on (press 60, L=2). A follow-up probe
  (`bench/probes/iframe-reentry/`) reproduces it on plain pages with no JavaScript: when the last Tab
  stop is an iframe with nothing to focus inside, Chromium 143 re-enters at that iframe after every
  wrap — in headless shell, new headless and headed mode alike once the window is active. Focus is
  never stuck: each cycle leaves the document, which the recording itself shows for `vdc.ru` (60 of
  60), and on the fixtures Shift+Tab from either half of the loop lands back on the links. So the
  old rule's 2.1.2 alarm is a false one, and the rebuilt judge's `pass` agrees — though its clause 1
  (`packages/accessibility/src/keyboard-trap.ts:114-121`, `:177-179`) passes any walk with a wrap in
  its last F+1 presses, so it would have passed this recording whatever caused the loop. For a
  keyboard user the loop is still a nuisance: forward Tab never returns to the top of the page. It is
  the only live page that re-enters at an iframe after a wrap, in either run; `hostway.com`, whose
  last stop is an iframe holding a button, re-enters at its first link instead. The probe is
  **test-informed** — written after reading this held-out page's walk — and it moved this page out
  of the "not clear-cut" count; it changes no recorded number and no detector. Whether `vdc.ru`'s own
  widget script adds anything is not shown: the site was not revisited, and Shift+Tab was tried only
  on the fixtures.

  **The 12th page is `zelesta.nl`** (§4), the one mixed case: it never wrapped, and its flag fired
  inside a cookie-consent dialog that was never probed for release.

So the old rules were mechanically bound to misfire — a claim about the rules, not a verdict on each
of the 12 flags they raised (§7). What remains unmeasured is the _positive_ precision of what the
rebuilt checker now raises — the 349 live gap flags and the 3.2.1 flags on 2 pages. Quantifying that
needs a valid labelling pass, which is deferred, along with the test–retest κ the brief asks for.

---

## 7. What this does NOT establish

- **2.1.2 detection on real pages.** No held-out page is known to contain a trap, so the detection
  evidence is synthetic. On the seeded `dev-variants` set at `118bb99`
  (`bench/results/118bb99/REPORT-baseline.md:39,43`), repeated at `e1eb294` and `7140b7e` — all
  earlier commits whose `packages/accessibility/src/keyboard-trap.ts` and `tab-walk.ts` are
  byte-identical to this run's — the rebuilt judge returned `fail` on exactly the 6 planted traps
  and on none of the 27 other variants or the 8 base pages, and it passed the 4 modal pages only
  after Escape released them. The legacy
  rule's matching 6/6 there proves nothing: it flagged all 41 pages, which is what that table's
  dagger marks on the _before_ side of every M5 cell — "the unmodified base page (dev-fixtures, same
  commit) already carries the same flag, so that Y is not evidence the seeded change was seen"
  (`:29`). This is **development-set evidence, not held-out evidence**: the pages and the one trap
  operator (M5) are our own, and the judge's end-of-page rules were chosen by how they scored on these
  same 6 fixtures (`packages/accessibility/src/keyboard-trap.ts:23-25`, `:111-113`). It shows the
  check is not a constant; it is not a detection rate. It also missed traps the six never test:
  each catches focus before the walk has reached every counted stop, and the judge as measured
  passed a trap the walk meets only after that — one on the last stop, one cycling among the last
  few, or one that closes only after focus has gone round the page once. Reaching every counted stop
  completes the count, so the "all stops visited" end-of-page rule
  (`packages/accessibility/src/keyboard-trap.ts:132` and `:193` at `74c4349`) passed the page before
  the release probe it had already run was read. Reproduced 2026-09-22 in `chrome-headless-shell` on
  `three-links`: M5 on `link-1` fail, on `link-2` fail, on `link-3` **pass**; a two-button dialog
  appended after the links that cycles Tab between its buttons, **pass**; `link-3` trapping only from
  its second visit, **pass**. **Fixed after the run:** the count now ends the page only if the walk's
  last F+1 presses still reach F distinct stops, which a trap confined to fewer than F stops cannot do
  (`packages/accessibility/src/keyboard-trap.ts:126-129`). All three return `fail` in the headless
  shell and in unactivated new headless, the clean pages tried still pass in both, and each kind is a
  test in `packages/accessibility/src/keyboard-trap.test.ts`. In unactivated new headless (not what
  the run used), a clean page whose F over-counts and whose stops re-render now leans on the release
  probe. Re-judging all 230 recorded walks on disk with the fixed judge (every dev and held-out set
  whose local raw records hold a walk) changes no verdict: all 24 held-out passes (16 live, 8 BAD)
  came through the other end-of-page signal, `body-unfocused`. Every 2.1.2 number here therefore
  also describes the fixed judge. That judge still reads a trap whose loop covers F or more distinct
  stops as the end of the page: one on a page's only Tab stop, a script loop over every stop, a
  region padded with stops F does not count, or an element re-rendered on every press. **Round 2
  changed that after the run, and was not run on held-out pages (§10):** a complete stop count now
  ends the page only after a wrap within the walk's last 2·max(F, L)+1 presses, L being the longest
  lap the walk measured. Without that wrap the release probe decides: Escape, then up to F+2
  Shift+Tabs. A wrap, or Escape replacing the document, releases the page. A key that lands on a stop
  outside the walk's last F+1 presses releases it too, unless those presses reached more stops than
  F: that release is read through node identity and refused, as `undetermined / focusables-exceeded`.
  A probe that gets nowhere fails. So the trap on the only stop, the script loop and the padded
  region now fail; the re-rendered element is refused, not failed, and counts as a miss. A trap where
  only some stops re-render can still pass, and so can one armed too late. The cost falls on clean
  pages.
  With one-press stops and focus starting at the top, a page with 4F+10 or more stops F does not
  count (scrollers) never wraps within the walk and is refused (pinned in `keyboard-trap.test.ts`).
  Until round 4, stops that take several Tab presses (date and time inputs, `<audio controls>`) gave
  wrong verdicts both ways, and `it.fails` pinned five in `tab-walk.test.ts`: a clean page with two
  datetime-local inputs failed; a dialog loop over a date input and a button, a trap, passed; and
  the recent-wrap rule added false fails on clean pages, of which three were pinned: eight scrollers
  then a datetime-local; seven scrollers, a datetime-local and one more scroller; and a link and ten
  scrollers then `<audio controls>`. `bench/COVERAGE.md`'s round-2 section has the full conditions.
  **Round 4 changed that after the run, and was not run on held-out pages (§12):** every count above
  in presses now counts Tab stops, which differ from presses only where Tab visits the parts of one
  control, and the five pass. Closed shadow roots and cross-origin frames keep press counting;
  Firefox and WebKit were not run. The accepted trade: a long clean page with such a control,
  past the 4F+10 bound, that passed only because the walk ended inside the control is now refused.
- **That this run could have caught a 2.1.2 regression.** It contains **no positive control**: no
  BAD page fails 2.1.2 and no live page is known to contain a trap. A checker hardwired to return
  `pass` reproduces §3's 0/8 exactly and would score §4's row as 0/18 with no refusals — the only
  live sign that the judge is not a constant is its two refusals. What distinguishes "fixed" from
  "stopped looking" is the seeded evidence above, not this run.
- **That the 12 live 2.1.2 flags are false.** §6 shows the rule that raised them was bound to
  misfire, the walk telemetry is consistent with a false alarm on 10 of the 12, and a test-informed
  probe shows the 11th, `vdc.ru`, is Chromium's own Tab behaviour rather than a trap (§6) — but no
  published label exists for a live site, so this is a strong mechanical case, not a scored result.
  The 12th, `zelesta.nl`, fired inside a real cookie dialog that was never probed for release (§4).
- **Anything about reverse-entry traps.** Every judged walk is forward-only — one walk per page
  (`bench/run.ts:480`) — so a trap armed only on reverse entry is out of scope
  (`bench/COVERAGE.md:58`). The release probe (Escape, then Shift+Tab) ran on exactly one live page,
  `zelesta.nl`, on its discount pop-up, and got out; the `release: "not-probed"` in that page's
  verdict is the placeholder every `undetermined` carries.
- **That the 3.2.1 rule was designed blind to the test set.** `bench/COVERAGE.md:37` records that
  the F55 rule "was chosen knowing how the BAD pages fail" — focus removed on arrival is how all four
  W3C Before-and-After pages fail 3.2.1 — and calls it "the most attackable fact in the project".
  `bench/COVERAGE.md:42` records that the 2.4.3 deletion "was decided with held-out numbers in
  hand". No BAD page was opened to design the rule and no BAD output was read (`:39`), but §2's 4/4
  is produced by exactly that rule, and this report should not be read without those two
  disclosures. Likewise, the probe that re-classified `vdc.ru` (§6) was designed after reading that
  held-out page's walk.
- **3.2.1 as an improvement ratio.** The before column is structurally zero on this harness.
- **That §2's, §3's and §4's 3.2.1 numbers describe the round-2 to round-4 judge.** The walk reads
  focus about 1 ms after each Tab press and again after the 150 ms settle. Since the settle fix
  (§10), a focus drop first seen at the second read is refused as `focus-removed-after-settle`, not
  reported. That covers any focus removal first seen after the first read, whatever deferred it: a
  timer of 1 ms or more, a CSS animation, or chained `requestAnimationFrame` calls. A removal made
  in the focus handler, or in the next task or frame, still shows at the first read and is still
  reported. Since the idle fix, a change to the `#fragment` alone before the first press no longer
  voids the walk as `undetermined / page-navigates-without-input`, unless the walk also has a
  `focus-removed-after-settle` refusal. Since the arrival fix (§11), a drop can also be reported, or
  refused, when a focus event shows focus arrived since the previous read, the first press included.
  Since round 4 (§12), the short-walk check counts stops, and walks over date and media controls are
  longer. None of these fixes was run on a held-out page, and whether every BAD page's focus removal
  shows at the first read is ASSUMED, not measured (§10).
- **2.4.7.** The focus-indicator check is built, exported and tested but **not wired into the
  harness, the agent or the CLI**, so 2.4.7 scores only the gap detector's `not_focusable` mapping and
  the check itself has no number. Leaving it out of the harness was deliberate (`COVERAGE.md`);
  nothing in the agent or the CLI calls it yet either.
- **Any single aggregate precision number.** None is computed. A headline "X → Y" must name which
  criteria it aggregates and state that 2.4.3 contributes a deletion, not a fix.
- **A tight bound on the label key.** 20 of 20 spot-checked labels were agreed, but the draw is
  **quota-stratified, not a simple random sample** (8 of 78, 2 of 41, 6 of 48, 4 of 182 — sampling
  fractions 2.2% to 12.5%), so the rule of three does not apply to the pooled 20. Per stratum
  (`bench/spotcheck.ts:419`, `planDraws()`): dev page flags **77.6%** (2 of 41) and BAD page-level
  **39.3%** (6 of 48) are single uniform draws with valid binomial upper bounds. BAD element mappings
  **52.7%** (4 of 182) is valid only for the single-reader mappings — all 4 came from that pool,
  because the both-reader sub-draw is allotted only what the single-reader pool cannot fill, which
  here is nothing, so both-reader mappings could never be drawn. Dev element labels are genuinely
  several sub-draws (one per gap operator plus 4 base labels), so the same objection applies inside
  that stratum and its 31.2% is not valid as printed. The spot-check shows the key is not grossly
  wrong; it does not bound its error rate tightly (no notes were recorded against the 20; §8).
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
  full run of the same 20 sites undisclosed. It is not a clean retest of the before column either —
  the Tab walk the legacy rules read changed substantially in between
  (`packages/accessibility/src/tab-walk.ts`: +625 −73) — but it bears on stability. On the 18
  pages walked in both runs the set of flagged pages is identical (12 = 12), and 10 of the 12 fire
  on the identical press; the 13th firing there is `apina.biz`, which this run could not walk. The
  end state is less stable: `beardo.in` ended trapped there and not here, `ironplanet.com` the
  reverse.
- **The first blind labelling pass measured nothing.** This is an instrument failure, like the
  browser death above: the worklist restated each flag as a page-wide WCAG accusation that named
  nothing a reviewer could find false, and all 58 items came back `agree`. §6 has the case, the
  repair and its limits. The answers are kept at `bench/BLIND-LABELS-answers.json`; **do not cite
  them as precision**. The parse, merge and archive helpers the recording goes through are covered
  by 15 tests in `bench/spotcheck-ui.test.ts`; the HTTP handler that wrote each verdict
  (`POST /api/answer`) is not under test.
- **The gap detector's read failures were never recorded.** When a per-element CDP read fails, the
  element loses what that read supplied: a lost click listener or pointer cursor can hide a gap, and
  a lost visibility or disabled/group fact keeps a hidden, disabled or arrow-reachable element in
  play, so a false gap can appear. Some crawl-stage failures drop an element without recording
  anything. `crawlPageWithGapDetection` returns the failures it does record as `errors`, but neither
  `summary.json` (`bench/run.ts`, `toGapsFindings`) nor the raw records keep that list, so this run
  cannot say whether any gap-derived cell (1.1.1, 2.1.1, 2.4.7, 4.1.2) gained or lost a flag that
  way. The gap detector is shared by both columns, so no before/after delta can come from it. The
  run's "never dropped" covers a tool that throws, not these.
- **`test-bad` reproduced identically** across the two runs, cell for cell.
- **The spot-check in §7 shares one flaw with the pass above, not the fatal one.** All 20 verdicts
  are bare `agree`s with empty notes (`bench/spotcheck-answers.json`), so what the reviewer saw is
  not recorded. But each spot-check item was a concrete test with a recorded expected result the
  reviewer could contradict (`bench/SPOTCHECK.md`), unlike §6's questions, which named nothing a
  reviewer could find false.

## 9. Reproducing this

```
git checkout 74c4349          # the run commit; this report was written later
npx tsx bench/run.ts test-bad # fetches the pinned W3C BAD copy if missing, then verifies it
npx tsx bench/run.ts test-live
npx tsx bench/report.ts 74c4349
```

Two things that block a literal re-run, stated so nobody rediscovers them. `run.ts` stamps results
with the tree's current HEAD (`bench/results/<shortSha>/`), so the `74c4349` directory only
reappears from that commit — and **`test-live` refuses to start while anything outside
`bench/results/` is uncommitted**, untracked files included. (`test-bad` and the dev sets accept
`--allow-dirty` and stamp `<shortSha>-dirty`; `test-live` refuses that flag.) And the seeded-trap
figures quoted in the Plain English summary, §2 and §7 are on the `dev-variants` set at `118bb99`,
which none of these commands touches. Do not run `bench/fetch-bad.ts` with no arguments: that mode
re-downloads the W3C site and rewrites the tracked manifest.

Runs A and B (§10), Run C (§11) and Run D (§12) cover the two dev sets only. Each ran from a clean
detached worktree at its commit, so its results are stamped with that commit:

```
git checkout 0a71e4e              # Run A, the old checker; Runs B, C, D: 145b3da, c013aa1, 483fac9
npx tsx bench/seed.ts && npx tsx bench/seed.ts --check
npx tsx bench/run.ts dev-fixtures
npx tsx bench/run.ts dev-variants
npx tsx bench/report.ts 0a71e4e   # 145b3da for Run B, c013aa1 for Run C, 483fac9 for Run D
```

§10's to §12's cells come from the runs' `summary.json` files, compared page by page on
`tools.walk.findings.trap` (verdict and reason), `tools.walk.findings.contextChange.verdict`,
`tools.gaps.findings.gaps` and `tools.gaps.findings.keyboard` (`notFocusableAssessed`,
`unassessedReasons`). §11 and §12 also compare `tools.walk.findings` `focusLost`, `F`, `wraps` and
`presses`, the press list of `contextChange.findings`, and the press and reason of each
`contextChange.unattributed` entry, and §12 every tool's `findings`.

Four figures are hand analyses of the raw files (`bench/results/74c4349/test-live/raw/*.json.gz`),
not generated tables, and no command above prints them: the 2.4.3 replay in §6 (first firing against
first wrap, from `legacy.identities` and `walk.steps[].wrapped`); the `zelesta.nl` counterfactual in
§4 (`judgeKeyboardTrap` on the recorded walk with `focusableCountEnd` set to `focusableCount`); the
`vdc.ru` loop in §6 (`walk.steps[].settled.backendNodeId` from press 51); and §4's "cycle L at first
fire" (`legacy.trapByPress`). Note that `results/**/raw/` is gitignored, so they can be rechecked
only on the machine that ran the set. The mechanism behind the `vdc.ru` loop is reproduced on
script-free fixtures by `bench/probes/iframe-reentry/probe.ts` and `activated.ts` (outside the
sandbox; they open headed windows) — test-informed, since they were written after reading that walk;
results in `bench/probes/iframe-reentry/RESULT.md`.

Evidence class for every number above: **local run, one machine, `chrome-headless-shell`
143.0.7499.4** (Playwright 1.57.0, axe-core 4.11.0, Node v24.10.0). Not "headless Chromium"
generically: `bench/probes/wrap/RESULT.md` ("Verifier corrections") records that wrap behaviour in
new headless and headed Chromium depends on whether the window is activated, while headless shell
behaves like an active window; `bench/probes/iframe-reentry/RESULT.md` found the same for the
`vdc.ru` loop. The before column reads its focus identities off that walk, so its flag counts could
differ under a harness that does not match an active window. No verdict here has been observed in
an activated browser, and no LLM agent was run.

## 10. After the run: round-2 fixes, measured on dev pages only (2026-09-23)

After this run, four branches changed the checker (B1-B4, merged at `145b3da`). They were measured
on the two dev sets only, and **no held-out page was run or re-judged**: §2-§8 describe the previous
checker. Run A is the old checker at `0a71e4e` (`bench/results/0a71e4e/`), Run B the new one at
`145b3da` (`bench/results/145b3da/`), both over the same 13 dev bases and 94 seeded variants; §9 has
the commands. Every changed cell below is on material added for this round after the labels froze
(operators M8-M13, five bases, a portal on `react-div-button`), each piece built to show one fix. The
changes therefore hold by construction: they show that each fix runs on the page built for it, not
how much it helps (`bench/COVERAGE.md`, round-2 section).

**What changed.** Page by page, on the trap verdict and reason, the 3.2.1 verdict, the gap list, and
whether `not_focusable` was assessed and why not, 70 cells change on 55 pages. Each belongs to one
fix, and all but one were predicted before the fixes were built (`one-button__M9`, below).

| fix                    | pages                                                 | cell                   | Run A                                                           | Run B                                                      | cells |
| ---------------------- | ----------------------------------------------------- | ---------------------- | --------------------------------------------------------------- | ---------------------------------------------------------- | ----- |
| 3.2.1 settle fix (B1)  | the 9 M8 variants                                     | 3.2.1                  | fail                                                            | pass: **the fix's cost**                                   | 9     |
| 3.2.1 idle fix (B1)    | 8 M9 variants                                         | 3.2.1                  | undetermined                                                    | fail, same findings                                        | 8     |
| 3.2.1 idle fix (B1)    | `one-button__M9`                                      | 3.2.1                  | undetermined                                                    | pass: a miss the void hid                                  | 1     |
| 2.1.2 recent wrap (B2) | 8 M10 variants, `scroll-panel__M12`, `one-button__M5` | 2.1.2                  | pass                                                            | fail                                                       | 10    |
| 2.1.2 refusal (B2)     | the 9 M11 variants                                    | 2.1.2 verdict, reason  | pass                                                            | undetermined, `focusables-exceeded`: refused, not detected | 18    |
| gap false alarms (B3)  | the 10 M13 variants                                   | gaps                   | `missing_from_a11y_tree` on the decoy, a false alarm            | none                                                       | 10    |
| gap false alarms (B3)  | `native-dialog`                                       | gaps                   | 2 × `missing_from_a11y_tree`                                    | none                                                       | 1     |
| gap false alarms (B3)  | `disclosure-tabs` and 8 of its variants               | gaps                   | the page's own 4 alarms (2 on the M5, M6, M10 and M11 variants) | none of them                                               | 9     |
| gap false alarms (B3)  | `react-div-button`                                    | gaps                   | `wrong_role` on `portal-host` and `add-to-cart-div`             | on `add-to-cart-div` only                                  | 1     |
| gap timing (B4)        | `remount-on-keydown`                                  | gaps, assessed, reason | 2 × `not_focusable`, assessed                                   | none; not assessed, `crawled-nodes-detached`               | 3     |

- The M9 rows also change the 3.2.1 reason: Run A's `undetermined` was
  `page-navigates-without-input` on all 9. "Same findings": the same kind, press and preceding stop;
  only the URLs differ: the local server's port on every finding, and the ticker's `#tick-n` on 24 of
  the 45.
- `one-button__M9` passes where a fail was predicted. Its only stop blurs on arrival, so focus
  never rests on a real element and the walk never sets `focusLost`: the old-checker miss already
  recorded for `one-button__M7`, which the old idle rule's void was hiding (`bench/COVERAGE.md`).
- `disclosure-tabs__M13`, counted in the M13 row, also loses the page's 4 alarms. On
  `disclosure-tabs`, M3, M7 and M9 keep the flag on their own target.
- Unchanged, as predicted: `navbar__M10` fails 2.1.2 in both runs. The 9 M8 targets, `form__M7` and
  `form__M9`, labelled `not_focusable`, get no gap in either run, the known misses pinned in
  `bench/gaps-dev.test.ts`. `one-button__M7` passes 3.2.1, and `scroll-panel__M6` is
  `undetermined / document-replaced`, in both.
- The other 52 pages match Run A on every one of those columns. Of the 41 pages that predate this
  round (8 bases, 33 variants), only `react-div-button` changes, and only on `portal-host`, added
  this round. F, wraps, `focusLost`, the legacy replay's first trap press and the gap walk's reached
  count are equal in the two runs on all 107 pages.

**What these runs MAY be read as saying:**

- On our own dev pages and seeded defects, built after the labels froze and each built to show its
  fix, the new checker changed exactly the cells above.
- The 41 pre-existing dev pages are unchanged, apart from `react-div-button`'s new portal element.
- Evidence class: local end-to-end runs on local pages, one machine, `chrome-headless-shell`
  143.0.7499.4 (Playwright 1.57.0, axe-core 4.11.0, Node v24.10.0). No live site and no held-out
  page was opened.

**What they MAY NOT be read as saying:**

- Any rate, ratio, precision or improvement figure. None is given here.
- That any held-out number in §2-§8 was re-measured or describes the new checker.
- That M8 going from fail to pass is an improvement. M8's target really does lose focus 60 ms after
  it arrives, and the new checker no longer reports it. That is the settle fix's cost.
- That these runs show the settle fix's benefit. They show only its cost. Its benefit, no longer
  blaming a key press for a page timer's focus drop, is shown only by the unit and Chromium tests in
  `packages/accessibility/src/context-change.test.ts` and the local-page walks recorded in
  `bench/COVERAGE.md`.
- That re-render traps (M11) are detected. They are refused, and an `undetermined` counts as a miss.
- That 2.1.2 has no wrong verdicts. The several-press stops and the pinned false fails in §7 stood
  until round 4 (§12), and no dev page has a date, time or media input, so no dev number measures
  them.
- That anything is "fixed" or "works" beyond the evidence class above.

**Direction of effect on the held-out numbers: reasoned from code, not measured.**

- **Settle fix (3.2.1).** It can only remove 3.2.1 findings, so §2's and §4's 3.2.1 counts could
  only fall. §2's detections stand only if each BAD page's focus removal shows at the first read
  after the press; that is ASSUMED.
- **Idle fix (3.2.1).** It can only move a page out of `undetermined / page-navigates-without-input`,
  to `fail`, `pass` or another `undetermined` reason (`walk-error`, `short-walk`), so it can add a
  3.2.1 flag.
- **Recent-wrap rule and refusal (2.1.2).** Every recorded held-out 2.1.2 pass came through
  `body-unfocused` (§7), which neither rule touches, and both refusals (`walk-error` and
  `focusables-changed`, §4) are decided before either rule applies, so re-judging the recorded walks
  would leave every recorded 2.1.2 verdict as it is. The contenteditable count changes F only on a
  page with an editing host; a recorded walk keeps the F it counted, and whether any held-out page has
  one was not checked.
- **Gap false-alarm fixes (B3).** They remove gaps, except where the code changes a flag instead: a
  candidate that loses its semantic signal (a `<details>`) or its listener signal (a React root or
  portal container) but still scores as one and has `cursor: pointer` (with `aria-expanded`, say), and
  that Tab never reaches, goes from `no_accessible_name` or `wrong_role` to `not_focusable`. The
  roving-tablist fix can also add one: a boxless roving group's members now count as reached, so an
  aria-hidden member that Tab skips gets `hidden_but_interactive` (4.1.2) where it got no gap (shown
  on synthetic inputs, not run in Chromium).
- **Gap timing fixes (B4).** They can remove `not_focusable` and `missing_from_a11y_tree`, and can
  turn a page's 2.1.1 and 2.4.7 cells undetermined. On a refused walk the no-walk rules decide, and
  those can add flags: `hidden_but_interactive`, and `wrong_role` on a zero-area Tab stop. A page
  closed during the check after the walk now records no gap result, where it recorded one.

Run A ran at a load of about 5-15 and Run B at about 4-6, both above the limit of about 4 set for
these runs.

## 11. After round 2: round-3 fixes, measured on dev pages only (2026-09-24)

After round 2, five small commits changed or pinned the checker (f1-f5, the last at `c013aa1`). They
were measured on the two dev sets only, and **no held-out page was run or re-judged**: §2-§8
describe the checker at `74c4349` plus the §7 2.1.2 fix, §10 round 2. Run C is the checker at
`c013aa1` (`bench/results/c013aa1/`), over the same 13 dev bases and 94 variants as Run B; §9 has the
commands. What each fix covers and costs is in `bench/COVERAGE.md`, round-3 section.

- f1: a renderer crash fails the gap tool, the Tab walk and the focus check instead of hanging them.
- f2: a crawl mark the page's own script refuses is labelled `crawl-mark-failed`, not
  `document-replaced`.
- f3: F counts an image-map area while the first image naming its map is rendered.
- f4: a test pins the 2F+1 floor on the 2.1.2 recent-wrap window as shipped; no source change.
- f5: a drop is `focusLost` when a focus event since the previous read shows focus arrived.

**What changed.** Page by page, on the columns §10 compares, 2 cells change on 2 pages, both
predicted, none unexpected. Below the verdicts, `focusLost` and the unattributed entries change on 18
pages, the 18 that had a `no-preceding-stop` entry in Run B, and the 3.2.1 findings on 12 of them.
All of it is f5.

| variants                                                                                  | Run B                                                    | Run C                                                        | pages |
| ----------------------------------------------------------------------------------------- | -------------------------------------------------------- | ------------------------------------------------------------ | ----- |
| `one-button__M7`, `one-button__M9`                                                        | 3.2.1 `pass`; 8 drops `no-preceding-stop`, `focusLost` 0 | `fail`; 8 findings, `focusLost` 8                            | 2     |
| M7 and M9 on `disclosure-tabs`, `identical-links`, `js-handlers`, `navbar`, `three-links` | `fail`; press 1 `no-preceding-stop`                      | `fail`; press 1 a finding, `focusLost` +1                    | 10    |
| M8 on those five bases and `one-button`                                                   | `pass`; press 1 `no-preceding-stop`                      | `pass`; press 1 `focus-removed-after-settle`, `focusLost` +1 | 6     |

- F, wraps and presses are equal on all 107 pages, so f3 changes no dev page (none has an `<area>`).
  Every tool ran ok on all 107.
- In the generated report (`bench/results/c013aa1/REPORT-baseline.md`) the M9 operator line goes
  from 8/9 to 9/9 after (`one-button__M9` N → Y). The M7 line stays 8/9: the report scores M7 by its
  target's `not_focusable` gap, which `one-button__M7` already had. The 2.1.2 legend also names
  `focusables-exceeded`, a note the run writes (`bench/run.ts`, changed by `396da6b` after Run B
  ran), not a checker change.

**What Run C MAY be read as saying:**

- On our own dev pages the round-3 checker changed exactly the cells above, and the other 89 pages
  match Run B on every column compared, `focusLost` included.
- f5 reports the blur-on-arrival stop that round 2 recorded as a miss (`one-button__M7` and
  `one-button__M9`). The change was predicted from Run B's walks, on pages that predate f5, so it
  shows the fix runs on the pages it was designed from, not how much it helps.
- Evidence class: local end-to-end runs on local pages, one machine, `chrome-headless-shell`
  143.0.7499.4 (Playwright 1.57.0, axe-core 4.11.0, Node v24.10.0), 1-minute load 3.3-5.0 at the
  set boundaries, at times above the limit of about 4 set for these runs. No live site and no
  held-out page was opened.

**What it MAY NOT be read as saying:**

- Any rate, ratio, precision or improvement figure.
- That any held-out number in §2-§8 was re-measured or describes the round-3 checker.
- That f1, f2 or f3 works on a real page. No dev page crashes, refuses the mark or has an image map,
  so Run C never takes their new paths; their evidence is Chromium tests on synthetic pages
  (`bench/COVERAGE.md`, round-3 section).
- That f5 has no cost. A page script's `el.focus()` counts as an arrival, so a timer that focuses
  and blurs an element between the previous read and a press's immediate read is now reported on the
  first press too, and on pages whose stops never hold focus; no dev page measures that.
- That anything is "fixed" or "works" beyond the evidence class above.

**Direction of effect on the held-out numbers: reasoned from code, not measured.**

- **f1 (crash).** It changes only a page whose renderer crashes: the gap tool and the walk now fail
  within seconds instead of hanging until the page budget, so the page's later tools run, and a
  crash during the gap detector's walk becomes a gap-tool error, excluded from the gap columns,
  where the budget's close gave `walk-error`, kept in them. A crash during the walk tool's own walk
  leaves no walk and so no legacy replay, and the page drops out of both columns, where the budget's
  close gave a partial walk (`undetermined / walk-error`) kept in the denominators. No committed
  summary records a crash, but before f1 a crash while either tool waited on its own CDP session
  left no trace except an exhausted budget; the two held-out overruns (§1) are ASSUMED to be the
  long walks §4 and §5 describe, not crashes.
- **f2 (crawl mark).** It only relabels a refusal: both reasons leave `not_focusable` unassessed, so
  no score moves.
- **f3 (image-map areas).** It changes F only on a page with an image map, and whether any held-out
  page has one was not checked; a recorded walk keeps the F it counted.
- **f4 (floor test).** No source change, so nothing moves.
- **f5 (arrival).** It only adds evidence: a `no-preceding-stop` drop can become a finding (`pass` →
  `fail`) or a `focus-removed-after-settle` refusal. It never removes a 3.2.1 finding, so no `fail`
  becomes `pass`. But a refusal on a walk whose idle check saw a fragment-only change voids the walk,
  so `pass` or `fail` can become `undetermined`. §2's, §3's and §4's 3.2.1 counts can therefore
  rise, and fall only through that void.

## 12. After round 3: stops that take several presses, measured on dev pages only (2026-09-25)

After round 3, one fix (`483fac9`, its tests pinned first in `9cf2aac`) made the Tab walk, its
escape probe, the 2.1.2 judge and the 3.2.1 short-walk check count Tab stops, not Tab presses. A
date, time or media control is one stop, but Tab visits its parts first (month, day, year; play,
timeline, volume), and counting presses gave wrong verdicts both ways (§7). It was measured on the
two dev sets only, and **no held-out page was run or re-judged**: §2-§8 describe the checker at
`74c4349` plus the §7 2.1.2 fix, §10 round 2, §11 round 3. Run D is the checker at `483fac9`
(`bench/results/483fac9/`), over the same 13 dev bases and 94 variants as Run C; §9 has the
commands. What the fix covers and costs is in `bench/COVERAGE.md`, round-4 section.

**What changed.** Nothing, as predicted. On the columns §11 compares, 0 cells change on the 107
pages, and F, wraps, presses (now stops), `focusLost`, 3.2.1 finding presses and unattributed
entries are equal on all 107. A comparison of every tool's findings (walk, gaps, legacy, axe) finds
no other difference than the local server's port and M9's `#tick-n` fragment in 3.2.1 finding URLs
(125 `fromUrl`, 125 `toUrl`) and backend node ids in 2.1.2 regions, one stuck-on stop and 3.2.1
preceding stops (33). Every tool ran ok on all 107. No dev page has a date, time or media control,
and none of Run D's 8695 reads gives a `part`, so every stop there is one press (CONFIRMED: `jq`
over its raw walk records, which are not committed). In the generated report
(`bench/results/483fac9/REPORT-baseline.md`) only the 2.1.2 legend's wording changes: "the walk's
last F+1 stops held more distinct stops than F".

**What the tests show instead.** The fix shows only in unit and Chromium tests on synthetic pages
(chrome-headless-shell 143), not in any run: the five §7 pins and 10 more wrong verdicts now pass
(`bench/COVERAGE.md`, round-4 section).

**What Run D MAY be read as saying:**

- On our own dev pages, counting stops changed nothing: every tool's findings match Run C's apart
  from the URL and node-id differences above.
- Evidence class: local end-to-end runs on local pages, one machine, `chrome-headless-shell`
  143.0.7499.4 (Playwright 1.57.0, axe-core 4.11.0, Node v24.10.0), 1-minute load 3.0-5.5 at the set
  boundaries (5-minute up to 7.0 at the start), at times above the limit of about 4 set for these
  runs. No live site and no held-out page was opened.

**What it MAY NOT be read as saying:**

- Any rate, ratio, precision or improvement figure.
- That any held-out number in §2-§8 was re-measured or describes the round-4 checker.
- That the fix works on a real page. Run D never groups two presses into one stop; its evidence is
  the tests above, on synthetic pages, in one browser build.
- That it has no cost. It has the accepted trade (below; pinned for F = 1 and F = 2); a refusal no
  design predicted on a page found in review whose date input is replaced by a clone as focus moves
  (not pinned); walks of up to 10 presses per stop over such controls (up to 4.9 times the presses
  on the prototype's pages); and up to 4 more DevTools calls per settled read (`bench/COVERAGE.md`,
  round-4 section).
- That 2.1.2 has no wrong verdicts. A trap on a button that is replaced by a clone on every fourth
  Tab passes before and after (not pinned). Closed shadow roots and cross-origin frames keep press
  counting, and Firefox and WebKit were not run.
- That every part of the fix is tested. No test covers the not-found catch, the probe gate, the
  3.2.1 short-walk count or bench's stop counts (`bench/COVERAGE.md`, round-4 section).
- That anything is "fixed" or "works" beyond the evidence class above.

**Direction of effect on the held-out numbers: reasoned from code, not measured.**

- **Recorded walks.** A walk recorded before the fix has no `part`, so it parses with `part` null on
  every read, each press is its own stop, and re-judging it gives what the round-3 judge gives.
- **Pages whose every read gives `part` null** walk and judge as before. That only date, time and
  media controls give a `part` was checked on the element kinds the design tried; for the rest it is
  ASSUMED.
- **Pages with a date, time or media control can move both ways.** Toward the right answer: a clean
  page failed as a trap can pass, and a trap looping through such a control can fail (shown on
  synthetic pages). Toward `undetermined`: a clean page past the 4F+10 bound that passed through a
  release read inside the control is refused (the trade), and a page that re-creates such a control
  as focus moves can be refused even well inside the bound (the clone page above). Whether any
  held-out page has such a control was not checked.
- **Longer walks on those pages.** The gap detector's walk has the same budget in stops, so it can
  reach a wrap where it did not and assess `not_focusable` where it read `no-wrap`; the legacy
  replay reads the longer walk, so the before column can move; the 3.2.1 judge reads more presses,
  so it can add findings or refusals; and a page that ran out of time takes longer still. All
  ASSUMED.
