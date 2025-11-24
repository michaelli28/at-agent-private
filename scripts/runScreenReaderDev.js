"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
const playwrightClient_1 = require("../browser/src/playwrightClient");
const ScreenReaderDriver_1 = require("../drivers/src/ScreenReaderDriver");
const readline = __importStar(require("readline"));
async function main() {
    const url = process.argv[2];
    if (!url) {
        console.error('Please provide a URL. Usage: pnpm dev:sr <url>');
        process.exit(1);
    }
    console.log(`[Harness] Launching browser for ${url}...`);
    const client = new playwrightClient_1.BrowserClient();
    await client.launch(false); // headless: false to see the browser
    try {
        await client.goto(url);
        console.log('[Harness] Page loaded.');
        const driver = new ScreenReaderDriver_1.ScreenReaderDriver(client);
        await driver.enable();
        console.log('\n--- Interactive Mode ---');
        console.log('Controls: [n] Next Item, [p] Previous Item, [q] Quit\n');
        // Initial state
        let snapshot = await driver.getPerceptualOutput();
        logSnapshot('Initial', snapshot);
        const rl = readline.createInterface({
            input: process.stdin,
            output: process.stdout
        });
        rl.setPrompt('Action (n/p/q)> ');
        rl.prompt();
        rl.on('line', async (line) => {
            const input = line.trim().toLowerCase();
            if (input === 'q') {
                rl.close();
                return;
            }
            let actionKey = '';
            if (input === 'n' || input === '')
                actionKey = 'ArrowDown';
            else if (input === 'p')
                actionKey = 'ArrowUp';
            if (actionKey) {
                const result = await driver.performAction({ type: 'KEY_PRESS', key: actionKey });
                if (result.success) {
                    logSnapshot('SR', result.snapshot);
                }
                else {
                    console.error(`[Error] ${result.message}`);
                }
            }
            else {
                console.log('Unknown command. Use n, p, or q.');
            }
            rl.prompt();
        });
        await new Promise((resolve) => {
            rl.on('close', resolve);
        });
    }
    catch (error) {
        console.error('[Harness] Error:', error);
    }
    finally {
        console.log('\n[Harness] Closing browser...');
        await client.close();
    }
}
function logSnapshot(prefix, snapshot) {
    console.log(`[${prefix}] Spoken: "${snapshot.text}"`);
    if (snapshot.cursorBox) {
        const { x, y, width, height } = snapshot.cursorBox;
        console.log(`[Box] x:${x}, y:${y}, w:${width}, h:${height}`);
    }
    else {
        console.log(`[Box] No visual cursor`);
    }
}
main();
