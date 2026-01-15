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
})
