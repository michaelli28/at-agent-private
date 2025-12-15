import 'dotenv/config';
import { BrowserClient, ScreenReaderDriver } from '@adf/virtual-screen-reader';
import { AgentOpenrouter } from '../agent/src/AgentOpenrouter';
import { AgentStep } from '../agent/src/types';

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
  const model = args[2] || 'google/gemini-3-pro'; // Allow model override via args

  if (!url || !goal) {
    console.error('Usage: npx ts-node scripts/runAgentOpenrouter.ts <url> "<goal>" [model]');
    process.exit(1);
  }

  // Clear screen for a fresh start
  console.clear();
  console.log(`${colors.bright}${colors.green}=== Accessibility Agent OpenRouter CLI ===${colors.reset}\n`);

  logInfo("Target URL", url);
  logInfo("Goal", goal);
  logInfo("Model", model);
  console.log(); // Spacer

  const client = new BrowserClient();
  await client.launch(false); // headed mode

  logStep("🚀", "Launching Browser...");
  await client.goto(url);

  const driver = new ScreenReaderDriver(client);
  await driver.enable();

  try {
    logStep("🌐", "Page loaded...");

    // Instantiate AgentOpenrouter
    const agent = new AgentOpenrouter({
      driver,
      onStep: (step: AgentStep) => {
        const thought = step.thought && step.thought.trim().length > 0
          ? step.thought
          : '(no model thought returned)';
        logStep("🧠", `Thought: ${thought}`);
        logStep("⚡", `Action: ${step.action.type} ${step.action.key || ''}`);
      },
      model
    });

    logStep("🤖", "Starting Agent Execution...");
    console.log(`${colors.dim}   (Press Ctrl+C to interrupt)\n${colors.reset}`);

    // Run the agent loop
    const trace = await agent.run(goal);
    console.log(); // Spacer

    logStep("🏁", "Agent execution finished.");

    // Print result summary
    if (trace.success) {
      console.log(`\n${colors.green}✓ Task completed successfully${colors.reset}`);
      if (trace.reason) {
        console.log(`   ${colors.dim}Reason: ${trace.reason}${colors.reset}`);
      }
    } else {
      console.log(`\n${colors.red}✗ Task failed${colors.reset}`);
      if (trace.error) {
        console.log(`   ${colors.dim}Error: ${trace.error}${colors.reset}`);
      }
    }
    console.log(`   ${colors.dim}Total steps: ${trace.steps.length}${colors.reset}`);

  } catch (error) {
    console.error(`\n${colors.red}❌ Fatal Error:${colors.reset}`, error);
  } finally {
    await driver.disable();
    await client.close();
    logStep("👋", "Browser closed.");
  }
}

function getCliArgs(): string[] {
  // When running with npx ts-node, the args are just the process.argv starting from index 2
  return process.argv.slice(2);
}

main().catch(err => {
  console.error(`${colors.red}Fatal error:${colors.reset}`, err);
  process.exit(1);
});
