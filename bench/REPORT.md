# Phase 3 — re-measuring the keyboard checker on held-out pages

Run: **`bench/results/74c4349/`** — both held-out sets at one commit, one `run.ts` invocation each.
Generated tables: `bench/results/74c4349/REPORT-baseline.md` (regenerate with
`npx tsx bench/report.ts 74c4349`).

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

| criterion | before            | after                                       | what changed                             |
| --------- | ----------------- | ------------------------------------------- | ---------------------------------------- |
| 2.1.2     | **12/18 flagged** | **0/18** · 2 undetermined (worst case 2/18) | periodicity rule → keyboard-trap judge   |
| 2.4.3     | **18/18 flagged** | 0/18                                        | **rule deleted**                         |
| 3.2.1     | 0/18              | 2/18 · 1 undetermined (worst case 3/18)     | before could not fire on a scripted walk |

> **These are FLAG COUNTS, not precision.** No published labels exist for live sites, so whether
> those 12 are false alarms is not settled by a label. §6 makes the mechanical case; these columns
> stay flag counts.

**Refusals stay in the denominator** (§1), so both after-column cells with a refusal print the worst
case beside the count.

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
  test in `packages/accessibility/src/keyboard-trap.test.ts`. A trap whose loop covers F or more
  distinct stops still reads as the end of the page: one on a page's only Tab stop, a script loop
  over every stop, a region padded with stops F does not count, or an element re-rendered on every
  press. In unactivated new headless (not what the run used), a clean page whose F over-counts and
  whose stops re-render now leans on the release probe. Re-judging all 230 recorded walks on disk with
  the fixed judge (every dev and held-out set whose local raw records hold a walk) changes no
  verdict: all 24 held-out passes (16 live, 8 BAD) came through the other end-of-page signal,
  `body-unfocused`. Every 2.1.2 number here therefore also describes the fixed judge.
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
