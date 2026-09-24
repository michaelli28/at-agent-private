import 'dotenv/config';
import { BrowserClient } from '../browser/src/playwrightClient';
import { ScreenReaderDriver } from '../drivers/src/ScreenReaderDriver';
import { Agent } from '../agent/src/Agent';
import { buildOpenAIModel } from '../agent/src/OpenAIClient';
import { Evaluator } from '../evaluation/src/Evaluator';
import { Section2CheckResult } from '../evaluation/src/types';
import path from 'path';

async function main() {
  const client = new BrowserClient();
  await client.launch(true); // Headless

  const evaluator = new Evaluator();
  const cwd = process.cwd();

  try {
    // Test 1: Single Way (Should Fail 2.4.5)
    const singleWayUrl = `file://${path.join(cwd, 'test-sites/single-way.html')}`;
    console.log(`Testing ${singleWayUrl}...`);
    await client.goto(singleWayUrl);

    // Minimal agent run to get trace
    const driver = new ScreenReaderDriver(client);
    const model = buildOpenAIModel();
    const agent = new Agent(driver, model);
    const trace = await agent.run("Read the page content");

    const axTree = await client.getFullAXTree();
    const metadata = await client.evaluate(() => ({
      title: document.title,
      lang: document.documentElement.lang,
      duplicateIds: []
    }));

    const results1 = evaluator.evaluateSection2(axTree, trace, metadata);
    const sc245_1 = results1.find(r => r.successCriterion === '2.4.5 Multiple Ways');

    if (sc245_1?.status === 'fail') {
      console.log('✅ Correctly detected failure for 2.4.5 on single-way.html');
    } else {
      console.error('❌ Failed to detect failure for 2.4.5 on single-way.html. Status:', sc245_1?.status);
      process.exit(1);
    }

    // Test 2: Good Operable (Should Pass 2.4.5)
    const goodUrl = `file://${path.join(cwd, 'test-sites/good-operable.html')}`;
    console.log(`Testing ${goodUrl}...`);
    await client.goto(goodUrl);

    const trace2 = await agent.run("Find the search bar");
    const axTree2 = await client.getFullAXTree();
    const metadata2 = await client.evaluate(() => ({
      title: document.title,
      lang: document.documentElement.lang,
      duplicateIds: []
    }));

    const results2 = evaluator.evaluateSection2(axTree2, trace2, metadata2);
    const sc245_2 = results2.find(r => r.successCriterion === '2.4.5 Multiple Ways');

    if (sc245_2?.status === 'pass') {
      console.log('✅ Correctly passed 2.4.5 on good-operable.html');
    } else {
      console.error('❌ Failed to pass 2.4.5 on good-operable.html. Status:', sc245_2?.status);
      // process.exit(1); // Don't exit yet, check others
    }

    // Check other SCs on good page
    const sc242 = results2.find(r => r.successCriterion === '2.4.2 Page Titled');
    if (sc242?.status === 'pass') console.log('✅ Passed 2.4.2 Page Titled');

    const sc241 = results2.find(r => r.successCriterion === '2.4.1 Bypass Blocks');
    if (sc241?.status === 'pass') console.log('✅ Passed 2.4.1 Bypass Blocks');

  } catch (e) {
    console.error(e);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
