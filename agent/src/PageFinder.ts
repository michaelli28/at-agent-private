/**
 * PageFinder - PageRank-based navigation for web agents
 *
 * This module crawls a website, builds a link graph, computes PageRank scores,
 * and ranks pages by semantic similarity to a goal combined with PageRank.
 */

import { URL } from 'url';

// ----------------------- Types ----------------------- //

export interface PageInfo {
  url: string;
  title: string;
  snippet: string;
  links: string[];
}

export interface PageRankResult {
  url: string;
  score: number;
  title: string;
  snippet: string;
}

export interface CrawlResult {
  graph: Map<string, string[]>;
  pages: Map<string, PageInfo>;
  pagerank: Map<string, number>;
}

// ----------------------- URL Helpers ----------------------- //

function cleanUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    if (!['http:', 'https:'].includes(parsed.protocol)) {
      return null;
    }

    // Normalize: lowercase host, remove trailing slash, remove hash/search
    let path = parsed.pathname || '/';
    path = path.replace(/\/+$/, '') || '/';

    return `${parsed.protocol}//${parsed.hostname.toLowerCase()}${path}`;
  } catch {
    return null;
  }
}

function isInternalLink(url: string, rootHost: string): boolean {
  try {
    const parsed = new URL(url);
    let host = parsed.hostname.toLowerCase();
    let base = rootHost.toLowerCase();

    // Strip www prefix for comparison
    if (host.startsWith('www.')) host = host.slice(4);
    if (base.startsWith('www.')) base = base.slice(4);

    return host === base;
  } catch {
    return false;
  }
}

function resolveUrl(base: string, href: string): string | null {
  try {
    return new URL(href, base).href;
  } catch {
    return null;
  }
}

// ----------------------- HTML Parsing ----------------------- //

function extractTitle(html: string): string {
  const match = html.match(/<title[^>]*>([^<]*)<\/title>/i);
  return match ? match[1].trim() : '';
}

function extractText(html: string): string {
  // Remove script and style tags
  let text = html.replace(/<script[^>]*>[\s\S]*?<\/script>/gi, '');
  text = text.replace(/<style[^>]*>[\s\S]*?<\/style>/gi, '');
  // Remove all HTML tags
  text = text.replace(/<[^>]+>/g, ' ');
  // Normalize whitespace
  text = text.replace(/\s+/g, ' ').trim();
  return text;
}

function extractLinks(html: string, baseUrl: string, rootHost: string): string[] {
  const links: Set<string> = new Set();
  const hrefRegex = /<a[^>]+href=["']([^"']+)["']/gi;
  let match;

  while ((match = hrefRegex.exec(html)) !== null) {
    const href = match[1];
    const resolved = resolveUrl(baseUrl, href);
    if (!resolved) continue;

    const cleaned = cleanUrl(resolved);
    if (!cleaned) continue;

    if (isInternalLink(cleaned, rootHost)) {
      links.add(cleaned);
    }
  }

  return Array.from(links);
}

function extractNavLinks(html: string, baseUrl: string, rootHost: string): string[] {
  // Extract links from nav, header, and menu elements
  const navRegex = /<(nav|header|menu)[^>]*>([\s\S]*?)<\/\1>/gi;
  const links: Set<string> = new Set();
  let match;

  while ((match = navRegex.exec(html)) !== null) {
    const navContent = match[2];
    for (const link of extractLinks(navContent, baseUrl, rootHost)) {
      links.add(link);
    }
  }

  return Array.from(links);
}

// ----------------------- Crawling ----------------------- //

const USER_AGENT = 'PageRankPlus/1.0';
const REQUEST_TIMEOUT = 15000;

async function fetchHtml(url: string): Promise<string | null> {
  try {
    const controller = new AbortController();
    const timeoutId = setTimeout(() => controller.abort(), REQUEST_TIMEOUT);

    const response = await fetch(url, {
      headers: { 'User-Agent': USER_AGENT },
      signal: controller.signal,
    });

    clearTimeout(timeoutId);

    if (!response.ok) return null;
    return await response.text();
  } catch {
    return null;
  }
}

export interface CrawlOptions {
  maxDepth?: number;
  maxPages?: number;
  onProgress?: (crawled: number, queued: number) => void;
}

export async function crawlWebsite(
  entryUrl: string,
  options: CrawlOptions = {}
): Promise<CrawlResult> {
  const { maxDepth = 2, maxPages = 100, onProgress } = options;

  const graph = new Map<string, string[]>();
  const pages = new Map<string, PageInfo>();
  const seen = new Set<string>();

  const entryClean = cleanUrl(entryUrl);
  if (!entryClean) {
    throw new Error(`Invalid entry URL: ${entryUrl}`);
  }

  const rootHost = new URL(entryClean).hostname;

  // Start with the entry page
  const queue: Array<{ url: string; depth: number }> = [{ url: entryClean, depth: 0 }];
  seen.add(entryClean);

  while (queue.length > 0 && pages.size < maxPages) {
    const { url, depth } = queue.shift()!;

    if (onProgress) {
      onProgress(pages.size, queue.length);
    }

    const html = await fetchHtml(url);
    if (!html) {
      graph.set(url, []);
      continue;
    }

    const title = extractTitle(html);
    const text = extractText(html);
    const snippet = text.slice(0, 300);

    // On the home page, prioritize nav links
    const links = depth === 0
      ? extractNavLinks(html, url, rootHost)
      : extractLinks(html, url, rootHost);

    graph.set(url, links);
    pages.set(url, { url, title, snippet, links });

    // Add children to queue if within depth
    if (depth < maxDepth) {
      for (const link of links.slice(0, 15)) { // Limit breadth
        if (!seen.has(link)) {
          seen.add(link);
          queue.push({ url: link, depth: depth + 1 });
        }
      }
    }
  }

  // Compute PageRank
  const pagerank = computePageRank(graph);

  return { graph, pages, pagerank };
}

// ----------------------- PageRank ----------------------- //

function computePageRank(
  graph: Map<string, string[]>,
  damping: number = 0.85,
  epsilon: number = 1e-6,
  maxIterations: number = 100
): Map<string, number> {
  const urls = Array.from(graph.keys());
  const n = urls.length;

  if (n === 0) return new Map();

  const urlToIndex = new Map<string, number>();
  urls.forEach((url, idx) => urlToIndex.set(url, idx));

  // Build transition matrix (column-stochastic)
  const outDegree = new Array(n).fill(0);
  const inLinks: number[][] = Array.from({ length: n }, () => []);

  for (const [url, links] of Array.from(graph.entries())) {
    const fromIdx = urlToIndex.get(url)!;
    const validLinks = links.filter(l => urlToIndex.has(l));
    outDegree[fromIdx] = validLinks.length || n; // Dangling nodes link to all

    for (const link of validLinks) {
      const toIdx = urlToIndex.get(link)!;
      inLinks[toIdx].push(fromIdx);
    }
  }

  // Initialize ranks
  let rank = new Array(n).fill(1 / n);
  const teleport = (1 - damping) / n;

  for (let iter = 0; iter < maxIterations; iter++) {
    const newRank = new Array(n).fill(teleport);

    // Handle dangling nodes (distribute their rank to all)
    let danglingSum = 0;
    for (let i = 0; i < n; i++) {
      if (outDegree[i] === n) { // This was a dangling node
        danglingSum += rank[i];
      }
    }
    const danglingContrib = damping * danglingSum / n;

    for (let i = 0; i < n; i++) {
      newRank[i] += danglingContrib;

      for (const j of inLinks[i]) {
        newRank[i] += damping * rank[j] / outDegree[j];
      }
    }

    // Check convergence
    let diff = 0;
    for (let i = 0; i < n; i++) {
      diff += Math.abs(newRank[i] - rank[i]);
    }

    rank = newRank;

    if (diff < epsilon) break;
  }

  // Convert back to map
  const result = new Map<string, number>();
  urls.forEach((url, idx) => result.set(url, rank[idx]));
  return result;
}

// ----------------------- Semantic Ranking ----------------------- //

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'in', 'of', 'to', 'at', 'by', 'on',
  'with', 'is', 'are', 'was', 'were', 'be', 'it', 'this', 'that', 'as',
  'from', 'about', 'how', 'what', 'where', 'when', 'why', 'who', 'i', 'me',
  'my', 'help', 'want', 'need', 'can', 'could', 'would', 'should'
]);

function tokenize(text: string): string[] {
  const tokens = text.toLowerCase().match(/[a-z0-9]+/g) || [];
  return tokens.filter(t => t.length > 1 && !STOPWORDS.has(t));
}

function textToVector(text: string): Map<string, number> {
  const tokens = tokenize(text);
  if (tokens.length === 0) return new Map();

  const freq = new Map<string, number>();

  // Unigrams
  for (const token of tokens) {
    freq.set(token, (freq.get(token) || 0) + 1);
  }

  // Bigrams (with boost)
  for (let i = 0; i < tokens.length - 1; i++) {
    const bigram = `${tokens[i]}_${tokens[i + 1]}`;
    freq.set(bigram, (freq.get(bigram) || 0) + 2);
  }

  // Normalize
  const total = Array.from(freq.values()).reduce((a, b) => a + b, 0);
  for (const [key, val] of Array.from(freq.entries())) {
    freq.set(key, val / total);
  }

  return freq;
}

function cosineSimilarity(a: Map<string, number>, b: Map<string, number>): number {
  if (a.size === 0 || b.size === 0) return 0;

  let dot = 0;
  for (const [key, val] of Array.from(a.entries())) {
    if (b.has(key)) {
      dot += val * b.get(key)!;
    }
  }

  let normA = 0;
  for (const val of Array.from(a.values())) normA += val * val;

  let normB = 0;
  for (const val of Array.from(b.values())) normB += val * val;

  const denom = Math.sqrt(normA) * Math.sqrt(normB);
  return denom === 0 ? 0 : dot / denom;
}

export function rankPages(
  goal: string,
  crawlResult: CrawlResult,
  pagerankWeight: number = 0.2
): PageRankResult[] {
  const { pages, pagerank } = crawlResult;
  const goalVector = textToVector(goal);

  const results: PageRankResult[] = [];

  for (const [url, info] of Array.from(pages.entries())) {
    const pr = pagerank.get(url) || 0;
    const text = `${info.title} ${info.snippet}`;
    const pageVector = textToVector(text);
    const semantic = cosineSimilarity(goalVector, pageVector);

    // Blend PageRank and semantic similarity
    const score = pagerankWeight * pr + (1 - pagerankWeight) * semantic;

    results.push({
      url,
      score,
      title: info.title,
      snippet: info.snippet,
    });
  }

  // Sort by score descending
  results.sort((a, b) => b.score - a.score);

  return results;
}

// ----------------------- PageFinder Class ----------------------- //

export class PageFinder {
  private crawlResult: CrawlResult | null = null;
  private entryUrl: string;
  private pagerankWeight: number;

  constructor(entryUrl: string, pagerankWeight: number = 0.2) {
    this.entryUrl = entryUrl;
    this.pagerankWeight = pagerankWeight;
  }

  async initialize(options?: CrawlOptions): Promise<void> {
    this.crawlResult = await crawlWebsite(this.entryUrl, options);
  }

  isInitialized(): boolean {
    return this.crawlResult !== null;
  }

  getSuggestedPages(goal: string, topK: number = 5): PageRankResult[] {
    if (!this.crawlResult) {
      throw new Error('PageFinder not initialized. Call initialize() first.');
    }

    return rankPages(goal, this.crawlResult, this.pagerankWeight).slice(0, topK);
  }

  getPageCount(): number {
    return this.crawlResult?.pages.size || 0;
  }

  getCrawlResult(): CrawlResult | null {
    return this.crawlResult;
  }
}
