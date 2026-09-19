// Draws the test-set live sites per SAMPLING-RULE.md @ 0467eb6, including Amendment 1.
// Anything the amended rule does not settle STOPS the draw at that candidate instead of picking a reading.
// The draw started in 7440778 (i=0..9 frozen), so the only mode is resume. Run outside the sandbox (launches Chromium):
//   node --import tsx bench/test-sites/draw.ts --resume [--max-candidates N]
// candidates.json is saved after every record, so repeated bounded runs continue where the last one paused.
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
export const RULE = "bench/test-sites/SAMPLING-RULE.md @ 0467eb6 (Amendment 1)";

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

// ---- rule constants (verbatim from SAMPLING-RULE.md; case-insensitive per Amendment 1 §3, §5) ----
const BOT_WALL_SOURCE =
  "captcha|verify you are human|just a moment|access denied|unusual traffic|are you a robot|continue shopping";
const FOCUSABLE_SELECTOR =
  'a[href], button, input:not([type=hidden]), select, textarea, [tabindex]:not([tabindex="-1"])';
const ADULT_KEYWORD = /porn|xxx|sex|adult|escort|nude|hentai/i;
const RTA_CONTENTS = ["RTA-5042-1996-1400-1577-RTA", "adult"];
const HTML_MEDIA_TYPES = new Set(["text/html", "application/xhtml+xml"]);
// Amendment 1 §6: registrable domains, each excluded with its subdomains.
const EXCLUDED_DOMAINS = [
  "amazon.com",
  "mealkeyway.com",
  "fake-university.com",
  "cmu.edu",
  "troy.k12.mi.us",
  "troyroyalpalace.com",
  "w3.org",
];

// Amendment 1 §1 families: DNS, TCP, TLS/certificate, reset or closed, empty response, HTTP/2.
const NO_RESPONSE_CODES = new Set([
  "ERR_NAME_NOT_RESOLVED",
  "ERR_NAME_RESOLUTION_FAILED",
  "ERR_CONNECTION_REFUSED",
  "ERR_CONNECTION_TIMED_OUT",
  "ERR_CONNECTION_FAILED",
  "ERR_ADDRESS_UNREACHABLE",
  "ERR_ADDRESS_INVALID",
  "ERR_TIMED_OUT",
  "ERR_CONNECTION_RESET",
  "ERR_CONNECTION_CLOSED",
  "ERR_CONNECTION_ABORTED",
  "ERR_EMPTY_RESPONSE",
  "ERR_BAD_SSL_CLIENT_AUTH_CERT",
]);
const NO_RESPONSE_PREFIXES = [
  "ERR_DNS_",
  "ERR_CERT",
  "ERR_SSL_",
  "ERR_TLS",
  "ERR_ECH_",
  "ERR_HTTP2_",
];
// Our own network, not the site: abort the run rather than record a verdict.
const ENVIRONMENT_FAILURES = new Set([
  "ERR_INTERNET_DISCONNECTED",
  "ERR_NETWORK_CHANGED",
  "ERR_PROXY_CONNECTION_FAILED",
  "ERR_NETWORK_ACCESS_DENIED",
]);

/** Whether a Chromium net error is one Amendment 1 §1 lists as "no HTTP response". */
export function failsToConnect(code: string): boolean {
  return (
    NO_RESPONSE_CODES.has(code) ||
    NO_RESPONSE_PREFIXES.some((p) => code.startsWith(p))
  );
}

export function urlsFor(domain: string): {
  primary: string;
  fallback: string | null;
} {
  return {
    primary: `https://${domain}/`,
    fallback: domain.toLowerCase().startsWith("www.")
      ? null
      : `https://www.${domain}/`,
  };
}

function isExcludedHost(host: string): boolean {
  const h = host.toLowerCase().replace(/\.$/, "");
  return EXCLUDED_DOMAINS.some((d) => h === d || h.endsWith(`.${d}`));
}

/** Rule 5/6 checks on the candidate domain, run before any load (a failing domain is never loaded). */
export function domainPrecheck(domain: string): 5 | 6 | null {
  if (ADULT_KEYWORD.test(domain)) return 5;
  if (isExcludedHost(domain)) return 6;
  return null;
}

// ---- observation ----
export type PageFacts = { botWall: boolean; focusable: number; rta: boolean };

export type Observation = {
  finalUrl: string | null;
  status: number | null;
  contentType: string | null;
  // Lower-cased media type of each Content-Type header on the final response.
  mediaTypes: string[];
  download: boolean;
  // cf-mitigated on any main-frame response during the judged load.
  cfMitigated: boolean;
  fallbackUsed: boolean;
  // Last Chromium net error seen in the screen (primary or fallback), else null.
  netError: string | null;
  // Set when Amendment 1 doesn't settle what this load means: the draw stops.
  loadIssue: string | null;
  page: PageFacts | null;
};

// evalTimeoutMs bounds the one in-page read: a page that never yields its main thread would otherwise hang the run.
export type Timing = {
  settleMs: number;
  loadTimeoutMs: number;
  evalTimeoutMs: number;
};

type InPage = PageFacts & { navName: string | null; navStatus: number | null };

// A string, not a function, so no transpiler helper can leak into the page. Returns booleans and counts only.
const IN_PAGE_SCRIPT = `(() => {
  const re = new RegExp(${JSON.stringify(BOT_WALL_SOURCE)}, 'i');
  const norm = (s) => (s || '').trim().toLowerCase();
  const rta = ${JSON.stringify(RTA_CONTENTS.map((c) => c.toLowerCase()))};
  const nav = performance.getEntriesByType('navigation')[0];
  return {
    botWall: re.test(document.title || '') || re.test(document.body ? document.body.innerText || '' : ''),
    focusable: document.querySelectorAll(${JSON.stringify(FOCUSABLE_SELECTOR)}).length,
    rta: Array.from(document.querySelectorAll('meta[name]')).some((m) => norm(m.getAttribute('name')) === 'rating' && rta.includes(norm(m.getAttribute('content')))),
    navName: nav ? nav.name : null,
    navStatus: nav && typeof nav.responseStatus === 'number' ? nav.responseStatus : null,
  };
})()`;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
const stripHash = (u: string): string => u.split("#")[0];
const firstLine = (e: unknown): string =>
  String(e instanceof Error ? e.message : e).split("\n")[0];
const is2xx = (s: number): boolean => s >= 200 && s <= 299;

type LoadFacts = Pick<
  Observation,
  | "finalUrl"
  | "status"
  | "contentType"
  | "mediaTypes"
  | "download"
  | "cfMitigated"
  | "netError"
  | "page"
>;
type Attempt =
  | { kind: "no-response"; netError: string | null; cfMitigated: boolean }
  | { kind: "response"; facts: LoadFacts }
  | {
      kind: "unsettled";
      reason: string;
      finalUrl: string | null;
      status: number | null;
      netError: string | null;
    };

async function anyCfMitigated(responses: Response[]): Promise<boolean> {
  for (const r of responses)
    if ((await r.allHeaders())["cf-mitigated"] !== undefined) return true;
  return false;
}

async function contentTypeOf(
  r: Response,
): Promise<Pick<Observation, "contentType" | "mediaTypes">> {
  const values = (await r.headersArray())
    .filter((h) => h.name.toLowerCase() === "content-type")
    .map((h) => h.value);
  return {
    contentType: values.length === 0 ? null : values.join(", "),
    mediaTypes: [
      ...new Set(values.map((v) => v.split(";")[0].trim().toLowerCase())),
    ],
  };
}

async function isRedirect(r: Response): Promise<boolean> {
  return (
    REDIRECT_STATUSES.has(r.status()) &&
    (await r.allHeaders()).location !== undefined
  );
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
    let downloaded = false;
    page.on("response", (r) => {
      const req = r.request();
      if (req.isNavigationRequest() && req.frame() === page.mainFrame())
        navResponses.push(r);
    });
    page.on("download", () => {
      downloaded = true;
    });

    try {
      await page.goto(url, {
        waitUntil: "load",
        timeout: timing.loadTimeoutMs,
      });
    } catch (err) {
      const code = /net::(ERR_[A-Z0-9_]+)/.exec(firstLine(err))?.[1] ?? null;
      if (code !== null && ENVIRONMENT_FAILURES.has(code))
        throw new Error(
          `environment network failure ${code} at ${url}; aborting the draw`,
        );
      const last = navResponses.at(-1);
      const doc =
        last === undefined || (await isRedirect(last)) ? undefined : last;
      // Only redirects (or nothing) came back, so the final hop got no response (§1: "a redirect whose target does any of these").
      let noResponse = true;
      for (const r of navResponses)
        if (!(await isRedirect(r))) noResponse = false;
      const cfMitigated = await anyCfMitigated(navResponses);
      const timedOut = err instanceof errors.TimeoutError;
      const unsettled = (reason: string): Attempt => ({
        kind: "unsettled",
        reason: `${reason}; Amendment 1 does not settle this`,
        finalUrl: doc?.url() ?? null,
        status: doc?.status() ?? null,
        netError: code,
      });
      const answered = doc
        ? `after an HTTP ${doc.status()} response`
        : noResponse
          ? "with no HTTP response"
          : "after an earlier main-frame document answered";

      if (noResponse && (timedOut || (code !== null && failsToConnect(code))))
        return { kind: "no-response", netError: code, cfMitigated };
      if (timedOut)
        return unsettled(
          `load did not fire within ${timing.loadTimeoutMs} ms ${answered} (§1 lists "a 60 s load timeout" but defines "fails to connect" as no HTTP response)`,
        );
      // goto can reject before the download event is dispatched, so its message counts too.
      const download =
        downloaded || /Download is starting/.test(firstLine(err));
      // A download is a rule-2 reject (§2); a non-2xx document fails rule 1 whatever error followed it.
      if (doc !== undefined && (download || !is2xx(doc.status())))
        return {
          kind: "response",
          facts: {
            finalUrl: doc.url(),
            status: doc.status(),
            ...(await contentTypeOf(doc)),
            download,
            cfMitigated,
            netError: code,
            page: null,
          },
        };
      return unsettled(
        `${download ? "download started" : `navigation failed with ${code ?? firstLine(err)}`} ${answered}`,
      );
    }

    await page.waitForTimeout(timing.settleMs);

    let inPage: InPage;
    let timer: NodeJS.Timeout | undefined;
    try {
      inPage = (await Promise.race([
        page.evaluate(IN_PAGE_SCRIPT),
        new Promise<never>((_, reject) => {
          timer = setTimeout(
            () =>
              reject(
                new Error(`did not return within ${timing.evalTimeoutMs} ms`),
              ),
            timing.evalTimeoutMs,
          );
        }),
      ])) as InPage;
    } catch (err) {
      return {
        kind: "unsettled",
        reason: `page evaluation at load + ${timing.settleMs} ms failed (${firstLine(err)})`,
        finalUrl: page.url(),
        status: navResponses.at(-1)?.status() ?? null,
        netError: null,
      };
    } finally {
      clearTimeout(timer);
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
        kind: "unsettled",
        reason: `current document (${navName ?? "no navigation entry"}) matches no main-frame response`,
        finalUrl: page.url(),
        status: null,
        netError: null,
      };
    }

    const { botWall, focusable, rta } = inPage;
    return {
      kind: "response",
      facts: {
        finalUrl: page.url(),
        status: final.status(),
        ...(await contentTypeOf(final)),
        download: false,
        cfMitigated: await anyCfMitigated(navResponses),
        netError: null,
        page: { botWall, focusable, rta },
      },
    };
  } finally {
    await context.close();
  }
}

const EMPTY: Omit<Observation, "fallbackUsed" | "netError" | "loadIssue"> = {
  finalUrl: null,
  status: null,
  contentType: null,
  mediaTypes: [],
  download: false,
  cfMitigated: false,
  page: null,
};

function fromAttempt(
  a: Exclude<Attempt, { kind: "no-response" }>,
  fallbackUsed: boolean,
  earlierNetError: string | null,
): Observation {
  if (a.kind === "response")
    return {
      ...a.facts,
      fallbackUsed,
      netError: a.facts.netError ?? earlierNetError,
      loadIssue: null,
    };
  return {
    ...EMPTY,
    finalUrl: a.finalUrl,
    status: a.status,
    fallbackUsed,
    netError: a.netError ?? earlierNetError,
    loadIssue: a.reason,
  };
}

/** One load of primaryUrl; one fallback load only when it gets no HTTP response (Amendment 1 §1). */
export async function observe(
  browser: Browser,
  primaryUrl: string,
  fallbackUrl: string | null,
  timing: Timing,
): Promise<Observation> {
  const first = await attempt(browser, primaryUrl, timing);
  if (first.kind !== "no-response") return fromAttempt(first, false, null);
  if (fallbackUrl === null)
    return {
      ...EMPTY,
      fallbackUsed: false,
      netError: first.netError,
      loadIssue: null,
    };
  if (first.cfMitigated)
    return {
      ...EMPTY,
      fallbackUsed: false,
      netError: first.netError,
      loadIssue:
        "cf-mitigated on a redirect of a load that then failed to connect: Amendment 1 doesn't say whether it counts toward the www fallback's rule 3",
    };
  const second = await attempt(browser, fallbackUrl, timing);
  if (second.kind !== "no-response")
    return fromAttempt(second, true, first.netError);
  return {
    ...EMPTY,
    fallbackUsed: true,
    netError: second.netError ?? first.netError,
    loadIssue: null,
  };
}

// ---- judgement ----
type RuleNumber = 1 | 2 | 3 | 4 | 5 | 6;
export type Judgement =
  | { result: "accept" }
  | { result: "reject"; rule: RuleNumber }
  | { result: "stop"; reasons: string[] };

function hostOf(url: string | null): string | null {
  if (url === null) return null;
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return null; // non-URL carries no host to check
  }
}

/** Accept, or reject on the lowest-numbered failing rule among the checks run (Amendment 1 §7). */
export function judge(domain: string, obs: Observation): Judgement {
  const pre = domainPrecheck(domain);
  if (pre !== null) return { result: "reject", rule: pre };
  if (obs.loadIssue !== null)
    return { result: "stop", reasons: [obs.loadIssue] };
  const reject = (rule: RuleNumber): Judgement => ({ result: "reject", rule });

  if (obs.status === null || !is2xx(obs.status)) return reject(1);
  const html = obs.mediaTypes.map((m) => HTML_MEDIA_TYPES.has(m));
  if (obs.download || !html.some(Boolean)) return reject(2);
  if (!html.every(Boolean))
    return {
      result: "stop",
      reasons: [
        `Content-Type headers disagree on HTML (${obs.contentType}): Amendment 1 §2 doesn't say which one decides`,
      ],
    };
  if (obs.cfMitigated) return reject(3);
  if (obs.page === null)
    return { result: "stop", reasons: ["2xx HTML page was not evaluated"] };
  if (obs.page.botWall) return reject(3);
  if (obs.page.focusable < 1) return reject(4);
  const finalHost = hostOf(obs.finalUrl);
  if (obs.page.rta || (finalHost !== null && ADULT_KEYWORD.test(finalHost)))
    return reject(5);
  if (finalHost !== null && isExcludedHost(finalHost)) return reject(6);
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
// The shape of records before Amendment 1; only the frozen i=0..9 from 7440778 use it.
const LegacyRecordSchema = z
  .object({
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
  })
  .strict();
const CandidateRecordSchema = LegacyRecordSchema.extend({
  fallbackUsed: z.boolean(),
  netError: z.string().nullable(),
}).strict();
type LegacyRecord = z.infer<typeof LegacyRecordSchema>;
type CandidateRecord = z.infer<typeof CandidateRecordSchema>;
type StoredRecord = LegacyRecord | CandidateRecord;

const LEGACY_COMMIT = "7440778";
const LEGACY_COUNT = 10;
// sha256 of JSON.stringify(candidates.slice(0, 10)) of candidates.json @ 7440778.
export const LEGACY_RECORDS_SHA256 =
  "ec89a6667f750de68840b06868184f85c0a03ba35b0b200c0941c4cbd05447d8";

export function legacyRecordsSha256(records: unknown[]): string {
  return createHash("sha256").update(JSON.stringify(records)).digest("hex");
}

const ListSchema = z.object({
  id: z.literal("V3YPN"),
  url: z.string().url(),
  file: z.string(),
  sha256: z.string().regex(/^[0-9a-f]{64}$/),
  rows: z.number().int(),
});
const BrowserSchema = z.object({
  launch: z.string(),
  version: z.string(),
  userAgent: z.string(),
});
const StopSchema = z
  .object({
    i: z.number().int(),
    rank: z.number().int(),
    domain: z.string(),
    reasons: z.array(z.string()),
  })
  .nullable();
// Written before a load starts and cleared with its record, so the next resume can disclose a killed run.
const InFlightSchema = z
  .object({
    i: z.number().int(),
    rank: z.number().int(),
    domain: z.string(),
    startedAt: z.string(),
  })
  .nullable();
const NotesSchema = z.array(z.string());
const LegacyRecordsSchema = z.object({
  note: z.string(),
  commit: z.literal(LEGACY_COMMIT),
  count: z.literal(LEGACY_COUNT),
  rule: z.string(),
  browser: BrowserSchema,
  startedAt: z.string(),
  updatedAt: z.string(),
  stop: StopSchema,
});
type LegacyRecords = z.infer<typeof LegacyRecordsSchema>;
const sharedFileFields = {
  rule: z.string(),
  seed: z.literal(SEED),
  list: ListSchema,
  browser: BrowserSchema,
  timing: z.object({
    waitUntil: z.literal("load"),
    settleMs: z.number(),
    loadTimeoutMs: z.number(),
    // Absent from the 7440778 file, whose evaluation was unbounded.
    evalTimeoutMs: z.number().optional(),
  }),
  startedAt: z.string(),
  updatedAt: z.string(),
  complete: z.boolean(),
  acceptedCount: z.number().int(),
  stop: StopSchema,
};
// candidates.json as committed in 7440778 (before Amendment 1), plus any hand-written notes.
const LegacyFileSchema = z.object({
  ...sharedFileFields,
  notes: NotesSchema.optional(),
  candidates: z.array(LegacyRecordSchema),
});
type LegacyFile = z.infer<typeof LegacyFileSchema>;
export const CandidatesFileSchema = z
  .object({
    ...sharedFileFields,
    notes: NotesSchema,
    legacyRecords: LegacyRecordsSchema,
    inFlight: InFlightSchema,
    candidates: z.array(z.union([CandidateRecordSchema, LegacyRecordSchema])),
  })
  .refine(
    (f) =>
      f.candidates.every((r) => "fallbackUsed" in r === r.i >= LEGACY_COUNT),
    { message: `only i < ${LEGACY_COUNT} may lack fallbackUsed/netError` },
  );
export type CandidatesFile = z.infer<typeof CandidatesFileSchema>;
const AcceptedFileSchema = z.object({
  seed: z.literal(SEED),
  list: ListSchema.pick({ id: true, sha256: true }),
  complete: z.boolean(),
  accepted: z.array(
    LegacyRecordSchema.pick({
      i: true,
      rank: true,
      domain: true,
      finalUrl: true,
    }),
  ),
});

export type ResumePlan = {
  kept: StoredRecord[];
  nextI: number;
  acceptedCount: number;
  legacyRecords: LegacyRecords;
  notes: string[];
  listSha256: string;
  // Set when continuing an amended file: its first start and browser, so one browser block covers every i >= 10.
  startedAt: string | null;
  browserVersion: string | null;
};

/**
 * Records to keep and the i to resume from. A pre-amendment file's stop at i=10 is re-attempted (Amendment 1);
 * an amended file's stop is re-attempted only under a newer rule. The frozen i=0..9 must match the 7440778 pin.
 */
export function planResume(
  raw: unknown,
  opts: {
    domains: readonly string[];
    legacySha256: string;
    rule: string;
    now: string;
  },
): ResumePlan {
  const amended = CandidatesFileSchema.safeParse(raw);
  let file: LegacyFile | CandidatesFile;
  let legacyRecords: LegacyRecords;
  const notes: string[] = [];
  let continued: CandidatesFile | null = null;
  if (amended.success) {
    file = continued = amended.data;
    legacyRecords = amended.data.legacyRecords;
    notes.push(...amended.data.notes);
    if (file.stop !== null && file.rule === opts.rule)
      throw new Error(
        `the draw stopped at i=${file.stop.i} under ${file.rule}; amend the rule (and RULE) before re-attempting it`,
      );
  } else {
    const legacy = LegacyFileSchema.safeParse(raw);
    if (!legacy.success)
      throw new Error(
        `candidates.json matches neither the amended nor the 7440778 shape: ${amended.error.issues[0]?.message}`,
      );
    file = legacy.data;
    if (file.stop?.i !== LEGACY_COUNT)
      throw new Error(
        `a pre-amendment candidates.json must have stopped at i=${LEGACY_COUNT}`,
      );
    notes.push(...(file.notes ?? []));
    legacyRecords = {
      note: `i=0..9 are copied unchanged from commit ${LEGACY_COMMIT}: first loads under ${file.rule}, judged before Amendment 1. They have no fallbackUsed/netError fields because they predate them; nothing is back-filled. Amendment 1 keeps them as they are and resumes at i=10.`,
      commit: LEGACY_COMMIT,
      count: LEGACY_COUNT,
      rule: file.rule,
      browser: file.browser,
      startedAt: file.startedAt,
      updatedAt: file.updatedAt,
      stop: file.stop,
    };
  }
  if (file.complete) throw new Error("the draw is already complete");

  // Keep the raw objects (not zod's copies) so re-serialising them reproduces the committed bytes.
  const rawRecords = (raw as { candidates: StoredRecord[] }).candidates;
  const last = rawRecords.at(-1);
  const stop = file.stop;
  if (stop !== null && (last?.result !== "stop" || last.i !== stop.i))
    throw new Error("stop is set but the last record is not that stop record");
  if (stop === null && last?.result === "stop")
    throw new Error("the last record is a stop but stop is null");
  const kept = stop !== null ? rawRecords.slice(0, -1) : rawRecords;

  if (kept.length < LEGACY_COUNT)
    throw new Error(`expected the ${LEGACY_COUNT} frozen records`);
  if (legacyRecordsSha256(kept.slice(0, LEGACY_COUNT)) !== opts.legacySha256)
    throw new Error(
      `records i=0..9 differ from the ones frozen in ${LEGACY_COMMIT}`,
    );
  const seen = new Set<number>();
  kept.forEach((r, k) => {
    const rank = rankForIndex(SEED, k);
    if (
      r.i !== k ||
      r.rank !== rank ||
      r.domain !== opts.domains[rank - 1] ||
      (r.result === "duplicate") !== seen.has(rank) ||
      r.result === "stop"
    )
      throw new Error(
        `record i=${r.i} (position ${k}) disagrees with the seed, the list or its duplicate flag`,
      );
    seen.add(rank);
  });

  if (continued !== null && stop !== null)
    notes.push(
      `i=${stop.i} (${stop.domain}) stopped under ${continued.rule} (${stop.reasons.join(" | ")}); that stop record is dropped and i=${stop.i} re-attempted under ${opts.rule} by the resume started ${opts.now}.`,
    );
  else if (continued !== null && continued.rule !== opts.rule)
    notes.push(
      `from i=${kept.length} the draw runs under ${opts.rule}; earlier amended records ran under ${continued.rule}.`,
    );
  const inFlight = continued?.inFlight ?? null;
  if (inFlight !== null) {
    if (inFlight.i !== kept.length)
      throw new Error(
        `the in-flight marker is for i=${inFlight.i}, but the next candidate is i=${kept.length}`,
      );
    notes.push(
      `i=${inFlight.i} (${inFlight.domain}): a load started ${inFlight.startedAt} was interrupted before its record was written, so no record exists for it; re-attempted by the resume started ${opts.now}.`,
    );
  }

  return {
    kept,
    nextI: kept.length,
    acceptedCount: kept.filter((r) => r.result === "accept").length,
    legacyRecords,
    notes,
    listSha256: file.list.sha256,
    startedAt: continued?.startedAt ?? null,
    browserVersion: continued?.browser.version ?? null,
  };
}

const HERE = dirname(fileURLToPath(import.meta.url));
const TRANCO_FILE = join(
  HERE,
  "..",
  "vendor",
  "tranco",
  "tranco_V3YPN-1000000.csv",
);
const CANDIDATES_FILE = join(HERE, "candidates.json");
const TIMING: Timing = {
  settleMs: 3_000,
  loadTimeoutMs: 60_000,
  evalTimeoutMs: 10_000,
};

/** The amended candidates.json a resume run starts from. */
export function resumeFile(
  plan: ResumePlan,
  meta: {
    list: CandidatesFile["list"];
    browser: CandidatesFile["browser"];
    now: string;
  },
): CandidatesFile {
  return {
    rule: RULE,
    seed: SEED,
    list: meta.list,
    notes: plan.notes,
    legacyRecords: plan.legacyRecords,
    browser: meta.browser,
    timing: { waitUntil: "load", ...TIMING },
    startedAt: plan.startedAt ?? meta.now,
    updatedAt: meta.now,
    complete: false,
    acceptedCount: plan.acceptedCount,
    stop: null,
    inFlight: null,
    candidates: [...plan.kept],
  };
}

export function parseArgs(argv: readonly string[]): {
  maxCandidates: number | null;
} {
  if (!argv.includes("--resume"))
    throw new Error(
      "the draw started in 7440778 and i=0..9 are frozen; only --resume continues it",
    );
  const k = argv.indexOf("--max-candidates");
  if (k === -1) return { maxCandidates: null };
  const raw = argv[k + 1] ?? "";
  const n = /^\d+$/.test(raw) ? Number(raw) : NaN;
  if (!Number.isSafeInteger(n) || n < 1)
    throw new Error(
      `--max-candidates takes a positive integer, got ${JSON.stringify(raw)}`,
    );
  return { maxCandidates: n };
}

function screenRecord(
  c: Candidate,
  domain: string,
  obs: Observation | null,
  result: CandidateRecord["result"],
): CandidateRecord {
  return {
    i: c.i,
    rank: c.rank,
    domain,
    finalUrl: obs?.finalUrl ?? null,
    status: obs?.status ?? null,
    contentType: obs?.contentType ?? null,
    result,
    fallbackUsed: obs?.fallbackUsed ?? false,
    netError: obs?.netError ?? null,
  };
}

const resultOf = (v: Judgement): CandidateRecord["result"] =>
  v.result === "reject" ? v.rule : v.result;

export type ScreenDeps = {
  domains: readonly string[];
  nextI: number;
  // Records to add in this run before pausing (null = until done or stopped).
  maxCandidates: number | null;
  observe: (primary: string, fallback: string | null) => Promise<Observation>;
  save: (file: CandidatesFile) => Promise<void>;
  now: () => string;
  log: (line: string) => void;
};

/** Screens candidates from nextI in order of i, saving after every record, until 20 are accepted. */
export async function screenFrom(
  start: CandidatesFile,
  deps: ScreenDeps,
): Promise<{
  file: CandidatesFile;
  outcome: "complete" | "paused" | "stopped";
}> {
  let file = start;
  let added = 0;
  for (const c of candidates(SEED)) {
    if (c.i < deps.nextI) continue;
    if (file.acceptedCount >= TARGET_ACCEPTED) break;
    if (deps.maxCandidates !== null && added >= deps.maxCandidates)
      return { file, outcome: "paused" };
    const domain = deps.domains[c.rank - 1];
    if (domain === undefined)
      throw new Error(`rank ${c.rank} missing from the list`);

    const pre = c.duplicate ? null : domainPrecheck(domain);
    let record: CandidateRecord;
    let verdict: Judgement | null = null;
    if (c.duplicate) record = screenRecord(c, domain, null, "duplicate");
    else if (pre !== null) record = screenRecord(c, domain, null, pre);
    else {
      file = {
        ...file,
        inFlight: { i: c.i, rank: c.rank, domain, startedAt: deps.now() },
      };
      await deps.save(file);
      const { primary, fallback } = urlsFor(domain);
      const obs = await deps.observe(primary, fallback);
      verdict = judge(domain, obs);
      record = screenRecord(c, domain, obs, resultOf(verdict));
    }
    added++;
    const stop =
      verdict?.result === "stop"
        ? { i: c.i, rank: c.rank, domain, reasons: verdict.reasons }
        : null;
    file = {
      ...file,
      updatedAt: deps.now(),
      acceptedCount: file.acceptedCount + (record.result === "accept" ? 1 : 0),
      stop,
      inFlight: null,
      candidates: [...file.candidates, record],
    };
    deps.log(
      `i=${record.i} rank=${record.rank} ${record.domain} -> ${record.result} status=${record.status ?? "-"} final=${record.finalUrl ?? "-"} ctype=${record.contentType ?? "-"} fallback=${record.fallbackUsed} netError=${record.netError ?? "-"}${pre !== null ? " (domain precheck, not loaded)" : ""}`,
    );
    await deps.save(file);
    if (stop !== null) {
      deps.log(`STOP at i=${c.i}: ${stop.reasons.join(" | ")}`);
      return { file, outcome: "stopped" };
    }
  }
  file = { ...file, complete: true, updatedAt: deps.now() };
  await deps.save(file);
  return { file, outcome: "complete" };
}

async function writeOutputs(file: CandidatesFile): Promise<void> {
  // Validate, but serialise the object as built so frozen records keep their key order and bytes.
  CandidatesFileSchema.parse(file);
  const accepted = AcceptedFileSchema.parse({
    seed: file.seed,
    list: { id: file.list.id, sha256: file.list.sha256 },
    complete: file.complete,
    accepted: file.candidates
      .filter((c) => c.result === "accept")
      .map(({ i, rank, domain, finalUrl }) => ({ i, rank, domain, finalUrl })),
  });
  await writeFile(CANDIDATES_FILE, `${JSON.stringify(file, null, 2)}\n`);
  await writeFile(
    join(HERE, "accepted.json"),
    `${JSON.stringify(accepted, null, 2)}\n`,
  );
}

async function main(): Promise<void> {
  const { maxCandidates } = parseArgs(process.argv.slice(2));
  const csv = await readFile(TRANCO_FILE);
  const listSha256 = createHash("sha256").update(csv).digest("hex");
  const domains = parseTranco(csv.toString("utf8"));
  const now = new Date().toISOString();
  const plan = planResume(JSON.parse(await readFile(CANDIDATES_FILE, "utf8")), {
    domains,
    legacySha256: LEGACY_RECORDS_SHA256,
    rule: RULE,
    now,
  });
  if (listSha256 !== plan.listSha256)
    throw new Error(
      `tranco sha256 ${listSha256} != committed ${plan.listSha256}`,
    );
  console.log(
    `tranco sha256=${listSha256} matches committed; rows=${domains.length}; keeping i=0..${plan.nextI - 1} (${plan.acceptedCount} accepted); resuming at i=${plan.nextI}${maxCandidates === null ? "" : ` for at most ${maxCandidates} candidates`}`,
  );
  for (const note of plan.notes) console.log(`note: ${note}`);

  const browser = await chromium.launch();
  try {
    if (
      plan.browserVersion !== null &&
      browser.version() !== plan.browserVersion
    )
      throw new Error(
        `browser ${browser.version()} differs from the ${plan.browserVersion} this amended draw started with`,
      );
    const probe = await browser.newPage();
    const userAgent = await probe.evaluate(() => navigator.userAgent); // about:blank only
    await probe.close();
    console.log(
      `browser=${browser.version()} (frozen records: ${plan.legacyRecords.browser.version}) ua=${userAgent}`,
    );
    const start = resumeFile(plan, {
      list: {
        id: "V3YPN",
        url: "https://tranco-list.eu/download/V3YPN/1000000",
        file: "bench/vendor/tranco/tranco_V3YPN-1000000.csv",
        sha256: listSha256,
        rows: domains.length,
      },
      browser: {
        launch: "playwright chromium.launch() default (headless shell)",
        version: browser.version(),
        userAgent,
      },
      now,
    });
    const { file, outcome } = await screenFrom(start, {
      domains,
      nextI: plan.nextI,
      maxCandidates,
      observe: (primary, fallback) =>
        observe(browser, primary, fallback, TIMING),
      save: writeOutputs,
      now: () => new Date().toISOString(),
      log: (line) => console.log(line),
    });
    console.log(
      `${outcome.toUpperCase()} accepted=${file.acceptedCount} screened=${file.candidates.length}`,
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
