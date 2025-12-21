#!/usr/bin/env npx ts-node
/**
 * Test script for scanning page elements using the Accessibility Tree
 * Usage: pnpm test:scan <url>
 */

import { chromium } from 'playwright';
import { AXTreeNavigator } from '../virtual-screen-reader/src/AXTreeNavigator';
import { AXNode } from '../virtual-screen-reader/src/types';

interface PageElement {
  position: number;
  name: string;
  role: string;
  backendNodeId: number;
  states?: {
    expanded?: boolean;
    hasPopup?: boolean | string;
    level?: number;
  };
}

async function main() {
  const url = process.argv[2] || 'https://www.w3.org/WAI/ARIA/apg/patterns/menu-button/examples/menu-button-actions-active-descendant/';

  console.log(`\nScanning: ${url}\n`);

  const browser = await chromium.launch({
    headless: false,
    channel: 'chrome',
    ignoreDefaultArgs: ['--enable-automation'],
    args: ['--start-maximized'],
  });
  const context = await browser.newContext({
    viewport: null,
    hasTouch: false,
  });
  const page = await context.newPage();

  await page.goto(url, { waitUntil: 'domcontentloaded' });
  await page.waitForLoadState('load');

  // Wait for DOM to stabilize
  await page.evaluate(`
    new Promise(function(resolve) {
      var lastMutationTime = Date.now();
      var observer = new MutationObserver(function() {
        lastMutationTime = Date.now();
      });
      observer.observe(document.body, { childList: true, subtree: true, attributes: true });
      function check() {
        if (Date.now() - lastMutationTime >= 100) {
          observer.disconnect();
          resolve();
        } else {
          setTimeout(check, 20);
        }
      }
      setTimeout(check, 20);
      setTimeout(function() { observer.disconnect(); resolve(); }, 2000);
    })
  `);

  console.log('Getting accessibility tree via CDP...\n');

  // Get CDP session
  const cdpSession = await page.context().newCDPSession(page);

  // Force refresh of accessibility tree
  await cdpSession.send('Accessibility.disable').catch(() => {});
  await cdpSession.send('Accessibility.enable');

  // Get the full accessibility tree
  // Cast through unknown because CDP types differ slightly from our AXNode interface
  const result = await cdpSession.send('Accessibility.getFullAXTree');
  const nodes = (result as unknown as { nodes: AXNode[] }).nodes;
  console.log(`Total AX nodes: ${nodes.length}`);

  // Debug: count ignored nodes
  const ignoredCount = nodes.filter(n => n.ignored).length;
  console.log(`Ignored nodes: ${ignoredCount}`);

  // Build navigable tree and filter to interesting nodes
  const axNavigator = new AXTreeNavigator();
  axNavigator.buildNavigableTree(nodes);
  const interestingNodes = axNavigator.getAllInterestingNodes();

  console.log(`Interesting nodes: ${interestingNodes.length}\n`);

  // Convert to PageElement format
  const elements: PageElement[] = [];
  for (const node of interestingNodes) {
    if (node.backendDOMNodeId === undefined) {
      continue;
    }

    elements.push({
      position: elements.length + 1,
      name: node.computedName || '',
      role: node.computedRole,
      backendNodeId: node.backendDOMNodeId,
      states: {
        expanded: node.states.expanded,
        hasPopup: node.states.hasPopup,
        level: node.states.level,
      },
    });
  }

  // Format as simple numbered list (same as AgentMinimal)
  function formatAsList(elements: PageElement[]): string {
    if (elements.length === 0) return 'No interactive elements found on page.';

    const lines = elements.map(el => {
      // Base format: "name, role" or just "role" if no name
      let display = el.name ? `${el.name}, ${el.role}` : el.role;

      // Add modifiers for important states
      if (el.states?.hasPopup) display += ' [popup]';
      // Only show heading level for actual headings
      if (el.states?.level && el.role === 'heading') display += ` [h${el.states.level}]`;

      return `${el.position}. ${display}`;
    });

    return `Interactive elements (${elements.length}):\n${lines.join('\n')}`;
  }

  // Print numbered list format
  console.log('=== Page Elements ===\n');
  console.log(formatAsList(elements));
  console.log(`\n=== Found ${elements.length} elements ===\n`);

  // Test navigation to a few elements
  if (elements.length > 0) {
    console.log('Testing direct focus via CDP...\n');

    // Focus the first link or button we find
    const testElement = elements.find(el => el.role === 'link' || el.role === 'button') || elements[0];

    console.log(`Focusing element ${testElement.position}: "${testElement.name}" (${testElement.role})`);

    try {
      await cdpSession.send('DOM.focus', { backendNodeId: testElement.backendNodeId });
      await cdpSession.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: testElement.backendNodeId });
      console.log('Focus successful!');
    } catch (err: any) {
      console.log(`Focus failed: ${err.message}`);
    }
  }

  // Interactive rescan loop
  const readline = await import('readline');
  const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout,
  });

  const rescan = async () => {
    console.log('\n--- Rescanning... ---\n');

    // Force refresh
    await cdpSession.send('Accessibility.disable').catch(() => {});
    await cdpSession.send('Accessibility.enable');

    const result2 = await cdpSession.send('Accessibility.getFullAXTree');
    const nodes2 = (result2 as unknown as { nodes: AXNode[] }).nodes;
    console.log(`Total AX nodes: ${nodes2.length}`);

    const ignoredCount2 = nodes2.filter(n => n.ignored).length;
    console.log(`Ignored nodes: ${ignoredCount2}`);

    const axNavigator2 = new AXTreeNavigator();
    axNavigator2.buildNavigableTree(nodes2);
    const interestingNodes2 = axNavigator2.getAllInterestingNodes();
    console.log(`Interesting nodes: ${interestingNodes2.length}\n`);

    // Show new elements
    const elements2: PageElement[] = [];
    for (const node of interestingNodes2) {
      if (node.backendDOMNodeId === undefined) continue;
      elements2.push({
        position: elements2.length + 1,
        name: node.computedName || '',
        role: node.computedRole,
        backendNodeId: node.backendDOMNodeId,
        states: {
          expanded: node.states.expanded,
          hasPopup: node.states.hasPopup,
          level: node.states.level,
        },
      });
    }

    console.log(formatAsList(elements2));
    console.log(`\n=== Found ${elements2.length} elements (was ${elements.length}) ===\n`);
  };

  console.log('\n=== Interactive Mode ===');
  console.log('Click dropdown in browser, then press ENTER here to rescan');
  console.log('Press Ctrl+C to exit\n');

  rl.on('line', async () => {
    await rescan();
  });

  // Keep process alive
  await new Promise(() => {});
}

main().catch(err => {
  console.error('Error:', err);
  process.exit(1);
});
