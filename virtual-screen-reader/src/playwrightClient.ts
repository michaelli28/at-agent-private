import { chromium, Browser, Page, CDPSession, BrowserContext } from 'playwright';
import { AXNode, Rect } from './types';

export class BrowserClient {
    private browser: Browser | null = null;
    private context: BrowserContext | null = null;
    private page: Page | null = null;
    private cdpSession: CDPSession | null = null;
    private navigationOccurred: boolean = false;
    private pageLoadCallback: (() => Promise<void>) | null = null;
    private screencastCallback: ((frame: { data: string; metadata: any }) => void) | null = null;
    private isScreencasting: boolean = false;
    private isRemote: boolean = false;

    /**
     * Launches a new browser instance.
     */
    async launch(headless: boolean = true): Promise<void> {
        this.browser = await chromium.launch({ headless });
        this.context = await this.browser.newContext();
        this.page = await this.context.newPage();
        this.cdpSession = await this.context.newCDPSession(this.page);
        this.isRemote = false;

        await this.setupPage();
    }

    /**
     * Connects to an existing browser via CDP endpoint (e.g., Docker container).
     */
    async connectCDP(cdpEndpoint: string): Promise<void> {
        this.browser = await chromium.connectOverCDP(cdpEndpoint);
        this.isRemote = true;

        // Get the default context or create one
        const contexts = this.browser.contexts();
        if (contexts.length > 0) {
            this.context = contexts[0];
            const pages = this.context.pages();
            if (pages.length > 0) {
                this.page = pages[0];
            } else {
                this.page = await this.context.newPage();
            }
        } else {
            this.context = await this.browser.newContext();
            this.page = await this.context.newPage();
        }

        this.cdpSession = await this.context.newCDPSession(this.page);
        await this.setupPage();
    }

    /**
     * Common page setup for both launch and connect.
     */
    private async setupPage(): Promise<void> {
        if (!this.cdpSession || !this.page) return;

        // Enable DOM domain to ensure we can get box models
        await this.cdpSession.send('DOM.enable');

        // Listen for page load events to detect full page navigations
        this.page.on('load', async () => {
            this.navigationOccurred = true;

            // If there's a callback registered, call it immediately
            if (this.pageLoadCallback) {
                await this.pageLoadCallback();
            }
        });
    }

    /**
     * Check if connected to a remote browser.
     */
    isRemoteBrowser(): boolean {
        return this.isRemote;
    }

    /**
     * Injects a script to run on every page load AND immediately.
     */
    async injectScript(content: string): Promise<void> {
        if (!this.page) throw new Error("Page not initialized.");
        await this.page.addInitScript({ content });
        await this.page.evaluate(content);
    }

    /**
     * Navigates to a URL.
     */
    async goto(url: string, waitUntil: 'load' | 'domcontentloaded' | 'networkidle' | 'commit' = 'domcontentloaded'): Promise<void> {
        if (!this.page) throw new Error("Browser not initialized. Call launch() first.");
        await this.page.goto(url, { waitUntil });
    }

    /**
     * Waits for the given timeout in milliseconds.
     */
    async waitForTimeout(timeout: number): Promise<void> {
        if (!this.page) throw new Error("Page not initialized.");
        await this.page.waitForTimeout(timeout);
    }

    /**
     * Fetches the full Accessibility Tree from CDP.
     */
    async getFullAXTree(): Promise<AXNode[]> {
        if (!this.cdpSession) throw new Error("CDP Session not initialized.");

        // We don't need to explicitly enable Accessibility domain for getFullAXTree,
        // but it's good practice if we were listening to events.
        const response = await this.cdpSession.send('Accessibility.getFullAXTree');
        return response.nodes as AXNode[];
    }

    /**
     * Gets the bounding box for a specific backend DOM node ID.
     * Returns null if the node has no visual representation (e.g. hidden).
     */
    async getBoundingBox(backendDOMNodeId: number): Promise<Rect | null> {
        if (!this.cdpSession) throw new Error("CDP Session not initialized.");

        try {
            const { model } = await this.cdpSession.send('DOM.getBoxModel', {
                backendNodeId: backendDOMNodeId
            });

            // model.border is [x1, y1, x2, y2, x3, y3, x4, y4]
            // We assume a rectangular shape for simplicity here.
            const x = model.border[0];
            const y = model.border[1];
            const width = model.width;
            const height = model.height;

            return { x, y, width, height };
        } catch (error) {
            // Node might be hidden or have no box model
            return null;
        }
    }

    /**
     * Focuses a specific backend DOM node.
     */
    async focus(backendDOMNodeId: number): Promise<void> {
        if (!this.cdpSession) throw new Error("CDP Session not initialized.");
        try {
            await this.cdpSession.send('DOM.focus', { backendNodeId: backendDOMNodeId });
        } catch (e) {
            // Ignore if not focusable
        }
    }

    /**
     * Simulates a key press.
     */
    async pressKey(key: string): Promise<void> {
        if (!this.page) throw new Error("Page not initialized.");
        await this.page.keyboard.press(key);
    }

    /**
     * Types text into the currently focused element.
     */
    async typeText(text: string): Promise<void> {
        if (!this.page) throw new Error("Page not initialized.");
        await this.page.keyboard.type(text);
    }

    /**
     * Simulates a mouse click at specific coordinates.
     */
    async click(x: number, y: number): Promise<void> {
        if (!this.page) throw new Error("Page not initialized.");
        await this.page.mouse.click(x, y);
    }

    /**
     * Takes a screenshot and returns it as a buffer.
     */
    async screenshot(path?: string): Promise<Buffer> {
        if (!this.page) throw new Error("Page not initialized.");
        return await this.page.screenshot({ path, fullPage: true });
    }

    /**
     * Closes the browser instance or disconnects from remote.
     */
    async close(): Promise<void> {
        if (this.browser) {
            if (this.isRemote) {
                // For remote browsers, just disconnect (don't close)
                await this.browser.close();
            } else {
                await this.browser.close();
            }
            this.browser = null;
            this.context = null;
            this.page = null;
            this.cdpSession = null;
        }
    }

    /**
     * Highlights a bounding box on the page for visual debugging.
     */
    async highlightBox(rect: Rect | null): Promise<void> {
        if (!this.page) return;

        await this.page.evaluate((rect) => {
            let box = document.getElementById('adf-highlight-box');
            if (!box) {
                box = document.createElement('div');
                box.id = 'adf-highlight-box';
                box.style.position = 'fixed'; // Fixed to viewport to match CDP coordinates
                box.style.border = '2px solid red';
                box.style.backgroundColor = 'rgba(255, 0, 0, 0.1)';
                box.style.pointerEvents = 'none'; // Click-through
                box.style.zIndex = '2147483647'; // Max z-index
                document.body.appendChild(box);
            }

            if (rect) {
                box.style.display = 'block';
                box.style.left = `${rect.x}px`;
                box.style.top = `${rect.y}px`;
                box.style.width = `${rect.width}px`;
                box.style.height = `${rect.height}px`;
            } else {
                box.style.display = 'none';
            }
        }, rect);
    }

    /**
     * Listen to console messages from the page.
     */
    onConsoleMessage(callback: (msg: string) => void) {
        if (!this.page) return;
        this.page.on('console', msg => callback(msg.text()));
    }

    /**
     * Gets the current page URL.
     */
    async getCurrentUrl(): Promise<string> {
        if (!this.page) throw new Error("Page not initialized.");
        return this.page.url();
    }

    /**
     * Gets the current page title.
     */
    async getTitle(): Promise<string> {
        if (!this.page) throw new Error("Page not initialized.");
        return this.page.title();
    }

    /**
     * Re-injects a script into the current page (useful after navigation).
     */
    async reinjectScript(content: string): Promise<void> {
        if (!this.page) throw new Error("Page not initialized.");
        await this.page.evaluate(content);
    }

    /**
     * Checks if a full page navigation occurred and resets the flag.
     */
    checkAndClearNavigation(): boolean {
        const occurred = this.navigationOccurred;
        this.navigationOccurred = false;
        return occurred;
    }

    /**
     * Register a callback to be invoked immediately when a page loads.
     */
    onPageLoad(callback: () => Promise<void>): void {
        this.pageLoadCallback = callback;
    }

    /**
     * Get the page instance for direct access.
     */
    getPage(): Page | null {
        return this.page;
    }

    /**
     * Starts CDP screencast - streams browser frames in real-time.
     * This is more efficient than taking screenshots for live preview.
     */
    async startScreencast(
        callback: (frame: { data: string; metadata: any }) => void,
        options?: { format?: 'jpeg' | 'png'; quality?: number; maxWidth?: number; maxHeight?: number }
    ): Promise<void> {
        if (!this.cdpSession) throw new Error("CDP Session not initialized.");
        if (this.isScreencasting) return;

        this.screencastCallback = callback;
        this.isScreencasting = true;

        // Listen for screencast frames
        this.cdpSession.on('Page.screencastFrame', async (params) => {
            if (this.screencastCallback) {
                this.screencastCallback({
                    data: params.data,
                    metadata: params.metadata
                });
            }
            // Acknowledge the frame to continue receiving frames
            if (this.cdpSession && this.isScreencasting) {
                try {
                    await this.cdpSession.send('Page.screencastFrameAck', {
                        sessionId: params.sessionId
                    });
                } catch (e) {
                    // Session might be closed
                }
            }
        });

        // Start the screencast
        await this.cdpSession.send('Page.startScreencast', {
            format: options?.format || 'jpeg',
            quality: options?.quality || 80,
            maxWidth: options?.maxWidth || 1280,
            maxHeight: options?.maxHeight || 720,
            everyNthFrame: 1
        });
    }

    /**
     * Stops the CDP screencast.
     */
    async stopScreencast(): Promise<void> {
        if (!this.cdpSession || !this.isScreencasting) return;

        try {
            await this.cdpSession.send('Page.stopScreencast');
        } catch (e) {
            // Session might already be closed
        }
        this.isScreencasting = false;
        this.screencastCallback = null;
    }

    /**
     * Check if screencast is currently active.
     */
    isScreencastActive(): boolean {
        return this.isScreencasting;
    }

    /**
     * Scrolls the page by a given amount.
     */
    async scrollBy(deltaX: number, deltaY: number): Promise<void> {
        if (!this.page) throw new Error("Page not initialized.");
        await this.page.evaluate(({ dx, dy }) => {
            window.scrollBy(dx, dy);
        }, { dx: deltaX, dy: deltaY });
    }

    /**
     * Scrolls the page to a specific position.
     */
    async scrollTo(x: number, y: number): Promise<void> {
        if (!this.page) throw new Error("Page not initialized.");
        await this.page.evaluate(({ sx, sy }) => {
            window.scrollTo(sx, sy);
        }, { sx: x, sy: y });
    }

    /**
     * Gets the current scroll position and page dimensions.
     */
    async getScrollInfo(): Promise<{ scrollX: number; scrollY: number; scrollWidth: number; scrollHeight: number; viewportWidth: number; viewportHeight: number }> {
        if (!this.page) throw new Error("Page not initialized.");
        return await this.page.evaluate(() => ({
            scrollX: window.scrollX,
            scrollY: window.scrollY,
            scrollWidth: document.documentElement.scrollWidth,
            scrollHeight: document.documentElement.scrollHeight,
            viewportWidth: window.innerWidth,
            viewportHeight: window.innerHeight
        }));
    }
}
