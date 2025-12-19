import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { BrowserClient, ScreenReaderDriver } from '@adf/virtual-screen-reader';
import { Agent } from '@adf/agent/Agent';
import { buildOpenAIModel } from '@adf/agent/OpenAIClient';
import { buildGeminiModel } from '@adf/agent/GeminiClient';

// --- Configuration ---

interface AgentTask {
  id: string;
  url: string;
  goal: string;
  provider?: 'openai' | 'gemini';
}

// EDIT THIS ARRAY TO ADD YOUR TASKS
// Note: With VoiceOver, tasks should run sequentially, not in parallel
const TASKS: AgentTask[] = [
  {
    id: 'hacker',
    url: 'https://news.ycombinator.com/show',
    goal: 'Click on "Show HN: KiDoom – Running DOOM on PCB Traces" post and get a summary of what it is about',
    provider: 'openai',
  },
  {
    id: 'cmueats',
    url: 'https://cmueats.com',
    goal: 'Determine when Hunan Express closes on Wednesday.',
    provider: 'openai',
  }
];

// ---------------------

const colors = {
  reset: "\x1b[0m",
  bright: "\x1b[1m",
  dim: "\x1b[2m",
  green: "\x1b[32m",
  cyan: "\x1b[36m",
  yellow: "\x1b[33m",
  red: "\x1b[31m",
  blue: "\x1b[34m",
  magenta: "\x1b[35m",
};

// Generate a color for each task ID to make them distinct
const taskColors: Record<string, string> = {};
const availableColors = [colors.green, colors.cyan, colors.yellow, colors.blue, colors.magenta];

function getTaskColor(id: string): string {
  if (!taskColors[id]) {
    taskColors[id] = availableColors[Object.keys(taskColors).length % availableColors.length];
  }
  return taskColors[id];
}

function log(taskId: string, emoji: string, message: string) {
  const color = getTaskColor(taskId);
  console.log(`${color}[${taskId}]${colors.reset} ${emoji} ${message}`);
}

async function runTask(task: AgentTask) {
  const { id, url, goal, provider = 'openai' } = task;
  const client = new BrowserClient();

  try {
    log(id, "🚀", `Starting task: "${goal}" on ${url}`);
    await client.launch(false); // headed mode
    await client.goto(url);

    const driver = new ScreenReaderDriver(client, (msg) => log(id, "🔊", msg));
    await driver.enable();

    log(id, "🌐", "Page loaded...");

    const model = provider === 'gemini' ? buildGeminiModel() : buildOpenAIModel();

    const agent = new Agent(driver, model, (step) => {
      const thought = step.thought && step.thought.trim().length > 0
        ? step.thought
        : '(no thought)';
      // Truncate thought if too long for cleaner logs
      const shortThought = thought.length > 100 ? thought.substring(0, 100) + '...' : thought;

      log(id, "🧠", `Thought: ${shortThought}`);
      log(id, "⚡", `Action: ${step.action.type} ${step.action.key || ''}`);
    });

    log(id, "🤖", "Running agent...");
    const trace = await agent.run(goal);

    // Ensure transcripts directory exists
    const transcriptsDir = path.join(process.cwd(), 'transcripts');
    if (!fs.existsSync(transcriptsDir)) {
      fs.mkdirSync(transcriptsDir, { recursive: true });
    }

    // Save Transcript
    const transcriptPath = path.join(transcriptsDir, `${id}.json`);
    fs.writeFileSync(transcriptPath, JSON.stringify(trace, null, 2));
    log(id, "💾", `Transcript saved to ${transcriptPath}`);

    log(id, "🏁", `Finished. Success: ${trace.success}`);

    return { id, success: trace.success, steps: trace.steps.length, error: null };

  } catch (error) {
    log(id, "💥", `Error: ${error}`);
    return { id, success: false, steps: 0, error: String(error) };
  } finally {
    await client.close();
    log(id, "👋", "Closed.");
  }
}

async function main() {
  console.log(`${colors.bright}=== Running ${TASKS.length} Agent Tasks Sequentially ===${colors.reset}`);
  console.log(`${colors.yellow}Note: Tasks run sequentially (one at a time)${colors.reset}\n`);

  const results = [];
  for (const task of TASKS) {
    const result = await runTask(task);
    results.push(result);
  }

  console.log(`\n${colors.bright}=== All Tasks Completed ===${colors.reset}`);
  console.log(`\n${colors.bright}=== Final Summary ===${colors.reset}`);

  // Print header
  console.log(`${colors.dim}${'Task ID'.padEnd(15)} | ${'Success'.padEnd(10)} | ${'Steps'.padEnd(6)} | ${'Error'}${colors.reset}`);
  console.log(`${colors.dim}${'-'.repeat(60)}${colors.reset}`);

  // Print rows
  for (const res of results) {
    const successStr = res.success ? `${colors.green}true${colors.reset} ` : `${colors.red}false${colors.reset}`;
    const errStr = res.error ? `${colors.red}${res.error.substring(0, 30)}...${colors.reset}` : '';

    console.log(
      `${res.id.padEnd(15)} | ` +
      `${successStr.padEnd(19)} | ` +
      `${res.steps.toString().padEnd(6)} | ` +
      `${errStr}`
    );
  }
  console.log();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});
