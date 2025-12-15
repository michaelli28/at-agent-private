import 'dotenv/config';
import { BrowserClient, ScreenReaderDriver } from '@adf/virtual-screen-reader';
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
  await client.launch(false); // headed mode
  await client.goto(url);

  const driver = new ScreenReaderDriver(client);
  await driver.enable();

  try {

    const model = provider === 'gemini' ? buildGeminiModel() : buildOpenAIModel();
    const agent = new Agent(driver, model);

    const startTime = Date.now();
    const trace = await agent.run(goal);
    const duration = (Date.now() - startTime) / 1000;

    console.log(`\n[Benchmark] Finished in ${duration}s`);

    // Simple success check based on the last step's thought or action
    const lastStep = trace.steps[trace.steps.length - 1];
    if (lastStep) {
      console.log(`[Benchmark] Last Step Observation: ${lastStep.observation?.text || 'N/A'}`);
      console.log(`[Benchmark] Last Step Thought: ${lastStep.thought}`);
    }

    console.log(`[Benchmark] Success: ${trace.success}`);
    if (trace.reason) {
      console.log(`[Benchmark] Reason: ${trace.reason}`);
    }
    if (trace.error) {
      console.log(`[Benchmark] Error: ${trace.error}`);
    }

  } catch (error) {
    console.error('[Benchmark] Error:', error);
    process.exit(1);
  } finally {
    await driver.disable();
    await client.close();
  }
}

main();
