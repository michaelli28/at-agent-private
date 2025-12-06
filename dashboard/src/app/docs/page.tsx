'use client';

import { useState } from 'react';
import { Copy, Check } from 'lucide-react';

export default function DocsPage() {
  const [copiedSection, setCopiedSection] = useState<string | null>(null);

  function copyToClipboard(text: string, section: string) {
    navigator.clipboard.writeText(text);
    setCopiedSection(section);
    setTimeout(() => setCopiedSection(null), 2000);
  }

  const CopyButton = ({ text, section }: { text: string; section: string }) => (
    <button
      onClick={() => copyToClipboard(text, section)}
      className="absolute top-2 right-2 p-2 text-gray-400 hover:text-gray-600 bg-gray-800 rounded"
      title="Copy to clipboard"
    >
      {copiedSection === section ? (
        <Check className="w-4 h-4 text-green-400" />
      ) : (
        <Copy className="w-4 h-4" />
      )}
    </button>
  );

  const githubActionsYml = `name: Accessibility Tests

on:
  push:
    branches: [main]
  workflow_dispatch:

jobs:
  test:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - uses: actions/setup-node@v4
        with:
          node-version: '20'

      - name: Install Playwright
        run: npx playwright install --with-deps chromium

      - name: Install dependencies
        run: npm install

      - name: Start test server
        run: |
          npm start &
          sleep 3

      - name: Clone accessibility agent
        run: |
          git clone --branch langgraph-agent https://\${{ secrets.AT_AGENT_PAT }}@github.com/justanothernoob4648/at-agent.git \${{ github.workspace }}/../at-agent
          cd \${{ github.workspace }}/../at-agent && npm ci
          cd \${{ github.workspace }}/../at-agent && npm run build

      - name: Run Accessibility Tests
        uses: ./.github/actions/accessibility-agent
        with:
          test-config: 'a11y-tests.json'
          provider: 'openai'
          openai-api-key: \${{ secrets.OPENAI_API_KEY }}
          dashboard-url: \${{ secrets.DASHBOARD_URL }}
          dashboard-api-key: \${{ secrets.DASHBOARD_API_KEY }}
          agent-path: \${{ github.workspace }}/../at-agent`;

  const gitlabCiYml = `stages:
  - test

accessibility-tests:
  stage: test
  image: node:20

  variables:
    PROVIDER: "openai"
    HEADLESS: "true"
    CONTINUE_ON_FAILURE: "true"

  before_script:
    - apt-get update && apt-get install -y jq
    - npm install
    - PORT=3000 npm start &
    - sleep 5
    - npx wait-on http://localhost:3000 --timeout 60000
    - git clone --branch langgraph-agent https://oauth2:\${AT_AGENT_PAT}@github.com/justanothernoob4648/at-agent.git /at-agent
    - cd /at-agent && npm install
    - cd /at-agent && npm run build
    - npx playwright install --with-deps chromium

  script:
    - cd /at-agent
    - npm run start:agent-cli -- "http://localhost:3000" "Test accessibility" openai --json

  artifacts:
    when: always
    paths:
      - accessibility-results.json
    expire_in: 30 days`;

  const azurePipelinesYml = `trigger:
  - main

pool:
  vmImage: 'ubuntu-latest'

variables:
  - group: api  # Variable group containing secrets

steps:
  - task: NodeTool@0
    inputs:
      versionSpec: '20.x'
    displayName: 'Install Node.js'

  - script: |
      npm install
      PORT=3000 npm start &
      npx wait-on http://localhost:3000 --timeout 60000
    displayName: 'Install and start test-website'

  - script: |
      git clone --branch langgraph-agent https://oauth2:$(AT_AGENT_PAT)@github.com/justanothernoob4648/at-agent.git $(Agent.BuildDirectory)/at-agent
      cd $(Agent.BuildDirectory)/at-agent
      npm install
      npm run build
      npx playwright install --with-deps chromium
    displayName: 'Install AT Agent'

  - task: AccessibilityAgent@1
    inputs:
      testConfig: 'a11y-tests.json'
      provider: 'openai'
      openaiApiKey: $(OPENAI_API_KEY)
      agentPath: '$(Agent.BuildDirectory)/at-agent'
      headless: true
      continueOnFailure: true
      dashboardUrl: $(DASHBOARD_URL)
      dashboardApiKey: $(DASHBOARD_API_KEY)
    displayName: 'Run Accessibility Tests'

  - publish: $(System.DefaultWorkingDirectory)/accessibility-results.json
    artifact: accessibility-results
    condition: always()
    displayName: 'Publish test results'`;

  const jenkinsfile = `pipeline {
    agent any

    environment {
        OPENAI_API_KEY = credentials('openai-api-key')
        AT_AGENT_PAT = credentials('at-agent-pat')
        DASHBOARD_URL = credentials('dashboard-url')
        DASHBOARD_API_KEY = credentials('dashboard-api-key')
    }

    stages {
        stage('Setup') {
            steps {
                sh 'npm install'
                sh 'npm start &'
                sh 'sleep 5'
            }
        }

        stage('Install AT Agent') {
            steps {
                sh '''
                    git clone --branch langgraph-agent https://oauth2:$AT_AGENT_PAT@github.com/justanothernoob4648/at-agent.git at-agent
                    cd at-agent && npm install
                    cd at-agent && npm run build
                    npx playwright install --with-deps chromium
                '''
            }
        }

        stage('Accessibility Tests') {
            steps {
                sh '''
                    cd at-agent
                    npm run start:agent-cli -- "http://localhost:3000" "Test accessibility" openai --json
                '''
            }
        }
    }

    post {
        always {
            archiveArtifacts artifacts: 'accessibility-results.json', allowEmptyArchive: true
        }
    }
}`;

  return (
    <div className="max-w-4xl">
      <div className="mb-8">
        <h1 className="text-2xl font-bold text-gray-900">Setup Guide</h1>
        <p className="text-gray-600 mt-1">
          Configure your CI/CD pipeline to run accessibility tests and report results to the dashboard
        </p>
      </div>

      {/* Step 1: Get API Key */}
      <div className="card mb-6">
        <div className="card-header">
          <h2 className="text-lg font-semibold">Step 1: Get Your API Key</h2>
        </div>
        <div className="card-body">
          <p className="text-gray-600 mb-4">
            Each project has a unique API key used to authenticate test submissions.
          </p>
          <ol className="list-decimal list-inside space-y-2 text-gray-700">
            <li>Go to the <a href="/projects" className="text-primary-600 hover:underline">Projects</a> page</li>
            <li>Create a new project or select an existing one</li>
            <li>Copy the API key from the project card</li>
            <li>Add the API key as a secret in your CI/CD platform (see below)</li>
          </ol>
        </div>
      </div>

      {/* Step 2: Configure Secrets */}
      <div className="card mb-6">
        <div className="card-header">
          <h2 className="text-lg font-semibold">Step 2: Configure Secrets</h2>
        </div>
        <div className="card-body space-y-4">
          <p className="text-gray-600">
            Add the following secrets/variables in your CI/CD platform:
          </p>

          {/* Required Secrets Table */}
          <div className="overflow-x-auto">
            <table className="w-full text-sm border border-gray-200 rounded-lg">
              <thead className="bg-gray-50">
                <tr>
                  <th className="text-left px-4 py-2 border-b">Variable Name</th>
                  <th className="text-left px-4 py-2 border-b">Description</th>
                  <th className="text-left px-4 py-2 border-b">Required</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td className="px-4 py-2 border-b"><code className="bg-gray-100 px-1 rounded text-xs">OPENAI_API_KEY</code></td>
                  <td className="px-4 py-2 border-b text-gray-600">Your OpenAI API key for the AI agent</td>
                  <td className="px-4 py-2 border-b text-green-600">Yes</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border-b"><code className="bg-gray-100 px-1 rounded text-xs">AT_AGENT_PAT</code></td>
                  <td className="px-4 py-2 border-b text-gray-600">GitHub Personal Access Token to clone the at-agent repo</td>
                  <td className="px-4 py-2 border-b text-green-600">Yes</td>
                </tr>
                <tr>
                  <td className="px-4 py-2 border-b"><code className="bg-gray-100 px-1 rounded text-xs">DASHBOARD_URL</code></td>
                  <td className="px-4 py-2 border-b text-gray-600">Dashboard URL: <code className="bg-gray-100 px-1 rounded text-xs">https://at-agent-dashboard.fly.dev</code></td>
                  <td className="px-4 py-2 border-b text-gray-500">Optional</td>
                </tr>
                <tr>
                  <td className="px-4 py-2"><code className="bg-gray-100 px-1 rounded text-xs">DASHBOARD_API_KEY</code></td>
                  <td className="px-4 py-2 text-gray-600">Your project's API key from the dashboard (for reporting results)</td>
                  <td className="px-4 py-2 text-gray-500">Optional</td>
                </tr>
              </tbody>
            </table>
          </div>

          <div className="space-y-3 mt-4">
            <div className="p-4 bg-gray-50 rounded-lg">
              <h4 className="font-medium text-gray-900 mb-2">GitHub Actions</h4>
              <p className="text-sm text-gray-600">
                Go to Repository Settings → Secrets and variables → Actions → New repository secret
              </p>
              <p className="text-sm text-gray-600 mt-1">
                Add each variable: <code className="bg-gray-200 px-1 rounded">OPENAI_API_KEY</code>, <code className="bg-gray-200 px-1 rounded">AT_AGENT_PAT</code>, <code className="bg-gray-200 px-1 rounded">DASHBOARD_URL</code>, <code className="bg-gray-200 px-1 rounded">DASHBOARD_API_KEY</code>
              </p>
            </div>

            <div className="p-4 bg-gray-50 rounded-lg">
              <h4 className="font-medium text-gray-900 mb-2">GitLab CI</h4>
              <p className="text-sm text-gray-600">
                Go to Settings → CI/CD → Variables → Add variable
              </p>
              <p className="text-sm text-gray-600 mt-1">
                Add each variable (mark sensitive ones as masked/protected)
              </p>
            </div>

            <div className="p-4 bg-gray-50 rounded-lg">
              <h4 className="font-medium text-gray-900 mb-2">Azure DevOps</h4>
              <p className="text-sm text-gray-600">
                Go to Pipelines → Library → Create a variable group named <code className="bg-gray-200 px-1 rounded">api</code>
              </p>
              <p className="text-sm text-gray-600 mt-1">
                Add all variables to the group (mark sensitive ones as secret)
              </p>
            </div>

            <div className="p-4 bg-gray-50 rounded-lg">
              <h4 className="font-medium text-gray-900 mb-2">Jenkins</h4>
              <p className="text-sm text-gray-600">
                Go to Manage Jenkins → Credentials → Add credentials (Secret text)
              </p>
              <p className="text-sm text-gray-600 mt-1">
                IDs: <code className="bg-gray-200 px-1 rounded">openai-api-key</code>, <code className="bg-gray-200 px-1 rounded">at-agent-pat</code>, <code className="bg-gray-200 px-1 rounded">dashboard-url</code>, <code className="bg-gray-200 px-1 rounded">dashboard-api-key</code>
              </p>
            </div>
          </div>
        </div>
      </div>

      {/* Step 3: Pipeline Configuration */}
      <div className="card mb-6">
        <div className="card-header">
          <h2 className="text-lg font-semibold">Step 3: Add Pipeline Configuration</h2>
        </div>
        <div className="card-body space-y-6">

          {/* GitHub Actions */}
          <div>
            <h3 className="font-medium text-gray-900 mb-2">GitHub Actions</h3>
            <p className="text-sm text-gray-600 mb-2">
              Create <code className="bg-gray-100 px-1 rounded">.github/workflows/accessibility.yml</code>:
            </p>
            <div className="relative">
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                <code>{githubActionsYml}</code>
              </pre>
              <CopyButton text={githubActionsYml} section="github" />
            </div>
          </div>

          {/* GitLab CI */}
          <div>
            <h3 className="font-medium text-gray-900 mb-2">GitLab CI</h3>
            <p className="text-sm text-gray-600 mb-2">
              Add to your <code className="bg-gray-100 px-1 rounded">.gitlab-ci.yml</code>:
            </p>
            <div className="relative">
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                <code>{gitlabCiYml}</code>
              </pre>
              <CopyButton text={gitlabCiYml} section="gitlab" />
            </div>
          </div>

          {/* Azure DevOps */}
          <div>
            <h3 className="font-medium text-gray-900 mb-2">Azure DevOps</h3>
            <p className="text-sm text-gray-600 mb-2">
              Create <code className="bg-gray-100 px-1 rounded">azure-pipelines.yml</code>:
            </p>
            <div className="relative">
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                <code>{azurePipelinesYml}</code>
              </pre>
              <CopyButton text={azurePipelinesYml} section="azure" />
            </div>
          </div>

          {/* Jenkins */}
          <div>
            <h3 className="font-medium text-gray-900 mb-2">Jenkins</h3>
            <p className="text-sm text-gray-600 mb-2">
              Create a <code className="bg-gray-100 px-1 rounded">Jenkinsfile</code>:
            </p>
            <div className="relative">
              <pre className="bg-gray-900 text-gray-100 p-4 rounded-lg overflow-x-auto text-sm">
                <code>{jenkinsfile}</code>
              </pre>
              <CopyButton text={jenkinsfile} section="jenkins" />
            </div>
          </div>
        </div>
      </div>

      {/* API Reference */}
      <div className="card">
        <div className="card-header">
          <h2 className="text-lg font-semibold">API Reference</h2>
        </div>
        <div className="card-body space-y-4">
          <p className="text-gray-600">
            Results are submitted to the dashboard API automatically by the at-agent CLI.
            The API endpoint is:
          </p>
          <code className="block bg-gray-100 p-3 rounded text-sm">
            POST https://at-agent-dashboard.fly.dev/api/results
          </code>
          <p className="text-gray-600 text-sm">
            Include the header <code className="bg-gray-100 px-1 rounded">X-API-Key: your-api-key</code> for authentication.
          </p>
        </div>
      </div>
    </div>
  );
}
