// Builds the blind labelling worklist Phase 3 needs (prompts/2-at-agent.md): every flag raised on the
// held-out pages, shuffled, with the SOURCE HIDDEN, so precision can be scored without knowing which
// version -- or which tool -- produced each claim while judging it.
//
//   npx tsx bench/blind-labels.ts <shortSha> [--sets test-bad,test-live] [--seed <text>]
//
// Writes bench/BLIND-LABELS.md (spotcheck-shaped, so bench/spotcheck-ui.ts --file drives it) plus
// bench/BLIND-LABELS.key.json, which maps each item back to its source. DO NOT read the key while
// labelling -- it is the thing the blind is hiding, and the report joins on it afterwards.
//
// Grouping: flags are grouped by component (NODENAME + sorted class set) per page, so 210 copies of
// one menu item are ONE judgement, not 210 -- the brief is explicit that copies must not inflate
// precision.
import { createHash } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  PAGE_SETS,
  SummarySchema,
  componentKey,
  type PageResult,
  type PageSet,
  type Summary,
} from "./results-schema.js";

const BENCH = dirname(fileURLToPath(import.meta.url));
const RESULTS = join(BENCH, "results");
const OUT_MD = join(BENCH, "BLIND-LABELS.md");
const OUT_KEY = join(BENCH, "BLIND-LABELS.key.json");
const DEFAULT_SETS: PageSet[] = ["test-bad", "test-live"];

// What produced a claim. Never rendered into the worklist.
export type FlagSource =
  | "before:legacy-trap"
  | "before:legacy-dynamic"
  | "shared:gaps"
  | "after:judge-trap"
  | "after:judge-context-change"
  | "axe";

export type BlindItem = {
  id: string;
  set: PageSet;
  pageId: string;
  url: string;
  // Component, or null for a page-level claim (the 2.1.2 / 3.2.1 / 2.4.3 verdicts).
  component: string | null;
  selector: string | null;
  criterion: string;
  claim: string;
  copies: number;
  source: FlagSource;
};

const sha256 = (s: string): string =>
  createHash("sha256").update(s).digest("hex");

// Deterministic order from the seed: Math.random would make the draw unreproducible, and the shuffle
// has to be re-derivable to defend the result later.
function shuffle<T>(
  items: readonly T[],
  seed: string,
  id: (t: T) => string,
): T[] {
  return [...items].sort((a, b) =>
    sha256(seed + id(a)) < sha256(seed + id(b)) ? -1 : 1,
  );
}

function pageUrl(p: PageResult): string {
  return p.url;
}

function flagsOnPage(set: PageSet, p: PageResult): BlindItem[] {
  const out: BlindItem[] = [];
  const add = (o: Omit<BlindItem, "id" | "set" | "pageId" | "url">): void => {
    out.push({
      ...o,
      set,
      pageId: p.pageId,
      url: pageUrl(p),
      id: sha256(
        [set, p.pageId, o.component ?? "-", o.criterion, o.source].join("|"),
      ).slice(0, 12),
    });
  };

  // Component-level gap flags, collapsed per component + gap type.
  const gaps = p.tools.gaps.findings?.gaps ?? [];
  const byComponent = new Map<
    string,
    { n: number; g: (typeof gaps)[number] }
  >();
  for (const g of gaps) {
    const key = `${componentKey(g.nodeName, g.class)}|${g.gapType}`;
    const seen = byComponent.get(key);
    if (seen) seen.n += 1;
    else byComponent.set(key, { n: 1, g });
  }
  for (const [key, { n, g }] of byComponent) {
    const comp = key.split("|")[0];
    for (const criterion of g.wcag) {
      add({
        component: comp,
        selector:
          g.dataBenchId !== null
            ? `[data-bench-id="${g.dataBenchId}"]`
            : g.id !== null
              ? `#${g.id}`
              : null,
        criterion,
        claim: `${g.gapType.replace(/_/g, " ")} — ${g.nodeName}${g.class === null ? "" : `.${g.class.trim().split(/\s+/).join(".")}`}`,
        copies: n,
        source: "shared:gaps",
      });
    }
  }

  // axe, collapsed the same way so it is judged on equal terms.
  for (const v of p.tools.axe.findings ?? []) {
    const comps = [...new Set(v.components)];
    for (const comp of comps) {
      add({
        component: comp,
        selector: null,
        criterion: v.wcagTags.join(","),
        claim: `${v.id} — ${comp}`,
        copies: v.components.filter((c) => c === comp).length,
        source: "axe",
      });
    }
  }

  // Page-level verdicts: the only place the two versions actually differ.
  const legacy = p.tools.legacy.findings;
  if (legacy && legacy.trap.firstTrappedPress !== null)
    add({
      component: null,
      selector: null,
      criterion: "2.1.2",
      claim: `this page traps keyboard focus${legacy.trap.element === null ? "" : ` at ${legacy.trap.element}`}`,
      copies: 1,
      source: "before:legacy-trap",
    });
  for (const v of legacy?.dynamicViolations ?? [])
    add({
      component: null,
      selector: null,
      criterion: v.criterion,
      claim: v.description,
      copies: 1,
      source: "before:legacy-dynamic",
    });

  const walk = p.tools.walk.findings;
  if (walk?.trap.verdict === "fail")
    add({
      component: null,
      selector: null,
      criterion: "2.1.2",
      claim:
        "this page traps keyboard focus: focus was confined and neither Escape nor the opposite Tab key got out",
      copies: 1,
      source: "after:judge-trap",
    });
  if (walk?.contextChange.verdict === "fail")
    add({
      component: null,
      selector: null,
      criterion: "3.2.1",
      claim:
        "focusing an element on this page changed the context on its own, with no activation",
      copies: 1,
      source: "after:judge-context-change",
    });

  return out;
}

const PAGE_TEST =
  "Open the page fresh. Decide ONE thing: is this claim TRUE of this page? agree = a real defect, disagree = a false alarm, not sure = you could not tell. Judge the claim on its own terms; do not think about which tool said it.";
const COMPONENT_TEST =
  "Open the page fresh and find the component. Decide ONE thing: does it really fail this success criterion? agree = a real defect, disagree = a false alarm, not sure = you could not tell. Judge the claim on its own terms; do not think about which tool said it.";

function render(
  items: readonly BlindItem[],
  seed: string,
  sha: string,
  total: number,
): string {
  const out = [
    "# Blind labelling — held-out flags",
    "",
    items.length === total
      ? `Every flag raised on the held-out pages at ${sha} (${total}), shuffled with seed \`${seed}\`, **source hidden**.`
      : `A stratified sample of ${items.length} of the ${total} flags raised on the held-out pages at ${sha}, drawn per source with seed \`${seed}\`, **source hidden**. Precision is therefore an estimate per source, with an interval -- not a census.`,
    "Judge each claim on its own merits. Which version (or which tool) produced it is in",
    "`BLIND-LABELS.key.json`; do not open that file until every item is labelled, or the blind is gone.",
    "",
    "Copies are collapsed per component, so many copies of one component count once.",
    "",
    `Drive it with: \`npx tsx bench/spotcheck-ui.ts --file bench/BLIND-LABELS.md --port 4175\``,
    "",
    "## Flags",
    "",
  ];
  items.forEach((it, i) => {
    const where =
      it.component === null
        ? "whole page"
        : `${it.component}${it.copies > 1 ? ` ×${it.copies}` : ""}`;
    out.push(
      `${i + 1}. [ ] **${it.pageId} · ${where} · WCAG ${it.criterion}**`,
      `    - open <${it.url}>${it.selector === null ? "" : ` and find \`${it.selector}\``}`,
      `    - test: ${it.component === null ? PAGE_TEST : COMPONENT_TEST}`,
      `    - recorded: claims **${it.criterion}** — ${it.claim}`,
      "    - agree? / note:",
    );
  });
  return `${out.join("\n")}\n`;
}

function readSummary(sha: string, set: PageSet): Summary | null {
  const p = join(RESULTS, sha, set, "summary.json");
  if (!existsSync(p)) return null;
  return SummarySchema.parse(JSON.parse(readFileSync(p, "utf8")));
}

function main(argv: readonly string[]): void {
  const [sha] = argv;
  if (sha === undefined) {
    console.error(
      "usage: npx tsx bench/blind-labels.ts <shortSha> [--sets test-bad,test-live] [--seed <text>]",
    );
    process.exit(2);
  }
  const setsFlag = argv.indexOf("--sets");
  const sets =
    setsFlag === -1
      ? DEFAULT_SETS
      : (argv[setsFlag + 1] ?? "")
          .split(",")
          .filter((s): s is PageSet =>
            (PAGE_SETS as readonly string[]).includes(s),
          );
  const seedFlag = argv.indexOf("--seed");
  const seed =
    seedFlag === -1 ? `blind-${sha}` : (argv[seedFlag + 1] ?? `blind-${sha}`);

  const items: BlindItem[] = [];
  const missing: PageSet[] = [];
  for (const set of sets) {
    const s = readSummary(sha, set);
    if (s === null) {
      missing.push(set);
      continue;
    }
    if (!s.complete)
      console.warn(
        `WARNING: ${set} at ${sha} is incomplete (${s.pages.length} pages); its flags are partial.`,
      );
    for (const p of s.pages) items.push(...flagsOnPage(set, p));
  }
  if (missing.length > 0)
    console.warn(`no summary for: ${missing.join(", ")} — skipped`);
  if (items.length === 0) {
    console.error(`no flags found for ${sha}`);
    process.exit(2);
  }

  // A worklist nobody finishes measures nothing. --sample draws up to N per SOURCE (a stratified
  // draw, the same shape spotcheck.ts uses), so every source gets its own bounded precision instead
  // of one unbounded pile dominated by whichever tool is noisiest.
  const sampleFlag = argv.indexOf("--sample");
  const perSource =
    sampleFlag === -1 ? null : Number(argv[sampleFlag + 1] ?? NaN);
  if (perSource !== null && (!Number.isInteger(perSource) || perSource <= 0)) {
    console.error("--sample must be a positive integer");
    process.exit(2);
  }
  const drawn =
    perSource === null
      ? items
      : [...new Set(items.map((i) => i.source))].flatMap((src) => {
          const pool = shuffle(
            items.filter((i) => i.source === src),
            seed,
            (i) => i.id,
          );
          if (pool.length > perSource)
            console.log(`  ${src}: drew ${perSource} of ${pool.length}`);
          return pool.slice(0, perSource);
        });
  const shuffled = shuffle(drawn, seed, (i) => i.id);
  writeFileSync(OUT_MD, render(shuffled, seed, sha, items.length));
  writeFileSync(
    OUT_KEY,
    `${JSON.stringify(
      {
        sha,
        seed,
        sets,
        // Position in the worklist -> what produced it. The join the report needs afterwards.
        key: shuffled.map((it, i) => ({
          n: i + 1,
          id: it.id,
          set: it.set,
          pageId: it.pageId,
          component: it.component,
          criterion: it.criterion,
          copies: it.copies,
          source: it.source,
        })),
      },
      null,
      2,
    )}\n`,
  );

  const bySource = new Map<FlagSource, number>();
  for (const it of shuffled)
    bySource.set(it.source, (bySource.get(it.source) ?? 0) + 1);
  console.log(`wrote ${resolve(OUT_MD)}  (${shuffled.length} flags to label)`);
  console.log(
    `wrote ${resolve(OUT_KEY)}  — do not read until labelling is done`,
  );
  for (const [s, n] of [...bySource].sort())
    console.log(`  ${String(n).padStart(4)}  ${s}`);
}

const invokedDirectly =
  process.argv[1] !== undefined &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (invokedDirectly) main(process.argv.slice(2));
