/**
 * AXTreeCache - Caches the accessibility tree and monitors for live region changes.
 *
 * Handles efficient caching of the AX tree and polling-based live region detection.
 */

import { BrowserClient } from './playwrightClient';
import { AXNode, NavigableAXNode, CachedAXTree, LiveRegionAnnouncement } from './types';
import { AXTreeNavigator } from './AXTreeNavigator';

/**
 * Options for the AX tree cache.
 */
export interface AXTreeCacheOptions {
    /** Maximum age of cache before refresh (ms). Default: 5000 */
    maxAge?: number;
    /** Interval for live region polling (ms). Default: 500 */
    pollInterval?: number;
    /** Enable live region monitoring. Default: true */
    enableLiveRegions?: boolean;
}

const DEFAULT_OPTIONS: Required<AXTreeCacheOptions> = {
    maxAge: 60000, // 60 seconds - only refresh on explicit actions, not time-based
    pollInterval: 500,
    enableLiveRegions: true,
};

/**
 * AXTreeCache manages caching and live region monitoring.
 */
export class AXTreeCache {
    private client: BrowserClient;
    private options: Required<AXTreeCacheOptions>;
    private navigator: AXTreeNavigator;

    private cache: CachedAXTree | null = null;
    private pollTimer: NodeJS.Timeout | null = null;
    private liveRegionContent: Map<string, string> = new Map();
    private onLiveRegionCallback: ((announcement: LiveRegionAnnouncement) => void) | null = null;
    private isPolling: boolean = false;
    private isCheckingLiveRegions: boolean = false; // Prevents re-entry during async polling

    constructor(client: BrowserClient, navigator: AXTreeNavigator, options: AXTreeCacheOptions = {}) {
        this.client = client;
        this.navigator = navigator;
        this.options = { ...DEFAULT_OPTIONS, ...options };
    }

    /**
     * Gets the cached tree, refreshing if stale.
     */
    async getTree(): Promise<CachedAXTree | null> {
        if (this.cache && !this.isStale()) {
            return this.cache;
        }

        return await this.refresh();
    }

    /**
     * Forces a refresh of the AX tree.
     */
    async refresh(): Promise<CachedAXTree | null> {
        try {
            const flatNodes = await this.client.getFullAXTree();
            const url = await this.client.getCurrentUrl();

            // Build navigable tree
            const root = this.navigator.buildNavigableTree(flatNodes);

            // Cache the result
            this.cache = {
                root,
                flatNodes: root ? this.collectFlatNodes(root) : [],
                interestingNodes: this.navigator.getAllInterestingNodes(),
                timestamp: Date.now(),
                url,
            };

            // Update live region tracking
            if (this.options.enableLiveRegions) {
                this.updateLiveRegionTracking();
            }

            return this.cache;
        } catch (error) {
            console.error('[AXTreeCache] Failed to refresh tree:', error);
            return this.cache; // Return stale cache on error
        }
    }

    /**
     * Invalidates the cache, forcing next getTree() to refresh.
     */
    invalidate(): void {
        this.cache = null;
    }

    /**
     * Checks if the cache is stale.
     */
    isStale(): boolean {
        if (!this.cache) return true;
        return Date.now() - this.cache.timestamp > this.options.maxAge;
    }

    /**
     * Gets the cache age in milliseconds.
     */
    getCacheAge(): number {
        if (!this.cache) return Infinity;
        return Date.now() - this.cache.timestamp;
    }

    // =========================================================================
    // Live Region Monitoring
    // =========================================================================

    /**
     * Starts polling for live region changes.
     */
    startLiveRegionPolling(): void {
        if (this.isPolling || !this.options.enableLiveRegions) return;

        this.isPolling = true;
        this.pollTimer = setInterval(() => {
            // Prevent re-entry: if previous check is still running, skip this interval
            if (this.isCheckingLiveRegions) return;

            this.checkLiveRegions().catch((error) => {
                // Log error but don't crash - polling should be resilient
                console.error('[AXTreeCache] Live region check error:', error);
            });
        }, this.options.pollInterval);
    }

    /**
     * Stops live region polling.
     */
    stopLiveRegionPolling(): void {
        this.isPolling = false;
        if (this.pollTimer) {
            clearInterval(this.pollTimer);
            this.pollTimer = null;
        }
    }

    /**
     * Registers a callback for live region announcements.
     */
    onLiveRegion(callback: (announcement: LiveRegionAnnouncement) => void): void {
        this.onLiveRegionCallback = callback;
    }

    /**
     * Checks for live region changes.
     */
    private async checkLiveRegions(): Promise<void> {
        if (!this.onLiveRegionCallback) return;

        // Set re-entry flag to prevent concurrent checks
        this.isCheckingLiveRegions = true;

        try {
            // Get fresh tree for live region check
            const flatNodes = await this.client.getFullAXTree();

            // Track which nodeIds we see in this check for cleanup
            const currentNodeIds = new Set<string>();

            for (const node of flatNodes) {
                // Check if this is a live region
                const liveProperty = node.properties?.find(p => p.name === 'live');
                const live = liveProperty?.value?.value as string | undefined;

                if (!live || live === 'off') continue;

                currentNodeIds.add(node.nodeId);

                // Check for aria-busy - don't announce while busy
                const busyProperty = node.properties?.find(p => p.name === 'busy');
                const busy = busyProperty?.value?.value === true;
                if (busy) continue;

                // Get current content
                const currentContent = this.getLiveRegionContent(node, flatNodes);
                const previousContent = this.liveRegionContent.get(node.nodeId);

                // Check if content changed
                if (previousContent !== undefined && currentContent !== previousContent && currentContent.trim()) {
                    // Content changed - announce it
                    const politeness = live === 'assertive' ? 'assertive' : 'polite';

                    // Check atomic - if true, announce entire region
                    const atomicProperty = node.properties?.find(p => p.name === 'atomic');
                    const atomic = atomicProperty?.value?.value === true;

                    const message = atomic ? currentContent : this.getAddedContent(previousContent, currentContent);

                    if (message.trim()) {
                        this.onLiveRegionCallback({
                            message,
                            politeness,
                            timestamp: Date.now(),
                            nodeId: node.nodeId,
                        });
                    }
                }

                // Update tracking
                this.liveRegionContent.set(node.nodeId, currentContent);
            }

            // Clean up stale entries - remove nodeIds that no longer exist
            for (const nodeId of this.liveRegionContent.keys()) {
                if (!currentNodeIds.has(nodeId)) {
                    this.liveRegionContent.delete(nodeId);
                }
            }
        } catch (error) {
            // Ignore errors during polling - page might be navigating
        } finally {
            // Always clear the re-entry flag
            this.isCheckingLiveRegions = false;
        }
    }

    /**
     * Updates live region tracking after tree refresh.
     */
    private updateLiveRegionTracking(): void {
        if (!this.cache) return;

        // Find all live regions and store their current content
        for (const node of this.cache.flatNodes) {
            if (node.states.live && node.states.live !== 'off') {
                const content = this.getNodeTextContent(node);
                this.liveRegionContent.set(node.nodeId, content);
            }
        }
    }

    /**
     * Gets the text content of a live region from flat nodes.
     */
    private getLiveRegionContent(node: AXNode, flatNodes: AXNode[]): string {
        // Build a map for quick lookup
        const nodeMap = new Map<string, AXNode>();
        for (const n of flatNodes) {
            nodeMap.set(n.nodeId, n);
        }

        // Recursively get text
        const getText = (n: AXNode): string => {
            if (n.name?.value) {
                return String(n.name.value);
            }

            if (!n.childIds) return '';

            const childTexts: string[] = [];
            for (const childId of n.childIds) {
                const child = nodeMap.get(childId);
                if (child && !child.ignored) {
                    const text = getText(child);
                    if (text) childTexts.push(text);
                }
            }

            return childTexts.join(' ');
        };

        return getText(node);
    }

    /**
     * Gets text content from a NavigableAXNode.
     */
    private getNodeTextContent(node: NavigableAXNode): string {
        if (node.computedName) {
            return node.computedName;
        }

        return node.children
            .map(child => this.getNodeTextContent(child))
            .filter(t => t)
            .join(' ');
    }

    /**
     * Gets the added content between previous and current state.
     * Uses word-level diff to accurately detect new content.
     */
    private getAddedContent(previous: string, current: string): string {
        if (previous === current) return '';

        const prevWords = previous.split(/\s+/).filter(w => w.length > 0);
        const currWords = current.split(/\s+/).filter(w => w.length > 0);

        // If previous is empty, everything is new
        if (prevWords.length === 0) return current;

        // Find words in current that aren't in previous (preserving order)
        // Use a simple approach: find the longest common prefix and suffix
        let prefixEnd = 0;
        while (prefixEnd < prevWords.length && prefixEnd < currWords.length &&
               prevWords[prefixEnd] === currWords[prefixEnd]) {
            prefixEnd++;
        }

        let suffixStart = 0;
        while (suffixStart < (prevWords.length - prefixEnd) &&
               suffixStart < (currWords.length - prefixEnd) &&
               prevWords[prevWords.length - 1 - suffixStart] === currWords[currWords.length - 1 - suffixStart]) {
            suffixStart++;
        }

        // Extract the new middle portion
        const newStartIndex = prefixEnd;
        const newEndIndex = currWords.length - suffixStart;

        if (newStartIndex < newEndIndex) {
            return currWords.slice(newStartIndex, newEndIndex).join(' ');
        }

        // If no clear addition found, return the whole current content
        // (content was replaced rather than added)
        return current;
    }

    /**
     * Collects all nodes into a flat array via DFS.
     */
    private collectFlatNodes(root: NavigableAXNode): NavigableAXNode[] {
        const nodes: NavigableAXNode[] = [];

        const traverse = (node: NavigableAXNode) => {
            nodes.push(node);
            for (const child of node.children) {
                traverse(child);
            }
        };

        traverse(root);
        return nodes;
    }

    // =========================================================================
    // Utility Methods
    // =========================================================================

    /**
     * Finds a node by its backend DOM node ID.
     */
    findByBackendNodeId(backendNodeId: number): NavigableAXNode | null {
        if (!this.cache) return null;

        return this.cache.flatNodes.find(n => n.backendDOMNodeId === backendNodeId) || null;
    }

    /**
     * Finds a node by its AX node ID.
     */
    findByNodeId(nodeId: string): NavigableAXNode | null {
        if (!this.cache) return null;

        return this.cache.flatNodes.find(n => n.nodeId === nodeId) || null;
    }

    /**
     * Gets cache statistics.
     */
    getStats(): { totalNodes: number; interestingNodes: number; liveRegions: number; cacheAge: number } {
        return {
            totalNodes: this.cache?.flatNodes.length || 0,
            interestingNodes: this.cache?.interestingNodes.length || 0,
            liveRegions: this.liveRegionContent.size,
            cacheAge: this.getCacheAge(),
        };
    }

    /**
     * Cleans up resources.
     */
    dispose(): void {
        this.stopLiveRegionPolling();
        this.cache = null;
        this.liveRegionContent.clear();
        this.onLiveRegionCallback = null;
    }
}
