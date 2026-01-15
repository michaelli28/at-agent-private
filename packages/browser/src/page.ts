import type { Page } from 'playwright'

export class BrowserPage {
  constructor(private readonly page: Page) {}

  async close(): Promise<void> {
    await this.page.close()
  }
}
