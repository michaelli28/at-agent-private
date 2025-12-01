#!/usr/bin/env ts-node

/**
 * CLI wrapper for the accessibility agent that outputs JSON results.
 * Used by the Jenkins plugin to run accessibility tests.
 *
 * Usage: pnpm start:agent-cli <url> "<goal>" [provider] [--json]
 */

import 'dotenv/config';
import { BrowserClient } from '../browser/src/playwrightClient';
import { ScreenReaderDriver } from '../virtual-screen-reader/src/ScreenReaderDriver';
import { Agent } from '../agent/src/Agent';
import { buildOpenAIModel } from '../agent/src/OpenAIClient';
import { buildGeminiModel } from '../agent/src/GeminiClient';

interface CliResult {
    url: string;
    goal: string;
    success: boolean;
    reason: string | null;
    error: string | null;
    steps: Array<{
        stepNumber: number;
        action: string;
        observation: string;
        thought: string;
    }>;
    violations: Array<{
        type: string;
        message: string;
        element: string;
        severity: string;
    }>;
}

async function main() {
    const args = process.argv.slice(2);
    const url = args[0];
    const goal = args[1];
    const provider = args[2] || 'openai';
    const jsonOutput = args.includes('--json');

    if (!url || !goal) {
        console.error('Usage: pnpm start:agent-cli <url> "<goal>" [provider] [--json]');
        process.exit(1);
    }

    const headless = process.env.HEADLESS === 'true';
    const client = new BrowserClient();

    const result: CliResult = {
        url,
        goal,
        success: false,
        reason: null,
        error: null,
        steps: [],
        violations: []
    };

    try {
        if (!jsonOutput) {
            console.log('Launching browser...');
        }
        await client.launch(headless);

        if (!jsonOutput) {
            console.log('Navigating to:', url);
        }
        await client.goto(url);

        const driver = new ScreenReaderDriver(client);

        const model = provider === 'gemini'
            ? buildGeminiModel()
            : buildOpenAIModel();

        const stepCallback = jsonOutput ? undefined : (step: any) => {
            console.log(`Step ${step.stepNumber}: ${step.action.type} ${step.action.key || ''}`);
        };

        const agent = new Agent(driver, model, stepCallback);

        if (!jsonOutput) {
            console.log('Running agent with goal:', goal);
        }

        const trace = await agent.run(goal);

        result.success = trace.success;
        result.reason = trace.reason || null;
        result.error = trace.error || null;
        result.steps = (trace.steps || []).map((step: any, idx: number) => ({
            stepNumber: step.stepNumber || idx + 1,
            action: step.action ? JSON.stringify(step.action) : '',
            observation: step.observation?.text || '',
            thought: step.thought || ''
        }));

    } catch (e: any) {
        result.success = false;
        result.error = e.message;

        if (!jsonOutput) {
            console.error('Agent error:', e.message);
        }
    } finally {
        try {
            await client.close();
        } catch (e) {
            // Ignore close errors
        }
    }

    if (jsonOutput) {
        // Output clean JSON for parsing
        console.log(JSON.stringify(result, null, 2));
    } else {
        // Human-readable output
        console.log('\n--- Result ---');
        console.log('Success:', result.success);
        if (result.reason) console.log('Reason:', result.reason);
        if (result.error) console.log('Error:', result.error);
        console.log('Steps:', result.steps.length);
    }

    process.exit(result.success ? 0 : 1);
}

main().catch(err => {
    console.error('Fatal error:', err.message);
    if (process.argv.includes('--json')) {
        console.log(JSON.stringify({
            success: false,
            error: err.message,
            steps: [],
            violations: []
        }));
    }
    process.exit(1);
});
