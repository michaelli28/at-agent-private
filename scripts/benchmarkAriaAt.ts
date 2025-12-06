import 'dotenv/config';
import { BrowserClient } from '../virtual-screen-reader/src/playwrightClient';
import { ScreenReaderDriver } from '../virtual-screen-reader/src/ScreenReaderDriver';
import { Agent } from '../agent/src/Agent';
import { buildOpenAIModel } from '../agent/src/OpenAIClient';
import { buildGeminiModel } from '../agent/src/GeminiClient';

async function main() {
  const url = 'https://aria-at.w3.org/reports';
  const goal = 'Find the report for "JAWS" on "Chrome" and tell me how many tests passed.';
  const provider = process.env.LLM_PROVIDER || 'openai';

  console.log(`[Benchmark] Starting ARIA-AT Benchmark`);
  console.log(`[Benchmark] URL: ${url}`);
  console.log(`[Benchmark] Goal: "${goal}"`);
  console.log(`[Benchmark] Provider: ${provider}`);

  const client = new BrowserClient();
  await client.launch(false); // Visible for observation

  try {
    await client.goto(url);

    const driver = new ScreenReaderDriver(client);
    await driver.enable(); // Explicitly enable to inject script

    const model = provider === 'gemini' ? buildGeminiModel() : buildOpenAIModel();
    const agent = new Agent(driver, model);

    const startTime = Date.now();
    const trace = await agent.run(goal);
    const duration = (Date.now() - startTime) / 1000;

    console.log(`\n[Benchmark] Finished in ${duration}s`);

    // Simple success check based on the last step's thought or action
    const lastStep = trace.steps[trace.steps.length - 1];
    console.log(`[Benchmark] Last Step Observation: ${lastStep.observation}`);
    console.log(`[Benchmark] Last Step Thought: ${lastStep.thought}`);

    // In a real benchmark, we might parse the output to verify the specific number
    // For now, we rely on the agent's self-reported completion.

  } catch (error) {
    console.error('[Benchmark] Error:', error);
    process.exit(1);
  } finally {
    await client.close();
  }
}

main();
