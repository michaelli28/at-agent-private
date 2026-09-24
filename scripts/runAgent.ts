import 'dotenv/config';
import { BrowserClient } from '../browser/src/playwrightClient';
import { ScreenReaderDriver } from '../drivers/src/ScreenReaderDriver';
import { Agent } from '../agent/src/Agent';
import { buildOpenAIModel } from '../agent/src/OpenAIClient';
import { buildGeminiModel } from '../agent/src/GeminiClient';
import { Reporter } from '../evaluation/src/Reporter';
import { Evaluator } from '../evaluation/src/Evaluator';
import { PageMetadata } from '../evaluation/src/types';
import { AXNode } from '../browser/src/types';

// Simple ANSI color codes for cleaner output
const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
};

function logStep(emoji: string, message: string) {
  console.log(`${emoji} ${colors.bright}${message}${colors.reset}`);
}

function logInfo(key: string, value: string) {
  console.log(`   ${colors.dim}${key}:${colors.reset} ${colors.cyan}${value}${colors.reset}`);
}

async function main() {
  const args = getCliArgs();
  const url = args[0];
  const goal = args[1];
  const provider = args.find((arg, idx) => idx === 2 && !arg.startsWith('--')) || 'openai';
  const captureScreenshots = args.includes('--with-screenshots') || process.env.npm_config_with_screenshots === 'true';

  if (!url || !goal) {
    console.error('Usage: pnpm start:agent <url> "<goal>" [provider] [--with-screenshots]');
    process.exit(1);
  }

  // Clear screen for a fresh start
  console.clear();
  console.log(`${colors.bright}${colors.green}=== Accessibility Agent CLI ===${colors.reset}\n`);

  logInfo("Target URL", url);
  logInfo("Goal", goal);
  logInfo("Model Provider", provider);
  logInfo("Screenshots", captureScreenshots ? "Enabled" : "Disabled");
  console.log(); // Spacer

  const client = new BrowserClient();

  logStep("🚀", "Launching Browser...");
  await client.launch(false);

  try {
    logStep("🌐", "Navigating to page...");
    await client.goto(url);

    const driver = new ScreenReaderDriver(client);

    const model = provider === 'gemini'
      ? buildGeminiModel()
      : buildOpenAIModel();

    const screenshotFn = captureScreenshots
      ? async () => {
        const buffer = await client.screenshot();
        return buffer.toString('base64');
      }
      : undefined;

    const agent = new Agent(driver, model, screenshotFn, (step) => {
      const thought = step.thought && step.thought.trim().length > 0
        ? step.thought
        : '(no model thought returned)';

      console.log(`\n${colors.bright}${colors.cyan}━━━ Step ${step.stepNumber} ━━━${colors.reset}`);
      logStep("🧠", `Thought: ${thought}`);
      logStep("⚡", `Action: ${step.action.type} ${step.action.key || ''}`);

      // Show screen reader output
      if (step.observation && step.observation.text) {
        const observationPreview = step.observation.text.length > 200
          ? step.observation.text.substring(0, 200) + '...'
          : step.observation.text;
        logStep("👂", `Screen Reader: "${observationPreview}"`);
      }

      // Show result status
      if (step.result) {
        const status = step.result.success ? `${colors.green}✓${colors.reset}` : `${colors.red}✗${colors.reset}`;
        console.log(`   ${colors.dim}Status: ${status} ${step.result.message || ''}${colors.reset}`);
      }

      // Show if finish_run was called
      if (step.action.type === 'FINISH') {
        console.log(`\n${colors.bright}${colors.yellow}🏁 Agent called finish_run:${colors.reset}`);
        console.log(`   ${colors.yellow}Success: ${step.result?.success}${colors.reset}`);
        console.log(`   ${colors.yellow}Reason: ${step.result?.message || 'No reason provided'}${colors.reset}`);
      }
    });

    logStep("🤖", "Starting Agent Execution...");
    console.log(`${colors.dim}   (Press Ctrl+C to interrupt)\n${colors.reset}`);

    // Run the agent loop
    const trace = await agent.run(goal);
    console.log(); // Spacer

    logStep("🏁", "Agent execution finished.");
    console.log(`${colors.dim}   Total steps: ${trace.steps.length}${colors.reset}`);
    console.log(`${colors.dim}   Success: ${trace.success ? colors.green + 'Yes' : colors.red + 'No'}${colors.reset}`);
    if (trace.error) {
      console.log(`${colors.red}   Error: ${trace.error}${colors.reset}`);
    }

    // Evaluation
    console.log("📊 Evaluating...");
    const evaluator = new Evaluator();
    let axTree: AXNode[] = [];
    let metadata: PageMetadata = { title: '', lang: '', duplicateIds: [] };

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

    // Generate Report
    const reporter = new Reporter();
    const markdown = reporter.toMarkdown(violations, trace);

    console.log('\n' + colors.dim + '='.repeat(60) + colors.reset);
    console.log(markdown);
    console.log(colors.dim + '='.repeat(60) + colors.reset + '\n');

    // Section 2 Evaluation
    const section2Results = evaluator.evaluateSection2(axTree, trace, metadata);

    console.log(colors.bright + colors.cyan + '=== WCAG 2.2 Section 2 (Operable) Evaluation ===' + colors.reset);
    section2Results.forEach(result => {
      const icon = result.status === 'pass' ? '✅' : result.status === 'fail' ? '❌' : '⚠️';
      const color = result.status === 'pass' ? colors.green : result.status === 'fail' ? colors.red : colors.yellow;
      console.log(`${icon} ${color}[${result.successCriterion}] ${result.status.toUpperCase()}${colors.reset}: ${result.evidence.reason}`);
      if (result.status === 'fail' && result.evidence.domNodes) {
        result.evidence.domNodes.forEach(node => console.log(`      - ${node}`));
      }
      if (result.status === 'fail' && result.evidence.traceEvents) {
        result.evidence.traceEvents.forEach(event => console.log(`      - ${event}`));
      }
    });
    console.log('\n' + colors.dim + '='.repeat(60) + colors.reset + '\n');

  } catch (error) {
    console.error(`\n${colors.red}❌ Fatal Error:${colors.reset}`, error);
  } finally {
    await client.close();
    logStep("👋", "Browser closed.");
  }
}

function getCliArgs(): string[] {
  const envArgs = process.env.npm_config_argv;
  if (envArgs) {
    try {
      const parsed = JSON.parse(envArgs);
      if (Array.isArray(parsed.raw)) {
        return parsed.raw.slice(2);
      }
    } catch {
      // fall through
    }
  }
  return process.argv.slice(2);
}

main().catch(err => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, err);
  process.exit(1);
});
