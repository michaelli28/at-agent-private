import 'dotenv/config';
import { BrowserClient } from '../browser/src/playwrightClient';
import { ScreenReaderDriver } from '../virtual-screen-reader/src/ScreenReaderDriver';
import { Agent } from '../agent/src/Agent';
import { buildOpenAIModel } from '../agent/src/OpenAIClient';
import { buildGeminiModel } from '../agent/src/GeminiClient';
import { Reporter } from '../evaluation/src/Reporter';
import { Evaluator } from '../evaluation/src/Evaluator';
import { AXNode } from '../browser/src/types';

// --- Configuration ---

interface AgentTask {
  id: string;
  url: string;
  goal: string;
  provider?: 'openai' | 'gemini';
}

// EDIT THIS ARRAY TO ADD YOUR TASKS
const TASKS: AgentTask[] = [
  {
    id: 'task-1',
    url: 'https://news.ycombinator.com/show',
    goal: 'Click on "Show HN: KiDoom – Running DOOM on PCB Traces" post and get a summary of what it is about',
    provider: 'gemini'
  },
  {
    id: 'task-2',
    url: 'https://news.ycombinator.com/show',
    goal: 'Click on "Show HN: We built an open source, zero webhooks payment processor" post and get a summary of what it is about',
    provider: 'gemini'
  },
  {
    id: 'task-3',
    url: 'https://news.ycombinator.com/show',
    goal: 'Click on "Show HN: A WordPress plugin that rewrites image URLs for near-zero-cost delivery" post and get a summary of what it is about',
    provider: 'gemini'
  },
  {
    id: 'task-4',
    url: 'https://news.ycombinator.com/show',
    goal: 'Click on "Show HN: I built an interactive HN Simulator" post and get a summary of what it is about',
    provider: 'gemini'
  },
  {
    id: 'task-5',
    url: 'https://news.ycombinator.com/show',
    goal: 'Click on "Show HN: Parm – Install GitHub releases just like your favorite package manager" post and get a summary of what it is about',
    provider: 'gemini'
  },
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
    await client.launch(true); // Headless true for parallel to avoid popup chaos

    log(id, "🌐", "Navigating...");
    await client.goto(url);

    const driver = new ScreenReaderDriver(client, (msg) => log(id, "🔊", msg));
    const model = provider === 'gemini' ? buildGeminiModel() : buildOpenAIModel();

    const agent = new Agent(driver, model, undefined, (step) => {
      const thought = step.thought && step.thought.trim().length > 0
        ? step.thought
        : '(no thought)';
      // Truncate thought if too long for cleaner parallel logs
      const shortThought = thought.length > 100 ? thought.substring(0, 100) + '...' : thought;

      log(id, "🧠", `Thought: ${shortThought}`);
      log(id, "⚡", `Action: ${step.action.type} ${step.action.key || ''}`);
    });

    log(id, "🤖", "Running agent...");
    const trace = await agent.run(goal);

    log(id, "🏁", `Finished. Success: ${trace.success}`);

    // Evaluation
    log(id, "📊", "Evaluating...");
    const evaluator = new Evaluator();
    let axTree: AXNode[] = [];
    try {
      axTree = await client.getFullAXTree();
    } catch (e) {
      log(id, "⚠️", "Could not fetch AXTree for evaluation.");
    }
    const violations = evaluator.evaluate(axTree, trace);

    // We won't print the full markdown report to console as it would be huge and interleaved.
    // Instead, we'll summarize.
    const score = Math.max(0, 100 - (violations.length * 10)); // Simple scoring
    log(id, "📝", `Evaluation Score: ${score}/100. Violations: ${violations.length}`);

    if (violations.length > 0) {
      log(id, "❌", `Top violation: ${violations[0].reason}`);
    }

  } catch (error) {
    log(id, "💥", `Error: ${error}`);
  } finally {
    await client.close();
    log(id, "👋", "Closed.");
  }
}

async function main() {
  console.log(`${colors.bright}=== Running ${TASKS.length} Agent Tasks in Parallel ===${colors.reset}\n`);

  await Promise.all(TASKS.map(task => runTask(task)));

  console.log(`\n${colors.bright}=== All Tasks Completed ===${colors.reset}`);
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});