import type { Page } from 'playwright'

export class BrowserPage {
  constructor(private readonly page: Page) {}

  async goto(url: string): Promise<void> {
    await this.page.goto(url, { waitUntil: 'domcontentloaded' })
  }

  async url(): Promise<string> {
    return this.page.url()
  }

  async title(): Promise<string> {
    return this.page.title()
  }

  async close(): Promise<void> {
    await this.page.close()
  }
}
