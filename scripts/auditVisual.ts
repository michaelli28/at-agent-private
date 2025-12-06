import { BrowserClient } from '@adf/browser/playwrightClient';
import * as prettier from 'prettier';
import { OpenRouter } from '@openrouter/sdk';
import * as dotenv from 'dotenv';
import { encoding_for_model } from 'tiktoken';
import * as fs from 'fs';
import * as path from 'path';
import { jsonrepair } from 'jsonrepair';

dotenv.config();

// Helper to shuffle array
function shuffleArray<T>(array: T[]): T[] {
  const newArray = [...array];
  for (let i = newArray.length - 1; i > 0; i--) {
    const j = Math.floor(Math.random() * (i + 1));
    [newArray[i], newArray[j]] = [newArray[j], newArray[i]];
  }
  return newArray;
}

async function main() {
  // Dynamic imports for ESM packages
  const chalk = (await import('chalk')).default;
  const ora = (await import('ora')).default;
  const boxen = (await import('boxen')).default;

  const url = process.argv[2];
  if (!url) {
    console.error(chalk.red('Usage: npm run get-visual <url>'));
    process.exit(1);
  }

  const browser = new BrowserClient();
  const spinner = ora('Initializing Visual Audit...').start();

  try {
    spinner.text = 'Launching browser...';
    await browser.launch(true); // headless

    spinner.text = `Navigating to ${chalk.blue(url)}...`;
    await browser.goto(url);

    spinner.text = 'Getting page content...';
    const page = browser.getPage();
    if (!page) {
      throw new Error('Page not available');
    }

    // Capture DOM *before* injecting heavy scripts like Axe
    const content = await page.content();

    spinner.text = 'Injecting axe-core for mathematical contrast analysis...';
    const axeCorePath = require.resolve('axe-core/axe.min.js');
    await page.addScriptTag({ path: axeCorePath });

    const axeResults = await page.evaluate(async () => {
      // @ts-ignore
      return await window.axe.run({
        runOnly: ['color-contrast'],
        resultTypes: ['violations', 'incomplete']
      });
    });

    // @ts-ignore
    const contrastViolations = axeResults.violations;

    spinner.text = 'Formatting content...';
    const formatted = await prettier.format(content, { parser: 'html' });

    spinner.text = 'Capturing screenshots...';

    // Set viewport size explicitly to ensure consistent screenshots
    const viewportWidth = 1280;
    const viewportHeight = 800;
    await page.setViewportSize({ width: viewportWidth, height: viewportHeight });

    const { scrollHeight } = await page.evaluate(() => {
      return { scrollHeight: document.body.scrollHeight };
    });

    const screenshots: string[] = [];
    let currentY = 0;
    const overlap = 100; // Overlap in pixels to ensure context isn't lost

    while (currentY < scrollHeight) {
      await page.evaluate((y) => window.scrollTo(0, y), currentY);
      // Wait a bit for any lazy-loading or animations to settle
      await page.waitForTimeout(500);

      const screenshotBuffer = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 50 });
      const screenshotBase64 = screenshotBuffer.toString('base64');
      screenshots.push(`data:image/jpeg;base64,${screenshotBase64}`);

      // If we are at the bottom, break
      if (currentY + viewportHeight >= scrollHeight) break;

      currentY += (viewportHeight - overlap);
    }

    const enc = encoding_for_model("gpt-4o");
    const tokenCount = enc.encode(formatted).length;
    enc.free();

    spinner.succeed(`DOM, Axe Analysis & ${screenshots.length} Screenshots Retrieved`);
    console.log(chalk.gray(`DOM Length: ${formatted.length} chars | ${tokenCount} tokens`));
    console.log(chalk.gray(`Axe Violations Found: ${contrastViolations.length}`));
    console.log(chalk.gray(`Screenshots: ${screenshots.length}`));

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.warn(chalk.yellow('OPENROUTER_API_KEY not set. Skipping LLM forwarding.'));
      return;
    }

    spinner.start('Initializing LLM Agents...');
    const openRouter = new OpenRouter({
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Visual Audit Script',
      },
    });

    const targetModels = process.env.JUDGE_MODELS
      ? process.env.JUDGE_MODELS.split(',').map(m => m.trim())
      : [
        'google/gemini-3-pro-preview',
        'openai/gpt-5.1',
        'anthropic/claude-sonnet-4.5'
      ];

    const systemPromptPath = path.join(__dirname, 'prompts', 'visual_summary_prompt.txt');
    const systemPrompt = fs.readFileSync(systemPromptPath, 'utf-8').trim();

    // Augment system prompt with Axe instructions
    const augmentedSystemPrompt = `${systemPrompt}

<axe_context>
The following is a list of mathematically detected contrast violations found by axe-core. 
Use this as a strong signal, but verify it visually. Axe can sometimes flag false positives (e.g. hidden elements) or miss things (e.g. text in images).
If you see a violation here, verify if it is actually visible and problematic in the screenshots.
${JSON.stringify(contrastViolations, null, 2)}
</axe_context>
`;

    spinner.text = `Querying ${targetModels.length} Judges (${targetModels.map(m => m.split('/')[1]).join(', ')})...`;

    // Logging setup
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) {
      fs.mkdirSync(logsDir);
    }

    const getLogDate = () => new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];

    const logRequest = (stage: string, model: string, messages: any[]) => {
      const safeModel = model.replace(/[^a-z0-9]/gi, '-');
      const logFile = path.join(logsDir, `getVisual_${stage}_${safeModel}_${getLogDate()}.json`);
      // Don't log the massive image string to save disk space/readability, maybe truncate it for log
      const logMessages = messages.map(m => ({
        ...m,
        content: Array.isArray(m.content)
          ? m.content.map((c: any) => c.type === 'image_url' ? { ...c, imageUrl: { url: '[BASE64_IMAGE_TRUNCATED]' } } : c)
          : m.content
      }));
      fs.writeFileSync(logFile, JSON.stringify({ model, messages: logMessages }, null, 2));
    };

    const promises = targetModels.map(async (model) => {
      try {
        const userContent: any[] = [
          { type: "text", text: formatted }
        ];

        screenshots.forEach(s => {
          userContent.push({ type: "image_url", imageUrl: { url: s } });
        });

        const messages: any[] = [
          {
            role: 'system',
            content: augmentedSystemPrompt
          },
          {
            role: 'user',
            content: userContent
          }
        ];

        logRequest('judge', model, messages);

        const result = await openRouter.chat.send({
          model: model,
          messages: messages,
          reasoning: {
            effort: 'low',
          },
        });

        // Log Full Response
        const safeModel = model.replace(/[^a-z0-9]/gi, '-');
        const responseLogFile = path.join(logsDir, `getVisual_response_${safeModel}_${getLogDate()}.json`);
        fs.writeFileSync(responseLogFile, JSON.stringify({ model, result }, null, 2));

        return { model, result };
      } catch (error) {
        return { model, error };
      }
    });

    const results = await Promise.all(promises);
    spinner.succeed('Judges have spoken.');

    const validOutputs: any[] = [];

    results.forEach(({ model, result, error }) => {
      if (error) {
        console.log(chalk.red(`✖ ${model} failed:`), error);
        return;
      }

      if (result && result.choices && result.choices.length > 0) {
        const content = result.choices[0].message.content;
        if (content) {
          try {
            const parsed = JSON.parse(jsonrepair(content));
            validOutputs.push(parsed);
          } catch (e) {
            console.log(chalk.red(`✖ ${model} produced invalid JSON`));
          }
        }
      } else {
        console.log(chalk.red(`✖ ${model} returned no content`));
      }
    });

    if (validOutputs.length > 0) {
      spinner.start('Aggregating consensus...');

      const shuffledOutputs = shuffleArray(validOutputs);
      let aggregationInput = "";
      shuffledOutputs.forEach((output, index) => {
        aggregationInput += `Judge ${index + 1}:
${JSON.stringify(output, null, 2)}

`;
      });

      const aggPromptPath = path.join(__dirname, 'prompts', 'visual_aggregation_prompt.txt');
      const aggSystemPrompt = fs.readFileSync(aggPromptPath, 'utf-8').trim();

      try {
        const aggModel = process.env.AGGREGATOR_MODEL || 'openai/gpt-5.1';
        const aggMessages = [
          {
            role: 'system',
            content: aggSystemPrompt
          },
          {
            role: 'user',
            content: aggregationInput
          }
        ];

        logRequest('aggregation', aggModel, aggMessages);

        const aggResult = await openRouter.chat.send({
          model: aggModel, // Using a real model for aggregation
          messages: aggMessages,
          reasoning: {
            effort: 'low',
          },
        });

        const aggLogFile = path.join(logsDir, `getVisual_aggregation_response_${getLogDate()}.json`);
        fs.writeFileSync(aggLogFile, JSON.stringify({ model: aggModel, result: aggResult }, null, 2));

        spinner.succeed('Aggregation complete.');

        if (aggResult && aggResult.choices && aggResult.choices.length > 0) {
          const content = aggResult.choices[0].message.content;
          if (content) {
            const finalJson = JSON.parse(jsonrepair(content));

            console.log(boxen(chalk.bold('Visual Accessibility Report'), {
              padding: 1,
              margin: 1,
              borderStyle: 'double',
              borderColor: 'magenta'
            }));

            if (finalJson.violations && finalJson.violations.length > 0) {
              finalJson.violations.forEach((v: any, i: number) => {
                console.log(chalk.bold.red(`Violation ${i + 1}:`));
                const source = typeof v.source === 'string' ? v.source.trim() : JSON.stringify(v.source) || '(unknown)';
                console.log(chalk.blue('Source:'), source);
                console.log(chalk.yellow('Reason:'), v.reason || '(no reason provided)');
                console.log(chalk.gray('---'));
              });
              console.log(chalk.red.bold(`
Total Violations: ${finalJson.violations.length}`));
            } else {
              console.log(chalk.green.bold('No visual violations found! Great job!'));
            }

            if (process.env.JSON_OUTPUT_PATH) {
              fs.writeFileSync(process.env.JSON_OUTPUT_PATH, JSON.stringify(finalJson, null, 2));
            }
          }
        } else {
          console.error(chalk.red("No response from aggregation model."));
        }

      } catch (aggError) {
        spinner.fail('Aggregation failed');
        console.error(aggError);
      }
    } else {
      spinner.fail('No valid outputs from judges to aggregate.');
    }

  } catch (error) {
    spinner.fail('Process failed');
    console.error(chalk.red(error));
    process.exit(1);
  } finally {
    await browser.close();
  }
}

main();
