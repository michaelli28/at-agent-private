// Baseline report over the bench/run.ts summaries of one commit: the headline detection / false-alarm table on the
// W3C BAD pages (our old checker vs axe-core, per WCAG criterion), the seeded-variant regression grid, and per-page
// flag counts grouped by component for the dev and live sets. Every interval sits next to its cluster count; McNemar
// is never computed (all BAD pages are one site, so paired pages are not independent). Only full-set runs feed the
// tables; --pages subset runs are listed with a SUBSET warning.
//   npx tsx bench/report.ts <shortSha[-dirty]> [--results <dir>]   writes <results>/<sha>/REPORT-baseline.md
import { createHash } from "node:crypto";
import { existsSync, readdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { z } from "zod";
import {
  BaseLabelsFileSchema,
  GAP_TYPES,
  OPERATOR_IDS,
  VariantLabelsFileSchema,
  acceptedGapTypes,
  type BaseLabelsFile,
  type VariantLabels,
  type VariantLabelsFile,
} from "./corpus/labels-schema.js";
import {
  PAGE_SETS,
  PageSetSchema,
  SUBSET_DIR_RE,
  SummarySchema,
  componentKey,
  type PageResult,
  type PageSet,
  type Summary,
  type WalkStats,
} from "./results-schema.js";
import { ruleOfThree, wilson } from "./stats.js";

const BENCH = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(BENCH, "..");

export const HEADLINE_CRITERIA = [
  "2.1.1",
  "2.1.2",
  "2.4.3",
  "2.4.7",
  "3.2.1",
  "4.1.2",
] as const;

// Page-level results of bench/corpus/test/bad-labels.json; only `result` is read ("Fail" / "Pass").
export const BadTruthSchema = z
  .object({
    pages: z.record(
      z.string(),
      z
        .object({
          criteria: z.record(
            z.string(),
            z.object({ result: z.string() }).passthrough(),
          ),
        })
        .passthrough(),
    ),
  })
  .passthrough();
export type BadTruth = z.infer<typeof BadTruthSchema>;

// A --pages run, by the directory it was read from.
export type SubsetRun = { dir: string; summary: Summary };

export type ReportInput = {
  sha: string;
  // Read from <sha>/<set>/. One with a pageFilter (written there by an older harness) is treated as a subset.
  summaries: Partial<Record<PageSet, Summary>>;
  // Read from <sha>/<set>--subset-<hash>/: warned about, never scored.
  subsets: SubsetRun[];
  badTruth: BadTruth | null;
  variantLabels: VariantLabelsFile | null;
  baseLabels: BaseLabelsFile | null;
  // sha256 of each input file now (null = missing), to flag drift since the run; paths not listed are not checked.
  currentInputs: Record<string, string | null>;
};

// Success-criterion tags only: wcag412 -> 4.1.2, wcag1411 -> 1.4.11. Level/version tags (wcag2a, wcag21aa) -> null.
export function criterionFromAxeTag(tag: string): string | null {
  const m = /^wcag(\d)(\d)(\d{1,2})$/.exec(tag);
  return m === null ? null : `${m[1]}.${m[2]}.${m[3]}`;
}

function addTo(
  map: Map<string, Set<string>>,
  criterion: string,
  evidence: string,
): void {
  const set = map.get(criterion) ?? new Set<string>();
  set.add(evidence);
  map.set(criterion, set);
}

// Our old checker's criteria on a page -> what flagged them. Gap criteria are each gap's wcag list, which the
// detector fills from GAP_WCAG_MAPPING (packages/accessibility/src/gaps/gap-detector.ts).
// The agent latches trapDetected on the first checkTrap that fires (packages/agent/src/agent.ts:91-92),
// and the walk replay checks after every press, so "ever trapped" is the old checker's page verdict.
export function legacyTrapFlagged(trap: {
  firstTrappedPress: number | null;
}): boolean {
  return trap.firstTrappedPress !== null;
}

export function ourCriteria(page: PageResult): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const gap of page.tools.gaps.findings ?? []) {
    for (const criterion of gap.wcag)
      addTo(out, criterion, `gap:${gap.gapType}`);
  }
  const legacy = page.tools.legacy.findings;
  if (legacy && legacyTrapFlagged(legacy.trap))
    addTo(out, "2.1.2", "legacy-trap");
  for (const v of legacy?.dynamicViolations ?? [])
    addTo(out, v.criterion, `legacy-dynamic:${v.criterion}`);
  return out;
}

export function axeCriteria(page: PageResult): Map<string, Set<string>> {
  const out = new Map<string, Set<string>>();
  for (const v of page.tools.axe.findings ?? []) {
    for (const tag of v.wcagTags) {
      const criterion = criterionFromAxeTag(tag);
      if (criterion !== null) addTo(out, criterion, v.id);
    }
  }
  return out;
}

const oursRan = (p: PageResult): boolean =>
  p.tools.gaps.findings !== null && p.tools.legacy.findings !== null;
const axeRan = (p: PageResult): boolean => p.tools.axe.findings !== null;

const f2 = (x: number): string => x.toFixed(2);
const plural = (n: number, word: string): string =>
  `${n} ${word}${n === 1 ? "" : "s"}`;
const clusterCount = (pages: readonly PageResult[]): number =>
  new Set(pages.map((p) => p.cluster)).size;

// x/n · p̂ [Wilson 95%]; a zero count on clean pages also gets the rule-of-three upper bound.
function rateCell(x: number, n: number, withRuleOfThree: boolean): string {
  if (n === 0) return "n/a";
  const w = wilson(x, n);
  const cell = `${x}/${n} · ${f2(w.p)} [${f2(w.lower)}, ${f2(w.upper)}]`;
  return withRuleOfThree && x === 0
    ? `${cell} · rule of 3 ≤ ${f2(ruleOfThree(n))}`
    : cell;
}

function tally(labels: Iterable<string>): string {
  const counts = new Map<string, number>();
  for (const l of labels) counts.set(l, (counts.get(l) ?? 0) + 1);
  const sorted = [...counts].sort(
    (a, b) => b[1] - a[1] || (a[0] < b[0] ? -1 : 1),
  );
  return sorted.map(([l, n]) => `${l} ×${n}`).join(", ") || "—";
}

type Scored = { cell: string; evidence: string };

function score(
  pages: readonly PageResult[],
  ran: (p: PageResult) => boolean,
  criteria: (p: PageResult) => Map<string, Set<string>>,
  criterion: string,
  withRuleOfThree: boolean,
): Scored {
  const evaluable = pages.filter(ran);
  const flagged = evaluable.filter((p) => criteria(p).has(criterion));
  const excluded = pages.length - evaluable.length;
  const cell = rateCell(flagged.length, evaluable.length, withRuleOfThree);
  return {
    cell: excluded > 0 ? `${cell} (${excluded} excluded: tool error)` : cell,
    evidence: tally(
      flagged.flatMap((p) => [...(criteria(p).get(criterion) ?? [])]),
    ),
  };
}

function truthResult(
  truth: BadTruth,
  pageId: string,
  criterion: string,
): string | null {
  return truth.pages[pageId]?.criteria[criterion]?.result ?? null;
}

function renderTestBad(summary: Summary, truth: BadTruth | null): string[] {
  const out = ["## test-bad — W3C BAD demo pages (headline)", ""];
  if (truth === null)
    return [
      ...out,
      "bench/corpus/test/bad-labels.json is missing; nothing can be scored.",
      "",
    ];
  if (summary.pages.length === 0)
    return [...out, "No pages recorded in this run.", ""];
  const unlabelled = summary.pages
    .filter((p) => truth.pages[p.pageId] === undefined)
    .map((p) => p.pageId);
  const clusters = clusterCount(summary.pages);
  out.push(
    `Truth: page-level results in bench/corpus/test/bad-labels.json (two independent readers of the W3C evaluation reports). ${plural(summary.pages.length, "page")} from ${plural(clusters, "cluster")}: the Wilson intervals treat pages as independent, which pages of one site are not, so they are too narrow.`,
    "",
    "Ours = gap detector (criteria from each gap's wcag list, i.e. GAP_WCAG_MAPPING) + legacy trap detector (2.1.2) + legacy DynamicEvaluator (by criterion). axe = violations through their wcagNNN tags. Cells: flagged/pages · rate [Wilson 95%]; a zero false-alarm count adds the rule-of-three 95% upper bound (3/pages).",
    "",
    "Each page counts once per criterion, before or after alike: a detection target where its report fails the criterion, a clean page where its report passes it.",
    "",
  );
  if (unlabelled.length > 0)
    out.push(`Not in the truth file (ignored): ${unlabelled.join(", ")}.`, "");

  const table = (result: "Fail" | "Pass"): string[] => {
    const rows = HEADLINE_CRITERIA.map((c) => {
      const pages = summary.pages.filter(
        (p) => truthResult(truth, p.pageId, c) === result,
      );
      const ours = score(pages, oursRan, ourCriteria, c, result === "Pass");
      const axe = score(pages, axeRan, axeCriteria, c, result === "Pass");
      const sides = (["before", "after"] as const)
        .map(
          (side) =>
            `${pages.filter((p) => p.pageId.startsWith(`${side}/`)).length} ${side}`,
        )
        .join(", ");
      const size =
        pages.length === 0
          ? "0 pages"
          : `${plural(pages.length, "page")} (${sides}) / ${plural(clusterCount(pages), "cluster")}`;
      return `| ${c} | ${size} | ${ours.cell} | ${ours.evidence} | ${axe.cell} | ${axe.evidence} |`;
    });
    return [
      `| SC | report says ${result} | ours flagged | ours: flagged by (pages) | axe flagged | axe: rules (pages) |`,
      "|---|---|---|---|---|---|",
      ...rows,
    ];
  };
  out.push(
    "### Detection: pages whose report fails the criterion — flagged?",
    "",
    ...table("Fail"),
    "",
  );
  out.push(
    "### False alarms: pages whose report passes the criterion (clean for it) — flagged?",
    "",
    ...table("Pass"),
    "",
  );

  out.push(
    "#### Per page (F/P = report fails/passes the criterion; O = ours flags it, A = axe flags it, – = not flagged, E = tool error)",
    "",
    `| page | ${HEADLINE_CRITERIA.join(" | ")} |`,
    `|---|${HEADLINE_CRITERIA.map(() => "---").join("|")}|`,
  );
  for (const p of summary.pages) {
    const ours = ourCriteria(p);
    const axe = axeCriteria(p);
    const cells = HEADLINE_CRITERIA.map((c) => {
      const t = truthResult(truth, p.pageId, c);
      const o = !oursRan(p) ? "E" : ours.has(c) ? "O" : "–";
      const a = !axeRan(p) ? "E" : axe.has(c) ? "A" : "–";
      return `${t === "Fail" ? "F" : t === "Pass" ? "P" : "?"} ${o}${a}`;
    });
    out.push(`| ${p.pageId} | ${cells.join(" | ")} |`);
  }
  out.push("");
  return out;
}

type Cell = "Y" | "N" | "E";

// Did the old checker flag the seeded target? M5: legacy trap. M6: legacy 3.2.1. M1-M4: any gap on the target.
function flaggedTarget(
  page: PageResult,
  v: Pick<VariantLabels, "operator" | "target">,
): Cell {
  if (v.operator === "M5" || v.operator === "M6") {
    const legacy = page.tools.legacy.findings;
    if (legacy === null) return "E";
    const hit =
      v.operator === "M5"
        ? legacyTrapFlagged(legacy.trap)
        : legacy.dynamicViolations.some((d) => d.criterion === "3.2.1");
    return hit ? "Y" : "N";
  }
  const gaps = page.tools.gaps.findings;
  if (gaps === null) return "E";
  return gaps.some((g) => g.dataBenchId === v.target) ? "Y" : "N";
}

function renderDevVariants(
  summary: Summary,
  labels: VariantLabelsFile | null,
  fixtures: Summary | undefined,
): string[] {
  const out = [
    "## dev-variants — seeded defects (regression only — not a headline number)",
    "",
  ];
  if (labels === null)
    return [
      ...out,
      "bench/corpus/dev/variants/labels.json is missing; run npx tsx bench/seed.ts.",
      "",
    ];
  const rows = summary.pages.flatMap((page) => {
    const label = labels.variants[page.pageId];
    return label === undefined ? [] : [{ page, label }];
  });
  if (rows.length === 0)
    return [...out, "No labelled variant pages recorded in this run.", ""];
  const bases = [...new Set(rows.map((r) => r.label.base))].sort();
  const operators = OPERATOR_IDS.filter((op) =>
    rows.some((r) => r.label.operator === op),
  );
  out.push(
    "Flagged = a gap on the target's data-bench-id (M1–M4), the legacy trap (M5), legacy 3.2.1 (M6, which a scripted walk can never produce). Y flagged · N missed · E tool error · · no variant. † the unmodified base page (dev-fixtures, same commit) already carries the same flag, so that Y is not evidence the seeded change was seen.",
    "",
    `| operator | ${bases.join(" | ")} |`,
    `|---|${bases.map(() => "---").join("|")}|`,
  );
  for (const op of operators) {
    const cells = bases.map((base) => {
      const hits = rows.filter(
        (r) => r.label.operator === op && r.label.base === base,
      );
      if (hits.length === 0) return "·";
      return hits
        .map(({ page, label }) => {
          const cell = flaggedTarget(page, label);
          const basePage = fixtures?.pages.find((p) => p.pageId === base);
          const dagger =
            cell === "Y" &&
            basePage !== undefined &&
            flaggedTarget(basePage, label) === "Y"
              ? "†"
              : "";
          return `${cell}${dagger}`;
        })
        .join(" ");
    });
    out.push(`| ${op} | ${cells.join(" | ")} |`);
  }
  out.push("");
  const perOp = operators.map((op) => {
    const mine = rows.filter((r) => r.label.operator === op);
    return `${op} ${mine.filter((r) => flaggedTarget(r.page, r.label) === "Y").length}/${mine.length}`;
  });
  out.push(`Flagged per operator: ${perOp.join(" · ")}.`, "");
  if (fixtures === undefined)
    out.push(
      "No dev-fixtures summary at this commit, so † could not be checked.",
      "",
    );

  out.push(
    "#### Gap type on the seeded target",
    "",
    "Rows: labelled gap type. Columns: targets whose element got a gap of that type (an element can get several); acceptable = at least one reported type is in acceptableGapTypes.",
    "",
    `| expected | targets | ${GAP_TYPES.join(" | ")} | (no gap) | acceptable |`,
    `|---|---|${GAP_TYPES.map(() => "---").join("|")}|---|---|`,
  );
  for (const expected of GAP_TYPES) {
    const targets = rows.filter(
      (r) =>
        r.label.elements[r.label.target]?.expectedGapType === expected &&
        r.page.tools.gaps.findings !== null,
    );
    if (targets.length === 0) continue;
    const reported = targets.map(
      (r) =>
        new Set(
          (r.page.tools.gaps.findings ?? [])
            .filter((g) => g.dataBenchId === r.label.target)
            .map((g) => g.gapType),
        ),
    );
    const accepted = targets.filter((r, i) => {
      const label = r.label.elements[r.label.target];
      return (
        label !== undefined &&
        acceptedGapTypes(label).some((t) => reported[i].has(t))
      );
    }).length;
    const byType = GAP_TYPES.map(
      (t) => reported.filter((s) => s.has(t)).length,
    );
    const none = reported.filter((s) => s.size === 0).length;
    out.push(
      `| ${expected} | ${targets.length} | ${byType.join(" | ")} | ${none} | ${accepted}/${targets.length} |`,
    );
  }
  out.push("");
  return out;
}

function componentTallies(page: PageResult): {
  gaps: string;
  axe: string;
  gapComponents: number;
  axeComponents: number;
} {
  const gapKeys = (page.tools.gaps.findings ?? []).map((g) =>
    componentKey(g.nodeName, g.class),
  );
  const axeKeys = (page.tools.axe.findings ?? []).flatMap((v) => v.components);
  return {
    gaps: tally(gapKeys),
    axe: tally(axeKeys),
    gapComponents: new Set(gapKeys).size,
    axeComponents: new Set(axeKeys).size,
  };
}

// The new walk's trap fact; undetermined pages never show a trap or an escape outcome (see WalkTrapSchema).
function walkTrapCell(w: WalkStats): string {
  if (w.trap === "no") return "—";
  if (w.trap === "suspected")
    return `suspected, ${w.escapeReachedAt === null ? "no escape" : `escape @${w.escapeReachedAt}`}`;
  if (w.suspectedTrap === null) return "undetermined (walk error)";
  const causes = [
    ...(w.fIncompleteCauses.crossOriginFrames > 0
      ? [plural(w.fIncompleteCauses.crossOriginFrames, "cross-origin frame")]
      : []),
    ...(w.fIncompleteCauses.closedShadowRoots > 0
      ? [plural(w.fIncompleteCauses.closedShadowRoots, "closed shadow root")]
      : []),
  ];
  return `undetermined (F lower bound: ${causes.join(", ")})`;
}

function trapLabel(labels: BaseLabelsFile | null, pageId: string): string {
  const page = labels?.pages[pageId]?.page;
  if (page === undefined) return "?";
  if (!page.keyboardTrap) return "no trap";
  return page.trapEscapable ? "escapable trap" : "inescapable trap";
}

function renderFlagTable(
  summary: Summary,
  opts: { baseLabels: BaseLabelsFile | null; live: boolean },
): string[] {
  const head = [
    "page",
    "walk: F / wraps",
    "gaps: flags / components",
    "legacy trap",
    "walk trap",
    ...(opts.baseLabels === null ? [] : ["labelled"]),
    "legacy dynamic",
    "axe: nodes / components",
    ...(opts.live ? ["load"] : []),
    "tool errors",
  ];
  const out = [
    `| ${head.join(" | ")} |`,
    `|${head.map(() => "---").join("|")}|`,
  ];
  const details: string[] = [];
  for (const p of summary.pages) {
    const t = componentTallies(p);
    const { gaps, legacy, axe, walk } = p.tools;
    const trap = legacy.findings?.trap;
    const errors = Object.entries(p.tools)
      .filter(([, run]) => run.status !== "ok")
      .map(([tool, run]) => `${tool} ${run.status}: ${run.error}`);
    const load = walk.load ?? gaps.load ?? axe.load;
    const cells = [
      p.pageId,
      walk.findings === null
        ? "E"
        : `${walk.findings.fIncomplete ? "≥" : ""}${walk.findings.F} / ${walk.findings.wraps}${walk.findings.presses < walk.findings.plannedPresses ? ` (${walk.findings.presses}/${walk.findings.plannedPresses} presses)` : ""}`,
      gaps.findings === null
        ? "E"
        : `${gaps.findings.length} / ${t.gapComponents}`,
      trap === undefined
        ? "E"
        : legacyTrapFlagged(trap)
          ? `Y @${trap.firstTrappedPress}${trap.trapped ? ` (cycle ${trap.cycleLength})` : " (clear at end)"}`
          : "N",
      walk.findings === null ? "E" : walkTrapCell(walk.findings),
      ...(opts.baseLabels === null
        ? []
        : [trapLabel(opts.baseLabels, p.pageId)]),
      legacy.findings === null
        ? "E"
        : legacy.findings.dynamicViolations
            .map((v) => v.criterion)
            .join(", ") || "—",
      axe.findings === null
        ? "E"
        : `${axe.findings.reduce((n, v) => n + v.targets.length, 0)} / ${t.axeComponents}`,
      ...(opts.live
        ? [
            load === null
              ? "—"
              : `${load.status ?? "?"}${load.title === "" ? ", empty title" : ""}${load.secondNavigation === "not-expected" ? "" : `, 2nd nav ${load.secondNavigation}`}`,
          ]
        : []),
      errors.join("; ").replaceAll("|", "/") || "—",
    ];
    out.push(`| ${cells.join(" | ")} |`);
    details.push(`- **${p.pageId}** — gaps: ${t.gaps} · axe: ${t.axe}`);
  }
  const lowerBound = summary.pages.some(
    (p) => p.tools.walk.findings?.fIncomplete,
  )
    ? "≥F: a cross-origin frame or closed shadow root may hide Tab stops, so F is a lower bound. "
    : "";
  return [
    ...out,
    "",
    `${lowerBound}Components (NODENAME + sorted class set, ×copies). Many copies of one component are one defect repeated, not independent findings.`,
    "",
    ...details,
    "",
  ];
}

function renderHeader(
  input: ReportInput,
  full: Partial<Record<PageSet, Summary>>,
  subsets: readonly SubsetRun[],
): string[] {
  const summaries = PAGE_SETS.map((s) => full[s]).filter(
    (s): s is Summary => s !== undefined,
  );
  const out = [
    `# Baseline report — ${input.sha}`,
    "",
    "The OLD (pre-fix) checker: the taskgen gap-detector port, plus the legacy KeyboardTrapDetector and DynamicEvaluator replayed over a scripted Tab walk; axe-core alongside for comparison. Regenerate with `npx tsx bench/report.ts " +
      input.sha +
      "`.",
    "",
  ];
  const dirty = summaries.filter((s) => s.git.dirty);
  if (dirty.length > 0) {
    const paths = Math.max(...dirty.map((s) => s.git.dirtyPaths.length));
    out.push(
      `> **DIRTY**: ${dirty.map((s) => s.set).join(", ")} ran with uncommitted changes (up to ${paths} paths), so no commit reproduces them. Re-run on a clean commit before quoting any number.`,
      "",
    );
  }
  for (const { dir, summary } of subsets) {
    out.push(
      `> **SUBSET**: ${dir} ran only ${plural(summary.pages.length, "page")} of ${summary.set} (--pages ${(summary.config.pageFilter ?? []).join(",")}${summary.git.dirty ? ", dirty" : ""}); it is left out of every table below.`,
      "",
    );
  }
  for (const s of summaries.filter((x) => !x.complete)) {
    out.push(
      `> **INCOMPLETE**: ${s.set} has complete:false (the run died or is still going); its numbers cover ${s.pages.length} pages only.`,
      "",
    );
  }
  const drift = summaries.flatMap((s) =>
    s.inputs
      .filter(
        (i) =>
          i.path in input.currentInputs &&
          input.currentInputs[i.path] !== i.sha256,
      )
      .map(
        (i) =>
          `${s.set}: ${i.path} ${input.currentInputs[i.path] === null ? "is missing now" : "changed since the run"}`,
      ),
  );
  if (drift.length > 0) out.push("> **INPUT DRIFT**: " + drift.join("; "), "");

  out.push(
    "| set | complete | pages | clusters | tools not ok | commit | browser | axe-core | run at |",
    "|---|---|---|---|---|---|---|---|---|",
  );
  for (const s of summaries) {
    const notOk = s.pages.reduce(
      (n, p) =>
        n + Object.values(p.tools).filter((t) => t.status !== "ok").length,
      0,
    );
    out.push(
      `| ${s.set} | ${s.complete ? "yes" : "NO"} | ${s.pages.length} | ${clusterCount(s.pages)} | ${notOk} | ${s.git.shortSha}${s.git.dirty ? " (dirty)" : ""} | ${s.launch.mode} ${s.launch.browserVersion} | ${s.axeCoreVersion} | ${s.createdAt} |`,
    );
  }
  const notes = [...new Set(summaries.flatMap((s) => s.notes))];
  out.push(
    "",
    "Method notes (from the run):",
    "",
    ...notes.map((n) => `- ${n}`),
    "",
  );
  return out;
}

export function renderReport(input: ReportInput): string {
  const full: Partial<Record<PageSet, Summary>> = {};
  const subsets = [...input.subsets];
  for (const set of PAGE_SETS) {
    const s = input.summaries[set];
    if (s === undefined) continue;
    if (s.config.pageFilter === null) full[set] = s;
    else subsets.push({ dir: set, summary: s });
  }
  const out = renderHeader(input, full, subsets);
  const bad = full["test-bad"];
  if (bad !== undefined) out.push(...renderTestBad(bad, input.badTruth));
  const variants = full["dev-variants"];
  if (variants !== undefined) {
    out.push(
      ...renderDevVariants(variants, input.variantLabels, full["dev-fixtures"]),
    );
  }
  const fixtures = full["dev-fixtures"];
  if (fixtures !== undefined) {
    out.push(
      "## dev-fixtures — hand-built base pages (regression only)",
      "",
      ...renderFlagTable(fixtures, {
        baseLabels: input.baseLabels,
        live: false,
      }),
    );
  }
  const devLive = full["dev-live"];
  if (devLive !== undefined) {
    out.push(
      "## dev-live — dev sites (regression only)",
      "",
      ...renderFlagTable(devLive, { baseLabels: null, live: true }),
    );
  }
  const testLive = full["test-live"];
  if (testLive !== undefined) {
    out.push(
      "## test-live — pre-registered site draw",
      "",
      "Counts only: precision needs the Phase-3 hand labels, which do not exist yet.",
      "",
      ...renderFlagTable(testLive, { baseLabels: null, live: true }),
    );
  }
  const missing = PAGE_SETS.filter((s) => full[s] === undefined);
  if (missing.length > 0)
    out.push(`No full-set run at this commit: ${missing.join(", ")}.`, "");
  return `${out.join("\n").trimEnd()}\n`;
}

const sha256 = (path: string): string =>
  createHash("sha256").update(readFileSync(path)).digest("hex");
const readJson = (path: string): unknown =>
  JSON.parse(readFileSync(path, "utf8"));

function main(argv: readonly string[]): number {
  const [sha, ...rest] = argv;
  let results = join(BENCH, "results");
  if (rest.length === 2 && rest[0] === "--results") results = resolve(rest[1]);
  else if (rest.length > 0 || sha === undefined || sha.startsWith("-")) {
    console.error(
      "usage: npx tsx bench/report.ts <shortSha[-dirty]> [--results <dir>]",
    );
    return 2;
  }
  const shaDir = join(results, sha);
  const summaries: Partial<Record<PageSet, Summary>> = {};
  const subsets: SubsetRun[] = [];
  const dirs = existsSync(shaDir) ? readdirSync(shaDir).sort() : [];
  for (const dir of dirs) {
    const path = join(shaDir, dir, "summary.json");
    if (!existsSync(path)) continue;
    const set = PageSetSchema.safeParse(dir);
    if (set.success) summaries[set.data] = SummarySchema.parse(readJson(path));
    else if (SUBSET_DIR_RE.test(dir))
      subsets.push({ dir, summary: SummarySchema.parse(readJson(path)) });
  }
  if (Object.keys(summaries).length === 0 && subsets.length === 0) {
    console.error(
      `no summaries under ${shaDir}; run npx tsx bench/run.ts <set> first`,
    );
    return 2;
  }
  const optional = <T>(path: string, schema: z.ZodType<T>): T | null =>
    existsSync(path) ? schema.parse(readJson(path)) : null;
  const currentInputs: Record<string, string | null> = {};
  for (const s of Object.values(summaries)) {
    for (const i of s.inputs) {
      const abs = join(ROOT, i.path);
      currentInputs[i.path] = existsSync(abs) ? sha256(abs) : null;
    }
  }
  const md = renderReport({
    sha,
    summaries,
    subsets,
    badTruth: optional(
      join(BENCH, "corpus", "test", "bad-labels.json"),
      BadTruthSchema,
    ),
    variantLabels: optional(
      join(BENCH, "corpus", "dev", "variants", "labels.json"),
      VariantLabelsFileSchema,
    ),
    baseLabels: optional(
      join(BENCH, "corpus", "dev", "labels.json"),
      BaseLabelsFileSchema,
    ),
    currentInputs,
  });
  const out = join(shaDir, "REPORT-baseline.md");
  writeFileSync(out, md);
  console.log(`wrote ${relative(process.cwd(), out)}`);
  return 0;
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (err: unknown) {
    console.error(err);
    process.exitCode = 1;
  }
}
