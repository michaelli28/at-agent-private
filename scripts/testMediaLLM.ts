import { OpenRouter } from '@openrouter/sdk';
import * as fs from 'fs';
import * as path from 'path';
import * as dotenv from 'dotenv';
import { spawn } from 'child_process';

dotenv.config();

async function compressVideo(inputPath: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const outputPath = path.join(path.dirname(inputPath), `compressed_${Date.now()}.mp4`);
    const args = [
      '-y',
      '-i', inputPath,
      '-t', '20',                 // Max 20 seconds
      '-vf', 'scale=640:-2',      // Downscale to 640px width
      '-r', '10',                 // 10 fps
      '-c:v', 'libx264',          // Ensure standard h264
      '-crf', '30',               // High compression
      outputPath
    ];

    console.log('Running ffmpeg compression...');
    const ffmpeg = spawn('ffmpeg', args);

    ffmpeg.on('close', (code) => {
      if (code === 0) resolve(outputPath);
      else reject(new Error(`ffmpeg failed with code ${code}`));
    });

    ffmpeg.on('error', (err) => reject(err));
  });
}

async function main() {
  const chalk = (await import('chalk')).default;
  const apiKey = process.env.OPENROUTER_API_KEY;

  if (!apiKey) {
    console.error(chalk.red('OPENROUTER_API_KEY not set.'));
    process.exit(1);
  }

  const openRouter = new OpenRouter({
    apiKey,
    defaultHeaders: {
      'HTTP-Referer': 'http://localhost:3000',
      'X-Title': 'Media Test Script',
    },
  });

  // Find the newest video/audio file in downloads
  const outputDir = path.join(process.cwd(), 'downloads');
  if (!fs.existsSync(outputDir)) {
    console.error(chalk.red('Downloads directory not found.'));
    process.exit(1);
  }

  const files = fs.readdirSync(outputDir);
  const mediaFiles = files.filter(f => {
    const ext = path.extname(f).toLowerCase();
    return ['.mp4', '.webm', '.mkv', '.mov', '.avi', '.mp3', '.wav', '.m4a'].includes(ext);
  });

  if (mediaFiles.length === 0) {
    console.error(chalk.red('No media files found in downloads.'));
    process.exit(1);
  }

  // Sort by newest
  mediaFiles.sort((a, b) => fs.statSync(path.join(outputDir, b)).mtimeMs - fs.statSync(path.join(outputDir, a)).mtimeMs);
  const mediaFile = mediaFiles[0];
  const mediaPath = path.join(outputDir, mediaFile);

  console.log(chalk.blue(`Testing with file: ${mediaFile}`));

  try {
    const ext = path.extname(mediaFile).toLowerCase().replace('.', '');
    let processPath = mediaPath;

    const mimeMap: Record<string, string> = {
      'mp4': 'video/mp4', 'webm': 'video/webm', 'mkv': 'video/x-matroska', 'mov': 'video/quicktime', 'avi': 'video/x-msvideo',
      'mp3': 'audio/mpeg', 'wav': 'audio/wav', 'm4a': 'audio/mp4', 'aac': 'audio/aac', 'flac': 'audio/flac'
    };
    let mimeType = mimeMap[ext] || 'application/octet-stream';

    // Compress if Video
    if (mimeType.startsWith('video/')) {
      try {
        console.log(chalk.yellow('Compressing video to reduce payload size...'));
        processPath = await compressVideo(mediaPath);
        mimeType = 'video/mp4'; // ffmpeg output is mp4
      } catch (e: any) {
        console.error(chalk.red('Compression failed, using original:'), e.message);
      }
    }

    const fileBuffer = fs.readFileSync(processPath);
    const base64Data = fileBuffer.toString('base64');
    const mediaDataUrl = `data:${mimeType};base64,${base64Data}`;

    console.log(chalk.gray(`File read. Original: ${fs.statSync(mediaPath).size / 1024 / 1024} MB`));
    if (processPath !== mediaPath) {
      console.log(chalk.green(`Compressed: ${(fileBuffer.length / 1024 / 1024).toFixed(2)} MB`));
      fs.unlinkSync(processPath); // Cleanup
    }

    const userContent: any[] = [
      { type: 'text', text: "What is this media file about? Please describe it in detail." }
    ];

    if (mimeType.startsWith('video/')) {
      console.log(chalk.yellow('Detected VIDEO. Sending as video_url...'));
      userContent.push({
        type: 'video_url',
        videoUrl: {
          url: mediaDataUrl
        }
      });
    } else if (mimeType.startsWith('audio/')) {
      console.log(chalk.yellow('Detected AUDIO. Sending as input_audio...'));
      userContent.push({
        type: 'input_audio',
        inputAudio: {
          data: base64Data,
          format: ext === 'mp3' ? 'mp3' : 'wav' // Simple mapping for test
        }
      });
    }

    const model = 'google/gemini-2.0-pro-exp-02-05';
    console.log(chalk.gray(`Sending to ${model}...`));

    const result = await openRouter.chat.send({
      model: model,
      messages: [
        { role: 'user', content: userContent }
      ]
    });

    if (result && result.choices && result.choices.length > 0) {
      console.log(chalk.green('\nResponse:'));
      console.log(result.choices[0].message.content);
    } else {
      console.log(chalk.red('No response content received.'));
    }

  } catch (error: any) {
    console.error(chalk.red('Error:'), error.message);
    if (error.response) {
      console.error('Status:', error.response.status);
      console.error('Headers:', JSON.stringify(error.response.headers, null, 2));
      console.error('Response data:', JSON.stringify(error.response.data, null, 2));
    }
    console.error(error.stack);
  }
}

main();
