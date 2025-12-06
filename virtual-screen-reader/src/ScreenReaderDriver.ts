import { IAccessibilityDriver } from './IAccessibilityDriver';
import { UserAction, ActionResult, PerceptualSnapshot } from './driverTypes';
import { BrowserClient } from './playwrightClient';
import * as fs from 'fs';
import * as path from 'path';

export class ScreenReaderDriver implements IAccessibilityDriver {
    name = "ScreenReader";
    private enabled = false;
    private lastSpokenText: string = "";
    private lastCursorBox: any = null; // Injected driver handles highlighting, but we might want to track it
    private currentUrl: string = "";
    private scriptContent: string = "";
    private initialInjectionDone = false;
    private logger: (message: string) => void;

    constructor(private client: BrowserClient, logger?: (message: string) => void) {
        this.logger = logger || console.log;
    }

    async enable(): Promise<void> {
        this.enabled = true;
        this.logger("Screen Reader Enabled (In-Browser)");

        // Load and cache the driver script
        // Support both bundled and unbundled paths
        const possiblePaths = [
            path.join(__dirname, '../dist/injected.js'),           // unbundled (tsx): src -> dist
            path.join(__dirname, '../../virtual-screen-reader/dist/injected.js'),  // bundled: dist -> virtual-screen-reader/dist
            path.join(process.cwd(), 'virtual-screen-reader/dist/injected.js'),    // bundled: from CWD
        ];

        let scriptPath = '';
        for (const p of possiblePaths) {
            if (fs.existsSync(p)) {
                scriptPath = p;
                break;
            }
        }

        if (scriptPath) {
            this.scriptContent = fs.readFileSync(scriptPath, 'utf-8');
            await this.client.injectScript(this.scriptContent);
        } else {
            this.logger(`ERROR: Injected driver script not found. Tried: ${possiblePaths.join(', ')}`);
        }

        // Listen for spoken output
        this.client.onConsoleMessage((msg) => {
            if (msg.startsWith('[SR] ')) {
                this.lastSpokenText = msg.replace('[SR] ', '');
            }
        });

        // Store initial URL
        this.currentUrl = await this.client.getCurrentUrl();

        // Set up proactive page load handler to immediately re-inject script
        this.client.onPageLoad(async () => {
            await this.handlePageLoad();
        });

        // Mark initial injection as done
        this.initialInjectionDone = true;
    }

    private async handlePageLoad(): Promise<void> {
        const newUrl = await this.client.getCurrentUrl();

        // Skip if this is the same URL (initial page load event after injection)
        if (newUrl === this.currentUrl) {
            this.logger(`[ScreenReaderDriver] Page load detected for same URL, skipping re-injection`);
            return;
        }

        const pageTitle = await this.client.getTitle();
        this.logger(`[ScreenReaderDriver] Page load detected`);
        this.logger(`[ScreenReaderDriver]   → Page Title: "${pageTitle}"`);
        this.logger(`[ScreenReaderDriver]   → URL: ${newUrl}`);
        this.currentUrl = newUrl;

        // Clear stale spoken text IMMEDIATELY to prevent old page text from persisting
        this.lastSpokenText = "";

        // Wait for the new page to be ready (reduced from 1000ms)
        await new Promise(resolve => setTimeout(resolve, 300));

        // Re-inject the screen reader script
        this.logger(`[ScreenReaderDriver] Re-injecting screen reader script on new page`);
        await this.client.reinjectScript(this.scriptContent);

        // Set initial text for new page with page context
        this.lastSpokenText = `Navigated to new page: "${pageTitle}"`;

        // Give the screen reader time to initialize (reduced from 300ms)
        await new Promise(resolve => setTimeout(resolve, 100));
    }

    private async checkForNavigation(): Promise<boolean> {
        // Check if browser detected a full page load event
        const pageLoadOccurred = this.client.checkAndClearNavigation();

        if (pageLoadOccurred) {
            const newUrl = await this.client.getCurrentUrl();
            const pageTitle = await this.client.getTitle();
            this.logger(`[ScreenReaderDriver] Full page navigation detected`);
            this.logger(`[ScreenReaderDriver]   → Page Title: "${pageTitle}"`);
            this.logger(`[ScreenReaderDriver]   → URL: ${newUrl}`);
            this.currentUrl = newUrl;

            // Clear stale spoken text IMMEDIATELY to prevent old page text from persisting
            this.lastSpokenText = "";

            // Wait for the new page to be ready (reduced from 1500ms)
            await new Promise(resolve => setTimeout(resolve, 500));

            // Re-inject the screen reader script
            this.logger(`[ScreenReaderDriver] Re-injecting screen reader script on new page`);
            await this.client.reinjectScript(this.scriptContent);

            // Set initial text for new page with page context
            this.lastSpokenText = `Navigated to new page: "${pageTitle}"`;

            // Give the screen reader time to initialize (reduced from 500ms)
            await new Promise(resolve => setTimeout(resolve, 150));

            return true;
        }

        return false;
    }

    async disable(): Promise<void> {
        this.enabled = false;
        this.logger("Screen Reader Disabled");
    }

    async performAction(action: UserAction): Promise<ActionResult> {
        if (!this.enabled) {
            return { success: false, message: "Driver not enabled", snapshot: await this.getPerceptualOutput() };
        }

        // Check for navigation BEFORE performing action
        // This handles cases where previous action caused navigation
        const preNavigated = await this.checkForNavigation();
        if (preNavigated) {
            this.logger("[ScreenReaderDriver] Pre-action navigation detected, screen reader re-initialized");
        }

        if (action.type === 'KEY_PRESS') {
            if (action.key) {
                // Normalize key names that LLMs might use
                let normalizedKey = action.key;

                // Translate common LLM key names to Playwright-compatible names
                const keyTranslations: { [key: string]: string } = {
                    'Ctrl': 'Control',
                    'ctrl': 'Control',
                    'CTRL': 'Control',
                    'Alt': 'Alt',
                    'alt': 'Alt',
                    'ALT': 'Alt',
                    'Esc': 'Escape',
                    'esc': 'Escape',
                    'ESC': 'Escape',
                    'Del': 'Delete',
                    'del': 'Delete',
                    'DEL': 'Delete',
                    'Ins': 'Insert',
                    'ins': 'Insert',
                    'INS': 'Insert'
                };

                // Handle compound keys like "Ctrl+F" -> "Control+F"
                if (normalizedKey.includes('+')) {
                    const parts = normalizedKey.split('+');
                    normalizedKey = parts.map(part => keyTranslations[part] || part).join('+');
                } else if (keyTranslations[normalizedKey]) {
                    normalizedKey = keyTranslations[normalizedKey];
                }

                // Pass the normalized key to the browser
                await this.client.pressKey(normalizedKey);

                // If Enter key, wait longer as it might trigger navigation (reduced from 1500ms)
                if (action.key === 'Enter') {
                    await new Promise(resolve => setTimeout(resolve, 500));
                } else {
                    // Wait a bit for the injected script to process and emit output
                    await new Promise(resolve => setTimeout(resolve, 50));
                }

                // Check if we navigated to a new page after the action
                const navigated = await this.checkForNavigation();
                if (navigated) {
                    this.logger("[ScreenReaderDriver] Post-action navigation detected, screen reader re-initialized");
                }
            }
        } else if (action.type === 'TYPE') {
            if (action.text) {
                // Type text into the currently focused element
                await this.client.typeText(action.text);

                // Wait for the text to be typed
                await new Promise(resolve => setTimeout(resolve, 100));
            }
        }

        return {
            success: true,
            snapshot: await this.getPerceptualOutput()
        };
    }

    async getPerceptualOutput(): Promise<PerceptualSnapshot> {
        if (!this.enabled) {
            return { text: "Screen Reader Off", cursorBox: null };
        }

        // Get current page context
        const pageTitle = await this.client.getTitle();
        const pageUrl = await this.client.getCurrentUrl();

        // Return the last text we heard from the injected script along with page context
        return {
            text: this.lastSpokenText || "No output",
            cursorBox: null, // Box is drawn by injected script, we don't track it here anymore
            pageTitle,
            pageUrl
        };
    }
}
