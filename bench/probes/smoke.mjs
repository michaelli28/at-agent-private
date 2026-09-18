import { chromium } from 'playwright'
const browser = await chromium.launch()
const page = await browser.newPage()
await page.setContent('<a href="#a">a</a>')
console.log('chromium', browser.version(), 'title-ok', await page.evaluate(() => document.querySelectorAll('a').length))
await browser.close()
