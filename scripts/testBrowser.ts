import { BrowserClient } from '../browser/src/playwrightClient';

async function main() {
  console.log('Testing browser initialization...');

  const client = new BrowserClient();

  console.log('Launching browser...');
  await client.launch(true);

  console.log('✅ Browser launched');

  console.log('Navigating to test page...');
  await client.goto(`file://${process.cwd()}/test-sites/good-operable.html`);

  console.log('✅ Page loaded');

  console.log('Getting AX tree...');
  const axTree = await client.getFullAXTree();
  console.log(`✅ Got AX tree with ${axTree.length} nodes`);

  await client.close();
  console.log('✅ Browser closed');
}

main().catch(console.error);
