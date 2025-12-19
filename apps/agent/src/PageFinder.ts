/**
 * PageFinder - Browser-based page discovery for web agents
 *
 * This module uses Playwright to discover all pages reachable from the current page
 * by clicking links and buttons, then ranks them by semantic similarity to the current goal step.
 */

import { Page } from 'playwright';

// ----------------------- Types ----------------------- //

export interface DiscoveredPage {
  url: string;
  title: string;
  linkText: string;      // Text of the element that leads to this page
  parentUrl: string;     // URL we were on when we found this link
}

export interface PageRankResult {
  url: string;
  score: number;
  title: string;
  snippet: string;       // The link text that leads to this page
}

export interface PageFinderOptions {
  maxPages?: number;     // Max pages to discover (default: 100)
  timeout?: number;      // Per-click timeout ms (default: 5000)
  onProgress?: (discovered: number) => void;
  onLog?: (message: string) => void;
}

// ----------------------- URL Helpers ----------------------- //

function cleanUrl(url: string): string {
  try {
    const parsed = new URL(url);
    // Normalize: remove hash, keep query params
    parsed.hash = '';
    return parsed.href;
  } catch {
    return url;
  }
}

function isSameOrigin(url: string, baseUrl: string): boolean {
  try {
    const urlParsed = new URL(url);
    const baseParsed = new URL(baseUrl);
    return urlParsed.origin === baseParsed.origin;
  } catch {
    return false;
  }
}

// ----------------------- Semantic Ranking ----------------------- //

const STOPWORDS = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'in', 'of', 'to', 'at', 'by', 'on',
  'with', 'is', 'are', 'was', 'were', 'be', 'it', 'this', 'that', 'as',
  'from', 'about', 'how', 'what', 'where', 'when', 'why', 'who', 'i', 'me',
  'my', 'help', 'want', 'need', 'can', 'could', 'would', 'should', 'do', 'not',
  'click', 'navigate', 'go', 'find', 'open', 'select', 'choose', 'but',
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

// ----------------------- Goal Step Parsing ----------------------- //

function parseGoalSteps(goal: string): string[] {
  // Match patterns like "1. do X" or "Step 1: do X"
  const stepRegex = /(?:^|\s)(\d+)\.\s*(.+?)(?=(?:\s+\d+\.)|$)/g;
  const steps: string[] = [];
  let match;
  while ((match = stepRegex.exec(goal)) !== null) {
    steps.push(match[2].trim());
  }
  return steps.length > 0 ? steps : [goal];
}

// ----------------------- PageFinder Class ----------------------- //

export class PageFinder {
  private page: Page;
  private discoveredPages: Map<string, DiscoveredPage> = new Map();
  private currentStepIndex: number = 0;
  private goalSteps: string[] = [];
  private initialized: boolean = false;
  private onLog?: (message: string) => void;

  constructor(page: Page, onLog?: (message: string) => void) {
    this.page = page;
    this.onLog = onLog;
  }

  private log(message: string) {
    if (this.onLog) {
      this.onLog(message);
    }
  }

  /**
   * Parse goal into numbered steps.
   */
  setGoal(goal: string): void {
    this.goalSteps = parseGoalSteps(goal);
    this.currentStepIndex = 0;
    this.log(`[PageFinder] Parsed ${this.goalSteps.length} goal steps`);
    this.goalSteps.forEach((step, i) => {
      this.log(`  Step ${i + 1}: ${step}`);
    });
  }

  /**
   * Crawl the current page to discover all reachable pages.
   * Clicks every link/button, records URL changes, then navigates back.
   */
  async discoverPages(options: PageFinderOptions = {}): Promise<void> {
    const { maxPages = 100, timeout = 5000, onProgress } = options;
    const startUrl = cleanUrl(this.page.url());

    this.log(`[PageFinder] Starting discovery from: ${startUrl}`);
    this.discoveredPages.clear();

    // Find all clickable elements
    const clickableSelector = 'a[href], button, [role="button"], [role="link"], [onclick]';
    const clickables = await this.page.$$(clickableSelector);
    this.log(`[PageFinder] Found ${clickables.length} clickable elements`);

    // Collect element info before clicking (elements may become stale)
    const elementInfos: Array<{ index: number; linkText: string; href: string | null }> = [];
    for (let i = 0; i < clickables.length; i++) {
      try {
        const linkText = await clickables[i].textContent() || '';
        const href = await clickables[i].getAttribute('href');
        elementInfos.push({ index: i, linkText: linkText.trim(), href });
      } catch {
        // Element may be stale, skip
        continue;
      }
    }

    for (const info of elementInfos) {
      if (this.discoveredPages.size >= maxPages) {
        this.log(`[PageFinder] Reached max pages limit (${maxPages})`);
        break;
      }

      const { linkText, href } = info;

      // Skip external links
      if (href && href.startsWith('http') && !isSameOrigin(href, startUrl)) {
        continue;
      }

      // Skip anchors and javascript: links
      if (href?.startsWith('#') || href?.startsWith('javascript:')) {
        continue;
      }

      // Skip empty link text (likely icons or hidden elements)
      if (!linkText || linkText.length === 0) {
        continue;
      }

      try {
        // Re-find the element (may have become stale after navigation)
        const elements = await this.page.$$(clickableSelector);
        const element = elements.find(async (el) => {
          try {
            const text = await el.textContent();
            return text?.trim() === linkText;
          } catch {
            return false;
          }
        });

        if (!element) {
          // Try to find by href instead
          if (href) {
            const byHref = await this.page.$(`a[href="${href}"]`);
            if (byHref) {
              await this.clickAndRecord(byHref, linkText, startUrl, timeout, onProgress);
            }
          }
          continue;
        }

        await this.clickAndRecord(element, linkText, startUrl, timeout, onProgress);
      } catch (e) {
        // Element interaction failed, continue to next
        continue;
      }
    }

    this.initialized = true;
    this.log(`[PageFinder] Discovery complete. Found ${this.discoveredPages.size} pages`);
  }

  private async clickAndRecord(
    element: any,
    linkText: string,
    startUrl: string,
    timeout: number,
    onProgress?: (discovered: number) => void
  ): Promise<void> {
    const beforeUrl = cleanUrl(this.page.url());

    try {
      // Click and wait for potential navigation
      await Promise.all([
        this.page.waitForNavigation({ timeout, waitUntil: 'domcontentloaded' }).catch(() => null),
        element.click({ timeout: 2000 }).catch(() => null),
      ]);

      // Small delay to let page settle
      await this.page.waitForTimeout(500);

      const newUrl = cleanUrl(this.page.url());

      // If URL changed and we haven't seen this page, record it
      if (newUrl !== startUrl && !this.discoveredPages.has(newUrl)) {
        const title = await this.page.title().catch(() => '');
        this.discoveredPages.set(newUrl, {
          url: newUrl,
          title,
          linkText: linkText.slice(0, 100),
          parentUrl: startUrl,
        });

        this.log(`[PageFinder] Discovered: ${title || newUrl} (via "${linkText.slice(0, 50)}")`);

        if (onProgress) {
          onProgress(this.discoveredPages.size);
        }
      }

      // Navigate back to start page if we moved
      if (newUrl !== startUrl) {
        await this.page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        await this.page.waitForTimeout(500);
      }
    } catch (e) {
      // Navigation or click failed, try to recover
      const currentUrl = cleanUrl(this.page.url());
      if (currentUrl !== startUrl) {
        try {
          await this.page.goto(startUrl, { waitUntil: 'domcontentloaded', timeout: 10000 });
        } catch {
          // Can't recover, will continue from wherever we are
        }
      }
    }
  }

  /**
   * Check if PageFinder has been initialized.
   */
  isInitialized(): boolean {
    return this.initialized;
  }

  /**
   * Get pages ranked by similarity to current step.
   */
  getSuggestedPages(topK: number = 100): PageRankResult[] {
    if (!this.initialized) {
      return [];
    }

    const currentStep = this.goalSteps[this.currentStepIndex] || this.goalSteps[0] || '';
    const stepVector = textToVector(currentStep);

    const results: PageRankResult[] = [];
    for (const [url, page] of Array.from(this.discoveredPages.entries())) {
      const pageText = `${page.title} ${page.linkText}`;
      const pageVector = textToVector(pageText);
      const score = cosineSimilarity(stepVector, pageVector);

      results.push({
        url,
        score,
        title: page.title,
        snippet: page.linkText,
      });
    }

    return results.sort((a, b) => b.score - a.score).slice(0, topK);
  }

  /**
   * Increment to next step (call after navigate_to_page).
   */
  advanceStep(): void {
    if (this.currentStepIndex < this.goalSteps.length - 1) {
      this.currentStepIndex++;
      this.log(`[PageFinder] Advanced to step ${this.currentStepIndex + 1}: ${this.goalSteps[this.currentStepIndex]}`);
    }
  }

  /**
   * Get current step index and text.
   */
  getCurrentStep(): { index: number; text: string } {
    return {
      index: this.currentStepIndex,
      text: this.goalSteps[this.currentStepIndex] || '',
    };
  }

  /**
   * Get total number of discovered pages.
   */
  getPageCount(): number {
    return this.discoveredPages.size;
  }

  /**
   * Get total number of goal steps.
   */
  getStepCount(): number {
    return this.goalSteps.length;
  }
}
