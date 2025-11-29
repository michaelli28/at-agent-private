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

interface Scenario {
  id: string;
  name: string;
  systemPrompt: string;
  configure: (page: any, browserClient: BrowserClient) => Promise<string[]>; // Returns screenshots
}

async function main() {
  // Dynamic imports for ESM packages
  const chalk = (await import('chalk')).default;
  const ora = (await import('ora')).default;
  const boxen = (await import('boxen')).default;

  const url = process.argv[2];
  if (!url) {
    console.error(chalk.red('Usage: npm run audit-visual-regression <url>'));
    process.exit(1);
  }

  const browser = new BrowserClient();
  const spinner = ora('Initializing Visual Regression Audit...').start();

  try {
    spinner.text = 'Launching browser...';
    await browser.launch(true); // headless

    spinner.text = `Navigating to ${chalk.blue(url)}...`;
    await browser.goto(url);

    spinner.text = 'Getting base page content...';
    const page = browser.getPage();
    if (!page) {
      throw new Error('Page not available');
    }

    // Capture initial DOM once as requested
    const content = await page.content();
    spinner.text = 'Formatting DOM...';
    const formattedDOM = await prettier.format(content, { parser: 'html' });
    const enc = encoding_for_model("gpt-4o");
    const tokenCount = enc.encode(formattedDOM).length;
    enc.free();

    spinner.succeed(`Base DOM Retrieved (${tokenCount} tokens)`);

    // Define Scenarios
    const scenarios: Scenario[] = [
      {
        id: 'orientation',
        name: '1. Portrait & Landscape',
        systemPrompt: "Ensure content is viewable in both portrait and landscape orientations, unless a specific display orientation is essential (e.g. a bank check, a piano application, etc.)",
        configure: async (p, client) => {
          const shots: string[] = [];

          // Landscape
          await p.setViewportSize({ width: 1280, height: 800 });
          await p.waitForTimeout(500);
          shots.push(...(await takeScreenshots(p, 1280, 800)));

          // Portrait (Mobile-ish)
          await p.setViewportSize({ width: 375, height: 667 });
          await p.waitForTimeout(500);
          shots.push(...(await takeScreenshots(p, 375, 667)));

          return shots;
        }
      },
      {
        id: 'resize_text',
        name: '2. Resize Text (200%)',
        systemPrompt: "Ensure page preserves content and functionality even after resizing.",
        configure: async (p, client) => {
          await p.setViewportSize({ width: 1280, height: 800 });
          // Inject CSS
          await p.addStyleTag({ content: 'html { font-size: 200% !important; }' });
          await p.waitForTimeout(500);
          return await takeScreenshots(p, 1280, 800);
        }
      },
      {
        id: 'reflow',
        name: '3. Reflow (400% Zoom)',
        systemPrompt: "Ensure the page preserves content and functionality and that users don't have to scroll left and right on a vertical scrolling application and vice versa.",
        configure: async (p, client) => {
          // 1280 / 4 = 320px width
          await p.setViewportSize({ width: 320, height: 600 });
          await p.waitForTimeout(500);
          return await takeScreenshots(p, 320, 600);
        }
      },
      {
        id: 'text_spacing',
        name: '4. Text Spacing',
        systemPrompt: "Ensure no loss of content or functionality occurs after altering text spacing.",
        configure: async (p, client) => {
          await p.setViewportSize({ width: 1280, height: 800 });
          await p.addStyleTag({
            content: `
                * {
                    line-height: 1.5 !important;
                    letter-spacing: 0.12em !important;
                    word-spacing: 0.16em !important;
                }
                p {
                    margin-bottom: 2em !important;
                }
            `});
          await p.waitForTimeout(500);
          return await takeScreenshots(p, 1280, 800);
        }
      },
      {
        id: 'hover',
        name: '5. Content on Hover',
        systemPrompt: "Ensure that any content triggered by hovering (like a tooltip) stays visible while the mouse is over it and can be easily dismissed by the user.",
        configure: async (p, client) => {
          await p.setViewportSize({ width: 1280, height: 800 });
          // Standard screenshot
          return await takeScreenshots(p, 1280, 800);
        }
      }
    ];

    const apiKey = process.env.OPENROUTER_API_KEY;
    if (!apiKey) {
      console.warn(chalk.yellow('OPENROUTER_API_KEY not set. Skipping LLM forwarding.'));
      return;
    }

    const openRouter = new OpenRouter({
      apiKey,
      defaultHeaders: {
        'HTTP-Referer': 'http://localhost:3000',
        'X-Title': 'Visual Regression Script',
      },
    });

    const targetModels = process.env.JUDGE_MODELS
      ? process.env.JUDGE_MODELS.split(',').map(m => m.trim())
      : [
        'google/gemini-3-pro-preview',
        'openai/gpt-5.1',
        'anthropic/claude-sonnet-4.5'
      ];

    // Log setup
    const logsDir = path.join(process.cwd(), 'logs');
    if (!fs.existsSync(logsDir)) fs.mkdirSync(logsDir);
    const getLogDate = () => new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];
    const logRequest = (stage: string, model: string, scenario: string, messages: any[]) => {
      const safeModel = model.replace(/[^a-z0-9]/gi, '-');
      const logFile = path.join(logsDir, `visualReg_${scenario}_${stage}_${safeModel}_${getLogDate()}.json`);
      const logMessages = messages.map(m => ({
        ...m,
        content: Array.isArray(m.content)
          ? m.content.map((c: any) => c.type === 'image_url' ? { ...c, imageUrl: { url: '[BASE64_IMAGE_TRUNCATED]' } } : c)
          : m.content
      }));
      fs.writeFileSync(logFile, JSON.stringify({ model, scenario, messages: logMessages }, null, 2));
    };

    const allViolations: any[] = [];

    // Iterate Scenarios
    for (const scenario of scenarios) {
      console.log(boxen(chalk.bold(scenario.name), { padding: 1, borderStyle: 'round', borderColor: 'cyan' }));
      spinner.start('Configuring environment & Capturing screenshots...');

      // Reload page to reset state/styles between scenarios
      await browser.goto(url);

      const currentScreenshots = await scenario.configure(page, browser);
      spinner.succeed(`Captured ${currentScreenshots.length} screenshots.`);

      spinner.start(`Consulting Judges on: "${scenario.systemPrompt.substring(0, 50)}"...`);

      const fullSystemPrompt = scenario.systemPrompt;

      // Run Judges
      const promises = targetModels.map(async (model) => {
        try {
          const userContent: any[] = [{ type: "text", text: formattedDOM }];
          currentScreenshots.forEach(s => userContent.push({ type: "image_url", imageUrl: { url: s } }));

          const messages = [
            { role: 'system', content: fullSystemPrompt },
            { role: 'user', content: userContent }
          ];

          logRequest('judge', model, scenario.id, messages);

          const result = await openRouter.chat.send({
            model: model,
            messages: messages,
            reasoning: { effort: 'low' }
          });

          return { model, result };
        } catch (error) {
          return { model, error };
        }
      });

      const results = await Promise.all(promises);

      // Aggregate
      const validOutputs: any[] = [];
      results.forEach(({ model, result, error }) => {
        if (error) {
          console.log(chalk.red(`  ✖ ${model} failed`));
        } else if (result?.choices?.[0]?.message?.content) {
          try {
            const parsed = JSON.parse(jsonrepair(result.choices[0].message.content));
            validOutputs.push(parsed);
          } catch (e) {
            console.log(chalk.red(`  ✖ ${model} invalid JSON`));
          }
        }
      });

      if (validOutputs.length > 0) {
        spinner.text = 'Aggregating consensus...';
        // Simple aggregation prompt
        const aggPromptPath = path.join(__dirname, 'prompts', 'visual_regression_aggregation_prompt.txt');
        const aggPromptTemplate = fs.readFileSync(aggPromptPath, 'utf-8').trim();
        const aggPrompt = aggPromptTemplate.replace('{{SCENARIO_NAME}}', scenario.name);

        let aggInput = "";
        validOutputs.forEach((o, i) => aggInput += `Report ${i + 1}:
      ${JSON.stringify(o, null, 2)}
      
      `);
        const aggModel = process.env.AGGREGATOR_MODEL || 'openai/gpt-5.1';
        const aggMessages = [
          { role: 'system', content: aggPrompt },
          { role: 'user', content: aggInput }
        ];

        logRequest('aggregation', aggModel, scenario.id, aggMessages);

        const aggResult = await openRouter.chat.send({
          model: aggModel,
          messages: aggMessages,
          reasoning: {
            effort: "low"
          }
        });

        if (aggResult?.choices?.[0]?.message?.content) {
          try {
            const final = JSON.parse(jsonrepair(aggResult.choices[0].message.content));
            spinner.stop();

            if (final.violations && final.violations.length > 0) {
              console.log(chalk.red.bold(`  Found ${final.violations.length} Violations:`));
              final.violations.forEach((v: any) => {
                const source = v.source || '(unknown source)';
                const reason = v.reason || v.description || '(no reason provided)';
                console.log(chalk.yellow(`  - ${source}: ${reason}`));
              });
              allViolations.push(...final.violations.map((v: any) => ({ ...v, scenario: scenario.name })));
            } else {
              console.log(chalk.green.bold('  ✅ No violations reported.'));
            }

          } catch (e) {
            spinner.fail('Failed to parse aggregation');
            console.error(e);
          }
        } else {
          spinner.fail('Aggregation returned no content');
        }
      } else {
        spinner.fail('No valid judge outputs');
      }
      console.log(''); // newline
    }

    console.log(boxen(chalk.bold('Visual Regression Report'), {
      padding: 1,
      margin: 1,
      borderStyle: 'double',
      borderColor: 'cyan'
    }));

    if (allViolations.length > 0) {
      allViolations.forEach((v: any, i: number) => {
        console.log(chalk.bold.red(`Violation ${i + 1}:`));
        const source = v.source || '(unknown source)';
        // Include scenario in source for context
        console.log(chalk.blue('Source:'), `[${v.scenario}] ${source}`);
        console.log(chalk.yellow('Reason:'), v.reason || v.description || '(no reason provided)');
        console.log(chalk.gray('---'));
      });
      console.log(chalk.red.bold(`\nTotal Violations: ${allViolations.length}`));
    } else {
      console.log(chalk.green.bold('No regression violations found! Great job!'));
    }

    if (process.env.JSON_OUTPUT_PATH) {
      fs.writeFileSync(process.env.JSON_OUTPUT_PATH, JSON.stringify({ violations: allViolations }, null, 2));
    }

  } catch (error) {
    spinner.fail('Process failed');
    console.error(chalk.red(error));
    process.exit(1);
  } finally {
    await browser.close();
  }
}

// Screenshot Helper
async function takeScreenshots(page: any, viewportWidth: number, viewportHeight: number): Promise<string[]> {
  const { scrollHeight } = await page.evaluate(() => ({ scrollHeight: document.body.scrollHeight }));
  const screenshots: string[] = [];
  let currentY = 0;
  const overlap = 100;

  // Limit to max 3 screenshots per scenario to save tokens/time if page is huge
  const MAX_SCREENSHOTS = 3;

  while (currentY < scrollHeight && screenshots.length < MAX_SCREENSHOTS) {
    await page.evaluate((y: number) => window.scrollTo(0, y), currentY);
    await page.waitForTimeout(500);

    const screenshotBuffer = await page.screenshot({ fullPage: false, type: 'jpeg', quality: 50 });
    screenshots.push(`data:image/jpeg;base64,${screenshotBuffer.toString('base64')}`);

    if (currentY + viewportHeight >= scrollHeight) break;
    currentY += (viewportHeight - overlap);
  }
  return screenshots;
}

main();
