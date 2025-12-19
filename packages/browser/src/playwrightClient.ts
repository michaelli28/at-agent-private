import { Browser, Page, chromium } from 'playwright';
import { AXNode, Rect } from './types';

export class BrowserClient {
  private browser: Browser | null = null;
  private page: Page | null = null;

  async launch(options?: { headless?: boolean }): Promise<void> {
    this.browser = await chromium.launch({
      headless: options?.headless ?? true,
    });
    const context = await this.browser.newContext();
    this.page = await context.newPage();
  }

  async goto(url: string): Promise<void> {
    if (!this.page) throw new Error('Browser not launched');
    await this.page.goto(url);
  }

  async close(): Promise<void> {
    if (this.browser) {
      await this.browser.close();
      this.browser = null;
      this.page = null;
    }
  }

  async getAccessibilityTree(): Promise<AXNode[]> {
    if (!this.page) throw new Error('Browser not launched');
    const snapshot = await this.page.accessibility.snapshot();
    return snapshot ? [snapshot as unknown as AXNode] : [];
  }

  async screenshot(): Promise<Buffer> {
    if (!this.page) throw new Error('Browser not launched');
    return await this.page.screenshot();
  }

  async click(x: number, y: number): Promise<void> {
    if (!this.page) throw new Error('Browser not launched');
    await this.page.mouse.click(x, y);
  }

  async type(text: string): Promise<void> {
    if (!this.page) throw new Error('Browser not launched');
    await this.page.keyboard.type(text);
  }

  async press(key: string): Promise<void> {
    if (!this.page) throw new Error('Browser not launched');
    await this.page.keyboard.press(key);
  }

  getPage(): Page | null {
    return this.page;
  }
}
