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
```

## Build

```bash
# Build everything with Bazel
bazel build //...

# Or use pnpm for TypeScript
pnpm build
```

## Run

### Agent

```bash
pnpm start:agent
pnpm start:agent-cli
pnpm start:agent-parallel
pnpm start:agent-openrouter
```

### Audits

```bash
pnpm audit-dom
pnpm audit-visual
pnpm audit-media
pnpm audit
```

### UI

```bash
pnpm start:ui
pnpm start:debug-ui
```

### Dashboard

```bash
cd apps/dashboard
pnpm dev
pnpm build
pnpm start
```

### Discovery Agent (Python)

```bash
cd python/discovery-agent
pip install -r requirements.txt
python discover.py
```

### Screen Reader

```bash
pnpm dev:sr
```

## Test

```bash
pnpm test
pnpm test:visual-regression
pnpm benchmark:aria-at
```

## Scripts

```bash
pnpm visualize-report
pnpm generate-graph
pnpm generate-sitemap
```

## Docker

```bash
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

See `integrations/github-actions/`

### GitLab CI

See `integrations/gitlab-ci/.gitlab-ci-template.yml`

## Structure

```
at-agent/
├── packages/                 # Shared libraries
│   ├── browser/              # Browser automation client
│   ├── shared/               # Common types
│   ├── drivers/              # Accessibility drivers
│   └── evaluation/           # Test evaluation
├── apps/                     # Applications
│   ├── agent/                # Core AI agent
│   ├── dashboard/            # Next.js dashboard
│   ├── ui/                   # Express server
│   └── virtual-screen-reader/
├── services/                 # Backend workers
│   └── rerun-worker/
├── scripts/                  # CLI tools
├── integrations/             # CI/CD plugins
│   ├── jenkins/
│   ├── azure-devops/
│   ├── github-actions/
│   └── gitlab-ci/
├── python/                   # Python code
│   └── discovery-agent/
├── infra/                    # Deployment
│   └── docker/
├── tools/                    # Bazel macros
└── third_party/              # External deps
```

## Environment

Create `.env`:

```
OPENAI_API_KEY=sk-...
GOOGLE_API_KEY=...
GROQ_API_KEY=...
```
