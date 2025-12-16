#!/usr/bin/env ts-node

/**
 * CLI wrapper for the accessibility agent that outputs JSON results.
 * Used by the Jenkins plugin to run accessibility tests.
 *
 * Usage: npm run start:agent-cli <url> "<goal>" [provider] [--json] [--live]
 *
 * Live mode environment variables:
 *   DASHBOARD_URL - Dashboard API URL (e.g., https://dashboard.example.com)
 *   DASHBOARD_API_KEY - API key for the project
 *   TEST_RUN_ID - Test run ID (from /api/live/start)
 *   TEST_INDEX - Index of current test (0, 1, 2...)
 *
 * Note: This script uses the virtual screen reader in headed mode for visibility.
 */

import 'dotenv/config';
import { BrowserClient, ScreenReaderDriver } from '@adf/virtual-screen-reader';
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
}

/**
 * Send a live step to the dashboard API
 */
async function sendLiveStep(
    dashboardUrl: string,
    apiKey: string,
    testRunId: string,
    testIndex: number,
    url: string,
    goal: string,
    step: any
): Promise<void> {
    try {
        const response = await fetch(`${dashboardUrl}/api/live/step`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'X-API-Key': apiKey,
            },
            body: JSON.stringify({
                testRunId,
                testIndex,
                url,
                goal,
                stepNumber: step.stepNumber,
                action: step.action ? JSON.stringify(step.action) : '',
                observation: step.observation?.text || '',
                thought: step.thought || '',
            }),
        });

        if (!response.ok) {
            console.error(`Failed to send live step: ${response.status}`);
        }
    } catch (error) {
        console.error('Error sending live step:', error);
    }
}

async function main() {
    const args = process.argv.slice(2);
    const url = args[0];
    const goal = args[1];
    const provider = args[2] || 'openai';
    const jsonOutput = args.includes('--json');
    const liveMode = args.includes('--live');

    // Live mode configuration from environment
    const dashboardUrl = process.env.DASHBOARD_URL;
    const dashboardApiKey = process.env.DASHBOARD_API_KEY;
    const testRunId = process.env.TEST_RUN_ID;
    const testIndex = parseInt(process.env.TEST_INDEX || '0', 10);

    if (!url || !goal) {
        console.error('Usage: npm run start:agent-cli <url> "<goal>" [provider] [--json] [--live]');
        process.exit(1);
    }

    // Validate live mode requirements
    if (liveMode && (!dashboardUrl || !dashboardApiKey || !testRunId)) {
        console.error('Live mode requires DASHBOARD_URL, DASHBOARD_API_KEY, and TEST_RUN_ID environment variables');
        process.exit(1);
    }

    const result: CliResult = {
        url,
        goal,
        success: false,
        reason: null,
        error: null,
        steps: []
    };

    const client = new BrowserClient();

    try {
        if (!jsonOutput) {
            console.log('Launching browser...');
        }
        await client.launch(false); // headed mode
        await client.goto(url);

        const driver = new ScreenReaderDriver(client);
        await driver.enable();

        if (!jsonOutput) {
            console.log('Navigating to:', url);
        }

        const model = provider === 'gemini'
            ? buildGeminiModel()
            : buildOpenAIModel();

        const stepCallback = (step: any) => {
            // Console output for non-JSON mode
            if (!jsonOutput) {
                console.log(`Step ${step.stepNumber}: ${step.action.type} ${step.action.key || ''}`);
            }

            // Send to dashboard in live mode
            if (liveMode && dashboardUrl && dashboardApiKey && testRunId) {
                sendLiveStep(dashboardUrl, dashboardApiKey, testRunId, testIndex, url, goal, step);
            }
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
        // Output compact JSON for parsing (no pretty-print for easier detection)
        console.log(JSON.stringify(result));
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
            steps: []
        }));
    }
    process.exit(1);
});
