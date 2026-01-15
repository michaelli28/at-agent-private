import { describe, it, expect, beforeAll, afterAll } from "vitest"
import { BrowserClient, BrowserPage } from "@at-agent/browser"
import { ScreenReaderSimulator } from "./screen-reader.js"

describe("ScreenReaderSimulator", () => {
  let client: BrowserClient
  let page: BrowserPage
  let simulator: ScreenReaderSimulator

  beforeAll(async () => {
    client = new BrowserClient()
    await client.launch()
  })

  afterAll(async () => {
    await client.close()
  })

  describe("readPage", () => {
    it("returns page content in reading order", async () => {
      page = await client.newPage()
      await page.goto("https://example.com")
      simulator = new ScreenReaderSimulator(page)

      const content = await simulator.readPage()

      expect(content.length).toBeGreaterThan(0)
      // Should include the heading
      expect(content.some(item => item.role === "heading")).toBe(true)
      await page.close()
    })
  })

  describe("getHeadings", () => {
    it("returns all headings with levels", async () => {
      page = await client.newPage()
      await page.goto("https://example.com")
      simulator = new ScreenReaderSimulator(page)

      const headings = await simulator.getHeadings()

      expect(headings.length).toBeGreaterThan(0)
      expect(headings[0].level).toBeDefined()
      expect(headings[0].text).toContain("Example")
      await page.close()
    })
  })

  describe("getLandmarks", () => {
    it("returns page landmarks", async () => {
      page = await client.newPage()
      await page.goto("https://example.com")
      simulator = new ScreenReaderSimulator(page)

      const landmarks = await simulator.getLandmarks()

      // Even simple pages have implicit landmarks
      expect(Array.isArray(landmarks)).toBe(true)
      await page.close()
    })
  })
})
