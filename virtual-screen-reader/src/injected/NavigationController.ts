import { computeAccessibleName } from 'dom-accessibility-api';
import { getRole, getHeadingLevel, getLandmarkRole, isFormField, isButton, isTable, isLink } from './accessibilityUtils';

/**
 * Callbacks for navigation events.
 */
export interface NavigationCallbacks {
    onCursorChange: (element: HTMLElement, action?: string) => void;
    onBoundaryReached: (message: string) => void;
}

/**
 * Handles DOM traversal and virtual cursor management for screen reader navigation.
 */
export class NavigationController {
    private virtualCursor: HTMLElement | null = null;
    private callbacks: NavigationCallbacks;

    constructor(callbacks: NavigationCallbacks) {
        this.callbacks = callbacks;
    }

    get cursor(): HTMLElement | null {
        return this.virtualCursor;
    }

    set cursor(element: HTMLElement | null) {
        this.virtualCursor = element;
    }

    /**
     * Initialize cursor to the first interesting element.
     */
    initializeCursor(): void {
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', () => this.findFirstElement());
        } else {
            this.findFirstElement();
        }
    }

    private findFirstElement(): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => this.isInteresting(node as HTMLElement)
            }
        );

        if (walker.firstChild()) {
            // Announce the first element automatically
            this.setCursor(walker.currentNode as HTMLElement);
        } else {
            console.log("[SR] Screen reader ready - no elements found");
        }
    }

    private ensureValidCursor(walker: TreeWalker): boolean {
        if (this.virtualCursor && document.body.contains(this.virtualCursor)) {
            walker.currentNode = this.virtualCursor;
            return true;
        } else if (this.virtualCursor) {
            console.log("[SR] Virtual cursor lost, resetting");
            this.findFirstElement();
            return false;
        }
        return true; // No cursor set yet, walker will start from body
    }

    setCursor(element: HTMLElement, action?: string): void {
        this.virtualCursor = element;
        this.callbacks.onCursorChange(element, action);
    }

    moveNext(action: string = 'ArrowDown'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => this.isInteresting(node as HTMLElement)
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.nextNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("End of page");
        }
    }

    movePrev(action: string = 'ArrowUp'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => this.isInteresting(node as HTMLElement)
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.previousNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("Top of page");
        }
    }

    moveToNextHeading(action: string = 'h'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    if (!this.isInteresting(node as HTMLElement)) return NodeFilter.FILTER_SKIP;
                    const role = getRole(node as HTMLElement);
                    return role === 'heading' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.nextNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("No next heading");
        }
    }

    moveToPrevHeading(action: string = 'Shift+h'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    if (!this.isInteresting(node as HTMLElement)) return NodeFilter.FILTER_SKIP;
                    const role = getRole(node as HTMLElement);
                    return role === 'heading' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.previousNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("No previous heading");
        }
    }

    moveToNextFocusable(action: string = 'Tab'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    if (!this.isInteresting(node as HTMLElement)) return NodeFilter.FILTER_SKIP;
                    const role = getRole(node as HTMLElement);
                    return (role === 'link' || role === 'button' || role === 'textbox')
                        ? NodeFilter.FILTER_ACCEPT
                        : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.nextNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("No next focusable element");
        }
    }

    moveToPrevFocusable(action: string = 'Shift+Tab'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    if (!this.isInteresting(node as HTMLElement)) return NodeFilter.FILTER_SKIP;
                    const role = getRole(node as HTMLElement);
                    return (role === 'link' || role === 'button' || role === 'textbox')
                        ? NodeFilter.FILTER_ACCEPT
                        : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.previousNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("No previous focusable element");
        }
    }

    moveToNextList(action: string = 'l'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    if (!this.isInteresting(node as HTMLElement)) return NodeFilter.FILTER_SKIP;
                    const role = getRole(node as HTMLElement);
                    return role === 'list' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.nextNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("No next list");
        }
    }

    moveToPrevList(action: string = 'Shift+l'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    if (!this.isInteresting(node as HTMLElement)) return NodeFilter.FILTER_SKIP;
                    const role = getRole(node as HTMLElement);
                    return role === 'list' ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.previousNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("No previous list");
        }
    }

    // ==================== Landmark Navigation ====================

    moveToNextLandmark(action: string = 'd'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    const landmark = getLandmarkRole(node as HTMLElement);
                    return landmark ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.nextNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("No next landmark");
        }
    }

    moveToPrevLandmark(action: string = 'Shift+d'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    const landmark = getLandmarkRole(node as HTMLElement);
                    return landmark ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.previousNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("No previous landmark");
        }
    }

    moveToMain(action: string = 'q'): void {
        // Find the main landmark directly
        const mainElement = document.querySelector('main, [role="main"]') as HTMLElement;
        if (mainElement) {
            this.setCursor(mainElement, action);
        } else {
            this.callbacks.onBoundaryReached("No main content found");
        }
    }

    // ==================== Button Navigation ====================

    moveToNextButton(action: string = 'b'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    return isButton(node as HTMLElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.nextNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("No next button");
        }
    }

    moveToPrevButton(action: string = 'Shift+b'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    return isButton(node as HTMLElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.previousNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("No previous button");
        }
    }

    // ==================== Form Field Navigation ====================

    moveToNextFormField(action: string = 'f'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    return isFormField(node as HTMLElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.nextNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("No next form field");
        }
    }

    moveToPrevFormField(action: string = 'Shift+f'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    return isFormField(node as HTMLElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.previousNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("No previous form field");
        }
    }

    // ==================== Table Navigation ====================

    moveToNextTable(action: string = 't'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    return isTable(node as HTMLElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.nextNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("No next table");
        }
    }

    moveToPrevTable(action: string = 'Shift+t'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    return isTable(node as HTMLElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.previousNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("No previous table");
        }
    }

    // ==================== Link Navigation ====================

    moveToNextLink(action: string = 'k'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    return isLink(node as HTMLElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.nextNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("No next link");
        }
    }

    moveToPrevLink(action: string = 'Shift+k'): void {
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    return isLink(node as HTMLElement) ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.previousNode()) {
            this.setCursor(walker.currentNode as HTMLElement, action);
        } else {
            this.callbacks.onBoundaryReached("No previous link");
        }
    }

    // ==================== Heading Level Navigation ====================

    moveToNextHeadingLevel(level: number, action?: string): void {
        const actionStr = action || `${level}`;
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    const headingLevel = getHeadingLevel(node as HTMLElement);
                    return headingLevel === level ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.nextNode()) {
            this.setCursor(walker.currentNode as HTMLElement, actionStr);
        } else {
            this.callbacks.onBoundaryReached(`No next heading level ${level}`);
        }
    }

    moveToPrevHeadingLevel(level: number, action?: string): void {
        const actionStr = action || `Shift+${level}`;
        const walker = document.createTreeWalker(
            document.body,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => {
                    const headingLevel = getHeadingLevel(node as HTMLElement);
                    return headingLevel === level ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_SKIP;
                }
            }
        );

        if (!this.ensureValidCursor(walker)) return;

        if (walker.previousNode()) {
            this.setCursor(walker.currentNode as HTMLElement, actionStr);
        } else {
            this.callbacks.onBoundaryReached(`No previous heading level ${level}`);
        }
    }

    /**
     * Determine if an element is "interesting" for screen reader navigation.
     */
    isInteresting(element: HTMLElement): number {
        // Skip hidden elements
        if (element.offsetParent === null) return NodeFilter.FILTER_REJECT;

        // Use dom-accessibility-api to check if it has a role/name
        const role = getRole(element);
        const name = computeAccessibleName(element);

        if (role && role !== 'generic' && role !== 'presentation') return NodeFilter.FILTER_ACCEPT;
        if (name && name.trim().length > 0) return NodeFilter.FILTER_ACCEPT;

        // Check if element has direct text node children
        const hasDirectTextContent = this.hasDirectTextNodes(element);
        if (hasDirectTextContent) {
            return NodeFilter.FILTER_ACCEPT;
        }

        // Also include text-only elements (no children)
        if (element.innerText && element.innerText.trim().length > 0 && element.childElementCount === 0) {
            return NodeFilter.FILTER_ACCEPT;
        }

        return NodeFilter.FILTER_SKIP;
    }

    private hasDirectTextNodes(element: HTMLElement): boolean {
        for (let i = 0; i < element.childNodes.length; i++) {
            const child = element.childNodes[i];
            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent?.trim();
                if (text && text.length > 0) {
                    return true;
                }
            }
        }
        return false;
    }

    getDirectTextContent(element: HTMLElement): string {
        const textParts: string[] = [];
        for (let i = 0; i < element.childNodes.length; i++) {
            const child = element.childNodes[i];
            if (child.nodeType === Node.TEXT_NODE) {
                const text = child.textContent;
                if (text) {
                    textParts.push(text);
                }
            }
        }
        return textParts.join('').trim();
    }
}
