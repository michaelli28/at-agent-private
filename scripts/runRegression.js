"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const path_1 = __importDefault(require("path"));
const playwrightClient_1 = require("../browser/src/playwrightClient");
const ScreenReaderDriver_1 = require("../drivers/src/ScreenReaderDriver");
const Evaluator_1 = require("../evaluation/src/Evaluator");
const TEST_SITES_DIR = path_1.default.join(__dirname, '../test-sites');
const TEST_CASES = [
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
    const client = new playwrightClient_1.BrowserClient();
    await client.launch(true); // Headless
    let passed = 0;
    let failed = 0;
    for (const testCase of TEST_CASES) {
        console.log(`\nTesting ${testCase.file}...`);
        const url = `file://${path_1.default.join(TEST_SITES_DIR, testCase.file)}`;
        try {
            await client.goto(url);
            const driver = new ScreenReaderDriver_1.ScreenReaderDriver(client);
            await driver.enable();
            // Build a fake trace for the evaluator
            const trace = {
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
            // Evaluate
            const evaluator = new Evaluator_1.Evaluator();
            // We need the raw AXTree for static analysis, driver has flattened it but we can fetch again
            const axTree = await client.getFullAXTree();
            const violations = evaluator.evaluate(axTree, trace);
            // Assert
            const found = violations.find(v => v.ruleId === testCase.expectedRuleId);
            if (found) {
                console.log(`✅ Passed: Found expected violation ${testCase.expectedRuleId}`);
                passed++;
            }
            else {
                console.error(`❌ Failed: Did not find ${testCase.expectedRuleId}`);
                console.log('Violations found:', violations.map(v => v.ruleId));
                failed++;
            }
        }
        catch (e) {
            console.error(`❌ Error running ${testCase.file}:`, e);
            failed++;
        }
    }
    await client.close();
    console.log(`\nSummary: ${passed} Passed, ${failed} Failed.`);
    if (failed > 0)
        process.exit(1);
}
runRegression();
