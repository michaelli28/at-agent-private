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
require("dotenv/config");
const playwrightClient_1 = require("../browser/src/playwrightClient");
const ScreenReaderDriver_1 = require("../drivers/src/ScreenReaderDriver");
const Agent_1 = require("../agent/src/Agent");
const OpenAIClient_1 = require("../agent/src/OpenAIClient");
const Reporter_1 = require("../evaluation/src/Reporter");
const Evaluator_1 = require("../evaluation/src/Evaluator");
async function main() {
    const url = process.argv[2];
    const goal = process.argv[3];
    if (!url || !goal) {
        console.error('Usage: pnpm start:agent <url> "<goal>" [provider]');
        process.exit(1);
    }
    const provider = process.argv[4] || 'openai'; // 'openai' or 'gemini'
    if (provider === 'openai' && !process.env.OPENAI_API_KEY) {
        console.error('Error: OPENAI_API_KEY environment variable is required for OpenAI.');
        process.exit(1);
    }
    if (provider === 'gemini' && !process.env.GEMINI_API_KEY) {
        console.error('Error: GEMINI_API_KEY environment variable is required for Gemini.');
        process.exit(1);
    }
    console.log(`[Runner] Starting Agent on ${url}`);
    console.log(`[Runner] Goal: "${goal}"`);
    const client = new playwrightClient_1.BrowserClient();
    await client.launch(false); // Visible browser
    try {
        await client.goto(url);
        const driver = new ScreenReaderDriver_1.ScreenReaderDriver(client);
        let llm;
        if (provider === 'gemini') {
            const { GeminiClient } = await Promise.resolve().then(() => __importStar(require('../agent/src/GeminiClient')));
            llm = new GeminiClient();
        }
        else {
            llm = new OpenAIClient_1.OpenAIClient();
        }
        const agent = new Agent_1.Agent(driver, llm);
        // Run the agent loop
        const trace = await agent.run(goal);
        // Evaluate the session
        console.log('\n[Runner] Evaluating session...');
        const evaluator = new Evaluator_1.Evaluator();
        const axTree = await client.getFullAXTree();
        const violations = evaluator.evaluate(axTree, trace);
        // Generate Report
        const reporter = new Reporter_1.Reporter();
        const markdown = reporter.toMarkdown(violations, trace);
        console.log('\n' + '='.repeat(50));
        console.log(markdown);
        console.log('='.repeat(50) + '\n');
    }
    catch (error) {
        console.error('[Runner] Error:', error);
    }
    finally {
        await client.close();
    }
}
main();
