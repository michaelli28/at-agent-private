import { BrowserClient } from '../virtual-screen-reader/src/playwrightClient';
import { ScreenReaderDriver } from '../virtual-screen-reader/src/ScreenReaderDriver';
import * as readline from 'readline';

async function main() {
  const url = process.argv[2];
  if (!url) {
    console.error('Please provide a URL. Usage: pnpm dev:sr <url>');
    process.exit(1);
  }

  console.log(`[Harness] Launching browser for ${url}...`);
  const client = new BrowserClient();
  await client.launch(false); // headless: false to see the browser

  try {
    await client.goto(url);
    console.log('[Harness] Page loaded.');

    const driver = new ScreenReaderDriver(client);
    await driver.enable();

    console.log('\n--- Interactive Mode ---');
    console.log('Controls: [n] Next Item, [p] Previous Item, [i] Instant Traverse, [h] Next Heading, [sh] Prev Heading, [q] Quit\n');

    // Initial state
    let snapshot = await driver.getPerceptualOutput();
    logSnapshot('Initial', snapshot);

    const rl = readline.createInterface({
      input: process.stdin,
      output: process.stdout
    });

    rl.setPrompt('Action (n/p/i/h/sh/q)> ');
    rl.prompt();

    rl.on('line', async (line) => {
      const input = line.trim().toLowerCase();

      if (input === 'q') {
        rl.close();
        return;
      }

      let actionKey = '';
      if (input === 'n' || input === '') actionKey = 'ArrowDown';
      else if (input === 'p') actionKey = 'ArrowUp';
      else if (input === 'i') actionKey = 'Shift+A';
      else if (input === 'h') actionKey = 'H';
      else if (input === 'sh') actionKey = 'Shift+H';

      if (actionKey) {
        const result = await driver.performAction({ type: 'KEY_PRESS', key: actionKey });
        if (result.success) {
          logSnapshot('SR', result.snapshot);
        } else {
          console.error(`[Error] ${result.message}`);
        }
      } else {
        console.log('Unknown command. Use n, p, i, h, sh, or q.');
      }

      rl.prompt();
    });

    await new Promise((resolve) => {
      rl.on('close', resolve);
    });

  } catch (error) {
    console.error('[Harness] Error:', error);
  } finally {
    console.log('\n[Harness] Closing browser...');
    await client.close();
  }
}

function logSnapshot(prefix: string, snapshot: any) {
  console.log(`[${prefix}] Spoken: "${snapshot.text}"`);
  if (snapshot.cursorBox) {
    const { x, y, width, height } = snapshot.cursorBox;
    console.log(`[Box] x:${x}, y:${y}, w:${width}, h:${height}`);
  } else {
    console.log(`[Box] No visual cursor`);
  }
}

main();
