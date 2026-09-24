import { chromium, Browser, Page, CDPSession } from 'playwright';
import { AXNode, Rect } from './types';

export class BrowserClient {
  private browser: Browser | null = null;
  private page: Page | null = null;
  private cdpSession: CDPSession | null = null;
  private navigationOccurred = false;
  private pageLoadCallback: (() => Promise<void>) | null = null;

  /**
   * Launches the browser and opens a new page.
   */
  async launch(headless: boolean = true): Promise<void> {
    this.browser = await chromium.launch({ headless });
    this.page = await this.browser.newPage();
    this.cdpSession = await this.page.context().newCDPSession(this.page);

    // Enable DOM domain to ensure we can get box models
    await this.cdpSession.send('DOM.enable');

    // Track navigation
    this.page.on('load', async () => {
      this.navigationOccurred = true;
      if (this.pageLoadCallback) {
        await this.pageLoadCallback();
      }
    });
  }

  /**
   * Injects a script to run on every page load AND immediately.
   */
  async injectScript(content: string): Promise<void> {
    if (!this.page) throw new Error("Page not initialized.");
    await this.page.addInitScript({ content });
    await this.page.evaluate(content);
  }

  async reinjectScript(content: string): Promise<void> {
    if (!this.page) throw new Error("Page not initialized.");
    await this.page.evaluate(content);
  }

  /**
   * Evaluates a function in the page context.
   */
  async evaluate<T>(pageFunction: () => T): Promise<T> {
    if (!this.page) throw new Error("Page not initialized.");
    return await this.page.evaluate(pageFunction);
  }

  /**
   * Navigates to a URL.
   */
  async goto(url: string): Promise<void> {
    if (!this.page) throw new Error("Browser not initialized. Call launch() first.");
    await this.page.goto(url, { waitUntil: 'domcontentloaded' });
  }

  async getCurrentUrl(): Promise<string> {
    if (!this.page) return "";
    return this.page.url();
  }

  async getTitle(): Promise<string> {
    if (!this.page) return "";
    return await this.page.title();
  }

  onPageLoad(callback: () => Promise<void>): void {
    this.pageLoadCallback = callback;
  }

  getPage(): Page | null {
    return this.page;
  }

  checkAndClearNavigation(): boolean {
    const occurred = this.navigationOccurred;
    this.navigationOccurred = false;
    return occurred;
  }

  async typeText(text: string): Promise<void> {
    if (!this.page) throw new Error("Page not initialized.");
    await this.page.keyboard.type(text);
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
   * Closes the browser instance.
   */
  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
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
}
