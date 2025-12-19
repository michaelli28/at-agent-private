# at-agent

AI-powered accessibility testing agent.

## Setup

```bash
# Install dependencies (macOS)
brew install bazelisk python@3.11 openjdk@17
curl -o- https://raw.githubusercontent.com/nvm-sh/nvm/v0.40.1/install.sh | bash
nvm install 20 && nvm use 20
corepack enable && corepack prepare pnpm@latest --activate

# Install packages
pnpm install

# Generate Python lock (first time only)
pip-compile python/discovery-agent/requirements.txt -o python/requirements_lock.txt
```

## Build

```bash
# Build everything
bazel build //...

# Build specific targets
bazel build //apps/agent
bazel build //apps/dashboard
bazel build //packages/drivers:injected
bazel build //scripts:cli
```

## Run

### Agent

```bash
# Run agent
pnpm start:agent

# Run agent CLI
pnpm start:agent-cli

# Run agent parallel
pnpm start:agent-parallel

# Run with OpenRouter
pnpm start:agent-openrouter
```

### Audits

```bash
# DOM audit
pnpm audit-dom

# Visual audit
pnpm audit-visual

# Media audit
pnpm audit-media

# Full audit
pnpm audit
```

### UI

```bash
# Start UI server
pnpm start:ui

# Start debug UI
pnpm start:debug-ui
```

### Dashboard

```bash
cd apps/dashboard
pnpm dev      # Development
pnpm build    # Production build
pnpm start    # Production server
```

### Discovery Agent (Python)

```bash
cd python/discovery-agent
python discover.py
```

### Screen Reader

```bash
pnpm dev:sr
```

## Test

```bash
# All tests
bazel test //...

# Specific package
bazel test //apps/agent:tests

# npm tests
pnpm test

# Visual regression
pnpm test:visual-regression

# Benchmarks
pnpm benchmark:aria-at
```

## Scripts

```bash
pnpm visualize-report    # Generate HTML report
pnpm generate-graph      # Generate GraphML
pnpm generate-sitemap    # Generate sitemap
```

## Docker

```bash
# Build image
bazel build //infra/docker:at_agent_tarball

# Or with docker-compose
cd infra/docker
docker-compose up
```

## Integrations

### Jenkins Plugin

```bash
cd integrations/jenkins
./mvnw package
```

### Azure DevOps Extension

```bash
cd integrations/azure-devops
pnpm install
npx tfx extension create
```

### GitHub Action

See `.github/actions/accessibility-agent/`

### GitLab CI

See `integrations/gitlab-ci/.gitlab-ci-template.yml`

## Structure

```
at-agent/
├── apps/                 # Deployable applications
│   ├── agent/            # Core AI agent
│   ├── dashboard/        # Next.js dashboard
│   ├── ui/               # Express server
│   └── virtual-screen-reader/
├── packages/             # Shared libraries
│   ├── shared/           # Common types
│   ├── drivers/          # Accessibility drivers
│   └── evaluation/       # Test evaluation
├── services/             # Backend workers
│   └── rerun-worker/
├── scripts/              # CLI tools
├── integrations/         # CI/CD plugins
│   ├── jenkins/
│   ├── azure-devops/
│   ├── github-actions/
│   └── gitlab-ci/
├── python/               # Python code
│   └── discovery-agent/
├── infra/                # Deployment
│   └── docker/
├── tools/                # Build macros
└── third_party/          # External deps
```

## Environment

Create `.env` in root:

```
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
GROQ_API_KEY=...
```
