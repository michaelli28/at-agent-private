import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { BrowserClient } from './client.js'
import { BrowserPage } from './page.js'

describe('BrowserPage', () => {
  let client: BrowserClient
  let page: BrowserPage

  beforeAll(async () => {
    client = new BrowserClient()
    await client.launch()
  })

  afterAll(async () => {
    await client.close()
  })

  describe('navigation', () => {
    it('navigates to URL', async () => {
      page = await client.newPage()
      await page.goto('https://example.com')
      expect(await page.url()).toBe('https://example.com/')
      await page.close()
    })

    it('throws on invalid URL', async () => {
      page = await client.newPage()
      await expect(page.goto('not-a-url')).rejects.toThrow()
      await page.close()
    })

    it('waits for page load', async () => {
      page = await client.newPage()
      await page.goto('https://example.com')
      const title = await page.title()
      expect(title).toBe('Example Domain')
      await page.close()
    })
  })

  describe('queries', () => {
    it('finds elements by role', async () => {
      page = await client.newPage()
      await page.goto('https://example.com')
      const links = await page.getByRole('link')
      expect(links.length).toBeGreaterThan(0)
      expect(links[0].role).toBe('link')
      await page.close()
    })

    it('finds elements by role and name', async () => {
      page = await client.newPage()
      await page.goto('https://example.com')
      const links = await page.getByRole('link', { name: 'Learn more' })
      expect(links.length).toBe(1)
      await page.close()
    })

    it('returns empty array when no matches', async () => {
      page = await client.newPage()
      await page.goto('https://example.com')
      const buttons = await page.getByRole('button')
      expect(buttons).toEqual([])
      await page.close()
    })

    it('finds elements by text', async () => {
      page = await client.newPage()
      await page.goto('https://example.com')
      const elements = await page.getByText('Example Domain')
      expect(elements.length).toBeGreaterThan(0)
      await page.close()
    })

    it('finds elements by partial text', async () => {
      page = await client.newPage()
      await page.goto('https://example.com')
      const elements = await page.getByText('Example', { exact: false })
      expect(elements.length).toBeGreaterThan(0)
      await page.close()
    })
  })

  describe('accessibility', () => {
    it('returns accessibility tree', async () => {
      page = await client.newPage()
      await page.goto('https://example.com')
      const tree = await page.accessibilityTree()
      expect(tree.role).toBe('WebArea')
      expect(tree.children.length).toBeGreaterThan(0)
      await page.close()
    })

    it('tree contains heading', async () => {
      page = await client.newPage()
      await page.goto('https://example.com')
      const tree = await page.accessibilityTree()

      const findHeading = (node: any): any => {
        if (node.role === 'heading') return node
        for (const child of node.children || []) {
          const found = findHeading(child)
          if (found) return found
        }
        return null
      }

      const heading = findHeading(tree)
      expect(heading).not.toBeNull()
      expect(heading.name).toContain('Example')
      await page.close()
    })
  })

  describe('screenshot', () => {
    it('captures screenshot as buffer', async () => {
      page = await client.newPage()
      await page.goto('https://example.com')
      const buffer = await page.screenshot()
      expect(buffer).toBeInstanceOf(Buffer)
      expect(buffer.length).toBeGreaterThan(0)
      // PNG magic bytes
      expect(buffer[0]).toBe(0x89)
      expect(buffer[1]).toBe(0x50) // P
      expect(buffer[2]).toBe(0x4e) // N
      expect(buffer[3]).toBe(0x47) // G
      await page.close()
    })

    it('captures full page screenshot', async () => {
      page = await client.newPage()
      await page.goto('https://example.com')
      const partial = await page.screenshot()
      const full = await page.screenshot({ fullPage: true })
      expect(full.length).toBeGreaterThanOrEqual(partial.length)
      await page.close()
    })
  })
})
