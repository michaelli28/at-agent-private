import type { Page, Locator } from 'playwright'
import { ScreenshotOptionsSchema, type ElementData, type ScreenshotOptions, type AccessibilityNode } from './types.js'

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

  async getByText(
    text: string | RegExp,
    options?: { exact?: boolean }
  ): Promise<ElementData[]> {
    const locator = this.page.getByText(text, options)
    return this.locatorToElementData(locator)
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

  async screenshot(options: Partial<ScreenshotOptions> = {}): Promise<Buffer> {
    const opts = ScreenshotOptionsSchema.parse(options)
    return this.page.screenshot({
      fullPage: opts.fullPage,
      type: opts.type,
    })
  }

  async accessibilityTree(): Promise<AccessibilityNode> {
    const yamlSnapshot = await this.page.locator('body').ariaSnapshot()
    const children = this.parseAriaSnapshot(yamlSnapshot)
    return {
      role: 'WebArea',
      name: await this.title(),
      value: null,
      description: null,
      children,
    }
  }

  private parseAriaSnapshot(yaml: string): AccessibilityNode[] {
    const lines = yaml.split('\n')
    const result: AccessibilityNode[] = []
    const stack: { indent: number; node: AccessibilityNode }[] = []

    for (const line of lines) {
      if (!line.trim() || line.trim().startsWith('/')) continue

      const indent = line.search(/\S/)
      const content = line.trim()

      if (!content.startsWith('-')) continue

      const node = this.parseAriaLine(content.slice(1).trim())

      while (stack.length > 0 && stack[stack.length - 1].indent >= indent) {
        stack.pop()
      }

      if (stack.length === 0) {
        result.push(node)
      } else {
        stack[stack.length - 1].node.children.push(node)
      }

      stack.push({ indent, node })
    }

    return result
  }

  private parseAriaLine(content: string): AccessibilityNode {
    // Parse lines like: heading "Example Domain" [level=1]
    // or: paragraph: some text here
    // or: link "Learn more":
    const roleMatch = content.match(/^(\w+)/)
    const role = roleMatch?.[1] ?? 'none'

    let name: string | null = null
    const quotedMatch = content.match(/"([^"]*)"/)
    if (quotedMatch) {
      name = quotedMatch[1]
    } else {
      // Check for unquoted text after colon (paragraph: text here)
      const colonMatch = content.match(/^\w+:\s*(.+?)(?:\s*$|\s*\[)/)
      if (colonMatch && colonMatch[1]) {
        name = colonMatch[1].trim()
      }
    }

    return {
      role,
      name,
      value: null,
      description: null,
      children: [],
    }
  }

  async close(): Promise<void> {
    await this.page.close()
  }
}
