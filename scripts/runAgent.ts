import 'dotenv/config';
import { BrowserClient } from '../browser/src/playwrightClient';
import { ScreenReaderDriver } from '../drivers/src/ScreenReaderDriver';
import { Agent } from '../agent/src/Agent';
import { OpenAIClient } from '../agent/src/OpenAIClient';
import { Reporter } from '../evaluation/src/Reporter';
import { Evaluator } from '../evaluation/src/Evaluator';

async function main() {
  const url = process.argv[2];
  const goal = process.argv[3];

  if (!url || !goal) {
    console.error('Usage: pnpm start:agent <url> "<goal>" [provider]');
    process.exit(1);
  }

  const provider = process.argv[4] || 'openai'; // 'openai' or 'gemini'

  if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
    console.error('Error: OPENAI_API_KEY environment variable is required for OpenAI.');
    process.exit(1);
  }
  if (provider === 'gemini' && !process.env.GEMINI_API_KEY) {
    console.error('Error: GEMINI_API_KEY environment variable is required for Gemini.');
    process.exit(1);
  }

  console.log(`[Runner] Starting Agent on ${url}`);
  console.log(`[Runner] Goal: "${goal}"`);

  const client = new BrowserClient();
  await client.launch(false); // Visible browser

  try {
    await client.goto(url);

    const driver = new ScreenReaderDriver(client);

    let llm;
    if (provider === 'gemini') {
      const { GeminiClient } = await import('../agent/src/GeminiClient');
      llm = new GeminiClient();
    } else {
      llm = new OpenAIClient();
    }

    const agent = new Agent(driver, llm);

    // Run the agent loop
    const trace = await agent.run(goal);

    // Evaluate the session
    console.log('\n[Runner] Evaluating session...');
    const evaluator = new Evaluator();
    const axTree = await client.getFullAXTree();
    const violations = evaluator.evaluate(axTree, trace);

    // Generate Report
    const reporter = new Reporter();
    const markdown = reporter.toMarkdown(violations, trace);

    console.log('\n' + '='.repeat(50));
    console.log(markdown);
    console.log('='.repeat(50) + '\n');

  } catch (error) {
    console.error('[Runner] Error:', error);
  } finally {
    await client.close();
  }
}

main();
