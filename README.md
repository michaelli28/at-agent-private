# at-agent

AI-powered accessibility testing agent.

## Quick Start

```bash
# Install
npm install

# Build
npm run build:packages

# Run accessibility audit
npm run at-agent -- audit https://example.com

# Run AI-guided flow test
npm run at-agent -- flow https://example.com --goal "complete checkout"
```

## CLI Commands

### Audit

Run an accessibility audit on any URL:

```bash
npm run at-agent -- audit <url> [options]

Options:
  --json              Output results as JSON
  --tags <tags...>    WCAG tags to check (e.g., wcag2a wcag2aa)
```

Example:
```bash
npm run at-agent -- audit https://example.com
npm run at-agent -- audit https://example.com --json
npm run at-agent -- audit https://example.com --tags wcag2a wcag2aa
```

### Flow

Run an AI-guided accessibility flow test:

```bash
npm run at-agent -- flow <url> [options]

Options:
  --goal <goal>       Goal for the agent to achieve (required)
  --json              Output results as JSON
  --max-steps <n>     Maximum steps (default: 20)
  --api-key <key>     OpenAI API key (or set OPENAI_API_KEY env var)
```

Example:
```bash
export OPENAI_API_KEY=sk-...
npm run at-agent -- flow https://shop.example.com --goal "add item to cart"
```

## GitHub Actions

Use at-agent in your CI/CD pipeline:

```yaml
# Accessibility audit
- uses: your-org/at-agent/integrations/github-actions/audit@main
  with:
    url: https://example.com
    fail-on: serious

# AI-guided flow test
- uses: your-org/at-agent/integrations/github-actions/flow@main
  with:
    url: https://example.com
    goal: "complete user registration"
    api-key: ${{ secrets.OPENAI_API_KEY }}
```

See [integrations/github-actions/README.md](integrations/github-actions/README.md) for full documentation.

## Development

### Setup

```bash
# Install dependencies
npm install

# Build all packages
npm run build:packages

# Run tests
npm run test:packages
```

### Package Structure

```
packages/
├── browser/        # Playwright wrapper for a11y-focused automation
├── accessibility/  # Auditor, axe-core integration, screen reader sim
├── agent/          # AI orchestration with OpenAI
└── cli/            # Command-line interface
```

### Environment

Create `.env`:

```
OPENAI_API_KEY=sk-...
```

## Architecture

```
┌─────────────────────────────────────────────────┐
│              Integrations Layer                 │
│         (GitHub Actions, CI/CD)                 │
└─────────────────────────────────────────────────┘
                        │
┌─────────────────────────────────────────────────┐
│              Application Layer                  │
│                   (CLI)                         │
└─────────────────────────────────────────────────┘
                        │
┌─────────────────────────────────────────────────┐
│                Agent Layer                      │
│      (AI orchestration, tools, OpenAI)          │
└─────────────────────────────────────────────────┘
                        │
┌─────────────────────────────────────────────────┐
│              Accessibility Layer                │
│    (Auditor, screen reader sim, WCAG rules)     │
└─────────────────────────────────────────────────┘
                        │
┌─────────────────────────────────────────────────┐
│               Browser Layer                     │
│        (Playwright wrapper, interactions)       │
└─────────────────────────────────────────────────┘
```

## Legacy Commands

The following commands are from the previous architecture and may be deprecated:

```bash
# Old agent commands
npm run start:agent
npm run start:agent-cli

# Old audit commands
npm run audit-dom
npm run audit-visual
npm run audit

# UI
npm run start:ui
npm run start:debug-ui
```
