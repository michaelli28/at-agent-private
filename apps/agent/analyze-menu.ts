#!/usr/bin/env npx ts-node
/**
 * Analyze menu/dropdown structure of a website
 */

import { chromium } from 'playwright';

async function analyzeMenu(url: string) {
  console.log(`\n${'='.repeat(60)}`);
  console.log(`Analyzing: ${url}`);
  console.log('='.repeat(60));

  const browser = await chromium.launch({ headless: true });
  const page = await browser.newPage();
  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');

  const analysis = await page.evaluate(() => {
    const results: string[] = [];

    // Find all elements with menu-related attributes
    const menuTriggers = document.querySelectorAll('[aria-haspopup], [aria-expanded], [role="menuitem"], [role="menu"], [role="menubar"]');

    results.push(`\n## Elements with ARIA menu attributes: ${menuTriggers.length}`);

    menuTriggers.forEach((el, i) => {
      if (i < 20) { // Limit output
        const tag = el.tagName.toLowerCase();
        const role = el.getAttribute('role');
        const haspopup = el.getAttribute('aria-haspopup');
        const expanded = el.getAttribute('aria-expanded');
        const hidden = el.getAttribute('aria-hidden');
        const text = (el as HTMLElement).innerText?.slice(0, 50).replace(/\n/g, ' ').trim();

        let attrs = [];
        if (role) attrs.push(`role="${role}"`);
        if (haspopup) attrs.push(`aria-haspopup="${haspopup}"`);
        if (expanded) attrs.push(`aria-expanded="${expanded}"`);
        if (hidden) attrs.push(`aria-hidden="${hidden}"`);

        results.push(`  <${tag} ${attrs.join(' ')}> "${text}"`);
      }
    });

    // Check for nav elements
    const navs = document.querySelectorAll('nav');
    results.push(`\n## <nav> elements: ${navs.length}`);

    navs.forEach((nav, i) => {
      const ariaLabel = nav.getAttribute('aria-label');
      const id = nav.id;
      const firstChild = nav.firstElementChild?.tagName;
      results.push(`  nav${id ? `#${id}` : ''}${ariaLabel ? ` [aria-label="${ariaLabel}"]` : ''} → first child: <${firstChild}>`);
    });

    // Check how dropdowns might work
    const hiddenMenus = document.querySelectorAll('[aria-hidden="true"]');
    results.push(`\n## Hidden elements (aria-hidden="true"): ${hiddenMenus.length}`);

    // Check for CSS-only dropdowns (hover-based)
    const cssDropdowns = document.querySelectorAll('li:has(> ul), li:has(> div.dropdown), .dropdown-menu, .submenu');
    results.push(`\n## Potential CSS dropdown containers: ${cssDropdowns.length}`);

    // Sample the first nav's structure
    if (navs.length > 0) {
      const mainNav = navs[0];
      results.push(`\n## First nav structure (first 500 chars of outerHTML):`);
      results.push(mainNav.outerHTML.slice(0, 500) + '...');
    }

    return results.join('\n');
  });

  console.log(analysis);
  await browser.close();
}

async function main() {
  const urls = process.argv.slice(2);

  if (urls.length === 0) {
    // Default to the two sites the user mentioned
    await analyzeMenu('https://www.michigan.gov/som');
    await analyzeMenu('https://www.bloomfield.org/');
  } else {
    for (const url of urls) {
      await analyzeMenu(url);
    }
  }
}

main().catch(console.error);
