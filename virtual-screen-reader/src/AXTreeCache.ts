/**
 * AXTreeCache - Caches the accessibility tree for efficient navigation.
 *
 * Simplified: Only handles caching of the AX tree. Dynamic content detection
 * is handled exclusively by the MutationObserver in playwrightClient.ts.
 */

import { BrowserClient } from './playwrightClient';
import { NavigableAXNode, CachedAXTree } from './types';
import { AXTreeNavigator } from './AXTreeNavigator';

/**
 * Options for the AX tree cache.
 */
export interface AXTreeCacheOptions {
    /** Maximum age of cache before refresh (ms). Default: 60000 */
    maxAge?: number;
}

const DEFAULT_OPTIONS: Required<AXTreeCacheOptions> = {
    maxAge: 60000, // 60 seconds - only refresh on explicit actions, not time-based
};

/**
 * AXTreeCache manages caching of the accessibility tree.
 */
export class AXTreeCache {
    private client: BrowserClient;
    private options: Required<AXTreeCacheOptions>;
    private navigator: AXTreeNavigator;
    private cache: CachedAXTree | null = null;

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

            // Resolve aria-controls relationships for expanded elements
            await this.resolveAriaControlsRelationships();

            return this.cache;
        } catch (error) {
            console.error('[AXTreeCache] Failed to refresh tree:', error);
            return this.cache; // Return stale cache on error
        }
    }

    /**
     * Resolves aria-controls relationships for elements that can expand/control other content.
     * This provides a fallback for sites that properly use aria-controls.
     * Note: Focus following (in ScreenReaderDriver) handles most dropdown cases.
     */
    private async resolveAriaControlsRelationships(): Promise<void> {
        if (!this.cache) return;

        // Find elements with hasPopup or expanded states that might control other content
        for (const node of this.cache.interestingNodes) {
            if ((node.states.hasPopup || node.states.expanded !== undefined) && node.backendDOMNodeId) {
                try {
                    const ariaControls = await this.client.getNodeAttribute(node.backendDOMNodeId, 'aria-controls');
                    if (ariaControls && ariaControls !== 'null') {
                        // aria-controls can be space-separated IDs
                        const controlledIds = ariaControls.split(/\s+/);

                        for (const domId of controlledIds) {
                            const backendNodeId = await this.client.getBackendNodeIdByDomId(domId);
                            if (backendNodeId) {
                                const controlledNode = this.findByBackendNodeId(backendNodeId);
                                if (controlledNode) {
                                    // Link the relationships
                                    if (!node.controlledNodes) node.controlledNodes = [];
                                    node.controlledNodes.push(controlledNode);
                                    controlledNode.controllerNode = node;
                                }
                            }
                        }
                    }
                } catch (e) {
                    // Ignore errors for individual nodes
                }
            }
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
    getStats(): { totalNodes: number; interestingNodes: number; cacheAge: number } {
        return {
            totalNodes: this.cache?.flatNodes.length || 0,
            interestingNodes: this.cache?.interestingNodes.length || 0,
            cacheAge: this.getCacheAge(),
        };
    }

    /**
     * Cleans up resources.
     */
    dispose(): void {
        this.cache = null;
    }
}
