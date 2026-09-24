import path from 'path';
import { BrowserClient } from '../browser/src/playwrightClient';
import { ScreenReaderDriver } from '../drivers/src/ScreenReaderDriver';
import { Evaluator } from '../evaluation/src/Evaluator';
import { AgentTrace } from '../agent/src/types';

const TEST_SITES_DIR = path.join(__dirname, '../test-sites');

interface TestCase {
  file: string;
  expectedRuleId: string;
  actions: string[]; // Simple keys to press
}

const TEST_CASES: TestCase[] = [
  {
    file: 'img-missing-alt.html',
    expectedRuleId: 'WCAG-4.1.2',
    actions: ['ArrowDown', 'ArrowDown'] // Just read the tree
  },
  {
    file: 'button-no-role-div.html',
    expectedRuleId: 'WCAG-4.1.2',
    actions: ['ArrowDown', 'ArrowDown']
  },
  {
    file: 'bad-focus-order.html',
    expectedRuleId: 'WCAG-2.1.2',
    actions: ['Tab', 'Tab', 'Tab', 'Tab', 'Tab', 'Tab'] // Trigger the trap detector (5+ tabs)
  }
];

async function runRegression() {
  console.log('Starting Regression Suite...');
  const client = new BrowserClient();
  await client.launch(true); // Headless

  let passed = 0;
  let failed = 0;

  for (const testCase of TEST_CASES) {
    console.log(`\nTesting ${testCase.file}...`);
    const url = `file://${path.join(TEST_SITES_DIR, testCase.file)}`;

    try {
      await client.goto(url);
      const driver = new ScreenReaderDriver(client);
      await driver.enable();

      // Build a fake trace for the evaluator
      const trace: AgentTrace = {
        goal: 'Regression Test',
        success: false,
        steps: []
      };

      // Execute actions
      for (let i = 0; i < testCase.actions.length; i++) {
        const key = testCase.actions[i];
        const result = await driver.performAction({ type: 'KEY_PRESS', key });

        trace.steps.push({
          stepNumber: i + 1,
          observation: result.snapshot,
          thought: 'Test Action',
          action: { type: 'KEY_PRESS', key },
          result
        });
      }

      // Evaluation
      const evaluator = new Evaluator();
      let axTree: AXNode[] = [];
      let metadata;

      try {
        axTree = await client.getFullAXTree();
        metadata = await client.evaluate(() => {
          return {
            title: document.title,
            lang: document.documentElement.lang,
            duplicateIds: (function () {
              const ids = new Set();
              const duplicates: string[] = [];
              document.querySelectorAll('[id]').forEach(el => {
                if (ids.has(el.id)) duplicates.push(el.id);
                ids.add(el.id);
              });
              return duplicates;
            })()
          };
        });
      } catch (e) {
        console.log("⚠️ Could not fetch AXTree or metadata for evaluation.");
      }
      const violations = evaluator.evaluate(axTree, trace, metadata);

      // Assert
      const found = violations.find(v => v.ruleId === testCase.expectedRuleId);
      if (found) {
        console.log(`✅ Passed: Found expected violation ${testCase.expectedRuleId}`);
        passed++;
      } else {
        console.error(`❌ Failed: Did not find ${testCase.expectedRuleId}`);
        console.log('Violations found:', violations.map(v => v.ruleId));
        failed++;
      }

    } catch (e) {
      console.error(`❌ Error running ${testCase.file}:`, e);
      failed++;
    }
  }

  await client.close();
  console.log(`\nSummary: ${passed} Passed, ${failed} Failed.`);
  if (failed > 0) process.exit(1);
}

runRegression();
