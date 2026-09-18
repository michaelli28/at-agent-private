// Draws the test-set live sites exactly per SAMPLING-RULE.md (commit 68ffa0a).
// Where the rule admits two readings, both are computed; if they disagree on the verdict the draw
// STOPS at that candidate instead of picking one. Run (outside the sandbox, launches Chromium):
//   node --import tsx bench/test-sites/draw.ts
import { createHash } from "node:crypto";
import { readFile, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { chromium, errors, type Browser, type Response } from "playwright";
import { z } from "zod";

export const SEED = "at-agent-bench-2026-09-18";
const RANK_LO = 10_001;
const RANK_SPAN = 90_000;
const TARGET_ACCEPTED = 20;

export function rankForIndex(seed: string, i: number): number {
  const u = createHash("sha256")
    .update(`${seed}:${i}`, "ascii")
    .digest()
    .readUInt32BE(0);
  return RANK_LO + (u % RANK_SPAN);
}

export type Candidate = { i: number; rank: number; duplicate: boolean };

export function* markDuplicates(ranks: Iterable<number>): Generator<Candidate> {
  const seen = new Set<number>();
  let i = 0;
  for (const rank of ranks) {
    yield { i, rank, duplicate: seen.has(rank) };
    seen.add(rank);
    i++;
  }
}

function* rankStream(seed: string): Generator<number> {
  for (let i = 0; ; i++) yield rankForIndex(seed, i);
}

export function candidates(seed: string): Generator<Candidate> {
  return markDuplicates(rankStream(seed));
}

/** Index r-1 holds the domain at Tranco rank r; throws unless rows are exactly 1,2,3,… */
export function parseTranco(csv: string): string[] {
  const domains: string[] = [];
  for (const raw of csv.split("\n")) {
    const line = raw.replace(/\r$/, "");
    if (line === "") continue;
    const m = /^(\d+),(\S+)$/.exec(line);
    const row = domains.length + 1;
    if (!m || Number(m[1]) !== row)
      throw new Error(
        `tranco row ${row} malformed or out of order: ${JSON.stringify(line)}`,
      );
    domains.push(m[2]);
  }
  return domains;
}

// ---- rule constants (verbatim from SAMPLING-RULE.md) ----
const BOT_WALL_SOURCE =
  "captcha|verify you are human|just a moment|access denied|unusual traffic|are you a robot|continue shopping";
const FOCUSABLE_SELECTOR =
  'a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])';
const ADULT_KEYWORD = /porn|xxx|sex|adult|escort|nude|hentai/;
const RTA_CONTENTS = ["RTA-5042-1996-1400-1577-RTA", "adult"];
// Short names -> domains as the dev sites were loaded in bench/probes/reach/probe.mjs.
const DEV_SET: Record<string, string> = {
  amazon: "amazon.com",
  mealkeyway: "mealkeyway.com",
  "fake-university": "fake-university.com",
  cmu: "cmu.edu",
  "troy-k12": "troy.k12.mi.us",
  troyroyalpalace: "troyroyalpalace.com",
};
const EXCLUDED_DOMAINS = [...Object.values(DEV_SET), "w3.org"];

// Only failures before any HTTP exchange; anything else (TLS, resets, timeouts) is not clearly "fails to connect".
const CONNECT_FAILURES = new Set([
  "ERR_NAME_NOT_RESOLVED",
  "ERR_NAME_RESOLUTION_FAILED",
  "ERR_CONNECTION_REFUSED",
  "ERR_CONNECTION_TIMED_OUT",
  "ERR_CONNECTION_FAILED",
  "ERR_ADDRESS_UNREACHABLE",
  "ERR_ADDRESS_INVALID",
]);
// Our own network, not the site: abort the run rather than record a verdict.
const ENVIRONMENT_FAILURES = new Set([
  "ERR_INTERNET_DISCONNECTED",
  "ERR_NETWORK_CHANGED",
  "ERR_PROXY_CONNECTION_FAILED",
  "ERR_NETWORK_ACCESS_DENIED",
]);

export function classifyNavError(
  code: string,
): "connect-failure" | "undecided" {
  return CONNECT_FAILURES.has(code) ? "connect-failure" : "undecided";
}

export function urlsFor(domain: string): {
  primary: string;
  fallback: string | null;
} {
  // The rule's fallback prepends www.; for a www.* domain that would be www.www.*, which the rule can't have meant.
  return {
    primary: `https://${domain}/`,
    fallback: domain.startsWith("www.") ? null : `https://www.${domain}/`,
  };
}

function isExcludedHost(host: string): boolean {
  return EXCLUDED_DOMAINS.some((d) => host === d || host.endsWith(`.${d}`));
}

/** Rule 5/6 rejects decidable from the domain alone, so no load is made for them. */
export function domainPrecheck(domain: string): 5 | 6 | null {
  if (ADULT_KEYWORD.test(domain)) return 5;
  if (isExcludedHost(domain)) return 6;
  return null;
}

// ---- observation ----
export type PageFacts = {
  // Rule 3 regex under each reading: case-sensitive/insensitive x raw/whitespace-collapsed text.
  botWall: {
    csRaw: boolean;
    ciRaw: boolean;
    csWs: boolean;
    ciWs: boolean;
    ciAlternatives: string[];
  };
  focusableMain: number;
  // Open shadow roots + child frames; null when a frame could not be counted.
  focusableElsewhere: number | null;
  rtaStrict: boolean;
  rtaLoose: boolean;
};

export type Observation = {
  finalUrl: string | null;
  status: number | null;
  contentType: string | null;
  cfMitigated: "final" | "earlier-only" | "none";
  // Set when the rule's load procedure could not be carried out as written.
  loadIssue: string | null;
  page: PageFacts | null;
};

export type Timing = { settleMs: number; loadTimeoutMs: number };

type InPage = Omit<PageFacts, "focusableElsewhere"> & {
  focusableShadow: number;
  navName: string | null;
  navStatus: number | null;
};

// A string, not a function, so no transpiler helper can leak into the page. Returns booleans and counts only.
const IN_PAGE_SCRIPT = `(() => {
  const SRC = ${JSON.stringify(BOT_WALL_SOURCE)};
  const SEL = ${JSON.stringify(FOCUSABLE_SELECTOR)};
  const RTA = ${JSON.stringify(RTA_CONTENTS)};
  const texts = [document.title || '', document.body ? document.body.innerText || '' : ''];
  const squash = (s) => s.replace(/\\s+/g, ' ');
  const hit = (src, flags, ws) => { const re = new RegExp(src, flags); return texts.some((t) => re.test(ws ? squash(t) : t)); };
  const ciAlternatives = SRC.split('|').filter((a) => hit(a, 'i', false) || hit(a, 'i', true));
  let focusableShadow = 0;
  const walk = (root) => { for (const el of root.querySelectorAll('*')) { if (el.shadowRoot) { focusableShadow += el.shadowRoot.querySelectorAll(SEL).length; walk(el.shadowRoot); } } };
  walk(document);
  const metas = Array.from(document.querySelectorAll('meta[name]')).filter((m) => (m.getAttribute('name') || '').toLowerCase() === 'rating');
  const loweredRta = RTA.map((c) => c.toLowerCase());
  const nav = performance.getEntriesByType('navigation')[0];
  return {
    botWall: { csRaw: hit(SRC, '', false), ciRaw: hit(SRC, 'i', false), csWs: hit(SRC, '', true), ciWs: hit(SRC, 'i', true), ciAlternatives },
    focusableMain: document.querySelectorAll(SEL).length,
    focusableShadow,
    rtaStrict: metas.some((m) => RTA.includes(m.getAttribute('content') || '')),
    rtaLoose: metas.some((m) => loweredRta.includes((m.getAttribute('content') || '').trim().toLowerCase())),
    navName: nav ? nav.name : null,
    navStatus: nav && typeof nav.responseStatus === 'number' ? nav.responseStatus : null,
  };
})()`;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const stripHash = (u: string): string => u.split("#")[0];
const firstLine = (e: unknown): string =>
  String(e instanceof Error ? e.message : e).split("\n")[0];

type Attempt =
  | { kind: "no-response"; code: string }
  | {
      kind: "issue";
      reason: string;
      finalUrl: string | null;
      status: number | null;
    }
  | { kind: "observed"; obs: Observation };

async function cfMitigatedOf(r: Response): Promise<boolean> {
  return (await r.allHeaders())["cf-mitigated"] !== undefined;
}

async function attempt(
  browser: Browser,
  url: string,
  timing: Timing,
): Promise<Attempt> {
  const context = await browser.newContext();
  try {
    const page = await context.newPage();
    const navResponses: Response[] = [];
    page.on("response", (r) => {
      const req = r.request();
      if (req.isNavigationRequest() && req.frame() === page.mainFrame())
        navResponses.push(r);
    });

    try {
      await page.goto(url, {
        waitUntil: "load",
        timeout: timing.loadTimeoutMs,
      });
    } catch (err) {
      const last = navResponses.at(-1);
      if (err instanceof errors.TimeoutError) {
        return {
          kind: "issue",
          reason: `load did not fire within ${timing.loadTimeoutMs} ms (${last ? `got HTTP ${last.status()}` : "no HTTP response"}); the rule sets no timeout`,
          finalUrl: last?.url() ?? null,
          status: last?.status() ?? null,
        };
      }
      const code =
        /net::(ERR_[A-Z0-9_]+)/.exec(firstLine(err))?.[1] ?? firstLine(err);
      if (ENVIRONMENT_FAILURES.has(code))
        throw new Error(
          `environment network failure ${code} at ${url}; aborting the draw`,
        );
      if (!last) return { kind: "no-response", code };
      // Connected and answered with a non-2xx (e.g. an empty-body 404 or a redirect loop): no 2xx document exists.
      if (last.status() < 200 || last.status() > 299) {
        const obs: Observation = {
          finalUrl: last.url(),
          status: last.status(),
          contentType: (await last.allHeaders())["content-type"] ?? null,
          cfMitigated: (await cfMitigatedOf(last)) ? "final" : "none",
          loadIssue: null,
          page: null,
        };
        return { kind: "observed", obs };
      }
      return {
        kind: "issue",
        reason: `navigation failed with ${code} after an HTTP ${last.status()} response`,
        finalUrl: last.url(),
        status: last.status(),
      };
    }

    await page.waitForTimeout(timing.settleMs);

    let inPage: InPage;
    try {
      inPage = (await page.evaluate(IN_PAGE_SCRIPT)) as InPage;
    } catch (err) {
      return {
        kind: "issue",
        reason: `page evaluation at load + ${timing.settleMs} ms failed (${firstLine(err)})`,
        finalUrl: page.url(),
        status: navResponses.at(-1)?.status() ?? null,
      };
    }

    // The final main document is the one present now; match it to the main-frame response that produced it.
    const navName = inPage.navName;
    const final =
      navName === null
        ? undefined
        : navResponses
            .filter(
              (r) =>
                !REDIRECT_STATUSES.has(r.status()) &&
                stripHash(r.url()) === stripHash(navName) &&
                (inPage.navStatus === null ||
                  inPage.navStatus === 0 ||
                  r.status() === inPage.navStatus),
            )
            .at(-1);
    if (!final) {
      return {
        kind: "issue",
        reason: `current document (${navName ?? "no navigation entry"}) matches no main-frame response`,
        finalUrl: page.url(),
        status: null,
      };
    }

    let focusableElsewhere: number | null = inPage.focusableShadow;
    for (const frame of page.frames()) {
      if (frame === page.mainFrame()) continue;
      try {
        focusableElsewhere += await frame.evaluate(
          (sel) => document.querySelectorAll(sel).length,
          FOCUSABLE_SELECTOR,
        );
      } catch {
        focusableElsewhere = null; // uncountable frame: rule 4 becomes undecided if the main document has none
        break;
      }
    }

    let cfMitigated: Observation["cfMitigated"] = "none";
    if (await cfMitigatedOf(final)) cfMitigated = "final";
    else
      for (const r of navResponses)
        if (await cfMitigatedOf(r)) cfMitigated = "earlier-only";

    const {
      navName: _n,
      navStatus: _s,
      focusableShadow: _f,
      ...facts
    } = inPage;
    const obs: Observation = {
      finalUrl: page.url(),
      status: final.status(),
      contentType: (await final.allHeaders())["content-type"] ?? null,
      cfMitigated,
      loadIssue: null,
      page: { ...facts, focusableElsewhere },
    };
    return { kind: "observed", obs };
  } finally {
    await context.close();
  }
}

const issueObs = (
  reason: string,
  finalUrl: string | null,
  status: number | null,
): Observation => ({
  finalUrl,
  status,
  contentType: null,
  cfMitigated: "none",
  loadIssue: reason,
  page: null,
});

/** One load of primaryUrl; one fallback load only when the first clearly fails to connect. */
export async function observe(
  browser: Browser,
  primaryUrl: string,
  fallbackUrl: string | null,
  timing: Timing,
): Promise<Observation> {
  const first = await attempt(browser, primaryUrl, timing);
  if (first.kind === "observed") return first.obs;
  if (first.kind === "issue")
    return issueObs(first.reason, first.finalUrl, first.status);
  if (classifyNavError(first.code) === "undecided") {
    return issueObs(
      `first load failed with ${first.code}; the rule doesn't say whether that counts as "fails to connect" (www retry or not)`,
      null,
      null,
    );
  }
  if (fallbackUrl === null)
    return issueObs(
      `first load failed with ${first.code} but the www fallback is undefined for this domain`,
      null,
      null,
    );
  const second = await attempt(browser, fallbackUrl, timing);
  if (second.kind === "observed") return second.obs;
  if (second.kind === "issue")
    return issueObs(second.reason, second.finalUrl, second.status);
  return {
    finalUrl: null,
    status: null,
    contentType: null,
    cfMitigated: "none",
    loadIssue: null,
    page: null,
  };
}

// ---- judgement ----
type RuleNumber = 1 | 2 | 3 | 4 | 5 | 6;
type RuleOutcome = {
  rule: RuleNumber;
  outcome: "pass" | "fail" | "undecided";
  why?: string;
};
export type Judgement =
  | { result: "accept" }
  | { result: "reject"; rule: RuleNumber }
  | { result: "stop"; reasons: string[] };

const pass = (rule: RuleNumber): RuleOutcome => ({ rule, outcome: "pass" });
const fail = (rule: RuleNumber, why?: string): RuleOutcome => ({
  rule,
  outcome: "fail",
  why,
});
const undecided = (rule: RuleNumber, why: string): RuleOutcome => ({
  rule,
  outcome: "undecided",
  why,
});

function hostOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null; // non-URL (e.g. chrome-error://) carries no host to check
  }
}

function rule1(obs: Observation): RuleOutcome {
  if (obs.status === null) return fail(1, "no HTTP response");
  return obs.status >= 200 && obs.status <= 299
    ? pass(1)
    : fail(1, `status ${obs.status}`);
}

function rule2(obs: Observation): RuleOutcome {
  if (obs.contentType === null)
    return undecided(
      2,
      'no content-type header: rule 2 does not say whether a sniffed document "is HTML"',
    );
  const media = obs.contentType.split(";")[0].trim().toLowerCase();
  if (media === "text/html") return pass(2);
  if (media === "application/xhtml+xml")
    return undecided(
      2,
      'application/xhtml+xml: rule 2 does not say whether XHTML "is HTML"',
    );
  return fail(2, media);
}

function rule3(obs: Observation): RuleOutcome {
  if (obs.cfMitigated === "final")
    return fail(3, "cf-mitigated on the final response");
  if (obs.cfMitigated === "earlier-only")
    return undecided(
      3,
      "cf-mitigated on an earlier main-frame document but not the final one",
    );
  if (obs.page === null) return undecided(3, "page not evaluated");
  const { csRaw, ciRaw, csWs, ciWs, ciAlternatives } = obs.page.botWall;
  const readings = [csRaw, ciRaw, csWs, ciWs];
  if (readings.every(Boolean))
    return fail(3, `bot-wall text (${ciAlternatives.join(", ")})`);
  if (!readings.some(Boolean)) return pass(3);
  return undecided(
    3,
    `bot-wall regex matches only under some readings (case-sensitive raw=${csRaw}, case-insensitive raw=${ciRaw}, case-sensitive whitespace-collapsed=${csWs}, case-insensitive whitespace-collapsed=${ciWs}; case-insensitive alternatives: ${ciAlternatives.join(", ")})`,
  );
}

function rule4(obs: Observation): RuleOutcome {
  if (obs.page === null) return undecided(4, "page not evaluated");
  if (obs.page.focusableMain > 0) return pass(4);
  if (obs.page.focusableElsewhere === null)
    return undecided(
      4,
      "0 focusable in the main document and a child frame could not be counted",
    );
  if (obs.page.focusableElsewhere > 0)
    return undecided(
      4,
      `0 focusable in the main document but ${obs.page.focusableElsewhere} in shadow roots/iframes`,
    );
  return fail(4, "0 focusable");
}

function rule5(domain: string, obs: Observation): RuleOutcome {
  if (ADULT_KEYWORD.test(domain)) return fail(5, "adult keyword in domain");
  if (obs.page?.rtaStrict) return fail(5, "RTA label");
  const finalHost = hostOf(obs.finalUrl);
  if (finalHost !== null && ADULT_KEYWORD.test(finalHost))
    return undecided(
      5,
      `final host ${finalHost} has an adult keyword the candidate domain lacks`,
    );
  if (obs.page === null) return undecided(5, "page not evaluated");
  if (obs.page.rtaLoose)
    return undecided(
      5,
      "rating meta matches the RTA/adult content only after trimming/case-folding",
    );
  return pass(5);
}

function rule6(domain: string, obs: Observation): RuleOutcome {
  if (isExcludedHost(domain)) return fail(6, "dev-set or w3.org domain");
  const finalHost = hostOf(obs.finalUrl);
  if (finalHost !== null && isExcludedHost(finalHost))
    return undecided(
      6,
      `final host ${finalHost} is a dev-set site or w3.org but the candidate domain isn't`,
    );
  const sameName = domain.split(".").find((label) => label in DEV_SET);
  if (sameName !== undefined)
    return undecided(
      6,
      `domain shares the dev-set name "${sameName}" but isn't ${DEV_SET[sameName]}`,
    );
  return pass(6);
}

export function judge(domain: string, obs: Observation): Judgement {
  const loadBound = (rule: RuleNumber, r: RuleOutcome): RuleOutcome =>
    obs.loadIssue === null
      ? r
      : r.outcome === "fail" && (rule === 5 || rule === 6)
        ? r
        : undecided(rule, obs.loadIssue);
  const outcomes = [
    loadBound(1, rule1(obs)),
    loadBound(2, rule2(obs)),
    loadBound(3, rule3(obs)),
    loadBound(4, rule4(obs)),
    loadBound(5, rule5(domain, obs)),
    loadBound(6, rule6(domain, obs)),
  ];
  const failed = outcomes.find((o) => o.outcome === "fail");
  if (failed) return { result: "reject", rule: failed.rule };
  const open = outcomes.filter((o) => o.outcome === "undecided");
  if (open.length > 0)
    return {
      result: "stop",
      reasons: [...new Set(open.map((o) => `rule ${o.rule}: ${o.why}`))],
    };
  return { result: "accept" };
}

// ---- persisted records ----
const RuleNumberSchema = z.union([
  z.literal(1),
  z.literal(2),
  z.literal(3),
  z.literal(4),
  z.literal(5),
  z.literal(6),
]);
const CandidateRecordSchema = z.object({
  i: z.number().int().nonnegative(),
  rank: z
    .number()
    .int()
    .min(RANK_LO)
    .max(RANK_LO + RANK_SPAN - 1),
  domain: z.string().min(1),
  finalUrl: z.string().nullable(),
  status: z.number().int().nullable(),
  contentType: z.string().nullable(),
  result: z.union([
    z.literal("accept"),
    z.literal("duplicate"),
    z.literal("stop"),
    RuleNumberSchema,
  ]),
});
type CandidateRecord = z.infer<typeof CandidateRecordSchema>;

const ListSchema = z.object({
  id: z.literal("V3YPN"),
  url: z.string().url(),
  file: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  rows: z.number().int(),
});
const CandidatesFileSchema = z.object({
  rule: z.string(),
  seed: z.literal(SEED),
  list: ListSchema,
  browser: z.object({
    launch: z.string(),
    version: z.string(),
    userAgent: z.string(),
  }),
  timing: z.object({
    waitUntil: z.literal("load"),
    settleMs: z.number(),
    loadTimeoutMs: z.number(),
  }),
  startedAt: z.string(),
  updatedAt: z.string(),
  complete: z.boolean(),
  acceptedCount: z.number().int(),
  stop: z
    .object({
      i: z.number().int(),
      rank: z.number().int(),
      domain: z.string(),
      reasons: z.array(z.string()),
    })
    .nullable(),
  candidates: z.array(CandidateRecordSchema),
});
type CandidatesFile = z.infer<typeof CandidatesFileSchema>;
const AcceptedFileSchema = z.object({
  seed: z.literal(SEED),
  list: ListSchema.pick({ id: true, sha256: true }),
  complete: z.boolean(),
  accepted: z.array(
    CandidateRecordSchema.pick({
      i: true,
      rank: true,
      domain: true,
      finalUrl: true,
    }),
  ),
});

const HERE = dirname(fileURLToPath(import.meta.url));
const TRANCO_FILE = join(
  HERE,
  "..",
  "vendor",
  "tranco",
  "tranco_V3YPN-1000000.csv",
);
const TIMING: Timing = { settleMs: 3_000, loadTimeoutMs: 60_000 };

async function writeOutputs(file: CandidatesFile): Promise<void> {
  const checked = CandidatesFileSchema.parse(file);
  const accepted = AcceptedFileSchema.parse({
    seed: checked.seed,
    list: { id: checked.list.id, sha256: checked.list.sha256 },
    complete: checked.complete,
    accepted: checked.candidates
      .filter((c) => c.result === "accept")
      .map(({ i, rank, domain, finalUrl }) => ({ i, rank, domain, finalUrl })),
  });
  await writeFile(
    join(HERE, "candidates.json"),
    `${JSON.stringify(checked, null, 2)}\n`,
  );
  await writeFile(
    join(HERE, "accepted.json"),
    `${JSON.stringify(accepted, null, 2)}\n`,
  );
}

async function main(): Promise<void> {
  const csv = await readFile(TRANCO_FILE);
  const domains = parseTranco(csv.toString("utf8"));
  const browser = await chromium.launch();
  try {
    const probe = await browser.newPage();
    const userAgent = await probe.evaluate(() => navigator.userAgent); // about:blank only
    await probe.close();
    const file: CandidatesFile = {
      rule: "bench/test-sites/SAMPLING-RULE.md @ 68ffa0a",
      seed: SEED,
      list: {
        id: "V3YPN",
        url: "https://tranco-list.eu/download/V3YPN/1000000",
        file: "bench/vendor/tranco/tranco_V3YPN-1000000.csv",
        sha256: createHash("sha256").update(csv).digest("hex"),
        rows: domains.length,
      },
      browser: {
        launch: "playwright chromium.launch() default (headless shell)",
        version: browser.version(),
        userAgent,
      },
      timing: { waitUntil: "load", ...TIMING },
      startedAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      complete: false,
      acceptedCount: 0,
      stop: null,
      candidates: [],
    };
    console.log(
      `list sha256=${file.list.sha256} rows=${file.list.rows} browser=${file.browser.version} ua=${userAgent}`,
    );

    for (const c of candidates(SEED)) {
      if (file.acceptedCount >= TARGET_ACCEPTED) break;
      const domain = domains[c.rank - 1];
      if (domain === undefined)
        throw new Error(`rank ${c.rank} missing from the list`);
      let record: CandidateRecord;
      let verdict: Judgement | null = null;
      const pre = c.duplicate ? null : domainPrecheck(domain);
      if (c.duplicate) {
        record = {
          i: c.i,
          rank: c.rank,
          domain,
          finalUrl: null,
          status: null,
          contentType: null,
          result: "duplicate",
        };
      } else if (pre !== null) {
        record = {
          i: c.i,
          rank: c.rank,
          domain,
          finalUrl: null,
          status: null,
          contentType: null,
          result: pre,
        };
      } else {
        const { primary, fallback } = urlsFor(domain);
        const obs = await observe(browser, primary, fallback, TIMING);
        verdict = judge(domain, obs);
        const result =
          verdict.result === "accept"
            ? "accept"
            : verdict.result === "reject"
              ? verdict.rule
              : "stop";
        record = {
          i: c.i,
          rank: c.rank,
          domain,
          finalUrl: obs.finalUrl,
          status: obs.status,
          contentType: obs.contentType,
          result,
        };
      }
      file.candidates.push(record);
      if (record.result === "accept") file.acceptedCount++;
      file.updatedAt = new Date().toISOString();
      console.log(
        `i=${record.i} rank=${record.rank} ${record.domain} -> ${record.result} status=${record.status ?? "-"} final=${record.finalUrl ?? "-"} ctype=${record.contentType ?? "-"}${pre !== null ? " (domain precheck, not loaded)" : ""}`,
      );
      if (verdict?.result === "stop") {
        file.stop = { i: c.i, rank: c.rank, domain, reasons: verdict.reasons };
        console.log(`STOP at i=${c.i}: ${verdict.reasons.join(" | ")}`);
        await writeOutputs(file);
        return;
      }
      await writeOutputs(file);
    }
    file.complete = file.acceptedCount === TARGET_ACCEPTED;
    await writeOutputs(file);
    console.log(
      `DONE accepted=${file.acceptedCount} screened=${file.candidates.length}`,
    );
  } finally {
    await browser.close();
  }
}

if (
  process.argv[1] !== undefined &&
  pathToFileURL(resolve(process.argv[1])).href === import.meta.url
) {
  main().catch((err: unknown) => {
    console.error(err);
    process.exitCode = 1;
  });
}
