import { BrowserClient } from '@adf/browser/playwrightClient';
import * as fs from 'fs';
import * as path from 'path';
import { spawn } from 'child_process';
import { OpenRouter } from '@openrouter/sdk';
import * as dotenv from 'dotenv';
import { jsonrepair } from 'jsonrepair';

dotenv.config();

async function compressVideo(inputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(path.dirname(inputPath), `compressed_${Date.now()}.mp4`);
    const args = [
      '-y',
      '-i', inputPath,
      '-vf', 'scale=640:-2',      // Downscale to 640px width
      '-r', '10',                 // 10 fps
      '-c:v', 'libx264',          // Ensure standard h264
      '-crf', '30',               // High compression
      outputPath
    ];

    const ffmpeg = spawn('ffmpeg', args);
    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`ffmpeg failed with code ${code}`));
    });
    ffmpeg.on('error', (err) => reject(err));
  });
}

interface MediaItem {
  url: string;
  type: 'video_tag' | 'audio_tag' | 'iframe_src' | 'frame_url';
  sourceFrame?: string;
}

async function main() {
  // Dynamic imports for styling
  const chalk = (await import('chalk')).default;
  const ora = (await import('ora')).default;
  const boxen = (await import('boxen')).default;

  const url = process.argv[2];
  if (!url) {
    console.error(chalk.red('Usage: npm run audit-media <url>'));
    process.exit(1);
  }

  const outputDir = path.join(process.cwd(), 'downloads');
  if (!fs.existsSync(outputDir)) {
    fs.mkdirSync(outputDir);
  }

  const browser = new BrowserClient();
  const spinner = ora('Initializing Media Audit...').start();

  // Final list of MediaItems
  const mediaToDownload = new Map<string, MediaItem>();

  try {
    // Launch with security disabled to allow cross-origin frame inspection
    await browser.launch(true, [
      '--disable-web-security',
      '--disable-features=IsolateOrigins,site-per-process'
    ]);

    const page = browser.getPage();
    if (!page) throw new Error("Page not initialized");

    spinner.text = `Navigating to ${chalk.blue(url)}...`;
    await page.goto(url, { waitUntil: 'domcontentloaded', timeout: 60000 });

    spinner.text = 'Waiting for hydration...';
    await page.waitForTimeout(2500);

    // Capture and format DOM
    spinner.text = 'Capturing DOM context...';
    let formattedDOM = '';
    try {
      const content = await page.content();
      formattedDOM = await (await import('prettier')).format(content, { parser: 'html' });
    } catch (e) {
      console.warn(chalk.yellow('Failed to capture/format DOM, proceeding without it.'));
    }

    // --- Deep DOM Scan ---
    spinner.text = 'Scanning DOM for active media elements...';

    const scanDOMContext = () => {
      const found: Array<{ url: string, type: 'video_tag' | 'audio_tag' | 'iframe_src' }> = [];

      const isVisible = (el: Element) => {
        const style = window.getComputedStyle(el);
        if (style.display === 'none' || style.visibility === 'hidden' || style.opacity === '0') return false;
        const rect = el.getBoundingClientRect();
        return rect.width > 0 && rect.height > 0;
      };

      const add = (src: string | undefined, type: 'video_tag' | 'audio_tag' | 'iframe_src') => {
        if (src && !src.startsWith('blob:') && src.length > 0) found.push({ url: src, type });
      };

      document.querySelectorAll('video').forEach((el: any) => {
        if (isVisible(el)) {
          add(el.currentSrc || el.src, 'video_tag');
          el.querySelectorAll('source').forEach((s: any) => add(s.src, 'video_tag'));
        }
      });

      document.querySelectorAll('audio').forEach((el: any) => {
        if (isVisible(el)) {
          add(el.currentSrc || el.src, 'audio_tag');
          el.querySelectorAll('source').forEach((s: any) => add(s.src, 'audio_tag'));
        }
      });

      document.querySelectorAll('iframe').forEach((el: any) => {
        if (isVisible(el)) {
          add(el.src, 'iframe_src');
        }
      });
      return found;
    };

    // 1. Scan Main Page
    const mainMedia = await page.evaluate(scanDOMContext);
    mainMedia.forEach(item => {
      if (!mediaToDownload.has(item.url)) mediaToDownload.set(item.url, { ...item });
    });

    // 2. Scan All Frames
    for (const frame of page.frames()) {
      try {
        if (frame.isDetached()) continue;

        const frameMedia = await frame.evaluate(scanDOMContext);
        frameMedia.forEach(item => {
          if (!mediaToDownload.has(item.url)) mediaToDownload.set(item.url, { ...item, sourceFrame: frame.url() });
        });

        const frameUrl = frame.url();
        if (frameUrl && (frameUrl.includes('embed') || frameUrl.includes('player') || frameUrl.includes('video'))) {
          if (!mediaToDownload.has(frameUrl)) {
            mediaToDownload.set(frameUrl, { url: frameUrl, type: 'frame_url' });
          }
        }
      } catch (e) {
        // Frame access error
      }
    }

    spinner.succeed(`Scan Complete. Found ${chalk.green(mediaToDownload.size)} active media sources.`);
    await browser.close();

    if (mediaToDownload.size === 0) {
      console.log(chalk.yellow('No active media found on page.'));
      return;
    }

    console.log(chalk.gray('\n--- Starting Downloader (yt-dlp) ---\n'));

    const sortedMedia = Array.from(mediaToDownload.values());

    // Initialize OpenRouter if API key is present
    const apiKey = process.env.OPENROUTER_API_KEY;
    let openRouter: OpenRouter | null = null;
    if (apiKey) {
      openRouter = new OpenRouter({
        apiKey,
        defaultHeaders: {
          'HTTP-Referer': 'http://localhost:3000',
          'X-Title': 'Media Scraper Script',
        },
      });
    } else {
      console.warn(chalk.yellow('OPENROUTER_API_KEY not set. Skipping LLM analysis.'));
    }

    for (const item of sortedMedia) {
      console.log(`Processing: ${chalk.cyan(item.url)}`);
      console.log(chalk.gray(`Type: ${item.type} ${item.sourceFrame ? `(from frame: ${item.sourceFrame})` : ''}`));

      // Record time before download to help identify new files
      const startTime = Date.now();

      try {
        await downloadWithYtDlp(item.url, outputDir, url);

        // --- LLM Analysis Step ---
        if (openRouter) {
          // Find the newest transcript file
          const files = fs.readdirSync(outputDir);
          const transcriptFiles = files.filter(f =>
            (f.endsWith('.vtt') || f.endsWith('.srt')) &&
            fs.statSync(path.join(outputDir, f)).mtimeMs > startTime
          );

          if (transcriptFiles.length > 0) {
            // Sort by modification time, newest first
            transcriptFiles.sort((a, b) => fs.statSync(path.join(outputDir, b)).mtimeMs - fs.statSync(path.join(outputDir, a)).mtimeMs);
            const transcriptFile = transcriptFiles[0];
            const transcriptPath = path.join(outputDir, transcriptFile);
            const transcriptContent = fs.readFileSync(transcriptPath, 'utf-8');

            console.log(chalk.blue(`\nFound transcript: ${transcriptFile}`));
            if (formattedDOM) {
              console.log(chalk.blue('Including Page DOM context.'));
            }

            // Robust Media File Discovery: Match by basename first
            let mediaFile: string | undefined;

            // Strip subtitle extensions to get the base name
            // Example: "Video Title [id].en.vtt" -> "Video Title [id]"
            const baseName = transcriptFile.replace(/\.(en|en-orig|[a-z]{2})\.(vtt|srt)$/, '').replace(/\.(vtt|srt)$/, '');

            const allFiles = fs.readdirSync(outputDir);
            const candidateFiles = allFiles.filter(f => {
              const ext = path.extname(f).toLowerCase();
              const isMedia = ['.mp4', '.webm', '.mkv', '.mov', '.avi', '.mp3', '.wav', '.m4a'].includes(ext);
              return isMedia && f.includes(baseName); // Loose match on basename
            });

            if (candidateFiles.length > 0) {
              mediaFile = candidateFiles[0]; // Best match
            } else {
              // Fallback: Any new media file
              const newMedia = allFiles.filter(f =>
                !f.endsWith('.vtt') && !f.endsWith('.srt') && !f.endsWith('.part') &&
                ['.mp4', '.webm', '.mkv', '.mov', '.avi', '.mp3', '.wav', '.m4a'].includes(path.extname(f).toLowerCase()) &&
                fs.statSync(path.join(outputDir, f)).mtimeMs > startTime // Keep strict time check for fallback
              );
              if (newMedia.length > 0) mediaFile = newMedia[0];
            }

            let mediaDataUrl: string | null = null;
            if (mediaFile) {
              const mediaPath = path.join(outputDir, mediaFile);

              try {
                const ext = path.extname(mediaFile).toLowerCase().replace('.', '');
                const mimeMap: Record<string, string> = {
                  'mp4': 'video/mp4', 'webm': 'video/webm', 'mkv': 'video/x-matroska', 'mov': 'video/quicktime', 'avi': 'video/x-msvideo',
                  'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'm4a': 'audio/mp4', 'aac': 'audio/aac', 'flac': 'audio/flac'
                };
                let mimeType = mimeMap[ext] || 'application/octet-stream';
                let processPath = mediaPath;

                // Compress if Video
                if (mimeType.startsWith('video/')) {
                  try {
                    console.log(chalk.yellow(`Compressing ${mediaFile} for analysis...`));
                    processPath = await compressVideo(mediaPath);
                    mimeType = 'video/mp4';
                  } catch (e: any) {
                    console.error(chalk.red('Compression failed, using original:'), e.message);
                  }
                }

                const fileBuffer = fs.readFileSync(processPath);
                const base64Data = fileBuffer.toString('base64');
                mediaDataUrl = `data:${mimeType};base64,${base64Data}`;

                console.log(chalk.blue(`Included media file: ${mediaFile} (Original: ${(fs.statSync(mediaPath).size / 1024 / 1024).toFixed(2)} MB)`));
                if (processPath !== mediaPath) {
                  console.log(chalk.green(`Compressed Size: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`));
                  fs.unlinkSync(processPath);
                }
              } catch (e: any) {
                console.warn(chalk.yellow(`Could not read media file: ${e.message}`));
              }
            }


            const targetModels = process.env.JUDGE_MODELS
              ? process.env.JUDGE_MODELS.split(',').map(m => m.trim())
              : [
                'google/gemini-3-pro-preview'
              ];

            const systemPromptPath = path.join(__dirname, 'prompts', 'media_summary_prompt.txt');
            const systemPrompt = fs.readFileSync(systemPromptPath, 'utf-8').trim();

            spinner.start(`Querying Judge (${targetModels[0]})...`);

            // Logging setup
            const logsDir = path.join(process.cwd(), 'logs');
            if (!fs.existsSync(logsDir)) {
              fs.mkdirSync(logsDir);
            }

            const getLogDate = () => new Date().toISOString().replace(/T/, '_').replace(/:/g, '-').split('.')[0];

            const logRequest = (stage: string, model: string, messages: any[]) => {
              const safeModel = model.replace(/[^a-z0-9]/gi, '-');
              const logFile = path.join(logsDir, `scrapeMedia_${stage}_${safeModel}_${getLogDate()}.json`);
              // Truncate base64 data for logs to keep them manageable
              const safeMessages = JSON.parse(JSON.stringify(messages));
              if (safeMessages[1]?.content) {
                safeMessages[1].content.forEach((part: any) => {
                  if (part.videoUrl?.url?.startsWith('data:')) part.videoUrl.url = part.videoUrl.url.substring(0, 100) + '...[truncated]';
                  if (part.inputAudio?.data) part.inputAudio.data = part.inputAudio.data.substring(0, 100) + '...[truncated]';
                });
              }
              fs.writeFileSync(logFile, JSON.stringify({ model, messages: safeMessages }, null, 2));
            };

            const promises = targetModels.map(async (model) => {
              try {
                const userContent: any[] = [];

                if (formattedDOM) {
                  userContent.push({ type: 'text', text: `Page DOM Context:\n${formattedDOM}\n\n` });
                }

                userContent.push({ type: 'text', text: `Transcript:\n${transcriptContent}` });

                if (mediaDataUrl) {
                  const isVideo = mediaDataUrl.startsWith('data:video/');
                  const isAudio = mediaDataUrl.startsWith('data:audio/');

                  if (isVideo) {
                    userContent.push({
                      type: 'video_url',
                      videoUrl: {
                        url: mediaDataUrl
                      }
                    });
                  } else if (isAudio) {
                    const matches = mediaDataUrl.match(/^data:audio\/([a-zA-Z0-9]+);base64,(.+)$/);
                    if (matches && matches.length === 3) {
                      let format = matches[1];
                      const base64Data = matches[2];
                      if (format === 'mpeg') format = 'mp3';

                      userContent.push({
                        type: 'input_audio',
                        inputAudio: {
                          data: base64Data,
                          format: format
                        }
                      });
                    }
                  }
                }

                const messages = [
                  { role: 'system', content: systemPrompt },
                  { role: 'user', content: userContent }
                ];

                logRequest('judge', model, messages);

                const result = await openRouter!.chat.send({
                  model: model,
                  messages: messages,
                  reasoning: {
                    effort: "low"
                  }
                });

                // Log Full Response
                const safeModel = model.replace(/[^a-z0-9]/gi, '-');
                const responseLogFile = path.join(logsDir, `scrapeMedia_response_${safeModel}_${getLogDate()}.json`);
                fs.writeFileSync(responseLogFile, JSON.stringify({ model, result }, null, 2));

                return { model, result };
              } catch (error) {
                return { model, error };
              }
            });
            const results = await Promise.all(promises);
            spinner.succeed('Analysis complete.');

            // Process single result
            const { model, result, error } = results[0];

            if (error) {
              console.log(chalk.red(`✖ ${model} failed:`), error);
            } else if (result?.choices?.[0]?.message?.content) {
              try {
                const content = result.choices[0].message.content;
                const finalJson = JSON.parse(jsonrepair(content));
                // Normalize violations to array
                const violations = Array.isArray(finalJson) ? finalJson : (finalJson.violations || []);

                console.log(boxen(chalk.bold('Media Accessibility Report'), {
                  padding: 1,
                  margin: 1,
                  borderStyle: 'double',
                  borderColor: 'cyan'
                }));

                if (violations.length > 0) {
                  violations.forEach((v: any, i: number) => {
                    console.log(chalk.bold.red(`Violation ${i + 1}:`));
                    const source = typeof v.source === 'string' ? v.source.trim() : JSON.stringify(v.source) || '(unknown)';
                    console.log(chalk.blue('Source:'), source);
                    console.log(chalk.yellow('Reason:'), v.reason || '(no reason provided)');
                    console.log(chalk.gray('---'));
                  });
                  console.log(chalk.red.bold(`\nTotal Violations: ${violations.length}`));
                } else {
                  console.log(chalk.green.bold('No violations found! Great job!'));
                }

                if (process.env.JSON_OUTPUT_PATH) {
                  // Ensure consistent output format { violations: [...] }
                  const outputData = { violations: violations };
                  fs.writeFileSync(process.env.JSON_OUTPUT_PATH, JSON.stringify(outputData, null, 2));
                }

              } catch (e: any) {
                throw new Error(`Failed to parse JSON: ${e.message}`);
              }
            } else {
              console.log(chalk.red(`✖ ${model} returned no content`));
            }
          }
        }


      } catch (e: any) {
        console.log(chalk.red(`Failed: ${e.message}`));
      }
      console.log(chalk.gray('---'));
    }

    console.log(chalk.green.bold(`\nAll tasks finished. Check the '${outputDir}' folder.`));

  } catch (error) {
    spinner.fail('Scrape failed');
    console.error(error);
  } finally {
    try { await browser.close(); } catch { }
  }
}

function downloadWithYtDlp(url: string, outputDir: string, referer: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const args = [
      '--no-warnings',
      '--referer', referer,
      '--write-subs',
      '--write-auto-subs',
      '--sub-lang', 'en,en.*,en-orig',
      '-P', outputDir,
      '-o', `%(title)s [%(id)s]_${Date.now()}.%(ext)s`,
      url
    ];

    const proc = spawn('yt-dlp', args);

    proc.stdout.on('data', (data) => {
      process.stdout.write(data);
    });

    proc.stderr.on('data', (data) => {
      process.stderr.write(data);
    });

    proc.on('close', (code) => {
      if (code === 0) {
        resolve();
      }
      else {
        reject(new Error(`yt-dlp exited with code ${code}`));
      }
    });

    proc.on('error', (err) => {
      reject(err);
    });
  });
}

main();
