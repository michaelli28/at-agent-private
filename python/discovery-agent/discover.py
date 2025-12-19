#!/usr/bin/env python3
"""
AT Agent Test Suite Discovery

Uses LangChain Deep Agents to automatically discover and generate accessibility
test suites by exploring a codebase.

Usage:
    # Fully automatic discovery (agent explores freely)
    python discover.py --root-dir /path/to/repo --base-url https://example.com --output tests.json

    # Guided discovery with focus areas
    python discover.py --root-dir /path/to/repo --base-url https://example.com \
        --focus "checkout flow,user authentication" --output tests.json

    # Prompted discovery with custom instructions
    python discover.py --root-dir /path/to/repo --base-url https://example.com \
        --prompt "Focus on forms and navigation, ignore admin pages" --output tests.json

    # With max test limit
    python discover.py --root-dir /path/to/repo --base-url https://example.com \
        --max-tests 20 --output tests.json

Environment Variables:
    OPENAI_API_KEY - Required for the discovery agent
"""

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Optional

from dotenv import load_dotenv

load_dotenv()


def get_discovery_system_prompt(
    base_url: str,
    focus_areas: Optional[list[str]] = None,
    custom_prompt: Optional[str] = None,
    max_tests: Optional[int] = None,
    exclude_dirs: Optional[list[str]] = None,
) -> str:
    """Generate the system prompt for the discovery agent."""

    exclude_section = ""
    if exclude_dirs:
        exclude_section = f"""
## Directories to Exclude
Do NOT explore these directories:
{chr(10).join(f'- {d}' for d in exclude_dirs)}
"""

    focus_section = ""
    if focus_areas:
        focus_section = f"""
## Focus Areas
Prioritize discovering tests for these specific areas:
{chr(10).join(f'- {area}' for area in focus_areas)}
"""

    custom_section = ""
    if custom_prompt:
        custom_section = f"""
## Custom Instructions
{custom_prompt}
"""

    max_tests_section = ""
    if max_tests:
        max_tests_section = f"""
## Test Limit
Generate no more than {max_tests} test cases. Prioritize the most important user workflows.
"""

    return f"""You are an expert accessibility test suite generator. Your task is to explore a web application's codebase and generate a comprehensive accessibility test suite.

## Your Mission
1. Explore the codebase to understand the application's structure, routes, and user workflows
2. Identify all user-facing pages and interactive features
3. Generate accessibility test cases that cover real user journeys using a screen reader

## Base URL
The web application is deployed at: {base_url}
All test URLs should be based on this URL.

## What to Look For
- Route definitions (React Router, Next.js pages/app directory, Express routes, etc.)
- Forms and interactive elements
- Navigation patterns
- Authentication flows
- Key user workflows (checkout, signup, profile management, etc.)
- Dynamic content areas
- Modal dialogs and overlays
- Error states and validation messages
{exclude_section}
{focus_section}
{custom_section}
{max_tests_section}
## Output Format
After exploring the codebase, you MUST output a JSON array of test cases. Each test case should have:
- "url": The full URL to test (starting with {base_url})
- "goal": A clear, actionable goal describing what the screen reader user should accomplish

Example output format:
```json
[
  {{
    "url": "{base_url}/login",
    "goal": "Navigate to the login form, enter credentials using keyboard only, and submit the form"
  }},
  {{
    "url": "{base_url}/products",
    "goal": "Browse the product listing, filter by category, and add an item to cart using screen reader navigation"
  }}
]
```

## Guidelines for Good Test Goals
- Be specific about what user action to perform
- Focus on keyboard/screen reader navigation
- Test realistic user workflows, not just page loads
- Include form interactions where applicable
- Consider error states and edge cases
- Think about what a real user with a screen reader would need to accomplish

## Process
1. First, use `ls` and `glob` to understand the project structure
2. Use `read_file` to examine route definitions and key components
3. Use `grep` to find patterns like "route", "path", "href", "Link", "form", etc.
4. Build a mental map of all user-facing pages and features
5. Generate test cases that cover the most important user journeys
6. Output the final JSON array

Begin by exploring the codebase structure.
"""


def run_discovery(
    root_dir: str,
    base_url: str,
    focus_areas: Optional[list[str]] = None,
    custom_prompt: Optional[str] = None,
    max_tests: Optional[int] = None,
    exclude_dirs: Optional[list[str]] = None,
    verbose: bool = False,
) -> list[dict]:
    """
    Run the discovery agent to generate test cases.

    Args:
        root_dir: Root directory of the codebase to explore
        base_url: Base URL of the deployed web application
        focus_areas: Optional list of areas to focus on
        custom_prompt: Optional custom instructions
        max_tests: Optional maximum number of tests to generate
        exclude_dirs: Optional list of directories to exclude
        verbose: Print agent progress

    Returns:
        List of test case dictionaries with 'url' and 'goal' keys
    """
    from deepagents import create_deep_agent
    from deepagents.backends import FilesystemBackend
    from langchain_openai import ChatOpenAI

    # Validate OpenAI API key
    if not os.environ.get("OPENAI_API_KEY"):
        raise ValueError("OPENAI_API_KEY environment variable is required")

    # Resolve root directory to absolute path
    root_path = Path(root_dir).resolve()
    if not root_path.exists():
        raise ValueError(f"Root directory does not exist: {root_path}")

    # Default exclude directories
    default_excludes = [
        "node_modules",
        ".git",
        "dist",
        "build",
        ".next",
        "__pycache__",
        "venv",
        ".venv",
        "coverage",
        ".nyc_output",
    ]

    all_excludes = list(set(default_excludes + (exclude_dirs or [])))

    # Create the model
    model = ChatOpenAI(
        model="gpt-4o",
        temperature=0.2,  # Lower temperature for more consistent output
    )

    # Create the discovery agent with filesystem backend
    # virtual_mode=True provides security by sandboxing paths
    agent = create_deep_agent(
        model=model,
        backend=FilesystemBackend(
            root_dir=str(root_path),
            virtual_mode=True,
        ),
        system_prompt=get_discovery_system_prompt(
            base_url=base_url,
            focus_areas=focus_areas,
            custom_prompt=custom_prompt,
            max_tests=max_tests,
            exclude_dirs=all_excludes,
        ),
    )

    # Run the agent
    if verbose:
        print(f"Starting discovery in: {root_path}")
        print(f"Base URL: {base_url}")
        if focus_areas:
            print(f"Focus areas: {', '.join(focus_areas)}")
        print("-" * 50)

    result = agent.invoke({
        "messages": [{
            "role": "user",
            "content": "Please explore this codebase and generate an accessibility test suite. Output the final test cases as a JSON array."
        }]
    })

    # Extract the final message content
    final_message = result["messages"][-1].content

    if verbose:
        print("-" * 50)
        print("Agent response:")
        print(final_message)
        print("-" * 50)

    # Parse JSON from the response
    test_cases = extract_json_from_response(final_message)

    if not test_cases:
        raise ValueError("Failed to extract test cases from agent response")

    return test_cases


def extract_json_from_response(response: str) -> list[dict]:
    """Extract JSON array from agent response."""
    import re

    # Try to find JSON in code blocks first
    json_block_pattern = r'```(?:json)?\s*([\[\{].*?[\]\}])\s*```'
    matches = re.findall(json_block_pattern, response, re.DOTALL)

    for match in matches:
        try:
            parsed = json.loads(match)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            continue

    # Try to find raw JSON array
    array_pattern = r'\[\s*\{.*?\}\s*\]'
    matches = re.findall(array_pattern, response, re.DOTALL)

    for match in matches:
        try:
            parsed = json.loads(match)
            if isinstance(parsed, list):
                return parsed
        except json.JSONDecodeError:
            continue

    # Last resort: try parsing the entire response
    try:
        parsed = json.loads(response)
        if isinstance(parsed, list):
            return parsed
    except json.JSONDecodeError:
        pass

    return []


def main():
    parser = argparse.ArgumentParser(
        description="Automatically discover and generate accessibility test suites",
        formatter_class=argparse.RawDescriptionHelpFormatter,
        epilog=__doc__,
    )

    parser.add_argument(
        "--root-dir",
        "-r",
        required=True,
        help="Root directory of the codebase to explore",
    )

    parser.add_argument(
        "--base-url",
        "-u",
        required=True,
        help="Base URL of the deployed web application",
    )

    parser.add_argument(
        "--output",
        "-o",
        default="discovered-tests.json",
        help="Output file for generated test suite (default: discovered-tests.json)",
    )

    parser.add_argument(
        "--focus",
        "-f",
        help="Comma-separated list of areas to focus on (e.g., 'checkout,login,search')",
    )

    parser.add_argument(
        "--prompt",
        "-p",
        help="Custom prompt/instructions for the discovery agent",
    )

    parser.add_argument(
        "--max-tests",
        "-m",
        type=int,
        help="Maximum number of test cases to generate",
    )

    parser.add_argument(
        "--exclude",
        "-e",
        help="Comma-separated list of directories to exclude from exploration",
    )

    parser.add_argument(
        "--verbose",
        "-v",
        action="store_true",
        help="Print verbose output",
    )

    args = parser.parse_args()

    # Parse comma-separated lists
    focus_areas = [f.strip() for f in args.focus.split(",")] if args.focus else None
    exclude_dirs = [e.strip() for e in args.exclude.split(",")] if args.exclude else None

    try:
        test_cases = run_discovery(
            root_dir=args.root_dir,
            base_url=args.base_url,
            focus_areas=focus_areas,
            custom_prompt=args.prompt,
            max_tests=args.max_tests,
            exclude_dirs=exclude_dirs,
            verbose=args.verbose,
        )

        # Write output
        output_path = Path(args.output)
        with open(output_path, "w") as f:
            json.dump(test_cases, f, indent=2)

        print(f"Generated {len(test_cases)} test cases")
        print(f"Output written to: {output_path}")

        # Also print to stdout for CI/CD integration
        if not args.verbose:
            print(json.dumps(test_cases, indent=2))

    except Exception as e:
        print(f"Error: {e}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
