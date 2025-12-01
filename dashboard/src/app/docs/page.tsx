'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export default function DocsPage() {
  const [copiedBlock, setCopiedBlock] = useState<string | null>(null);

  function copyCode(code: string, blockId: string) {
    navigator.clipboard.writeText(code);
    setCopiedBlock(blockId);
    setTimeout(() => setCopiedBlock(null), 2000);
  }

  const jenkinsPluginConfig = `pipeline {
    agent any

    tools {
        nodejs 'NodeJS'
    }

    stages {
        stage('Accessibility Tests') {
            steps {
                accessibilityAgent(
                    testConfigFile: 'accessibility-tests.json',
                    continueOnFailure: true,
                    failBuildOnTestFailure: true
                )
            }
        }
    }
}`;

  const testConfigJson = `[
  {
    "url": "http://localhost:3000",
    "goal": "Navigate through the main page and verify all content is accessible"
  },
  {
    "url": "http://localhost:3000/login",
    "goal": "Test the login form for proper labels and keyboard navigation"
  }
]`;

  const curlExample = `curl -X POST https://your-dashboard.com/api/results \\
  -H "Content-Type: application/json" \\
  -H "X-API-Key: YOUR_API_KEY" \\
  -d '{
    "platform": "jenkins",
    "buildNumber": "123",
    "buildUrl": "https://jenkins.example.com/job/my-project/123",
    "branch": "main",
    "commit": "abc1234",
    "results": [
      {
        "url": "https://example.com",
        "goal": "Verify homepage accessibility",
        "success": true,
        "reason": "All accessibility checks passed",
        "steps": [
          {"stepNumber": 1, "action": "Navigate to homepage", "observation": "Page loaded successfully"},
          {"stepNumber": 2, "action": "Check heading structure", "observation": "Proper H1-H6 hierarchy found"}
        ],
        "violations": [],
        "duration": 5000
      }
    ],
    "totalDuration": 5000
  }'`;

  const globalConfigCode = `// In Jenkins: Manage Jenkins > Configure System > Accessibility Agent

Agent Path: /path/to/at-agent
LLM Provider: gemini
API Key Credential: your-credential-id
Headless Browser: true
Dashboard URL: https://your-dashboard.com
Dashboard API Key: ak_xxxxxxxxxxxx`;

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Documentation</h1>
        <p className="text-gray-600 mt-1">Learn how to integrate accessibility testing into your CI/CD pipeline</p>
      </div>

      {/* Table of Contents */}
      <div className="card mb-8">
        <div className="card-body">
          <h2 className="text-lg font-semibold mb-4">Contents</h2>
          <ul className="space-y-2 text-primary-600">
            <li><a href="#overview" className="hover:underline">1. Overview</a></li>
            <li><a href="#jenkins-setup" className="hover:underline">2. Jenkins Setup</a></li>
            <li><a href="#test-config" className="hover:underline">3. Test Configuration</a></li>
            <li><a href="#dashboard-integration" className="hover:underline">4. Dashboard Integration</a></li>
            <li><a href="#api-reference" className="hover:underline">5. API Reference</a></li>
            <li><a href="#troubleshooting" className="hover:underline">6. Troubleshooting</a></li>
          </ul>
        </div>
      </div>

      {/* Overview */}
      <section id="overview" className="card mb-8">
        <div className="card-header">
          <h2 className="text-lg font-semibold">1. Overview</h2>
        </div>
        <div className="card-body prose prose-sm max-w-none">
          <p>
            The Accessibility Testing Agent is an AI-powered tool that performs automated accessibility testing
            by simulating real user interactions with screen readers. It integrates with your CI/CD pipeline
            to catch accessibility issues before they reach production.
          </p>

          <h3>Key Features</h3>
          <ul>
            <li>AI-powered testing using LLMs (GPT-4, Gemini)</li>
            <li>Screen reader simulation for realistic testing</li>
            <li>Jenkins plugin for seamless CI/CD integration</li>
            <li>Centralized dashboard for viewing results across projects</li>
            <li>Historical trends and violation tracking</li>
          </ul>

          <h3>Architecture</h3>
          <pre className="bg-gray-100 p-4 rounded-lg text-sm">
{`┌─────────────────┐     POST results     ┌─────────────────┐
│    Jenkins      │ ─────────────────────▶│    Dashboard    │
│    Plugin       │                       │    Website      │
└─────────────────┘                       └─────────────────┘
         │                                         │
         ▼                                         ▼
┌─────────────────┐                       ┌─────────────────┐
│   AT-Agent      │                       │    Firebase     │
│   (Node.js)     │                       │   (Firestore)   │
└─────────────────┘                       └─────────────────┘`}
          </pre>
        </div>
      </section>

      {/* Jenkins Setup */}
      <section id="jenkins-setup" className="card mb-8">
        <div className="card-header">
          <h2 className="text-lg font-semibold">2. Jenkins Setup</h2>
        </div>
        <div className="card-body prose prose-sm max-w-none">
          <h3>Prerequisites</h3>
          <ul>
            <li>Jenkins 2.387.3 or later</li>
            <li>NodeJS plugin installed and configured</li>
            <li>Accessibility Agent plugin installed</li>
          </ul>

          <h3>Step 1: Install the Plugin</h3>
          <ol>
            <li>Download <code>accessibility-agent.hpi</code> from the releases</li>
            <li>Go to <strong>Manage Jenkins → Plugins → Advanced settings</strong></li>
            <li>Upload the .hpi file under "Deploy Plugin"</li>
            <li>Restart Jenkins</li>
          </ol>

          <h3>Step 2: Configure Global Settings</h3>
          <p>Go to <strong>Manage Jenkins → Configure System → Accessibility Agent</strong>:</p>
          <div className="relative">
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
              {globalConfigCode}
            </pre>
            <button
              onClick={() => copyCode(globalConfigCode, 'global-config')}
              className="absolute top-2 right-2 btn btn-secondary btn-sm"
            >
              {copiedBlock === 'global-config' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          <h3>Step 3: Configure Your Jenkinsfile</h3>
          <div className="relative">
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
              {jenkinsPluginConfig}
            </pre>
            <button
              onClick={() => copyCode(jenkinsPluginConfig, 'jenkinsfile')}
              className="absolute top-2 right-2 btn btn-secondary btn-sm"
            >
              {copiedBlock === 'jenkinsfile' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>
        </div>
      </section>

      {/* Test Configuration */}
      <section id="test-config" className="card mb-8">
        <div className="card-header">
          <h2 className="text-lg font-semibold">3. Test Configuration</h2>
        </div>
        <div className="card-body prose prose-sm max-w-none">
          <p>
            Tests are defined in a JSON file that specifies URLs to test and goals for the AI agent.
          </p>

          <h3>Example: accessibility-tests.json</h3>
          <div className="relative">
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto">
              {testConfigJson}
            </pre>
            <button
              onClick={() => copyCode(testConfigJson, 'test-config')}
              className="absolute top-2 right-2 btn btn-secondary btn-sm"
            >
              {copiedBlock === 'test-config' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          <h3>Goal Writing Tips</h3>
          <ul>
            <li>Be specific about what accessibility aspects to test</li>
            <li>Include the expected behavior or outcome</li>
            <li>Reference specific elements or pages when relevant</li>
          </ul>

          <h3>Example Goals</h3>
          <ul>
            <li>"Navigate to all form inputs using Tab key and verify each has a visible focus indicator"</li>
            <li>"Use screen reader commands to read the main navigation and verify all links are announced correctly"</li>
            <li>"Check that all images have descriptive alt text that conveys their purpose"</li>
            <li>"Verify the page can be navigated using only keyboard, without any focus traps"</li>
          </ul>
        </div>
      </section>

      {/* Dashboard Integration */}
      <section id="dashboard-integration" className="card mb-8">
        <div className="card-header">
          <h2 className="text-lg font-semibold">4. Dashboard Integration</h2>
        </div>
        <div className="card-body prose prose-sm max-w-none">
          <p>
            The dashboard receives test results from your CI/CD pipelines and provides a centralized view
            of accessibility testing across all your projects.
          </p>

          <h3>Setup Steps</h3>
          <ol>
            <li>Create a project in the dashboard to get an API key</li>
            <li>Configure the Jenkins plugin with the dashboard URL and API key</li>
            <li>Results will be automatically sent after each test run</li>
          </ol>

          <h3>Jenkins Plugin Configuration</h3>
          <p>In Jenkins global configuration, set:</p>
          <ul>
            <li><strong>Dashboard URL</strong>: The URL of your dashboard instance</li>
            <li><strong>Dashboard API Key</strong>: The API key from your project settings</li>
          </ul>
        </div>
      </section>

      {/* API Reference */}
      <section id="api-reference" className="card mb-8">
        <div className="card-header">
          <h2 className="text-lg font-semibold">5. API Reference</h2>
        </div>
        <div className="card-body prose prose-sm max-w-none">
          <h3>POST /api/results</h3>
          <p>Submit test results from a CI/CD run.</p>

          <h4>Headers</h4>
          <ul>
            <li><code>Content-Type: application/json</code></li>
            <li><code>X-API-Key: YOUR_API_KEY</code></li>
          </ul>

          <h4>Request Body</h4>
          <div className="relative">
            <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-xs">
              {curlExample}
            </pre>
            <button
              onClick={() => copyCode(curlExample, 'curl')}
              className="absolute top-2 right-2 btn btn-secondary btn-sm"
            >
              {copiedBlock === 'curl' ? <Check className="w-4 h-4" /> : <Copy className="w-4 h-4" />}
            </button>
          </div>

          <h4>Response</h4>
          <pre className="bg-gray-100 p-4 rounded-lg">
{`{
  "success": true,
  "testRunId": "abc123xyz"
}`}
          </pre>
        </div>
      </section>

      {/* Troubleshooting */}
      <section id="troubleshooting" className="card mb-8">
        <div className="card-header">
          <h2 className="text-lg font-semibold">6. Troubleshooting</h2>
        </div>
        <div className="card-body prose prose-sm max-w-none">
          <h3>Common Issues</h3>

          <h4>"npm: command not found"</h4>
          <p>
            Ensure the NodeJS plugin is installed and configured in Jenkins, and that your Jenkinsfile
            includes the <code>tools {'{ nodejs \'NodeJS\' }'}</code> block.
          </p>

          <h4>"Cannot connect to browser"</h4>
          <p>
            The agent requires a browser to be available. Ensure Playwright browsers are installed:
          </p>
          <pre className="bg-gray-100 p-4 rounded-lg">npx playwright install chromium</pre>

          <h4>"API key not found"</h4>
          <p>
            Verify the API key is correctly configured in Jenkins credentials and referenced in the
            global configuration.
          </p>

          <h4>Dashboard not receiving results</h4>
          <ul>
            <li>Check the dashboard URL is correct and accessible from Jenkins</li>
            <li>Verify the API key matches a project in the dashboard</li>
            <li>Check Jenkins console output for any error messages</li>
          </ul>
        </div>
      </section>
    </div>
  );
}
