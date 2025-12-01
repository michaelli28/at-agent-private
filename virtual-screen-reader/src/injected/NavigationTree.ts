import { computeAccessibleName } from 'dom-accessibility-api';
import { getRole, getHeadingLevel, getLandmarkRole, isFormField, isButton, isTable, isLink } from './accessibilityUtils';

/**
 * Element type flags for pathfinding optimization.
 */
export interface ElementTypeFlags {
    isLandmark: boolean;
    landmarkRole: string | null;
    isButton: boolean;
    isFormField: boolean;
    isTable: boolean;
    isLink: boolean;
    isList: boolean;
    headingLevel: number | null;
}

/**
 * Represents a node in the navigation tree for tracking screen reader traversal.
 */
export interface NavigationTreeNode {
    id: string;
    element: HTMLElement;
    role: string;
    name: string;
    visited: boolean;
    visitCount: number;
    parent: NavigationTreeNode | null;
    children: NavigationTreeNode[];
    depth: number;
    typeFlags: ElementTypeFlags;
}

/**
 * Represents a directed edge in the navigation graph, representing a user action.
 */
export interface NavigationEdge {
    fromId: string;
    toId: string;
    action: string;
    timestamp: number;
}

/**
 * Tree data structure for tracking navigation history and providing
 * context information to help detect loops and understand page structure.
 */
export class NavigationTree {
    private nodeMap: Map<string, NavigationTreeNode> = new Map();
    private currentNode: NavigationTreeNode | null = null;
    private visitOrder: string[] = []; // Track DOM order of visited elements
    private edgeMap: Map<string, NavigationEdge> = new Map(); // Track navigation actions uniquely

    /**
     * Generate unique ID based on element's XPath-like position.
     */
    private generateElementId(element: HTMLElement): string {
        const path: string[] = [];
        let current: HTMLElement | null = element;

        while (current && current !== document.body) {
            let index = 0;
            let sibling = current.previousElementSibling;
            while (sibling) {
                if (sibling.tagName === current.tagName) {
                    index++;
                }
                sibling = sibling.previousElementSibling;
            }
            path.unshift(`${current.tagName.toLowerCase()}[${index}]`);
            current = current.parentElement;
        }

        return path.join('/') || 'body';
    }

    /**
     * Helper to add or update an edge in the graph.
     * Consolidates multiple actions between the same two nodes.
     */
    private addEdge(fromId: string, toId: string, action: string): void {
        const key = `${fromId}->${toId}`;
        const existing = this.edgeMap.get(key);
        
        if (existing) {
            // Check if action already exists in the list
            const actions = new Set(existing.action.split(', '));
            if (!actions.has(action)) {
                actions.add(action);
                existing.action = Array.from(actions).join(', ');
                existing.timestamp = Date.now();
            }
        } else {
            this.edgeMap.set(key, {
                fromId,
                toId,
                action,
                timestamp: Date.now()
            });
        }
    }

    /**
     * Get or create a node for the given element.
     */
    getOrCreateNode(element: HTMLElement): NavigationTreeNode {
        const id = this.generateElementId(element);

        if (this.nodeMap.has(id)) {
            return this.nodeMap.get(id)!;
        }

        // Create new node
        const role = getRole(element) || 'generic';
        const name = computeAccessibleName(element);

        // Find parent node
        let parent: NavigationTreeNode | null = null;
        let parentElement = element.parentElement;
        while (parentElement && parentElement !== document.body) {
            const parentId = this.generateElementId(parentElement);
            if (this.nodeMap.has(parentId)) {
                parent = this.nodeMap.get(parentId)!;
                break;
            }
            parentElement = parentElement.parentElement;
        }

        const depth = parent ? parent.depth + 1 : 0;

        // Compute element type flags for pathfinding
        const landmarkRole = getLandmarkRole(element);
        const typeFlags: ElementTypeFlags = {
            isLandmark: landmarkRole !== null,
            landmarkRole,
            isButton: isButton(element),
            isFormField: isFormField(element),
            isTable: isTable(element),
            isLink: isLink(element),
            isList: role === 'list',
            headingLevel: getHeadingLevel(element)
        };

        const node: NavigationTreeNode = {
            id,
            element,
            role,
            name,
            visited: false,
            visitCount: 0,
            parent,
            children: [],
            depth,
            typeFlags
        };

        // Add to parent's children
        if (parent) {
            parent.children.push(node);
        }

        this.nodeMap.set(id, node);
        return node;
    }

    /**
     * Update current position and mark as visited.
     */
    visit(element: HTMLElement, action?: string): NavigationTreeNode {
        const node = this.getOrCreateNode(element);

        // Record navigation edge if we have a previous node and an action
        if (this.currentNode && this.currentNode.id !== node.id && action) {
            this.addEdge(this.currentNode.id, node.id, action);
        }

        node.visited = true;
        node.visitCount++;
        this.currentNode = node;

        // Track visit order (only add once, first visit determines order)
        if (!this.visitOrder.includes(node.id)) {
            this.visitOrder.push(node.id);
        }

        return node;
    }

    /**
     * Get tree context as a string for LLM consumption.
     */
    getTreeContext(node: NavigationTreeNode): string {
        const parts: string[] = [];

        // Visit information
        if (node.visitCount === 1) {
            parts.push('[FIRST VISIT]');
        } else if (node.visitCount > 1) {
            parts.push(`[VISITED ${node.visitCount} TIMES - POSSIBLE LOOP]`);
        }

        // Depth/hierarchy information
        parts.push(`[Depth: ${node.depth}]`);

        // Parent information
        if (node.parent) {
            parts.push(`[Parent: ${node.parent.role}${node.parent.name ? ' "' + node.parent.name + '"' : ''}]`);
        } else {
            parts.push('[Top-level element]');
        }

        // Children information
        if (node.children.length > 0) {
            const visitedChildren = node.children.filter(c => c.visited).length;
            parts.push(`[Children: ${node.children.length}, Visited: ${visitedChildren}]`);

            // List unvisited children if any
            if (visitedChildren < node.children.length) {
                const unvisited = node.children
                    .filter(c => !c.visited)
                    .map(c => `${c.role}${c.name ? ' "' + c.name + '"' : ''}`)
                    .slice(0, 3);
                if (unvisited.length > 0) {
                    parts.push(`[Unvisited children: ${unvisited.join(', ')}${node.children.length - visitedChildren > 3 ? '...' : ''}]`);
                }
            }
        }

        return parts.join(' ');
    }

    /**
     * Get statistics for debugging.
     */
    getStats(): { totalNodes: number; visitedNodes: number; maxVisitCount: number } {
        let visitedCount = 0;
        let maxVisits = 0;

        for (const node of this.nodeMap.values()) {
            if (node.visited) visitedCount++;
            if (node.visitCount > maxVisits) maxVisits = node.visitCount;
        }

        return {
            totalNodes: this.nodeMap.size,
            visitedNodes: visitedCount,
            maxVisitCount: maxVisits
        };
    }

    /**
     * Get the shortest keystroke path from current node to target node.
     */
    getPathTo(targetId: string): PathResult {
        const currentIdx = this.currentNode ? this.visitOrder.indexOf(this.currentNode.id) : -1;
        const targetIdx = this.visitOrder.indexOf(targetId);

        if (currentIdx === -1 || targetIdx === -1) {
            return { found: false, keys: [], targetId };
        }

        // Build type flags map for pathfinding
        const nodeTypeFlags = new Map<string, ElementTypeFlags>();
        for (const [id, node] of this.nodeMap.entries()) {
            nodeTypeFlags.set(id, node.typeFlags);
        }

        const keys = findShortestPath(this.visitOrder, nodeTypeFlags, currentIdx, targetIdx);

        return {
            found: keys.length > 0 || currentIdx === targetIdx,
            keys,
            targetId
        };
    }

    /**
     * Compute all possible edges between visited nodes.
     * This turns the linear visit history into a fully connected graph based on
     * available navigation commands.
     */
    computeFullGraph(): void {
        this.edgeMap.clear(); // Reset edges to avoid duplicates

        // Build type flags map
        const nodeTypeFlags = new Map<string, ElementTypeFlags>();
        for (const [id, node] of this.nodeMap.entries()) {
            nodeTypeFlags.set(id, node.typeFlags);
        }

        // Precompute indices for quick lookup
        const headingIndices: number[] = [];
        const listIndices: number[] = [];
        const landmarkIndices: number[] = [];
        let mainIdx: number | null = null;
        const buttonIndices: number[] = [];
        const formFieldIndices: number[] = [];
        const tableIndices: number[] = [];
        const linkIndices: number[] = [];
        const headingLevelIndices: Map<number, number[]> = new Map([
            [1, []], [2, []], [3, []], [4, []], [5, []], [6, []]
        ]);

        for (let i = 0; i < this.visitOrder.length; i++) {
            const flags = nodeTypeFlags.get(this.visitOrder[i]);
            if (!flags) continue;

            if (flags.headingLevel !== null) {
                headingIndices.push(i);
                headingLevelIndices.get(flags.headingLevel)?.push(i);
            }
            if (flags.isLandmark) {
                landmarkIndices.push(i);
                if (flags.landmarkRole === 'main') {
                    mainIdx = i;
                }
            }
            if (flags.isButton) buttonIndices.push(i);
            if (flags.isFormField) formFieldIndices.push(i);
            if (flags.isTable) tableIndices.push(i);
            if (flags.isLink) linkIndices.push(i);
            if (flags.isList) listIndices.push(i);
        }

        // Helper to find next/prev of type
        const findNext = (indices: number[], currentIdx: number): number | null => {
            for (const idx of indices) {
                if (idx > currentIdx) return idx;
            }
            return null;
        };

        const findPrev = (indices: number[], currentIdx: number): number | null => {
            for (let i = indices.length - 1; i >= 0; i--) {
                if (indices[i] < currentIdx) return indices[i];
            }
            return null;
        };

        // Iterate through all visited nodes to generate edges
        for (let i = 0; i < this.visitOrder.length; i++) {
            const currentId = this.visitOrder[i];

            // Define all possible moves from this node
            const moves: [number | null, string][] = [
                // ArrowDown - next in order
                [i + 1 < this.visitOrder.length ? i + 1 : null, 'ArrowDown'],
                // ArrowUp - previous in order
                [i - 1 >= 0 ? i - 1 : null, 'ArrowUp'],
                
                // H - headings
                [findNext(headingIndices, i), 'h'],
                [findPrev(headingIndices, i), 'Shift+h'],

                // D - landmarks
                [findNext(landmarkIndices, i), 'd'],
                [findPrev(landmarkIndices, i), 'Shift+d'],
                
                // Q - main
                [mainIdx !== null && i !== mainIdx ? mainIdx : null, 'q'],

                // B - buttons
                [findNext(buttonIndices, i), 'b'],
                [findPrev(buttonIndices, i), 'Shift+b'],

                // F - form fields
                [findNext(formFieldIndices, i), 'f'],
                [findPrev(formFieldIndices, i), 'Shift+f'],

                // T - tables
                [findNext(tableIndices, i), 't'],
                [findPrev(tableIndices, i), 'Shift+t'],

                // K - links
                [findNext(linkIndices, i), 'k'],
                [findPrev(linkIndices, i), 'Shift+k'],

                // L - lists
                [findNext(listIndices, i), 'l'],
                [findPrev(listIndices, i), 'Shift+l'],
            ];

            // 1-6 Heading Levels
            for (let level = 1; level <= 6; level++) {
                const levelIndices = headingLevelIndices.get(level) || [];
                moves.push([findNext(levelIndices, i), `${level}`]);
                moves.push([findPrev(levelIndices, i), `Shift+${level}`]);
            }

            // Consolidate valid edges
            for (const [targetIdx, action] of moves) {
                if (targetIdx !== null) {
                    const targetId = this.visitOrder[targetIdx];
                    this.addEdge(currentId, targetId, action);
                }
            }
        }
    }

    /**
     * Get text content for generic elements.
     */
    private getContentPreview(element: HTMLElement, role: string): string {
        // Only get content for generic elements
        if (role !== 'generic') return '';

        const text = element.innerText?.trim() || '';
        if (!text) return '';

        // Truncate long content
        const maxLength = 100;
        return text.length > maxLength ? text.substring(0, maxLength) + '...' : text;
    }

    /**
     * Serialize the tree for external visualization.
     */
    serialize(): SerializedTree {
        // Get all visited nodes and sort by actual DOM order
        const visitedNodes = Array.from(this.nodeMap.values())
            .filter(node => node.visited)
            .sort((a, b) => {
                // Use compareDocumentPosition for proper DOM ordering
                const position = a.element.compareDocumentPosition(b.element);
                if (position & Node.DOCUMENT_POSITION_FOLLOWING) {
                    return -1; // a comes before b
                } else if (position & Node.DOCUMENT_POSITION_PRECEDING) {
                    return 1; // a comes after b
                }
                return 0;
            });

        const nodes: SerializedNode[] = visitedNodes.map((node, index) => ({
            id: node.id,
            role: node.role,
            name: node.name,
            content: this.getContentPreview(node.element, node.role),
            visited: node.visited,
            visitCount: node.visitCount,
            depth: node.depth,
            parentId: node.parent?.id || null,
            isCurrent: node === this.currentNode,
            order: index
        }));

        return {
            nodes,
            edges: Array.from(this.edgeMap.values()),
            stats: this.getStats(),
            currentId: this.currentNode?.id || null
        };
    }

    /**
     * Save tree state to sessionStorage for back/forward navigation.
     */
    saveState(url: string): void {
        const state: SavedTreeState = {
            visitOrder: this.visitOrder,
            currentNodeId: this.currentNode?.id || null,
            timestamp: Date.now()
        };
        try {
            sessionStorage.setItem(`sr-tree-${url}`, JSON.stringify(state));
            console.log(`[SR] Saved tree state for ${url} (${this.visitOrder.length} nodes)`);
        } catch (e) {
            console.warn('[SR] Failed to save tree state:', e);
        }
    }

    /**
     * Restore tree state from sessionStorage.
     * Returns the element ID to navigate to, or null if no state found.
     */
    restoreState(url: string): string | null {
        try {
            const stored = sessionStorage.getItem(`sr-tree-${url}`);
            if (!stored) return null;

            const state: SavedTreeState = JSON.parse(stored);

            // Only restore if state is recent (within last hour)
            if (Date.now() - state.timestamp > 3600000) {
                sessionStorage.removeItem(`sr-tree-${url}`);
                return null;
            }

            console.log(`[SR] Restoring tree state for ${url} (${state.visitOrder.length} nodes)`);

            // Rebuild nodes from saved IDs
            const restoredIds: string[] = [];
            for (const id of state.visitOrder) {
                const element = this.findElementById(id);
                if (element) {
                    // Recreate the node and mark as visited
                    const node = this.getOrCreateNode(element);
                    node.visited = true;
                    node.visitCount = 1;
                    restoredIds.push(id);
                }
            }

            this.visitOrder = restoredIds;
            console.log(`[SR] Restored ${restoredIds.length} of ${state.visitOrder.length} nodes`);

            return state.currentNodeId;
        } catch (e) {
            console.warn('[SR] Failed to restore tree state:', e);
            return null;
        }
    }

    /**
     * Find an element by its XPath-like ID.
     */
    findElementById(id: string): HTMLElement | null {
        // ID format: "tag[index]/tag[index]/..."
        const parts = id.split('/');
        let current: Element = document.body;

        for (const part of parts) {
            const match = part.match(/^([a-z0-9]+)\[(\d+)\]$/i);
            if (!match) return null;

            const [, tagName, indexStr] = match;
            const index = parseInt(indexStr, 10);

            // Find the nth sibling of this tag type
            const children = Array.from(current.children);
            let count = 0;
            let found: Element | null = null;

            for (const child of children) {
                if (child.tagName.toLowerCase() === tagName.toLowerCase()) {
                    if (count === index) {
                        found = child;
                        break;
                    }
                    count++;
                }
            }

            if (!found) return null;
            current = found;
        }

        return current as HTMLElement;
    }

    /**
     * Get the current node ID for state saving.
     */
    getCurrentNodeId(): string | null {
        return this.currentNode?.id || null;
    }
}

export interface SavedTreeState {
    visitOrder: string[];
    currentNodeId: string | null;
    timestamp: number;
}

export interface SerializedNode {
    id: string;
    role: string;
    name: string;
    content: string;
    visited: boolean;
    visitCount: number;
    depth: number;
    parentId: string | null;
    isCurrent: boolean;
    order: number;
}

export interface SerializedTree {
    nodes: SerializedNode[];
    edges: NavigationEdge[];
    stats: { totalNodes: number; visitedNodes: number; maxVisitCount: number };
    currentId: string | null;
}

export type NavigationKey =
    | 'ArrowDown' | 'ArrowUp'
    | 'h' | 'Shift+h'
    | 'l' | 'Shift+l'
    | 'd' | 'Shift+d'
    | 'q'
    | 'b' | 'Shift+b'
    | 'f' | 'Shift+f'
    | 't' | 'Shift+t'
    | 'k' | 'Shift+k'
    | '1' | 'Shift+1'
    | '2' | 'Shift+2'
    | '3' | 'Shift+3'
    | '4' | 'Shift+4'
    | '5' | 'Shift+5'
    | '6' | 'Shift+6';

export interface PathResult {
    found: boolean;
    keys: NavigationKey[];
    targetId: string;
}

/**
 * Finds the shortest keystroke path between two visited nodes using BFS.
 */
export function findShortestPath(
    visitOrder: string[],
    nodeTypeFlags: Map<string, ElementTypeFlags>,
    fromIndex: number,
    toIndex: number
): NavigationKey[] {
    if (fromIndex === toIndex) return [];
    if (fromIndex < 0 || toIndex < 0 || fromIndex >= visitOrder.length || toIndex >= visitOrder.length) {
        return [];
    }

    // BFS state: [currentIndex, path]
    const queue: [number, NavigationKey[]][] = [[fromIndex, []]];
    const visited = new Set<number>();
    visited.add(fromIndex);

    // Precompute type indices for quick lookup
    const headingIndices: number[] = [];
    const listIndices: number[] = [];
    const landmarkIndices: number[] = [];
    const mainIndex: number | null = null;
    const buttonIndices: number[] = [];
    const formFieldIndices: number[] = [];
    const tableIndices: number[] = [];
    const linkIndices: number[] = [];
    const headingLevelIndices: Map<number, number[]> = new Map([
        [1, []], [2, []], [3, []], [4, []], [5, []], [6, []]
    ]);

    let mainIdx: number | null = null;

    for (let i = 0; i < visitOrder.length; i++) {
        const flags = nodeTypeFlags.get(visitOrder[i]);
        if (!flags) continue;

        if (flags.headingLevel !== null) {
            headingIndices.push(i);
            headingLevelIndices.get(flags.headingLevel)?.push(i);
        }
        if (flags.isLandmark) {
            landmarkIndices.push(i);
            if (flags.landmarkRole === 'main') {
                mainIdx = i;
            }
        }
        if (flags.isButton) buttonIndices.push(i);
        if (flags.isFormField) formFieldIndices.push(i);
        if (flags.isTable) tableIndices.push(i);
        if (flags.isLink) linkIndices.push(i);
        if (flags.isList) listIndices.push(i);
    }

    // Helper to find next/prev of type
    const findNext = (indices: number[], currentIdx: number): number | null => {
        for (const idx of indices) {
            if (idx > currentIdx) return idx;
        }
        return null;
    };

    const findPrev = (indices: number[], currentIdx: number): number | null => {
        for (let i = indices.length - 1; i >= 0; i--) {
            if (indices[i] < currentIdx) return indices[i];
        }
        return null;
    };

    while (queue.length > 0) {
        const [currentIdx, path] = queue.shift()!;

        // Generate all possible moves
        const moves: [number, NavigationKey][] = [];

        // ArrowDown - next in order
        if (currentIdx + 1 < visitOrder.length) {
            moves.push([currentIdx + 1, 'ArrowDown']);
        }

        // ArrowUp - previous in order
        if (currentIdx - 1 >= 0) {
            moves.push([currentIdx - 1, 'ArrowUp']);
        }

        // H - next heading (any level)
        const nextHeading = findNext(headingIndices, currentIdx);
        if (nextHeading !== null) {
            moves.push([nextHeading, 'h']);
        }

        // Shift+H - previous heading (any level)
        const prevHeading = findPrev(headingIndices, currentIdx);
        if (prevHeading !== null) {
            moves.push([prevHeading, 'Shift+h']);
        }

        // D - next landmark
        const nextLandmark = findNext(landmarkIndices, currentIdx);
        if (nextLandmark !== null) {
            moves.push([nextLandmark, 'd']);
        }

        // Shift+D - previous landmark
        const prevLandmark = findPrev(landmarkIndices, currentIdx);
        if (prevLandmark !== null) {
            moves.push([prevLandmark, 'Shift+d']);
        }

        // Q - jump to main (only if there's a main and we're not there)
        if (mainIdx !== null && currentIdx !== mainIdx) {
            moves.push([mainIdx, 'q']);
        }

        // B - next button
        const nextButton = findNext(buttonIndices, currentIdx);
        if (nextButton !== null) {
            moves.push([nextButton, 'b']);
        }

        // Shift+B - previous button
        const prevButton = findPrev(buttonIndices, currentIdx);
        if (prevButton !== null) {
            moves.push([prevButton, 'Shift+b']);
        }

        // F - next form field
        const nextFormField = findNext(formFieldIndices, currentIdx);
        if (nextFormField !== null) {
            moves.push([nextFormField, 'f']);
        }

        // Shift+F - previous form field
        const prevFormField = findPrev(formFieldIndices, currentIdx);
        if (prevFormField !== null) {
            moves.push([prevFormField, 'Shift+f']);
        }

        // T - next table
        const nextTable = findNext(tableIndices, currentIdx);
        if (nextTable !== null) {
            moves.push([nextTable, 't']);
        }

        // Shift+T - previous table
        const prevTable = findPrev(tableIndices, currentIdx);
        if (prevTable !== null) {
            moves.push([prevTable, 'Shift+t']);
        }

        // K - next link
        const nextLink = findNext(linkIndices, currentIdx);
        if (nextLink !== null) {
            moves.push([nextLink, 'k']);
        }

        // Shift+K - previous link
        const prevLink = findPrev(linkIndices, currentIdx);
        if (prevLink !== null) {
            moves.push([prevLink, 'Shift+k']);
        }

        // L - next list
        const nextList = findNext(listIndices, currentIdx);
        if (nextList !== null) {
            moves.push([nextList, 'l']);
        }

        // Shift+L - previous list
        const prevList = findPrev(listIndices, currentIdx);
        if (prevList !== null) {
            moves.push([prevList, 'Shift+l']);
        }

        // 1-6 - heading level navigation
        for (let level = 1; level <= 6; level++) {
            const levelIndices = headingLevelIndices.get(level) || [];

            const nextLevel = findNext(levelIndices, currentIdx);
            if (nextLevel !== null) {
                moves.push([nextLevel, `${level}` as NavigationKey]);
            }

            const prevLevel = findPrev(levelIndices, currentIdx);
            if (prevLevel !== null) {
                moves.push([prevLevel, `Shift+${level}` as NavigationKey]);
            }
        }

        // Process moves
        for (const [nextIdx, key] of moves) {
            if (nextIdx === toIndex) {
                return [...path, key];
            }

            if (!visited.has(nextIdx)) {
                visited.add(nextIdx);
                queue.push([nextIdx, [...path, key]]);
            }
        }
    }

    return []; // No path found
}
