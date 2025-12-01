import express from 'express';
import { WebSocketServer } from 'ws';
import http from 'http';
import path from 'path';
import { BrowserClient } from '@adf/browser/playwrightClient';
import { ScreenReaderDriver } from '@adf/drivers';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = 3000;
const TARGET_URL = process.argv[2] || 'https://example.com';

app.use(express.static(path.join(__dirname, 'public')));

// Global state
let client: BrowserClient | null = null;
let driver: ScreenReaderDriver | null = null;

async function startSimulation(ws: any) {
  try {
    if (!client) {
      ws.send(JSON.stringify({ type: 'log', message: `Launching browser for ${TARGET_URL}...` }));
      client = new BrowserClient();
      await client.launch(false);
      await client.goto(TARGET_URL);

      driver = new ScreenReaderDriver(client);
      await driver.enable();
      ws.send(JSON.stringify({ type: 'log', message: 'Browser ready. Starting loop...' }));
    }

    // Simple loop: Move down every 2 seconds
    const interval = setInterval(async () => {
      if (!driver) return;

      try {
        const result = await driver.performAction({ type: 'KEY_PRESS', key: 'ArrowDown' });
        if (result.success) {
          ws.send(JSON.stringify({ type: 'snapshot', payload: result.snapshot }));
        }
      } catch (e) {
        console.error(e);
        clearInterval(interval);
      }
    }, 2000);

    ws.on('close', () => {
      clearInterval(interval);
    });

  } catch (error: any) {
    ws.send(JSON.stringify({ type: 'log', message: `Error: ${error.message}` }));
  }
}

wss.on('connection', (ws) => {
  console.log('Client connected');
  startSimulation(ws);
});

server.listen(PORT, () => {
  console.log(`UI Server running at http://localhost:${PORT}`);
  console.log(`Targeting: ${TARGET_URL}`);
});
