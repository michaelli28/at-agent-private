import type { Page, Locator } from 'playwright'
import type { ElementData } from './types.js'

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

  async getByRole(
    role: string,
    options?: { name?: string | RegExp }
  ): Promise<ElementData[]> {
    const locator = this.page.getByRole(role as Parameters<Page['getByRole']>[0], options)
    return this.locatorToElementData(locator, role)
  }

  private async locatorToElementData(locator: Locator, role?: string): Promise<ElementData[]> {
    const count = await locator.count()
    const elements: ElementData[] = []

    for (let i = 0; i < count; i++) {
      const el = locator.nth(i)
      const box = await el.boundingBox()

      elements.push({
        tagName: await el.evaluate((node) => (node as Element).tagName.toLowerCase()),
        role: await el.getAttribute('role') ?? role ?? null,
        name: await el.evaluate((node) => {
          return (node as Element).getAttribute('aria-label') ?? (node as Element).textContent?.trim() ?? null
        }),
        value: await el.inputValue().catch(() => null),
        checked: await el.isChecked().catch(() => null),
        disabled: await el.isDisabled(),
        location: {
          selector: `${await el.evaluate((n) => (n as Element).tagName.toLowerCase())}`,
          boundingBox: box,
        },
      })
    }

    return elements
  }

  async close(): Promise<void> {
    await this.page.close()
  }
}
