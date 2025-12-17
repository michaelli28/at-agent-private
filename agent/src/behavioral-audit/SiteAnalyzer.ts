/**
 * SiteAnalyzer - Combines PageRank crawling with AX tree analysis
 *
 * This module crawls a website, computes PageRank scores, and analyzes
 * each page's accessibility tree to build a comprehensive site inventory.
 */

import { PageFinder, CrawlResult, PageRankResult } from '../PageFinder';
import { BrowserClient, AXNode } from '@adf/virtual-screen-reader';
import {
  SiteInventory,
  PageInventory,
  HeadingStructure,
  HeadingInfo,
  FormInventory,
  FormFieldInfo,
  InteractiveElement,
  ImageInventory,
  TableInventory,
  NavigationPattern,
  Workflow,
  BehavioralAuditEventCallback,
} from './types';

// Roles for different element categories
const HEADING_ROLE = 'heading';
const FORM_ROLES = new Set(['textbox', 'searchbox', 'checkbox', 'radio', 'combobox', 'listbox', 'slider', 'spinbutton', 'switch']);
const INTERACTIVE_ROLES = new Set(['button', 'link', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'tab', 'treeitem']);
const LANDMARK_ROLES = new Set(['banner', 'main', 'navigation', 'complementary', 'contentinfo', 'search', 'form', 'region']);
const IMAGE_ROLE = 'img';
const TABLE_ROLES = new Set(['table', 'grid', 'treegrid']);

interface AnalyzerOptions {
  maxPages: number;
  crawlDepth: number;
  pageRankWeight: number;
  onEvent?: BehavioralAuditEventCallback;
  verbose?: boolean;
}

const DEFAULT_OPTIONS: AnalyzerOptions = {
  maxPages: 50,
  crawlDepth: 2,
  pageRankWeight: 0.4,
  verbose: false,
};

export class SiteAnalyzer {
  private options: AnalyzerOptions;
  private browserClient: BrowserClient | null = null;

  constructor(options: Partial<AnalyzerOptions> = {}) {
    this.options = { ...DEFAULT_OPTIONS, ...options };
  }

  /**
   * Analyze a website and build a comprehensive site inventory.
   */
  async analyze(rootUrl: string): Promise<SiteInventory> {
    const startTime = Date.now();

    this.emit({ type: 'crawl_started', url: rootUrl });

    // Phase 1: Crawl site and compute PageRank
    const pageFinder = new PageFinder(rootUrl, this.options.pageRankWeight);
    await pageFinder.initialize({
      maxPages: this.options.maxPages,
      maxDepth: this.options.crawlDepth,
    });

    const crawlResult = pageFinder.getCrawlResult();
    if (!crawlResult) {
      throw new Error('Failed to crawl website');
    }

    const { graph, pages, pagerank } = crawlResult;
    const totalPages = pages.size;

    this.emit({ type: 'crawl_progress', pagesAnalyzed: 0, totalPages });

    // Phase 2: Launch browser for AX tree analysis
    this.browserClient = new BrowserClient();
    await this.browserClient.launch(true); // headless

    try {
      // Phase 3: Analyze each page's AX tree
      const pageInventories: PageInventory[] = [];
      let analyzed = 0;

      for (const [url, pageInfo] of Array.from(pages.entries())) {
        try {
          const inventory = await this.analyzePageAXTree(url, pagerank.get(url) || 0, pageInfo.title);
          pageInventories.push(inventory);
        } catch (error) {
          this.log(`Failed to analyze ${url}: ${error}`);
          // Create minimal inventory for failed pages
          pageInventories.push(this.createMinimalInventory(url, pagerank.get(url) || 0, pageInfo.title));
        }

        analyzed++;
        this.emit({ type: 'crawl_progress', pagesAnalyzed: analyzed, totalPages });
      }

      // Phase 4: Analyze global patterns
      const globalElements = this.analyzeGlobalPatterns(pageInventories);

      // Phase 5: Generate suggested workflows based on PageRank paths
      const suggestedWorkflows = this.generateWorkflows(graph, pagerank, pageInventories);

      this.emit({ type: 'crawl_completed', pageCount: pageInventories.length });

      return {
        rootUrl,
        crawledAt: new Date().toISOString(),
        pages: pageInventories,
        globalElements,
        suggestedWorkflows,
        graph,
        pageRanks: pagerank,
      };
    } finally {
      await this.browserClient.close();
      this.browserClient = null;
    }
  }

  /**
   * Analyze a single page's accessibility tree.
   */
  private async analyzePageAXTree(url: string, pageRank: number, title: string): Promise<PageInventory> {
    if (!this.browserClient) {
      throw new Error('Browser not initialized');
    }

    await this.browserClient.goto(url);
    // Wait for page to settle
    await new Promise(resolve => setTimeout(resolve, 1000));

    const axNodes = await this.browserClient.getFullAXTree();

    // Extract various element types from AX tree
    const headings = this.extractHeadings(axNodes);
    const forms = this.extractForms(axNodes);
    const interactiveElements = this.extractInteractiveElements(axNodes);
    const landmarks = this.extractLandmarks(axNodes);
    const images = this.extractImages(axNodes);
    const tables = this.extractTables(axNodes);
    const liveRegions = this.extractLiveRegions(axNodes);
    const hasSkipLink = this.detectSkipLink(axNodes);
    const hasLangAttribute = this.detectLanguageAttribute(axNodes);

    return {
      url,
      pageRank,
      title,
      hasLangAttribute,
      headings,
      forms,
      interactiveElements,
      landmarks,
      images,
      tables,
      liveRegions,
      hasSkipLink,
    };
  }

  /**
   * Create a minimal inventory for pages that failed analysis.
   */
  private createMinimalInventory(url: string, pageRank: number, title: string): PageInventory {
    return {
      url,
      pageRank,
      title,
      hasLangAttribute: false,
      headings: { headings: [], hasH1: false, isHierarchyValid: false },
      forms: [],
      interactiveElements: [],
      landmarks: [],
      images: [],
      tables: [],
      liveRegions: [],
      hasSkipLink: false,
    };
  }

  /**
   * Extract heading structure from AX tree.
   */
  private extractHeadings(axNodes: AXNode[]): HeadingStructure {
    const headings: HeadingInfo[] = [];

    for (const node of axNodes) {
      if (this.getRole(node) === HEADING_ROLE) {
        const level = this.getHeadingLevel(node);
        const text = this.getName(node);
        if (text) {
          headings.push({
            level,
            text,
            axNodeId: node.nodeId,
          });
        }
      }
    }

    const hasH1 = headings.some(h => h.level === 1);
    const isHierarchyValid = this.validateHeadingHierarchy(headings);

    return { headings, hasH1, isHierarchyValid };
  }

  /**
   * Validate heading hierarchy (no skipped levels).
   */
  private validateHeadingHierarchy(headings: HeadingInfo[]): boolean {
    if (headings.length === 0) return true;

    let prevLevel = 0;
    for (const h of headings) {
      // Allow going down by 1 or up by any amount
      if (h.level > prevLevel + 1 && prevLevel !== 0) {
        return false; // Skipped a level
      }
      prevLevel = h.level;
    }
    return true;
  }

  /**
   * Extract forms and their fields from AX tree.
   */
  private extractForms(axNodes: AXNode[]): FormInventory[] {
    const forms: FormInventory[] = [];
    const formFields: Map<string, FormFieldInfo[]> = new Map();

    // First pass: find form containers
    for (const node of axNodes) {
      if (this.getRole(node) === 'form') {
        const name = this.getName(node) || 'Unnamed form';
        formFields.set(node.nodeId, []);
        forms.push({
          id: node.nodeId,
          name,
          fields: [],
          hasSubmitButton: false,
          axNodeId: node.nodeId,
        });
      }
    }

    // Second pass: find form fields and associate with forms
    for (const node of axNodes) {
      const role = this.getRole(node);
      if (FORM_ROLES.has(role)) {
        const field: FormFieldInfo = {
          type: role,
          name: this.getName(node) || '',
          hasLabel: this.hasAccessibleName(node),
          isRequired: this.isRequired(node),
          axNodeId: node.nodeId,
        };

        // Find parent form or create standalone form
        const parentFormId = this.findParentForm(node, axNodes);
        if (parentFormId && formFields.has(parentFormId)) {
          formFields.get(parentFormId)!.push(field);
        } else {
          // Standalone form field - create implicit form
          const implicitForm: FormInventory = {
            name: 'Standalone form fields',
            fields: [field],
            hasSubmitButton: false,
          };
          const existingImplicit = forms.find(f => f.name === 'Standalone form fields');
          if (existingImplicit) {
            existingImplicit.fields.push(field);
          } else {
            forms.push(implicitForm);
          }
        }
      }

      // Check for submit buttons
      if (role === 'button') {
        const name = this.getName(node)?.toLowerCase() || '';
        if (name.includes('submit') || name.includes('send') || name.includes('save')) {
          const parentFormId = this.findParentForm(node, axNodes);
          const form = forms.find(f => f.axNodeId === parentFormId);
          if (form) {
            form.hasSubmitButton = true;
          }
        }
      }
    }

    // Associate fields with forms
    for (const form of forms) {
      if (form.axNodeId && formFields.has(form.axNodeId)) {
        form.fields = formFields.get(form.axNodeId)!;
      }
    }

    return forms.filter(f => f.fields.length > 0);
  }

  /**
   * Extract interactive elements from AX tree.
   */
  private extractInteractiveElements(axNodes: AXNode[]): InteractiveElement[] {
    const elements: InteractiveElement[] = [];

    for (const node of axNodes) {
      const role = this.getRole(node);
      if (INTERACTIVE_ROLES.has(role)) {
        elements.push({
          role,
          name: this.getName(node) || '',
          hasKeyboardAccess: this.isFocusable(node),
          axNodeId: node.nodeId,
        });
      }
    }

    return elements;
  }

  /**
   * Extract landmarks from AX tree.
   */
  private extractLandmarks(axNodes: AXNode[]): string[] {
    const landmarks: Set<string> = new Set();

    for (const node of axNodes) {
      const role = this.getRole(node);
      if (LANDMARK_ROLES.has(role)) {
        landmarks.add(role);
      }
    }

    return Array.from(landmarks);
  }

  /**
   * Extract images from AX tree.
   */
  private extractImages(axNodes: AXNode[]): ImageInventory[] {
    const images: ImageInventory[] = [];

    for (const node of axNodes) {
      if (this.getRole(node) === IMAGE_ROLE) {
        const name = this.getName(node);
        const isDecorative = this.isDecorative(node);
        images.push({
          hasAltText: !!name && name.length > 0,
          altText: name || undefined,
          isDecorative,
          axNodeId: node.nodeId,
        });
      }
    }

    return images;
  }

  /**
   * Extract tables from AX tree.
   */
  private extractTables(axNodes: AXNode[]): TableInventory[] {
    const tables: TableInventory[] = [];

    for (const node of axNodes) {
      const role = this.getRole(node);
      if (TABLE_ROLES.has(role)) {
        const { rowCount, columnCount, hasHeaders } = this.analyzeTableStructure(node, axNodes);
        tables.push({
          hasHeaders,
          rowCount,
          columnCount,
          caption: this.getTableCaption(node, axNodes),
          axNodeId: node.nodeId,
        });
      }
    }

    return tables;
  }

  /**
   * Extract live region types from AX tree.
   */
  private extractLiveRegions(axNodes: AXNode[]): string[] {
    const liveRegions: Set<string> = new Set();

    for (const node of axNodes) {
      const live = this.getLiveProperty(node);
      if (live && live !== 'off') {
        liveRegions.add(live);
      }
    }

    return Array.from(liveRegions);
  }

  /**
   * Detect skip link presence.
   */
  private detectSkipLink(axNodes: AXNode[]): boolean {
    for (const node of axNodes) {
      if (this.getRole(node) === 'link') {
        const name = this.getName(node)?.toLowerCase() || '';
        if (name.includes('skip') && (name.includes('main') || name.includes('content') || name.includes('nav'))) {
          return true;
        }
      }
    }
    return false;
  }

  /**
   * Detect language attribute.
   */
  private detectLanguageAttribute(axNodes: AXNode[]): boolean {
    // The root webarea should have language property
    for (const node of axNodes) {
      if (this.getRole(node) === 'rootwebarea' || this.getRole(node) === 'webarea') {
        // Check for language property
        const props = node.properties || [];
        for (const prop of props) {
          if (prop.name === 'language' || prop.name === 'lang') {
            return true;
          }
        }
      }
    }
    return false;
  }

  /**
   * Analyze global patterns across all pages.
   */
  private analyzeGlobalPatterns(pages: PageInventory[]): SiteInventory['globalElements'] {
    const navigationPatterns: NavigationPattern[] = [];
    const commonLandmarks: Set<string> = new Set();
    let hasSkipLinks = false;
    let hasSearchForm = false;

    // Find common landmarks across pages
    const landmarkCounts: Map<string, number> = new Map();
    for (const page of pages) {
      for (const landmark of page.landmarks) {
        landmarkCounts.set(landmark, (landmarkCounts.get(landmark) || 0) + 1);
      }
      if (page.hasSkipLink) hasSkipLinks = true;
    }

    // Landmarks present on >50% of pages are considered common
    const threshold = pages.length * 0.5;
    for (const [landmark, count] of Array.from(landmarkCounts.entries())) {
      if (count >= threshold) {
        commonLandmarks.add(landmark);
      }
    }

    // Check for search form
    for (const page of pages) {
      for (const form of page.forms) {
        if (form.name.toLowerCase().includes('search') ||
            form.fields.some(f => f.type === 'searchbox')) {
          hasSearchForm = true;
          break;
        }
      }
    }

    // Detect navigation patterns
    if (commonLandmarks.has('navigation')) {
      navigationPatterns.push({
        type: 'main-nav',
        name: 'Main navigation',
        itemCount: 0, // Would need more analysis
        landmarkRole: 'navigation',
      });
    }
    if (commonLandmarks.has('banner')) {
      navigationPatterns.push({
        type: 'skip-link',
        name: 'Banner',
        itemCount: 1,
        landmarkRole: 'banner',
      });
    }

    return {
      navigation: navigationPatterns,
      hasSkipLinks,
      hasSearchForm,
      commonLandmarks: Array.from(commonLandmarks),
    };
  }

  /**
   * Generate suggested workflows based on PageRank paths.
   */
  private generateWorkflows(
    graph: Map<string, string[]>,
    pageRanks: Map<string, number>,
    pages: PageInventory[]
  ): Workflow[] {
    const workflows: Workflow[] = [];

    // Get top pages by PageRank
    const sortedPages = Array.from(pageRanks.entries())
      .sort((a, b) => b[1] - a[1])
      .slice(0, 10);

    if (sortedPages.length < 2) return workflows;

    const rootUrl = sortedPages[0][0];

    // Generate workflows from root to important pages
    for (let i = 1; i < Math.min(sortedPages.length, 6); i++) {
      const [targetUrl, targetRank] = sortedPages[i];
      const path = this.findShortestPath(graph, rootUrl, targetUrl);

      if (path && path.length > 1) {
        const totalPageRank = path.reduce((sum, url) => sum + (pageRanks.get(url) || 0), 0);
        const pageData = pages.find(p => p.url === targetUrl);

        workflows.push({
          id: `workflow-${i}`,
          name: `Navigate to ${pageData?.title || targetUrl}`,
          description: `Multi-page journey from homepage to ${pageData?.title || 'target page'}`,
          path,
          totalPageRank,
          complexity: path.length * 1.5, // Simple complexity measure
        });
      }
    }

    // Generate form submission workflows
    for (const page of pages) {
      if (page.forms.length > 0 && page.pageRank > 0.01) {
        for (const form of page.forms.slice(0, 2)) {
          workflows.push({
            id: `workflow-form-${page.url}-${form.name}`,
            name: `Complete ${form.name}`,
            description: `Submit the ${form.name} form on ${page.title}`,
            path: [page.url],
            totalPageRank: page.pageRank,
            complexity: form.fields.length * 2,
          });
        }
      }
    }

    // Sort workflows by importance (PageRank * complexity balance)
    workflows.sort((a, b) => {
      const scoreA = a.totalPageRank * Math.log(a.complexity + 1);
      const scoreB = b.totalPageRank * Math.log(b.complexity + 1);
      return scoreB - scoreA;
    });

    return workflows.slice(0, 10);
  }

  /**
   * Find shortest path between two URLs using BFS.
   */
  private findShortestPath(graph: Map<string, string[]>, start: string, end: string): string[] | null {
    if (start === end) return [start];
    if (!graph.has(start)) return null;

    const queue: { url: string; path: string[] }[] = [{ url: start, path: [start] }];
    const visited = new Set<string>([start]);

    while (queue.length > 0) {
      const { url, path } = queue.shift()!;
      const neighbors = graph.get(url) || [];

      for (const neighbor of neighbors) {
        if (neighbor === end) {
          return [...path, neighbor];
        }
        if (!visited.has(neighbor)) {
          visited.add(neighbor);
          queue.push({ url: neighbor, path: [...path, neighbor] });
        }
      }
    }

    return null;
  }

  // ==================== AX Node Helper Methods ====================

  private getRole(node: AXNode): string {
    return node.role?.value || '';
  }

  private getName(node: AXNode): string {
    return node.name?.value || '';
  }

  private hasAccessibleName(node: AXNode): boolean {
    const name = this.getName(node);
    return !!name && name.trim().length > 0;
  }

  private getHeadingLevel(node: AXNode): number {
    const props = node.properties || [];
    for (const prop of props) {
      if (prop.name === 'level') {
        const value = prop.value?.value;
        return typeof value === 'number' ? value : parseInt(String(value), 10) || 0;
      }
    }
    return 0;
  }

  private isRequired(node: AXNode): boolean {
    const props = node.properties || [];
    for (const prop of props) {
      if (prop.name === 'required') {
        const value = prop.value?.value;
        return value === true || value === 'true';
      }
    }
    return false;
  }

  private isFocusable(node: AXNode): boolean {
    const props = node.properties || [];
    for (const prop of props) {
      if (prop.name === 'focusable') {
        const value = prop.value?.value;
        return value === true || value === 'true';
      }
    }
    // Default: interactive roles are usually focusable
    const role = this.getRole(node);
    return INTERACTIVE_ROLES.has(role) || FORM_ROLES.has(role);
  }

  private isDecorative(node: AXNode): boolean {
    const props = node.properties || [];
    for (const prop of props) {
      if (prop.name === 'hidden' || prop.name === 'presentation') {
        const value = prop.value?.value;
        return value === true || value === 'true';
      }
    }
    // Empty alt text indicates decorative
    return this.getName(node) === '';
  }

  private getLiveProperty(node: AXNode): string | null {
    const props = node.properties || [];
    for (const prop of props) {
      if (prop.name === 'live') {
        return String(prop.value?.value || '');
      }
    }
    return null;
  }

  private findParentForm(node: AXNode, allNodes: AXNode[]): string | null {
    // Simple parent lookup - would need proper tree traversal
    // For now, return null to trigger standalone form handling
    return null;
  }

  private analyzeTableStructure(tableNode: AXNode, allNodes: AXNode[]): { rowCount: number; columnCount: number; hasHeaders: boolean } {
    let rowCount = 0;
    let columnCount = 0;
    let hasHeaders = false;

    for (const node of allNodes) {
      const role = this.getRole(node);
      if (role === 'row') rowCount++;
      if (role === 'rowheader' || role === 'columnheader') hasHeaders = true;
      if (role === 'cell' || role === 'gridcell') {
        columnCount = Math.max(columnCount, 1); // Simplified
      }
    }

    return { rowCount, columnCount: columnCount || 1, hasHeaders };
  }

  private getTableCaption(tableNode: AXNode, allNodes: AXNode[]): string | undefined {
    // Look for caption in table's children
    for (const node of allNodes) {
      if (this.getRole(node) === 'caption') {
        return this.getName(node);
      }
    }
    return undefined;
  }

  // ==================== Utility Methods ====================

  private emit(event: Parameters<BehavioralAuditEventCallback>[0]): void {
    if (this.options.onEvent) {
      this.options.onEvent(event);
    }
  }

  private log(message: string): void {
    if (this.options.verbose) {
      console.log(`[SiteAnalyzer] ${message}`);
    }
  }
}
