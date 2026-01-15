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
})
