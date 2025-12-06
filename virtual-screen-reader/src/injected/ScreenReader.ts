import { computeAccessibleName } from 'dom-accessibility-api';
import { getRole } from './accessibilityUtils';
import { NavigationTree, PathResult } from './NavigationTree';
import { HighlightBox } from './HighlightBox';
import { SpeechAnnouncer } from './SpeechAnnouncer';
import { NavigationController } from './NavigationController';
import { KeyboardHandler } from './KeyboardHandler';

/**
 * Main screen reader class that orchestrates all components.
 * Acts as a facade coordinating navigation, speech, and visual feedback.
 */
export class ScreenReader {
    private navigationTree: NavigationTree;
    private highlightBox: HighlightBox;
    private announcer: SpeechAnnouncer;
    private navigator: NavigationController;
    private keyboard: KeyboardHandler;
    private isAutoTraversing: boolean = false;
    private isInstantTraversing: boolean = false;
    private autoTraverseTimer: number | null = null;

    constructor() {
        // Initialize components
        this.navigationTree = new NavigationTree();
        this.highlightBox = new HighlightBox();
        this.announcer = new SpeechAnnouncer(this.navigationTree);

        // Initialize navigator with callbacks
        this.navigator = new NavigationController({
            onCursorChange: (element, action) => this.handleCursorChange(element, action),
            onBoundaryReached: (message) => this.announcer.announceMessage(message)
        });

        // Initialize keyboard handler with callbacks
        this.keyboard = new KeyboardHandler({
            // Basic navigation
            onNavigateNext: () => this.navigator.moveNext('ArrowDown'),
            onNavigatePrev: () => this.navigator.movePrev('ArrowUp'),
            onNextHeading: () => this.navigator.moveToNextHeading('h'),
            onPrevHeading: () => this.navigator.moveToPrevHeading('Shift+h'),
            onNextList: () => this.navigator.moveToNextList('l'),
            onPrevList: () => this.navigator.moveToPrevList('Shift+l'),
            onTabFocus: (element) => this.handleTabFocus(element),
            onActivate: () => this.handleActivate(),

            // Landmark navigation
            onNextLandmark: () => this.navigator.moveToNextLandmark('d'),
            onPrevLandmark: () => this.navigator.moveToPrevLandmark('Shift+d'),
            onJumpToMain: () => this.navigator.moveToMain('q'),

            // Element type navigation
            onNextButton: () => this.navigator.moveToNextButton('b'),
            onPrevButton: () => this.navigator.moveToPrevButton('Shift+b'),
            onNextFormField: () => this.navigator.moveToNextFormField('f'),
            onPrevFormField: () => this.navigator.moveToPrevFormField('Shift+f'),
            onNextTable: () => this.navigator.moveToNextTable('t'),
            onPrevTable: () => this.navigator.moveToPrevTable('Shift+t'),
            onNextLink: () => this.navigator.moveToNextLink('k'),
            onPrevLink: () => this.navigator.moveToPrevLink('Shift+k'),

            // Heading level navigation
            onNextHeadingLevel: (level) => this.navigator.moveToNextHeadingLevel(level, `${level}`),
            onPrevHeadingLevel: (level) => this.navigator.moveToPrevHeadingLevel(level, `Shift+${level}`),

            // History navigation
            onGoBack: () => this.handleGoBack(),
            onGoForward: () => this.handleGoForward(),

            // Auto-traverse
            onAutoTraverse: () => this.startAutoTraverse(),
            onStopTraverse: () => this.stopAutoTraverse(),
            onInstantTraverse: () => this.instantTraverse()
        });

        // Start up
        this.keyboard.attach();

        // Try to restore previous state, otherwise initialize fresh
        this.tryRestoreState();

        console.log("In-Browser Screen Reader Initialized");
    }

    /**
     * Try to restore navigation state from a previous visit.
     */
    private tryRestoreState(): void {
        const url = window.location.href;
        const savedNodeId = this.navigationTree.restoreState(url);

        if (savedNodeId) {
            // Try to find and navigate to the saved element
            const element = this.navigationTree.findElementById(savedNodeId);
            if (element && this.navigator.isInteresting(element) === NodeFilter.FILTER_ACCEPT) {
                console.log(`[SR] Restored cursor position`);
                this.navigator.setCursor(element);
                return;
            }
        }

        // No saved state or element not found - initialize normally
        this.navigator.initializeCursor();
    }

    /**
     * Save current state before navigation.
     */
    private saveStateBeforeNavigation(): void {
        const url = window.location.href;
        this.navigationTree.saveState(url);
    }

    /**
     * Handle browser back navigation.
     */
    private handleGoBack(): void {
        this.saveStateBeforeNavigation();
        this.announcer.announceMessage("Going back");
        history.back();
    }

    /**
     * Handle browser forward navigation.
     */
    private handleGoForward(): void {
        this.saveStateBeforeNavigation();
        this.announcer.announceMessage("Going forward");
        history.forward();
    }

    /**
     * Start auto-traversing through the page.
     */
    private startAutoTraverse(): void {
        if (this.isAutoTraversing) {
            // Already traversing - toggle off
            this.stopAutoTraverse();
            return;
        }

        this.isAutoTraversing = true;
        this.announcer.announceMessage("Auto-traversing... Press Escape to stop");
        console.log("[SR] Starting auto-traverse");

        this.autoTraverseStep();
    }

    /**
     * Execute one step of auto-traversal.
     */
    private autoTraverseStep(): void {
        if (!this.isAutoTraversing) return;

        const previousCursor = this.navigator.cursor;
        this.navigator.moveNext();

        // Check if we reached the end (cursor didn't change)
        if (this.navigator.cursor === previousCursor) {
            this.stopAutoTraverse();
            this.announcer.announceMessage("End of page reached");
            return;
        }

        // Schedule next step (300ms delay for readability)
        this.autoTraverseTimer = window.setTimeout(() => {
            this.autoTraverseStep();
        }, 300);
    }

    /**
     * Stop auto-traversal.
     */
    private stopAutoTraverse(): void {
        if (!this.isAutoTraversing) return;

        this.isAutoTraversing = false;
        if (this.autoTraverseTimer !== null) {
            clearTimeout(this.autoTraverseTimer);
            this.autoTraverseTimer = null;
        }
        console.log("[SR] Auto-traverse stopped");
    }

    /**
     * Instantly traverse the entire page (no delay).
     */
    private instantTraverse(): void {
        console.log("[SR] Starting instant traversal");
        this.isInstantTraversing = true;
        const traversalLog: string[] = [];
        
        // Reset cursor to top to ensure full page traversal
        this.navigator.initializeCursor();
        if (this.navigator.cursor) {
             traversalLog.push(this.announcer.getSpokenText(this.navigator.cursor));
        }

        let count = 0;
        const maxIterations = 10000; // Safety limit

        while (count < maxIterations) {
            const previousCursor = this.navigator.cursor;
            this.navigator.moveNext();

            // Check if we reached the end
            if (this.navigator.cursor === previousCursor) {
                break;
            }

            if (this.navigator.cursor) {
                traversalLog.push(this.announcer.getSpokenText(this.navigator.cursor));
            }

            count++;
        }

        this.isInstantTraversing = false;
        
        // Compute the full accessibility graph now that we've visited everything
        console.log("[SR] Computing full accessibility graph...");
        this.navigationTree.computeFullGraph();

        const fullContent = `Instant Traversal Output (${count} elements):\n` + traversalLog.join('\n');
        this.announcer.announceMessage(fullContent);
        
        // Force a tree update to the UI with the new edges
        const treeData = this.navigationTree.serialize();
        console.log(`[SR Tree] ${JSON.stringify(treeData)}`);
        
        console.log(`[SR-DEBUG] Instant traversal complete: ${count} elements, Graph built with ${this.navigationTree.serialize().edges.length} edges`);
    }

    private handleCursorChange(element: HTMLElement, action?: string): void {
        this.highlightBox.update(element);
        if (!this.isInstantTraversing) {
            this.announcer.speak(element, action);
        }
    }

    private handleTabFocus(element: HTMLElement): void {
        this.navigator.cursor = element;
        this.highlightBox.update(element);
        this.announcer.speak(element);
    }

    /**
     * Find the first interesting element within or starting from a given element.
     * Used for anchor link navigation.
     */
    private findFirstInterestingElement(element: HTMLElement): HTMLElement | null {
        // Check if the element itself is interesting
        if (this.navigator.isInteresting(element) === NodeFilter.FILTER_ACCEPT) {
            return element;
        }

        // Otherwise find the first interesting descendant
        const walker = document.createTreeWalker(
            element,
            NodeFilter.SHOW_ELEMENT,
            {
                acceptNode: (node) => this.navigator.isInteresting(node as HTMLElement)
            }
        );

        if (walker.firstChild()) {
            return walker.currentNode as HTMLElement;
        }

        return null;
    }

    /**
     * Get the shortest path to a target node (for external use).
     */
    getPathTo(targetId: string): PathResult {
        return this.navigationTree.getPathTo(targetId);
    }

    /**
     * Handle element activation (Enter key).
     * This is complex coordination logic that stays in the orchestrator.
     */
    private handleActivate(): void {
        const cursor = this.navigator.cursor;
        if (!cursor) return;

        console.log(`[SR] Activating element: ${cursor.tagName}`);

        // Focus the element first
        cursor.focus();

        // For links, directly navigate
        if (cursor.tagName.toLowerCase() === 'a') {
            const href = cursor.getAttribute('href');
            const target = cursor.getAttribute('target');

            if (href) {
                // Handle anchor links (jump to content)
                if (href.startsWith('#')) {
                    const targetId = href.slice(1);
                    const targetElement = document.getElementById(targetId);

                    if (targetElement) {
                        console.log(`[SR] Jumping to anchor: #${targetId}`);
                        // Scroll to the element
                        targetElement.scrollIntoView({ behavior: 'smooth', block: 'start' });
                        // Move virtual cursor to the target or its first interesting descendant
                        const interestingTarget = this.findFirstInterestingElement(targetElement);
                        if (interestingTarget) {
                            this.navigator.setCursor(interestingTarget);
                        } else {
                            this.announcer.announceMessage(`Jumped to ${targetId}`);
                        }
                        return;
                    } else {
                        this.announcer.announceMessage(`Target not found: ${targetId}`);
                        return;
                    }
                }

                // Check if link opens in new window/tab
                if (target === '_blank') {
                    console.log(`[SR] Link opens in new window, navigating in same tab instead: ${href}`);
                    this.saveStateBeforeNavigation();
                    const absoluteUrl = new URL(href, window.location.href).href;
                    window.location.href = absoluteUrl;
                    return;
                }

                // Save state before navigating
                console.log(`[SR] Navigating to link: ${href}`);
                this.saveStateBeforeNavigation();
                cursor.click();
                return;
            }
        }

        // For buttons and other interactive elements
        const elementRole = getRole(cursor) || cursor.tagName.toLowerCase();
        const elementName = computeAccessibleName(cursor) || 'element';
        console.log(`[SR] Activating ${elementRole}: ${elementName}`);

        // Save reference before timeout
        const activatedElement = cursor;

        // Use both synthetic click and native click for maximum compatibility
        cursor.click();

        // Also dispatch MouseEvent for event listeners
        const clickEvent = new MouseEvent('click', {
            bubbles: true,
            cancelable: true,
            view: window,
            detail: 1,
            button: 0
        });
        cursor.dispatchEvent(clickEvent);

        // Dispatch Enter key events for elements that listen for keyboard
        const keydownEvent = new KeyboardEvent('keydown', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
        });
        cursor.dispatchEvent(keydownEvent);

        const keyupEvent = new KeyboardEvent('keyup', {
            key: 'Enter',
            code: 'Enter',
            keyCode: 13,
            which: 13,
            bubbles: true,
            cancelable: true
        });
        cursor.dispatchEvent(keyupEvent);

        // After clicking a button/interactive element, announce the result
        setTimeout(() => {
            // Check if focus moved to a new element
            const activeElement = document.activeElement as HTMLElement;
            if (activeElement && activeElement !== document.body && activeElement !== activatedElement) {
                // Focus moved to a different element - announce it
                if (this.navigator.isInteresting(activeElement) === NodeFilter.FILTER_ACCEPT) {
                    this.navigator.setCursor(activeElement);
                } else {
                    this.announcer.announceMessage(`Activated ${elementRole}, ${elementName}`);
                }
            } else {
                // No focus change - just announce the activation
                this.announcer.announceMessage(`Activated ${elementRole}, ${elementName}`);
            }
        }, 150);
    }
}
