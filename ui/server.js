"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const express_1 = __importDefault(require("express"));
const ws_1 = require("ws");
const http_1 = __importDefault(require("http"));
const path_1 = __importDefault(require("path"));
const playwrightClient_1 = require("../browser/src/playwrightClient");
const ScreenReaderDriver_1 = require("../drivers/src/ScreenReaderDriver");
const app = (0, express_1.default)();
const server = http_1.default.createServer(app);
const wss = new ws_1.WebSocketServer({ server });
const PORT = 3000;
const TARGET_URL = process.argv[2] || 'https://example.com';
app.use(express_1.default.static(path_1.default.join(__dirname, 'public')));
// Global state
let client = null;
let driver = null;
async function startSimulation(ws) {
    try {
        if (!client) {
            ws.send(JSON.stringify({ type: 'log', message: `Launching browser for ${TARGET_URL}...` }));
            client = new playwrightClient_1.BrowserClient();
            await client.launch(false);
            await client.goto(TARGET_URL);
            driver = new ScreenReaderDriver_1.ScreenReaderDriver(client);
            await driver.enable();
            ws.send(JSON.stringify({ type: 'log', message: 'Browser ready. Starting loop...' }));
        }
        // Simple loop: Move down every 2 seconds
        const interval = setInterval(async () => {
            if (!driver)
                return;
            try {
                const result = await driver.performAction({ type: 'KEY_PRESS', key: 'ArrowDown' });
                if (result.success) {
                    ws.send(JSON.stringify({ type: 'snapshot', payload: result.snapshot }));
                }
            }
            catch (e) {
                console.error(e);
                clearInterval(interval);
            }
        }, 2000);
        ws.on('close', () => {
            clearInterval(interval);
        });
    }
    catch (error) {
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
