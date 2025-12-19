# AT Agent Test Discovery

Automatically discover and generate accessibility test suites by analyzing your codebase using LangChain Deep Agents.

## Overview

The discovery agent uses AI to explore your codebase, understand your application's structure, and generate comprehensive accessibility test cases. It identifies routes, forms, user workflows, and interactive elements to create tests that simulate real screen reader users.

## Installation

```bash
cd discovery-agent
pip install -r requirements.txt
```

## Prerequisites

- Python 3.10+
- OpenAI API key

```bash
export OPENAI_API_KEY=sk-your-key-here
```

## Usage

### Three Levels of Control

#### 1. Fully Automatic (Agent Explores Freely)

Let the agent explore the entire codebase and generate tests:

```bash
python discover.py \
    --root-dir /path/to/your/repo \
    --base-url https://your-app.example.com \
    --output tests.json
```

#### 2. Guided Discovery (Focus Areas)

Direct the agent to focus on specific areas:

```bash
python discover.py \
    --root-dir /path/to/your/repo \
    --base-url https://your-app.example.com \
    --focus "checkout,user authentication,search" \
    --output tests.json
```

#### 3. Prompted Discovery (Custom Instructions)

Provide detailed instructions:

```bash
python discover.py \
    --root-dir /path/to/your/repo \
    --base-url https://your-app.example.com \
    --prompt "Focus on e-commerce flows. Test the complete purchase journey from browsing to checkout. Ignore admin and internal pages." \
    --output tests.json
```

### Additional Options

```bash
# Limit number of tests
python discover.py -r ./repo -u https://example.com --max-tests 20 -o tests.json

# Exclude directories
python discover.py -r ./repo -u https://example.com --exclude "admin,internal,docs" -o tests.json

# Verbose output (see agent's exploration)
python discover.py -r ./repo -u https://example.com --verbose -o tests.json

# Combine options
python discover.py \
    --root-dir ./repo \
    --base-url https://example.com \
    --focus "checkout,forms" \
    --prompt "Pay special attention to error handling and validation messages" \
    --max-tests 30 \
    --exclude "admin" \
    --verbose \
    --output tests.json
```

## Output Format

The discovery agent generates a JSON file compatible with AT Agent:

```json
[
  {
    "url": "https://example.com/login",
    "goal": "Navigate to the login form, enter credentials using keyboard only, and submit the form"
  },
  {
    "url": "https://example.com/products",
    "goal": "Browse the product listing, filter by category, and add an item to cart using screen reader navigation"
  },
  {
    "url": "https://example.com/checkout",
    "goal": "Complete the checkout process including shipping address and payment forms"
  }
]
```

## CI/CD Integration

### GitHub Actions

```yaml
jobs:
  discover-tests:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v4

      - name: Set up Python
        uses: actions/setup-python@v5
        with:
          python-version: '3.11'

      - name: Install discovery agent
        run: |
          cd discovery-agent
          pip install -r requirements.txt

      - name: Discover tests
        env:
          OPENAI_API_KEY: ${{ secrets.OPENAI_API_KEY }}
        run: |
          python discovery-agent/discover.py \
            --root-dir . \
            --base-url ${{ vars.APP_URL }} \
            --focus "checkout,authentication" \
            --max-tests 20 \
            --output discovered-tests.json

      - name: Run discovered tests
        uses: ./.github/actions/accessibility-agent
        with:
          test-config: discovered-tests.json
          openai-api-key: ${{ secrets.OPENAI_API_KEY }}
```

### GitLab CI

```yaml
discover-and-test:
  stage: test
  image: python:3.11
  variables:
    APP_URL: "https://your-app.example.com"
  before_script:
    - pip install -r discovery-agent/requirements.txt
  script:
    - python discovery-agent/discover.py
        --root-dir .
        --base-url $APP_URL
        --output discovered-tests.json
    # Then run the tests with AT Agent
```

### Azure DevOps

```yaml
steps:
  - task: UsePythonVersion@0
    inputs:
      versionSpec: '3.11'

  - script: |
      pip install -r discovery-agent/requirements.txt
      python discovery-agent/discover.py \
        --root-dir $(Build.SourcesDirectory) \
        --base-url $(APP_URL) \
        --output discovered-tests.json
    displayName: 'Discover accessibility tests'
    env:
      OPENAI_API_KEY: $(OPENAI_API_KEY)

  - task: accessibility-agent@1
    inputs:
      testConfig: discovered-tests.json
      # ... other inputs
```

## How It Works

1. **Codebase Exploration**: The agent uses filesystem tools (`ls`, `glob`, `read_file`, `grep`) to explore your codebase
2. **Pattern Recognition**: It identifies route definitions, components, forms, and navigation patterns
3. **Workflow Mapping**: It builds a mental map of user-facing pages and features
4. **Test Generation**: It generates test cases that cover realistic accessibility scenarios

## What the Agent Looks For

- **Routes**: React Router, Next.js pages/app directory, Express routes, etc.
- **Forms**: Login, signup, checkout, contact forms
- **Navigation**: Menus, breadcrumbs, pagination
- **Interactive Elements**: Buttons, modals, dropdowns, accordions
- **Dynamic Content**: Search results, filters, infinite scroll
- **Error States**: Validation messages, error pages

## Security

The discovery agent runs with `virtual_mode=True` which:
- Sandboxes all file operations under the specified root directory
- Prevents path traversal attacks
- Normalizes all paths for safety

The agent has **read-only** access to the filesystem - it cannot modify any files.

## Troubleshooting

### No tests generated

- Ensure the codebase has recognizable route/page patterns
- Try using `--verbose` to see what the agent is exploring
- Provide more specific `--focus` areas or `--prompt` instructions

### API errors

- Verify `OPENAI_API_KEY` is set correctly
- Check API quota and rate limits

### Missing routes

- Check if routes are in excluded directories
- Use `--exclude` to explicitly remove problematic directories
