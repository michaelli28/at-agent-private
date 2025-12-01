import 'dotenv/config';
import express from 'express';
import { WebSocketServer, WebSocket } from 'ws';
import http from 'http';
import path from 'path';
import { BrowserClient } from '../virtual-screen-reader/src/playwrightClient';
import { ScreenReaderDriver } from '../virtual-screen-reader/src/ScreenReaderDriver';
import { Agent } from '../agent/src/Agent';
import { buildOpenAIModel } from '../agent/src/OpenAIClient';
import { buildGeminiModel } from '../agent/src/GeminiClient';
import { AgentStep, AgentTrace } from '../agent/src/types';

const app = express();
const server = http.createServer(app);
const wss = new WebSocketServer({ server });

const PORT = process.env.PORT || 3000;

// Docker browser configuration
const DOCKER_CDP_ENDPOINT = process.env.DOCKER_CDP_ENDPOINT || 'http://localhost:9222';
const NOVNC_URL = process.env.NOVNC_URL || 'http://localhost:6080/vnc.html';
const USE_DOCKER_BROWSER = process.env.USE_DOCKER_BROWSER === 'true';

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// Track active agent sessions
interface AgentSession {
  client: BrowserClient | null;
  driver: ScreenReaderDriver | null;
  abortController: AbortController | null;
  isRunning: boolean;
}

const sessions = new Map<WebSocket, AgentSession>();

// Send message helper
function send(ws: WebSocket, data: object) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(data));
  }
}

// Handle WebSocket connections
wss.on('connection', (ws) => {
  console.log('Client connected');

  // Initialize session
  sessions.set(ws, {
    client: null,
    driver: null,
    abortController: null,
    isRunning: false
  });

  ws.on('message', async (message) => {
    try {
      const data = JSON.parse(message.toString());
      await handleMessage(ws, data);
    } catch (error: any) {
      console.error('Error handling message:', error);
      send(ws, { type: 'error', message: error.message || 'Unknown error' });
    }
  });

  ws.on('close', async () => {
    console.log('Client disconnected');
    await cleanupSession(ws);
    sessions.delete(ws);
  });

  ws.on('error', (error) => {
    console.error('WebSocket error:', error);
  });
});

// Handle incoming messages
async function handleMessage(ws: WebSocket, data: any) {
  const session = sessions.get(ws);
  if (!session) return;

  switch (data.type) {
    case 'run':
      await runAgent(ws, session, data);
      break;
    case 'stop':
      await stopAgent(ws, session);
      break;
    default:
      send(ws, { type: 'error', message: `Unknown command: ${data.type}` });
  }
}

// Helper to capture and send screenshot (fallback)
async function sendScreenshot(ws: WebSocket, client: BrowserClient) {
  try {
    const buffer = await client.screenshot();
    const base64 = buffer.toString('base64');
    const currentUrl = await client.getCurrentUrl();
    send(ws, { type: 'screenshot', screenshot: base64, url: currentUrl });
  } catch (e) {
    console.error('Failed to capture screenshot:', e);
  }
}

// Send full-page screenshot
async function sendFullPageScreenshot(ws: WebSocket, client: BrowserClient) {
  try {
    // Small delay to let page render after actions
    await client.waitForTimeout(300);
    const buffer = await client.screenshot(); // Already captures full page with fullPage: true
    const base64 = buffer.toString('base64');
    const currentUrl = await client.getCurrentUrl();
    send(ws, { type: 'screenshot', screenshot: base64, url: currentUrl });
  } catch (e) {
    console.error('Failed to capture full-page screenshot:', e);
  }
}

// Run the agent
async function runAgent(ws: WebSocket, session: AgentSession, data: { url: string; goal: string; provider: string }) {
  if (session.isRunning) {
    send(ws, { type: 'error', message: 'Agent is already running' });
    return;
  }

  const { url, goal, provider } = data;

  if (!url || !goal) {
    send(ws, { type: 'error', message: 'URL and goal are required' });
    return;
  }

  // Clean up any existing browser from previous run
  if (session.client) {
    try {
      await session.client.stopScreencast();
      await session.client.close();
    } catch (e) {
      // Ignore cleanup errors
    }
    session.client = null;
  }

  session.isRunning = true;
  session.abortController = new AbortController();

  try {
    // Initialize browser
    session.client = new BrowserClient();

    if (USE_DOCKER_BROWSER) {
      send(ws, { type: 'log', message: 'Connecting to Docker browser...' });
      await session.client.connectCDP(DOCKER_CDP_ENDPOINT);
      // Send noVNC URL to client for live preview
      send(ws, { type: 'novnc-url', url: NOVNC_URL });
    } else {
      send(ws, { type: 'log', message: 'Launching browser...' });
      await session.client.launch(true); // headless mode
    }

    await session.client.goto(url);

    // Only send screenshots if NOT using Docker browser (noVNC handles preview)
    if (!USE_DOCKER_BROWSER) {
      send(ws, { type: 'log', message: 'Capturing page...' });
      await sendFullPageScreenshot(ws, session.client);
    }

    // Initialize driver
    send(ws, { type: 'log', message: 'Initializing screen reader driver...' });
    session.driver = new ScreenReaderDriver(session.client);

    // Initialize model
    send(ws, { type: 'log', message: `Loading ${provider} model...` });
    const model = provider === 'gemini' ? buildGeminiModel() : buildOpenAIModel();

    // Create agent with step callback
    const agent = new Agent(session.driver, model, async (step: AgentStep) => {
      // Send step update
      send(ws, { type: 'step', step });

      // Only send screenshots if NOT using Docker browser (noVNC handles preview)
      if (!USE_DOCKER_BROWSER && session.client) {
        await sendFullPageScreenshot(ws, session.client);
      }
    });

    // Run the agent
    send(ws, { type: 'log', message: 'Starting agent execution...' });
    const trace: AgentTrace = await agent.run(goal);

    // Only send final screenshot if NOT using Docker browser
    if (!USE_DOCKER_BROWSER) {
      await sendFullPageScreenshot(ws, session.client);
    }

    // Send completion
    send(ws, {
      type: 'complete',
      success: trace.success,
      error: trace.error,
      reason: trace.reason,
      totalSteps: trace.steps.length
    });

  } catch (error: any) {
    console.error('Agent error:', error);
    send(ws, {
      type: 'complete',
      success: false,
      error: error.message || 'Agent execution failed'
    });
  } finally {
    // Don't cleanup here - keep browser open for scrolling
    // Cleanup happens when WebSocket closes or new run starts
    session.isRunning = false;
  }
}

// Stop the agent
async function stopAgent(ws: WebSocket, session: AgentSession) {
  if (session.abortController) {
    session.abortController.abort();
  }
  await cleanupSession(ws);
  send(ws, { type: 'log', message: 'Agent stopped' });
}

// Cleanup session
async function cleanupSession(ws: WebSocket) {
  const session = sessions.get(ws);
  if (!session) return;

  session.isRunning = false;

  if (session.client) {
    try {
      // Stop screencast first
      await session.client.stopScreencast();
      await session.client.close();
    } catch (e) {
      console.error('Error closing browser:', e);
    }
    session.client = null;
  }

  session.driver = null;
  session.abortController = null;
}

// Start server
server.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║   🤖 Accessibility Agent UI                                ║
║                                                            ║
║   Server running at: http://localhost:${PORT}               ║
║                                                            ║
║   Open this URL in your browser to start using the agent   ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
`);
});

// Handle graceful shutdown
process.on('SIGINT', async () => {
  console.log('\nShutting down...');

  // Close all sessions
  for (const [ws] of sessions) {
    await cleanupSession(ws);
    ws.close();
  }

  server.close(() => {
    console.log('Server closed');
    process.exit(0);
  });
});
