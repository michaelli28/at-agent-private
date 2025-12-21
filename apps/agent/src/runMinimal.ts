#!/usr/bin/env npx ts-node
/**
 * CLI runner for AgentMinimal
 *
 * Usage:
 *   npx ts-node agent/src/runMinimal.ts <url> "<goal>"
 *
 * Example:
 *   npx ts-node agent/src/runMinimal.ts https://example.com "Click the More information link"
 *
 * Environment:
 *   OPENROUTER_API_KEY - Required API key
 *   MODEL - Optional model override (default: google/gemini-2.0-flash-001)
 */

import { chromium } from 'playwright';
import { AgentMinimal } from './AgentMinimal';

async function main() {
  const args = process.argv.slice(2);

  if (args.length < 2) {
    console.error('Usage: npx ts-node agent/src/runMinimal.ts <url> "<goal>"');
    console.error('Example: npx ts-node agent/src/runMinimal.ts https://example.com "Click the contact link"');
    process.exit(1);
  }

  const [url, goal] = args;
  const apiKey = process.env['OPENROUTER_API_KEY'];
  const model = process.env['MODEL'];

  if (!apiKey) {
    console.error('Error: OPENROUTER_API_KEY environment variable is required');
    process.exit(1);
  }

  console.log(`\n🚀 Starting AgentMinimal`);
  console.log(`   URL: ${url}`);
  console.log(`   Goal: ${goal}`);
  console.log(`   Model: ${model || 'google/gemini-2.0-flash-001'}\n`);

  // Use same browser settings as full screen reader mode
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

  try {
    await page.goto(url, { waitUntil: 'domcontentloaded' });

    const agent = new AgentMinimal({
      page,
      apiKey,
      model,
      onLog: (msg) => console.log(msg),
    });

    const result = await agent.run(goal);

    console.log('\n' + '='.repeat(50));
    console.log(`Result: ${result.success ? '✅ SUCCESS' : '❌ FAILED'}`);
    console.log(`Steps: ${result.steps.length}`);
    if (result.error) {
      console.log(`Error: ${result.error}`);
    }
    console.log('='.repeat(50) + '\n');

  } finally {
    await browser.close();
  }
}

main().catch((err) => {
  console.error('Fatal error:', err);
  process.exit(1);
});
