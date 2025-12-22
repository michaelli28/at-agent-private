import 'dotenv/config';
import { writeFileSync } from 'fs';
import { ShoppingFlowAgent } from '../shopping/ShoppingFlowAgent';
import { ShoppingFlowConfig, FlowStepName } from '../shopping/types';
import { getStepDescription } from '../shopping/flowSteps';

// ANSI color codes for console output
const colors = {
  reset: '\x1b[0m',
  bright: '\x1b[1m',
  dim: '\x1b[2m',
  green: '\x1b[32m',
  cyan: '\x1b[36m',
  yellow: '\x1b[33m',
  red: '\x1b[31m',
  magenta: '\x1b[35m',
};

function log(emoji: string, message: string) {
  console.log(`${emoji} ${colors.bright}${message}${colors.reset}`);
}

function logInfo(key: string, value: string) {
  console.log(
    `   ${colors.dim}${key}:${colors.reset} ${colors.cyan}${value}${colors.reset}`
  );
}

function parseArgs(): {
  url: string;
  search: string;
  output: string;
  productIndex: number;
  quantity: number;
  checkout: boolean;
  headed: boolean;
  provider: 'openai' | 'gemini';
} {
  const args = process.argv.slice(2);
  const result = {
    url: '',
    search: '',
    output: 'shopping-a11y-report.html',
    productIndex: 0,
    quantity: 1,
    checkout: false,
    headed: false,
    provider: 'openai' as 'openai' | 'gemini',
  };

  for (let i = 0; i < args.length; i++) {
    const arg = args[i];

    if (arg === '--search' || arg === '-s') {
      result.search = args[++i] || '';
    } else if (arg === '--output' || arg === '-o') {
      result.output = args[++i] || 'shopping-a11y-report.html';
    } else if (arg === '--product-index' || arg === '-p') {
      result.productIndex = parseInt(args[++i] || '0', 10);
    } else if (arg === '--quantity' || arg === '-q') {
      result.quantity = parseInt(args[++i] || '1', 10);
    } else if (arg === '--checkout' || arg === '-c') {
      result.checkout = true;
    } else if (arg === '--headed') {
      result.headed = true;
    } else if (arg === '--gemini') {
      result.provider = 'gemini';
    } else if (!arg.startsWith('-') && !result.url) {
      result.url = arg;
    }
  }

  return result;
}

function printUsage() {
  console.log(`
${colors.bright}Shopping Accessibility Testing Agent${colors.reset}

${colors.cyan}Usage:${colors.reset}
  npm run shopping-flow <url> --search "<term>" [options]

${colors.cyan}Required:${colors.reset}
  <url>                    E-commerce site URL to test
  --search, -s <term>      Search term to use

${colors.cyan}Options:${colors.reset}
  --output, -o <file>      Output HTML report file (default: shopping-a11y-report.html)
  --product-index, -p <n>  Which product to select from results (default: 0)
  --quantity, -q <n>       Quantity to add to cart (default: 1)
  --checkout, -c           Test checkout flow (stops at cart if login required)
  --headed                 Run browser in headed mode (visible)
  --gemini                 Use Gemini instead of OpenAI

${colors.cyan}Examples:${colors.reset}
  npm run shopping-flow https://amazon.com --search "headphones" -o report.html
  npm run shopping-flow https://shop.example.com -s "t-shirt" --checkout --headed

${colors.cyan}Environment Variables:${colors.reset}
  OPENAI_API_KEY           Required for OpenAI provider (default)
  GOOGLE_API_KEY           Required for Gemini provider
`);
}

async function main() {
  const args = parseArgs();

  if (!args.url || !args.search) {
    printUsage();
    process.exit(1);
  }

  console.clear();
  console.log(
    `${colors.bright}${colors.magenta}╔══════════════════════════════════════════════════════════╗${colors.reset}`
  );
  console.log(
    `${colors.bright}${colors.magenta}║     Shopping Accessibility Testing Agent                  ║${colors.reset}`
  );
  console.log(
    `${colors.bright}${colors.magenta}╚══════════════════════════════════════════════════════════╝${colors.reset}\n`
  );

  logInfo('Target URL', args.url);
  logInfo('Search term', args.search);
  logInfo('Output file', args.output);
  logInfo('Product index', String(args.productIndex));
  logInfo('Quantity', String(args.quantity));
  logInfo('Test checkout', args.checkout ? 'Yes' : 'No');
  logInfo('Browser mode', args.headed ? 'Headed' : 'Headless');
  logInfo('LLM provider', args.provider);
  console.log();

  const config: ShoppingFlowConfig = {
    siteUrl: args.url,
    searchTerm: args.search,
    productIndex: args.productIndex,
    quantity: args.quantity,
    completeCheckout: args.checkout,
    llmProvider: args.provider,
  };

  const stepEmojis: Record<FlowStepName, string> = {
    search: '🔍',
    results: '📋',
    product: '🛍️',
    cart: '🛒',
    checkout: '💳',
  };

  const agent = new ShoppingFlowAgent({
    headed: args.headed,
    onStepStart: (step, stepNumber, totalSteps) => {
      const emoji = stepEmojis[step.name];
      log(
        emoji,
        `Step ${stepNumber}/${totalSteps}: ${getStepDescription(step.name)}`
      );
    },
    onStepComplete: (result) => {
      if (result.passed) {
        console.log(
          `   ${colors.green}✓ Passed${colors.reset} (${result.violations.length} issues found)`
        );
      } else {
        console.log(
          `   ${colors.red}✗ Failed${colors.reset}: ${result.failureReason || 'Unknown error'}`
        );
      }
      if (result.violations.length > 0) {
        const critical = result.violations.filter(
          (v) => v.severity === 'critical'
        ).length;
        const serious = result.violations.filter(
          (v) => v.severity === 'serious'
        ).length;
        console.log(
          `   ${colors.dim}Issues: ${critical} critical, ${serious} serious${colors.reset}`
        );
      }
      console.log();
    },
    onAgentAction: (action) => {
      console.log(`   ${colors.dim}→ ${action}${colors.reset}`);
    },
  });

  try {
    log('🚀', 'Starting accessibility test...\n');
    const startTime = Date.now();

    const report = await agent.runFlow(config);

    const duration = ((Date.now() - startTime) / 1000).toFixed(1);

    // Print summary
    console.log(
      `${colors.bright}═══════════════════════════════════════════════════════════${colors.reset}\n`
    );

    if (report.passed) {
      log('✅', `Test PASSED in ${duration}s`);
    } else {
      log('❌', `Test FAILED in ${duration}s`);
    }

    console.log(`
   ${colors.dim}Steps passed:${colors.reset} ${report.summary.passedSteps}/${report.summary.totalSteps}
   ${colors.dim}Total violations:${colors.reset} ${report.summary.totalViolations}
   ${colors.dim}Critical:${colors.reset} ${colors.red}${report.summary.criticalViolations}${colors.reset}
   ${colors.dim}Serious:${colors.reset} ${colors.yellow}${report.summary.seriousViolations}${colors.reset}
`);

    // Save HTML report
    if (report.htmlReport) {
      writeFileSync(args.output, report.htmlReport);
      log('📄', `Report saved to: ${args.output}`);
    }

    // Exit with appropriate code
    process.exit(report.passed ? 0 : 1);
  } catch (error) {
    console.error(`\n${colors.red}❌ Fatal error:${colors.reset}`, error);
    process.exit(1);
  }
}

main();
