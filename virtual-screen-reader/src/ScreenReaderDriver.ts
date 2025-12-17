/**
 * ScreenReaderDriver - AX-tree-based screen reader driver.
 *
 * This driver uses the Chrome DevTools Protocol Accessibility API to navigate
 * the accessibility tree directly, providing accurate screen reader behavior
 * without relying on DOM heuristics.
 *
 * Dynamic content detection is handled by MutationObserver (not polling).
 */

import { IAccessibilityDriver } from './IAccessibilityDriver';
import { UserAction, ActionResult, PerceptualSnapshot } from './driverTypes';
import { BrowserClient, MutationSummary } from './playwrightClient';
import { AXTreeNavigator } from './AXTreeNavigator';
import { AXAnnouncementGenerator } from './AXAnnouncementGenerator';
import { AXTreeCache } from './AXTreeCache';
import {
    KEY_TO_COMMAND,
    TABLE_NAV_COMMANDS,
    FORMS_MODE_ROLES,
    NavigationCommand,
    NavigableAXNode,
    InteractionMode,
    Rect,
} from './types';
import { FOCUSABLE_ROLES } from './AXTreeNavigator';

/**
 * Timing configuration for screen reader operations.
 * These delays account for browser rendering and state propagation.
 */
export interface TimingOptions {
    /** Delay after key press for browser to process (ms). Default: 50 */
    keyPressDelay?: number;
    /** Delay after click for state changes to propagate (ms). Default: 100 */
    clickDelay?: number;
    /** Delay after link click for navigation to start (ms). Default: 500 */
    navigationDelay?: number;
    /** Delay for page to settle after load (ms). Default: 300 */
    pageSettleDelay?: number;
}

/**
 * Options for the ScreenReaderDriver.
 */
export interface ScreenReaderDriverOptions {
    /** Enable verbose logging */
    verbose?: boolean;
    /** Cache max age in milliseconds */
    cacheMaxAge?: number;
    /** Timing configuration for operations */
    timing?: TimingOptions;
}

/**
 * Default timing values with rationale:
 * - keyPressDelay: 50ms - Minimum time for browser to process keyboard event
 * - clickDelay: 100ms - Time for click handlers and state updates to complete
 * - navigationDelay: 500ms - Time for navigation to initiate (network latency varies)
 * - pageSettleDelay: 300ms - Time for page JS to initialize after load
 */
const DEFAULT_TIMING: Required<TimingOptions> = {
    keyPressDelay: 50,
    clickDelay: 100,
    navigationDelay: 500,
    pageSettleDelay: 300,
};

const DEFAULT_OPTIONS: Required<Omit<ScreenReaderDriverOptions, 'timing'>> & { timing: Required<TimingOptions> } = {
    verbose: false,
    cacheMaxAge: 5000,
    timing: DEFAULT_TIMING,
};

/**
 * ScreenReaderDriver implements screen reader navigation using the AX tree.
 */
export class ScreenReaderDriver implements IAccessibilityDriver {
    name = "ScreenReader";
    private enabled = false;
    private options: Required<Omit<ScreenReaderDriverOptions, 'timing'>> & { timing: Required<TimingOptions> };
    private logger: (message: string) => void;

    // Core components
    private navigator: AXTreeNavigator;
    private announcer: AXAnnouncementGenerator;
    private cache: AXTreeCache;

    // State
    private currentUrl: string = "";
    private lastSpokenText: string = "";
    private pendingLiveAnnouncements: string[] = [];
    private interactionMode: InteractionMode = 'browse';
    private pageJustLoaded: boolean = false; // Forces tree refresh on first action after page load

    // Timing shortcuts for cleaner code
    private get timing(): Required<TimingOptions> {
        return this.options.timing;
    }

    constructor(
        private client: BrowserClient,
        logger?: (message: string) => void,
        options: ScreenReaderDriverOptions = {}
    ) {
        this.logger = logger || console.log;
        this.options = {
            ...DEFAULT_OPTIONS,
            ...options,
            timing: { ...DEFAULT_TIMING, ...options.timing },
        };

        // Initialize components
        this.navigator = new AXTreeNavigator();
        this.announcer = new AXAnnouncementGenerator();
        this.cache = new AXTreeCache(client, this.navigator, {
            maxAge: this.options.cacheMaxAge,
        });
    }

    // =========================================================================
    // IAccessibilityDriver Implementation
    // =========================================================================

    async enable(): Promise<void> {
        this.enabled = true;
        this.log("Screen Reader Enabled (AX-Tree Mode)");

        // Store initial URL
        this.currentUrl = await this.client.getCurrentUrl();

        // Set up page load handler
        this.client.onPageLoad(async () => {
            await this.handlePageLoad();
        });

        // Initial tree load and move to first interesting node
        await this.initializeNavigation();

        // Mark that page just loaded - forces tree refresh on first navigation action
        // This handles cases where JS renders content after initial page load
        this.pageJustLoaded = true;

        // Start MutationObserver for dynamic content detection
        await this.client.startMutationObserver((mutations) => {
            this.handleMutations(mutations);
        });
    }

    /**
     * Handles DOM mutations detected by MutationObserver.
     * This is the ONLY source of dynamic content announcements.
     */
    private handleMutations(mutations: MutationSummary[]): void {
        for (const mutation of mutations) {
            switch (mutation.type) {
                case 'liveRegion':
                    if (mutation.content) {
                        if (mutation.politeness === 'assertive') {
                            // Assertive: interrupt immediately
                            this.lastSpokenText = mutation.content;
                            this.log(`[LiveRegion:assertive] ${mutation.content}`);
                        } else {
                            // Polite: queue for next output
                            this.pendingLiveAnnouncements.push(mutation.content);
                            this.log(`[LiveRegion:polite] ${mutation.content}`);
                        }
                    }
                    break;

                case 'dialogOpened':
                    this.lastSpokenText = `Dialog: ${mutation.name || 'opened'}`;
                    this.log(`[Dialog] Opened: ${mutation.name}`);
                    this.cache.invalidate();
                    break;

                case 'dialogClosed':
                    this.lastSpokenText = 'Dialog closed';
                    this.log('[Dialog] Closed');
                    this.cache.invalidate();
                    break;

                case 'alert':
                    // Alerts are always assertive
                    this.lastSpokenText = `Alert: ${mutation.content}`;
                    this.log(`[Alert] ${mutation.content}`);
                    break;

                case 'stateChange':
                    this.log(`[StateChange] ${mutation.attribute}=${mutation.value} on "${mutation.name}"`);
                    // Invalidate cache when expansion state changes so aria-controls relationships are re-resolved
                    if (mutation.attribute === 'aria-expanded') {
                        this.cache.invalidate();
                    }
                    break;
            }
        }
    }

    async disable(): Promise<void> {
        this.enabled = false;
        this.cache.dispose();
        await this.client.stopMutationObserver();
        this.interactionMode = 'browse';
        this.log("Screen Reader Disabled");
    }

    async performAction(action: UserAction): Promise<ActionResult> {
        if (!this.enabled) {
            return {
                success: false,
                message: "Driver not enabled",
                snapshot: await this.getPerceptualOutput(),
            };
        }

        // Check for navigation before performing action
        const preNavigated = await this.checkForNavigation();
        if (preNavigated) {
            this.log("[ScreenReaderDriver] Pre-action navigation detected");
        }

        try {
            if (action.type === 'KEY_PRESS' && action.key) {
                await this.handleKeyPress(action.key);
            } else if (action.type === 'TYPE' && action.text) {
                await this.handleType(action.text);
            } else if (action.type === 'GO_BACK') {
                await this.handleGoBack();
            }

            // Check for navigation after action
            await this.checkForNavigation();

        } catch (error: any) {
            this.log(`[ScreenReaderDriver] Action error: ${error.message}`);
            this.lastSpokenText = `Error: ${error.message}`;
        }

        return {
            success: true,
            snapshot: await this.getPerceptualOutput(),
        };
    }

    async getPerceptualOutput(): Promise<PerceptualSnapshot> {
        if (!this.enabled) {
            return { text: "Screen Reader Off", cursorBox: null };
        }

        // Include any pending live region announcements
        let text = this.lastSpokenText;
        if (this.pendingLiveAnnouncements.length > 0) {
            const liveMessages = this.pendingLiveAnnouncements.join(', ');
            text = liveMessages + (text ? ` | ${text}` : '');
            this.pendingLiveAnnouncements = [];
        }

        // Get page context
        let pageTitle = "";
        let pageUrl = "";
        try {
            pageTitle = await this.client.getTitle();
            pageUrl = await this.client.getCurrentUrl();
        } catch (error: any) {
            this.log(`[ScreenReaderDriver] Error getting page context: ${error.message}`);
            pageTitle = "Loading...";
            pageUrl = this.currentUrl || "";
        }

        // Get cursor box from current node
        let cursorBox: Rect | null = null;
        const currentNode = this.navigator.getCurrentNode();
        if (currentNode?.backendDOMNodeId) {
            try {
                cursorBox = await this.client.getNodeBoundingBox(currentNode.backendDOMNodeId);
            } catch {
                // Ignore - node might not be visible
            }
        }

        return {
            text: text || "No output",
            cursorBox,
            pageTitle,
            pageUrl,
        };
    }

    // =========================================================================
    // Key Press Handling
    // =========================================================================

    private async handleKeyPress(key: string): Promise<void> {
        // Normalize key names
        const normalizedKey = this.normalizeKey(key);

        // Forms mode: pass most keys directly to the input
        if (this.interactionMode === 'forms') {
            if (normalizedKey === 'Escape') {
                // Exit forms mode
                this.interactionMode = 'browse';
                this.lastSpokenText = 'Browse mode';
                this.log('[Mode] Switched to browse mode');
                return;
            }
            // In forms mode, pass keys through to the browser
            await this.client.pressKey(normalizedKey);
            await this.sleep(this.timing.keyPressDelay);
            return;
        }

        // Browse mode: check for table navigation commands (Ctrl+Alt+Arrow)
        const tableCommand = TABLE_NAV_COMMANDS[normalizedKey];
        if (tableCommand) {
            await this.handleTableNavigation(tableCommand.type);
            return;
        }

        // Check if this is a standard navigation command
        const command = KEY_TO_COMMAND[normalizedKey];

        if (command) {
            await this.handleNavigationCommand(command);
        } else if (normalizedKey === 'Enter') {
            await this.handleActivate();
        } else if (normalizedKey === 'Space' || normalizedKey === ' ') {
            await this.handleSpace();
        } else if (normalizedKey === 'Escape') {
            await this.handleEscape();
        } else {
            // Pass through to browser for other keys
            await this.client.pressKey(normalizedKey);
            await this.sleep(this.timing.keyPressDelay);
        }
    }

    /**
     * Handles table navigation (Ctrl+Alt+Arrow).
     */
    private async handleTableNavigation(type: 'tableCellRight' | 'tableCellLeft' | 'tableCellDown' | 'tableCellUp'): Promise<void> {
        const directionMap: Record<string, 'left' | 'right' | 'up' | 'down'> = {
            'tableCellRight': 'right',
            'tableCellLeft': 'left',
            'tableCellDown': 'down',
            'tableCellUp': 'up',
        };

        const direction = directionMap[type];
        const result = this.navigator.moveToTableCell(direction);

        if (result.success && result.node) {
            // Get table headers for context
            const headers = this.navigator.getTableCellHeaders();
            const context = this.navigator.getTableContext();

            // Build announcement with headers
            let announcement = this.announcer.generateAnnouncement(result.node);

            // Add column header on horizontal movement
            if ((direction === 'left' || direction === 'right') && headers.colHeader) {
                announcement = `${headers.colHeader}, ${announcement}`;
            }
            // Add row header on vertical movement
            if ((direction === 'up' || direction === 'down') && headers.rowHeader) {
                announcement = `${headers.rowHeader}, ${announcement}`;
            }
            // Add position info
            if (context) {
                announcement += `, Row ${context.row + 1} of ${context.rowCount}, Column ${context.col + 1} of ${context.colCount}`;
            }

            this.lastSpokenText = announcement;
            await this.focusAndHighlightNode(result.node);
            this.log(`[TableNav] ${type} -> ${result.node.computedRole}: "${result.node.computedName}"`);
        } else {
            this.lastSpokenText = result.message;
            this.log(`[TableNav] ${type} -> ${result.message}`);
        }
    }

    private async handleNavigationCommand(command: NavigationCommand): Promise<void> {
        try {
            // Force refresh if page just loaded - JS may have rendered more content
            if (this.pageJustLoaded) {
                this.log(`[Navigate] Page just loaded, forcing tree refresh...`);
                this.pageJustLoaded = false; // Clear flag before refresh
                try {
                    await this.cache.refresh();
                    // Reset navigator to start after refresh since tree may have changed significantly
                    this.navigator.reset();
                } catch (refreshError: any) {
                    this.log(`[Navigate] Page load refresh failed: ${refreshError.message}`);
                }
            }
            // Also refresh tree if stale
            else if (this.cache.isStale()) {
                this.log(`[Navigate] Cache was stale, refreshing...`);
                try {
                    await this.cache.refresh();
                } catch (refreshError: any) {
                    this.log(`[Navigate] Cache refresh failed: ${refreshError.message}`);
                    // Continue with stale cache rather than failing completely
                }
            }

            const currentBefore = this.navigator.getCurrentNode();
            this.log(`[Navigate] Before: index=${this.navigator.getCurrentPosition()}, node=${currentBefore?.computedRole || 'null'}`);

            // Execute navigation
            const result = await this.executeNavigation(command);

            this.log(`[Navigate] ${command.type}: success=${result.success}, msg="${result.message}"`);

            if (result.success && result.node) {
                // Generate announcement
                let announcement = this.announcer.generateAnnouncement(result.node, {
                    includeDescription: true,
                });

                // **KEY: Actually focus the element like a real screen reader**
                // This triggers focus events, opens dropdowns, etc.
                await this.focusAndHighlightNode(result.node);

                // Auto-switch to forms mode for form fields
                if (FORMS_MODE_ROLES.has(result.node.computedRole) && this.interactionMode === 'browse') {
                    this.interactionMode = 'forms';
                    announcement += ', Forms mode';
                    this.log('[Mode] Auto-switched to forms mode');
                }

                this.lastSpokenText = announcement;
                this.log(`[Navigate] -> ${result.node.computedRole}: "${result.node.computedName}"`);

                // Check if focusing caused DOM changes (e.g., dropdown opened)
                // Give a moment for any focus-triggered content to appear
                await this.sleep(this.timing.keyPressDelay);
            } else {
                // Announce boundary or error
                this.lastSpokenText = result.message;
                this.log(`[Navigate] -> ${result.message}`);
            }
        } catch (error: any) {
            // Handle navigation errors gracefully
            this.log(`[Navigate] Error during navigation: ${error.message}`);
            this.lastSpokenText = 'Navigation error';
        }
    }

    private async executeNavigation(command: NavigationCommand): Promise<{ success: boolean; node: NavigableAXNode | null; message: string }> {
        switch (command.type) {
            case 'next':
                return this.navigator.moveNext();
            case 'prev':
                return this.navigator.movePrev();
            case 'nextHeading':
                return this.navigator.moveToNextHeading();
            case 'prevHeading':
                return this.navigator.moveToPrevHeading();
            case 'nextHeadingLevel':
                return this.navigator.moveToNextHeadingLevel(command.level);
            case 'prevHeadingLevel':
                return this.navigator.moveToPrevHeadingLevel(command.level);
            case 'nextLandmark':
                return this.navigator.moveToNextLandmark();
            case 'prevLandmark':
                return this.navigator.moveToPrevLandmark();
            case 'nextButton':
                return this.navigator.moveToNextButton();
            case 'prevButton':
                return this.navigator.moveToPrevButton();
            case 'nextLink':
                return this.navigator.moveToNextLink();
            case 'prevLink':
                return this.navigator.moveToPrevLink();
            case 'nextFormField':
                return this.navigator.moveToNextFormField();
            case 'prevFormField':
                return this.navigator.moveToPrevFormField();
            case 'nextTable':
                return this.navigator.moveToNextTable();
            case 'prevTable':
                return this.navigator.moveToPrevTable();
            case 'nextList':
                return this.navigator.moveToNextList();
            case 'prevList':
                return this.navigator.moveToPrevList();
            case 'main':
                return this.navigator.moveToMain();
            case 'nextFocusable':
                return this.navigator.moveToNextFocusable();
            case 'prevFocusable':
                return this.navigator.moveToPrevFocusable();
            case 'nextByRole':
                return this.navigator.moveToNextByRole(
                    Array.isArray(command.role) ? command.role : [command.role]
                );
            case 'prevByRole':
                return this.navigator.moveToPrevByRole(
                    Array.isArray(command.role) ? command.role : [command.role]
                );
            default:
                return { success: false, node: null, message: 'Unknown navigation command' };
        }
    }

    // =========================================================================
    // Actions (Enter, Space, Type)
    // =========================================================================

    private async handleActivate(): Promise<void> {
        const currentNode = this.navigator.getCurrentNode();
        if (!currentNode?.backendDOMNodeId) {
            this.lastSpokenText = "Nothing to activate";
            return;
        }

        const role = currentNode.computedRole;
        this.log(`[Activate] Activating ${role}: "${currentNode.computedName}"`);

        try {
            // Handle different roles
            if (role === 'link') {
                // For links: focus first, then click (more reliable)
                await this.client.focusNode(currentNode.backendDOMNodeId);
                await this.sleep(this.timing.keyPressDelay);
                await this.client.clickNode(currentNode.backendDOMNodeId);
                this.log(`[Activate] Link clicked, waiting for navigation...`);
                await this.sleep(this.timing.navigationDelay);
                this.lastSpokenText = this.announcer.generateActivationAnnouncement(currentNode, 'activated');

            } else if (role === 'button') {
                // Click the button
                await this.client.clickNode(currentNode.backendDOMNodeId);
                await this.sleep(this.timing.clickDelay);

                // Check if button state changed and if focus moved (for dropdowns)
                try {
                    await this.cache.refresh();
                    const updatedNode = this.cache.findByNodeId(currentNode.nodeId);

                    // First check if focus moved to a different element (dropdown behavior)
                    // This is how VoiceOver handles dropdowns - it follows DOM focus
                    const focusedNode = await this.findFocusedNode();

                    if (focusedNode && focusedNode.nodeId !== currentNode.nodeId) {
                        // Focus moved to a different element - follow it (like VoiceOver)
                        this.log(`[Activate] Focus moved from "${currentNode.computedName}" to "${focusedNode.computedName}" (${focusedNode.computedRole})`);

                        // Update navigator position to the focused node
                        const moved = this.navigator.setCurrentByNodeId(focusedNode.nodeId) ||
                                      this.navigator.setCurrentByBackendNodeId(focusedNode.backendDOMNodeId!);

                        if (moved) {
                            // Announce the button state change followed by the focused element
                            let announcement = '';
                            if (updatedNode) {
                                const stateChange = this.getStateChangeAnnouncement(currentNode, updatedNode);
                                if (stateChange) {
                                    announcement = `${currentNode.computedName}, ${stateChange}. `;
                                }
                            }
                            announcement += this.announcer.generateAnnouncement(focusedNode);
                            this.lastSpokenText = announcement;
                            await this.highlightNode(focusedNode);
                            return; // Skip normal button handling
                        }
                    }

                    // Normal button handling (no focus change)
                    if (updatedNode) {
                        const stateAnnouncement = this.getStateChangeAnnouncement(currentNode, updatedNode);
                        if (stateAnnouncement) {
                            this.lastSpokenText = this.announcer.generateActivationAnnouncement(updatedNode, stateAnnouncement);
                        } else {
                            this.lastSpokenText = this.announcer.generateActivationAnnouncement(updatedNode, 'activated');
                        }
                    } else {
                        this.lastSpokenText = this.announcer.generateActivationAnnouncement(currentNode, 'activated');
                    }
                } catch (refreshError) {
                    this.log(`[Activate] Cache refresh failed: ${refreshError}`);
                    this.lastSpokenText = this.announcer.generateActivationAnnouncement(currentNode, 'activated');
                }

            } else if (role === 'checkbox' || role === 'switch') {
                // Toggle checkbox/switch
                await this.client.clickNode(currentNode.backendDOMNodeId);
                await this.sleep(this.timing.clickDelay);

                // Refresh to get new state
                try {
                    await this.cache.refresh();
                    const updatedNode = this.cache.findByNodeId(currentNode.nodeId);

                    if (updatedNode?.states.checked === true) {
                        this.lastSpokenText = this.announcer.generateActivationAnnouncement(updatedNode, 'checked');
                    } else if (updatedNode?.states.checked === false) {
                        this.lastSpokenText = this.announcer.generateActivationAnnouncement(updatedNode, 'unchecked');
                    } else {
                        this.lastSpokenText = this.announcer.generateActivationAnnouncement(currentNode, 'activated');
                    }
                } catch (refreshError) {
                    this.log(`[Activate] Cache refresh failed: ${refreshError}`);
                    this.lastSpokenText = this.announcer.generateActivationAnnouncement(currentNode, 'activated');
                }

            } else if (role === 'textbox' || role === 'searchbox' || role === 'combobox' || role === 'spinbutton' || role === 'listbox') {
                // Focus the input and switch to forms mode
                await this.client.focusNode(currentNode.backendDOMNodeId);
                this.interactionMode = 'forms';
                this.lastSpokenText = `${currentNode.computedName || role}, focused, Forms mode`;
                this.log('[Mode] Switched to forms mode via activation');

            } else if (role === 'menuitem' || role === 'option' || role === 'treeitem' || role === 'tab') {
                // Activate menu/list item
                await this.client.clickNode(currentNode.backendDOMNodeId);
                await this.sleep(this.timing.clickDelay);
                this.lastSpokenText = this.announcer.generateActivationAnnouncement(currentNode, 'activated');

            } else {
                // Generic click
                await this.client.clickNode(currentNode.backendDOMNodeId);
                await this.sleep(this.timing.clickDelay);
                this.lastSpokenText = this.announcer.generateActivationAnnouncement(currentNode, 'activated');
            }
        } catch (error: any) {
            // Handle activation errors gracefully
            this.log(`[Activate] Error activating element: ${error.message}`);
            this.lastSpokenText = `Could not activate ${role}`;
        }

        // Always re-highlight after action (even on error)
        await this.highlightCurrentNode();
    }

    /**
     * Detects state changes between two nodes and returns an appropriate announcement.
     * Handles: expanded, pressed, checked, selected
     */
    private getStateChangeAnnouncement(oldNode: NavigableAXNode, newNode: NavigableAXNode): string | null {
        // Expanded state
        if (newNode.states.expanded === true && oldNode.states.expanded !== true) {
            return 'expanded';
        }
        if (newNode.states.expanded === false && oldNode.states.expanded === true) {
            return 'collapsed';
        }

        // Pressed state (toggle buttons)
        if (newNode.states.pressed === true && oldNode.states.pressed !== true) {
            return 'pressed';
        }
        if (newNode.states.pressed === false && oldNode.states.pressed === true) {
            return 'not pressed';
        }

        // Checked state
        if (newNode.states.checked === true && oldNode.states.checked !== true) {
            return 'checked';
        }
        if (newNode.states.checked === false && oldNode.states.checked === true) {
            return 'unchecked';
        }
        if (newNode.states.checked === 'mixed') {
            return 'partially checked';
        }

        // Selected state
        if (newNode.states.selected === true && oldNode.states.selected !== true) {
            return 'selected';
        }
        if (newNode.states.selected === false && oldNode.states.selected === true) {
            return 'not selected';
        }

        return null;
    }

    private async handleSpace(): Promise<void> {
        const currentNode = this.navigator.getCurrentNode();
        if (!currentNode?.backendDOMNodeId) {
            this.lastSpokenText = "Nothing to interact with";
            return;
        }

        const role = currentNode.computedRole;

        // Space typically toggles checkboxes, presses buttons, or scrolls
        if (role === 'checkbox' || role === 'switch' || role === 'radio') {
            await this.handleActivate();
        } else if (role === 'button') {
            await this.handleActivate();
        } else if (role === 'textbox' || role === 'searchbox') {
            // In a text field, space should type a space
            await this.client.typeText(' ');
            this.lastSpokenText = 'space';
        } else {
            // For other elements, pass space through
            await this.client.pressKey('Space');
            await this.sleep(this.timing.keyPressDelay);
        }
    }

    private async handleEscape(): Promise<void> {
        // Pass escape to browser (close dialogs, menus, etc.)
        await this.client.pressKey('Escape');
        await this.sleep(this.timing.clickDelay);

        // Refresh tree to see updated state
        await this.cache.refresh();
        this.lastSpokenText = 'Escaped';
    }

    private async handleGoBack(): Promise<void> {
        this.log('[GoBack] Navigating to previous page');

        try {
            await this.client.goBack();

            // Reset state for new page
            this.interactionMode = 'browse';
            this.cache.invalidate();

            // Re-initialize navigation on the new page (waits for network idle internally)
            await this.initializeNavigation();

            // Re-inject MutationObserver
            await this.client.reinjectMutationObserver();

            const pageTitle = await this.client.getTitle();
            this.lastSpokenText = `Navigated back. ${pageTitle}`;

            // Mark that page just loaded - forces tree refresh on first action
            this.pageJustLoaded = true;

        } catch (error: any) {
            this.log(`[GoBack] Error: ${error.message}`);
            this.lastSpokenText = 'Could not go back';
        }
    }

    private async handleType(text: string): Promise<void> {
        const currentNode = this.navigator.getCurrentNode();

        // If current node is an input, type into it
        if (currentNode?.backendDOMNodeId) {
            const role = currentNode.computedRole;
            if (role === 'textbox' || role === 'searchbox' || role === 'spinbutton' || role === 'combobox') {
                // Focus first, then type
                await this.client.focusNode(currentNode.backendDOMNodeId);
                await this.client.typeText(text);
                this.lastSpokenText = `typed: ${text}`;
                return;
            }
        }

        // Otherwise, just type (browser will handle it)
        await this.client.typeText(text);
        this.lastSpokenText = `typed: ${text}`;
    }

    // =========================================================================
    // Navigation & Page Load
    // =========================================================================

    private async initializeNavigation(): Promise<void> {
        // Reset navigator to start fresh - prevents restoring position from previous page
        this.navigator.reset();

        // Wait for network to settle before fetching tree
        // This helps ensure JS has finished rendering dynamic content
        await this.client.waitForNetworkIdle(2000);

        // Build tree
        const tree = await this.cache.refresh();

        this.log(`[InitNav] Tree loaded: ${tree ? 'yes' : 'no'}`);
        this.log(`[InitNav] Root: ${tree?.root ? tree.root.computedRole : 'null'}`);
        this.log(`[InitNav] Interesting nodes: ${tree?.interestingNodes.length || 0}`);

        if (tree && tree.root) {
            // Move to first interesting node
            const result = this.navigator.moveNext();

            this.log(`[InitNav] moveNext result: success=${result.success}, node=${result.node?.computedRole || 'null'}, msg=${result.message}`);

            if (result.success && result.node) {
                const pageTitle = await this.client.getTitle();
                this.lastSpokenText = `${pageTitle}. ${this.announcer.generateAnnouncement(result.node)}`;
                // Focus and highlight the first element
                await this.focusAndHighlightNode(result.node);
            } else {
                const pageTitle = await this.client.getTitle();
                this.lastSpokenText = `${pageTitle}. Page loaded`;
            }
        } else {
            this.lastSpokenText = "Failed to load accessibility tree";
        }
    }

    private async handlePageLoad(): Promise<void> {
        try {
            const newUrl = await this.client.getCurrentUrl();

            // Skip if same URL
            if (newUrl === this.currentUrl) {
                return;
            }

            const pageTitle = await this.client.getTitle();
            this.log(`[ScreenReaderDriver] Page load detected: "${pageTitle}"`);
            this.currentUrl = newUrl;

            // Reset interaction mode on page load
            this.interactionMode = 'browse';

            // Invalidate cache
            this.cache.invalidate();

            // Re-initialize navigation (waits for network idle internally)
            await this.initializeNavigation();

            // Re-inject MutationObserver (destroyed during navigation)
            await this.client.reinjectMutationObserver();

            // Announce navigation
            this.lastSpokenText = this.announcer.generateNavigationAnnouncement(pageTitle);

            // Mark that page just loaded - forces tree refresh on first action
            // This handles cases where JS renders content after initial page load
            this.pageJustLoaded = true;

        } catch (error: any) {
            this.log(`[ScreenReaderDriver] Page load error: ${error.message}`);
            this.lastSpokenText = "Page is loading...";
        }
    }

    private async checkForNavigation(): Promise<boolean> {
        const pageLoadOccurred = this.client.checkAndClearNavigation();

        if (pageLoadOccurred) {
            try {
                const newUrl = await this.client.getCurrentUrl();
                const pageTitle = await this.client.getTitle();

                if (newUrl !== this.currentUrl) {
                    this.log(`[ScreenReaderDriver] Navigation detected: ${newUrl}`);
                    this.currentUrl = newUrl;

                    // Reset interaction mode on navigation
                    this.interactionMode = 'browse';

                    // Invalidate cache and reinitialize (waits for network idle internally)
                    this.cache.invalidate();
                    await this.initializeNavigation();

                    this.lastSpokenText = this.announcer.generateNavigationAnnouncement(pageTitle);

                    // Mark that page just loaded - forces tree refresh on first action
                    this.pageJustLoaded = true;
                    return true;
                }
            } catch (error: any) {
                this.log(`[ScreenReaderDriver] Navigation check error: ${error.message}`);
                this.lastSpokenText = "Page is loading...";
                return true;
            }
        }

        return false;
    }

    // =========================================================================
    // Focus & Highlighting (Real Screen Reader Behavior)
    // =========================================================================

    /**
     * Focus and highlight a node - mimics real screen reader behavior.
     * Real screen readers actually move DOM focus, which triggers:
     * - Focus events (opens dropdowns, shows focus styles)
     * - Scroll into view
     * - Visual focus indicator
     */
    private async focusAndHighlightNode(node: NavigableAXNode): Promise<void> {
        if (!node.backendDOMNodeId) {
            this.client.clearHighlight();
            return;
        }

        let scrollSuccess = false;
        let focusSuccess = false;
        let highlightSuccess = false;

        try {
            // 1. Scroll into view first
            await this.client.scrollNodeIntoView(node.backendDOMNodeId);
            scrollSuccess = true;
        } catch (scrollError: any) {
            this.log(`[Focus] Scroll failed for ${node.computedRole}: ${scrollError.message}`);
        }

        try {
            // 2. Actually focus the element (like a real screen reader)
            // This triggers focus events which may open dropdowns, menus, etc.
            if (FOCUSABLE_ROLES.has(node.computedRole)) {
                await this.client.focusNode(node.backendDOMNodeId);
                focusSuccess = true;
            }
        } catch (focusError: any) {
            this.log(`[Focus] Focus failed for ${node.computedRole}: ${focusError.message}`);
        }

        try {
            // 3. Get bounding box and highlight
            const box = await this.client.getNodeBoundingBox(node.backendDOMNodeId);
            if (box) {
                this.client.highlightBox(box);
                highlightSuccess = true;
            } else {
                this.client.clearHighlight();
                this.log(`[Focus] No bounding box for ${node.computedRole}: "${node.computedName}"`);
            }
        } catch (highlightError: any) {
            this.log(`[Focus] Highlight failed for ${node.computedRole}: ${highlightError.message}`);
            this.client.clearHighlight();
        }

        // Log summary if any operation failed
        if (!scrollSuccess || !focusSuccess || !highlightSuccess) {
            this.log(`[Focus] Operations: scroll=${scrollSuccess}, focus=${focusSuccess}, highlight=${highlightSuccess}`);
        }
    }

    /**
     * Just highlight without focusing (for re-highlighting after actions).
     */
    private async highlightNode(node: NavigableAXNode): Promise<void> {
        if (!node.backendDOMNodeId) {
            this.client.clearHighlight();
            return;
        }

        try {
            await this.client.scrollNodeIntoView(node.backendDOMNodeId);
            const box = await this.client.getNodeBoundingBox(node.backendDOMNodeId);
            if (box) {
                this.client.highlightBox(box);
            } else {
                this.client.clearHighlight();
            }
        } catch (error) {
            this.client.clearHighlight();
        }
    }

    private async highlightCurrentNode(): Promise<void> {
        const currentNode = this.navigator.getCurrentNode();
        if (currentNode) {
            await this.highlightNode(currentNode);
        }
    }

    // =========================================================================
    // Focus Detection
    // =========================================================================

    /**
     * Finds the currently focused node in the AX tree.
     * Uses multiple strategies:
     * 1. Use CDP to get the backendNodeId of the focused element
     * 2. Check focused property in AX tree nodes
     * 3. Query DOM activeElement and match by properties
     *
     * This is crucial for following focus after activating dropdowns.
     */
    private async findFocusedNode(): Promise<NavigableAXNode | null> {
        const tree = await this.cache.getTree();
        if (!tree) return null;

        // Strategy 1: Use CDP to get focused element's backendNodeId directly (most reliable)
        try {
            const focusedBackendId = await this.client.getFocusedBackendNodeId();
            if (focusedBackendId) {
                const node = this.cache.findByBackendNodeId(focusedBackendId);
                if (node) {
                    this.log(`[Focus] Found via CDP backendNodeId: "${node.computedName}" (${node.computedRole})`);
                    return node;
                }
                // BackendNodeId found but not in interestingNodes - try to find nearest interesting parent
                for (const interestingNode of tree.interestingNodes) {
                    if (interestingNode.backendDOMNodeId === focusedBackendId) {
                        this.log(`[Focus] Found in interestingNodes: "${interestingNode.computedName}" (${interestingNode.computedRole})`);
                        return interestingNode;
                    }
                }
            }
        } catch (e) {
            // Continue to other strategies
        }

        // Strategy 2: Check AX tree focused property
        for (const node of tree.flatNodes) {
            if (node.states.focused === true) {
                this.log(`[Focus] Found via AX tree focused property: "${node.computedName}" (${node.computedRole})`);
                return node;
            }
        }

        // Strategy 3: Query DOM activeElement and match by properties
        const page = this.client.getPage();
        if (!page) return null;

        try {
            // Get the backend node ID of the focused element from the DOM
            const focusedInfo = await page.evaluate(async () => {
                const focused = document.activeElement;
                if (!focused || focused === document.body || focused === document.documentElement) {
                    return null;
                }

                return {
                    tagName: focused.tagName.toLowerCase(),
                    id: focused.id || null,
                    className: focused.className || null,
                    textContent: (focused.textContent || '').trim().substring(0, 100),
                    href: (focused as HTMLAnchorElement).href || null,
                };
            });

            if (!focusedInfo) {
                this.log('[Focus] DOM activeElement is body or null');
                return null;
            }

            this.log(`[Focus] DOM activeElement: ${focusedInfo.tagName}#${focusedInfo.id || ''} "${focusedInfo.textContent?.substring(0, 30)}..."`);

            // Try to match by various properties
            for (const node of tree.interestingNodes) {
                // Match by ID first (most reliable)
                if (focusedInfo.id && node.nodeId.includes(focusedInfo.id)) {
                    return node;
                }

                // Match by name and role
                const nameMatch = node.computedName &&
                    focusedInfo.textContent &&
                    (node.computedName.trim() === focusedInfo.textContent.trim() ||
                     focusedInfo.textContent.includes(node.computedName.trim()));

                const roleMatch =
                    (focusedInfo.tagName === 'a' && node.computedRole === 'link') ||
                    (focusedInfo.tagName === 'button' && node.computedRole === 'button') ||
                    (focusedInfo.tagName === 'input' && (node.computedRole === 'textbox' || node.computedRole === 'searchbox'));

                if (nameMatch && roleMatch) {
                    this.log(`[Focus] Matched by name+role: "${node.computedName}" (${node.computedRole})`);
                    return node;
                }

                // Match by href for links
                if (focusedInfo.href && node.computedRole === 'link') {
                    // Check if this link has similar text content
                    if (node.computedName && focusedInfo.textContent?.includes(node.computedName)) {
                        this.log(`[Focus] Matched link by text: "${node.computedName}"`);
                        return node;
                    }
                }
            }

            this.log('[Focus] Could not match DOM activeElement to AX tree node');
            return null;
        } catch (error: any) {
            this.log(`[Focus] Error finding focused node: ${error.message}`);
            return null;
        }
    }

    // =========================================================================
    // Utilities
    // =========================================================================

    private normalizeKey(key: string): string {
        // Key translations for common variations
        const translations: Record<string, string> = {
            'Ctrl': 'Control',
            'ctrl': 'Control',
            'CTRL': 'Control',
            'Esc': 'Escape',
            'esc': 'Escape',
            'ESC': 'Escape',
            'Del': 'Delete',
            'del': 'Delete',
            'DEL': 'Delete',
            'Ins': 'Insert',
            'ins': 'Insert',
            'INS': 'Insert',
        };

        // Handle compound keys like "Ctrl+F"
        if (key.includes('+')) {
            const parts = key.split('+');
            return parts.map(part => translations[part] || part).join('+');
        }

        return translations[key] || key;
    }

    private log(message: string): void {
        if (this.options.verbose || message.startsWith('[')) {
            this.logger(message);
        }
    }

    private sleep(ms: number): Promise<void> {
        return new Promise(resolve => setTimeout(resolve, ms));
    }

    // =========================================================================
    // Public Utilities
    // =========================================================================

    /**
     * Gets current navigator state for debugging.
     */
    getNavigatorState(): { currentNode: NavigableAXNode | null; cacheStats: any; mode: InteractionMode; tableContext: any } {
        return {
            currentNode: this.navigator.getCurrentNode(),
            cacheStats: this.cache.getStats(),
            mode: this.interactionMode,
            tableContext: this.navigator.getTableContext(),
        };
    }

    /**
     * Gets the current interaction mode.
     */
    getMode(): InteractionMode {
        return this.interactionMode;
    }

    /**
     * Forces a refresh of the accessibility tree.
     */
    async forceRefresh(): Promise<void> {
        await this.cache.refresh();
    }
}
