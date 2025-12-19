import path from "path";
import { BrowserClient, ScreenReaderDriver } from "@adf/virtual-screen-reader";
import { Evaluator } from "@adf/evaluation/Evaluator";
import { AgentTrace } from "@adf/agent/types";

const TEST_SITES_DIR = path.join(__dirname, "../test-sites");

interface TestCase {
  file: string;
  expectedRuleId: string;
  actions: string[]; // Simple keys to press
}

const TEST_CASES: TestCase[] = [
  {
    file: "img-missing-alt.html",
    expectedRuleId: "WCAG-4.1.2",
    actions: ["ArrowDown", "ArrowDown"], // Just read the tree
  },
  {
    file: "button-no-role-div.html",
    expectedRuleId: "WCAG-4.1.2",
    actions: ["ArrowDown", "ArrowDown"],
  },
  {
    file: "bad-focus-order.html",
    expectedRuleId: "WCAG-2.1.2",
    actions: ["Tab", "Tab", "Tab", "Tab", "Tab", "Tab"], // Trigger the trap detector (5+ tabs)
  },
];

async function runRegression() {
  console.log("Starting Regression Suite...");
  const client = new BrowserClient();
  await client.launch(false); // headed mode

  const driver = new ScreenReaderDriver(client);
  await driver.enable();

  let passed = 0;
  let failed = 0;

  for (const testCase of TEST_CASES) {
    console.log(`\nTesting ${testCase.file}...`);
    const url = `file://${path.join(TEST_SITES_DIR, testCase.file)}`;

    try {
      await client.goto(url);

      // Build a fake trace for the evaluator
      const trace: AgentTrace = {
        goal: "Regression Test",
        success: false,
        steps: [],
      };

      // Execute actions
      for (let i = 0; i < testCase.actions.length; i++) {
        const key = testCase.actions[i];
        const result = await driver.performAction({ type: "KEY_PRESS", key });

        trace.steps.push({
          stepNumber: i + 1,
          observation: result.snapshot,
          thought: "Test Action",
          action: { type: "KEY_PRESS", key },
          result,
        });
      }

      // Evaluate - Note: AXTree evaluation may need updating
      // The Evaluator works with the virtual screen reader
      const evaluator = new Evaluator();
      const violations = evaluator.evaluate([], trace);

      // Assert
      const found = violations.find(
        (v) => v.ruleId === testCase.expectedRuleId,
      );
      if (found) {
        console.log(
          `✅ Passed: Found expected violation ${testCase.expectedRuleId}`,
        );
        passed++;
      } else {
        console.error(`❌ Failed: Did not find ${testCase.expectedRuleId}`);
        console.log(
          "Violations found:",
          violations.map((v) => v.ruleId),
        );
        failed++;
      }
    } catch (e) {
      console.error(`❌ Error running ${testCase.file}:`, e);
      failed++;
    }
  }

  await driver.disable();
  await client.close();
  console.log(`\nSummary: ${passed} Passed, ${failed} Failed.`);
  if (failed > 0) process.exit(1);
}

runRegression();
