import 'dotenv/config';
import * as fs from 'fs';
import * as path from 'path';
import { BrowserClient } from '../browser/src/playwrightClient';
import { ScreenReaderDriver } from '../drivers/src/ScreenReaderDriver';
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
    provider: 'openai'
  },
  {
    id: 'task-2',
    url: 'https://news.ycombinator.com/show',
    goal: 'Click on "Show HN: We built an open source, zero webhooks payment processor" post and get a summary of what it is about',
    provider: 'openai'
  },
  {
    id: 'task-3',
    url: 'https://news.ycombinator.com/show',
    goal: 'Click on "Show HN: A WordPress plugin that rewrites image URLs for near-zero-cost delivery" post and get a summary of what it is about',
    provider: 'openai'
  },
  {
    id: 'task-4',
    url: 'https://news.ycombinator.com/show',
    goal: 'Click on "Show HN: I built an interactive HN Simulator" post and get a summary of what it is about',
    provider: 'openai'
  },
  {
    id: 'task-5',
    url: 'https://news.ycombinator.com/show',
    goal: 'Click on "Show HN: Parm – Install GitHub releases just like your favorite package manager" post and get a summary of what it is about',
    provider: 'openai'
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
    await client.launch(false); // Headless false to show browser

    log(id, "🌐", "Navigating...");
    await client.goto(url);

    const driver = new ScreenReaderDriver(client, (msg) => log(id, "🔊", msg));
    const model = provider === 'gemini' ? buildGeminiModel() : buildOpenAIModel();

    const agent = new Agent(driver, model, undefined, (step) => {
      const thought = step.thought && step.thought.trim().length > 0
        ? step.thought
        : '(no thought)';
      // Truncate thought if too long for cleaner parallel logs
      log(id, "🧠", `Thought: ${thought}`);
      log(id, "⚡", `Action: ${step.action.type} ${step.action.key || ''}`);
    });

    log(id, "🤖", "Running agent...");
    const trace = await agent.run(goal);

    // Save Transcript
    const transcriptPath = path.join(process.cwd(), 'transcripts', `${id}.json`);
    fs.mkdirSync(path.dirname(transcriptPath), { recursive: true });
    fs.writeFileSync(transcriptPath, JSON.stringify(trace, null, 2));
    log(id, "💾", `Transcript saved to ${transcriptPath}`);

    log(id, "🏁", `Finished. Success: ${trace.success}`);

    // Evaluation
    log(id, "📊", "Evaluating...");
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
      log(id, "⚠️", "Could not fetch AXTree or metadata for evaluation.");
    }
    const violations = evaluator.evaluate(axTree, trace, metadata);

    // We won't print the full markdown report to console as it would be huge and interleaved.
    // Instead, we'll summarize.
    const score = Math.max(0, 100 - (violations.length * 10)); // Simple scoring
    log(id, "📝", `Evaluation Score: ${score}/100. Violations: ${violations.length}`);

    if (violations.length > 0) {
      log(id, "❌", `Top violation: ${violations[0].reason}`);
    }

    return { id, success: trace.success, score, violations: violations.length, error: null };

  } catch (error) {
    log(id, "💥", `Error: ${error}`);
    return { id, success: false, score: 0, violations: 0, error: String(error) };
  } finally {
    await client.close();
    log(id, "👋", "Closed.");
  }
}

async function main() {
  console.log(`${colors.bright}=== Running ${TASKS.length} Agent Tasks in Parallel ===${colors.reset}\n`);

  const results = await Promise.all(TASKS.map(task => runTask(task)));

  console.log(`\n${colors.bright}=== All Tasks Completed ===${colors.reset}`);
  console.log(`\n${colors.bright}=== Final Summary ===${colors.reset}`);

  // Print header
  console.log(`${colors.dim}${'Task ID'.padEnd(15)} | ${'Success'.padEnd(10)} | ${'Score'.padEnd(6)} | ${'Violations'.padEnd(12)} | ${'Error'}${colors.reset}`);
  console.log(`${colors.dim}${'-'.repeat(15 + 3 + 10 + 3 + 6 + 3 + 12 + 3 + 20)}${colors.reset}`);

  // Print rows
  for (const res of results) {
    const successStr = res.success ? `${colors.green}true${colors.reset} ` : `${colors.red}false${colors.reset}`;
    const scoreStr = res.score.toString();
    const errStr = res.error ? `${colors.red}${res.error.substring(0, 30)}...${colors.reset}` : '';

    console.log(
      `${res.id.padEnd(15)} | ` +
      `${successStr.padEnd(19)} | ` + // padded with extra for color codes
      `${scoreStr.padEnd(6)} | ` +
      `${res.violations.toString().padEnd(12)} | ` +
      `${errStr}`
    );
  }
  console.log();
}

main().catch(err => {
  console.error(err);
  process.exit(1);
});