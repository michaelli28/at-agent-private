import { BrowserClient } from '../browser/src/playwrightClient';

async function main() {
  const client = new BrowserClient();
  console.log('Launching browser...');
  await client.launch(false); // Headless false to see it

  console.log('Navigating to example.com...');
  await client.goto('https://example.com');

  console.log('Fetching Accessibility Tree...');
  const nodes = await client.getFullAXTree();
  console.log(`Received ${nodes.length} AXNodes.`);

  // Find the first heading
  const heading = nodes.find(n => n.role?.value === 'heading');
  if (heading) {
    console.log('Found heading:', heading.name?.value);
    if (heading.backendDOMNodeId) {
      console.log('Fetching bounding box for heading...');
      const box = await client.getBoundingBox(heading.backendDOMNodeId);
      console.log('Bounding Box:', box);
    }
  } else {
    console.log('No heading found.');
  }

  console.log('Taking screenshot...');
  await client.screenshot('example.png');

  console.log('Closing browser...');
  await client.close();
}

main().catch(console.error);
