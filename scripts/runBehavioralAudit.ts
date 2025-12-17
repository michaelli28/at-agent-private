#!/usr/bin/env npx ts-node

/**
 * CLI script for running WCAG Behavioral Audits
 *
 * Usage:
 *   npx ts-node scripts/runBehavioralAudit.ts <url> [options]
 *
 * Options:
 *   --level          WCAG level: A, AA, or both (default: AA)
 *   --max-tasks      Maximum tasks to generate (default: 20)
 *   --parallel       Number of parallel task executions (default: 1)
 *   --timeout        Timeout per task in seconds (default: 120)
 *   --output         Output file path (default: behavioral-audit-report.json)
 *   --model          LLM model for task generation (default: openai/gpt-4o)
 *   --verbose        Show detailed progress
 *   --max-pages      Maximum pages to analyze (default: 50)
 *   --crawl-depth    Crawl depth for site analysis (default: 2)
 *   --pagerank-weight PageRank weight for prioritization (default: 0.4)
 *
 * Examples:
 *   npx ts-node scripts/runBehavioralAudit.ts https://example.com
 *   npx ts-node scripts/runBehavioralAudit.ts https://example.com --level AA --max-tasks 30
 *   npx ts-node scripts/runBehavioralAudit.ts https://example.com --verbose --output report.json
 */

// Load environment variables from .env file
import * as dotenv from 'dotenv';
dotenv.config();

import * as fs from 'fs';
import { BehavioralAudit } from '../agent/src/behavioral-audit/BehavioralAudit';
import { BehavioralAuditOptions, BehavioralAuditEvent } from '../agent/src/behavioral-audit/types';

// Parse command line arguments
function parseArgs(): { url: string; options: Partial<BehavioralAuditOptions> & { outputPath: string } } {
  const args = process.argv.slice(2);

  if (args.length === 0 || args[0] === '--help' || args[0] === '-h') {
    console.log(`
WCAG Behavioral Audit - Autonomous accessibility testing

Usage:
  npx ts-node scripts/runBehavioralAudit.ts <url> [options]

Options:
  --level <A|AA|both>     WCAG level to test (default: AA)
  --max-tasks <n>         Maximum tasks to generate (default: 20)
  --parallel <n>          Parallel task executions (default: 1)
  --timeout <seconds>     Timeout per task in seconds (default: 120)
  --output <path>         Output file path (default: behavioral-audit-report.json)
  --model <model>         LLM model ID (default: openai/gpt-4o)
  --verbose               Show detailed progress
  --max-pages <n>         Maximum pages to analyze (default: 50)
  --crawl-depth <n>       Crawl depth (default: 2)
  --pagerank-weight <n>   PageRank weight 0-1 (default: 0.4)
  --help, -h              Show this help

Examples:
  npx ts-node scripts/runBehavioralAudit.ts https://example.com
  npx ts-node scripts/runBehavioralAudit.ts https://example.com --level AA --max-tasks 30 --verbose
  npx ts-node scripts/runBehavioralAudit.ts https://example.com --timeout 180 --parallel 2

Environment Variables:
  OPENROUTER_API_KEY      Required for LLM-based task generation
`);
    process.exit(0);
  }

  const url = args[0];
  const options: Partial<BehavioralAuditOptions> & { outputPath: string } = {
    outputPath: 'behavioral-audit-report.json',
  };

  for (let i = 1; i < args.length; i++) {
    const arg = args[i];
    const nextArg = args[i + 1];

    switch (arg) {
      case '--level':
        if (nextArg === 'A' || nextArg === 'AA' || nextArg === 'both') {
          options.level = nextArg;
        }
        i++;
        break;

      case '--max-tasks':
        options.maxTasks = parseInt(nextArg, 10);
        i++;
        break;

      case '--parallel':
        options.parallel = parseInt(nextArg, 10);
        i++;
        break;

      case '--timeout':
        // Convert seconds to milliseconds
        options.taskTimeout = parseInt(nextArg, 10) * 1000;
        i++;
        break;

      case '--output':
        options.outputPath = nextArg;
        i++;
        break;

      case '--model':
        options.model = nextArg;
        i++;
        break;

      case '--verbose':
        options.verbose = true;
        break;

      case '--max-pages':
        options.maxPagesToAnalyze = parseInt(nextArg, 10);
        i++;
        break;

      case '--crawl-depth':
        options.crawlDepth = parseInt(nextArg, 10);
        i++;
        break;

      case '--pagerank-weight':
        options.pageRankWeight = parseFloat(nextArg);
        i++;
        break;
    }
  }

  return { url, options };
}

// Format duration
function formatDuration(ms: number): string {
  const seconds = Math.floor(ms / 1000);
  const minutes = Math.floor(seconds / 60);
  const remainingSeconds = seconds % 60;

  if (minutes > 0) {
    return `${minutes}m ${remainingSeconds}s`;
  }
  return `${seconds}s`;
}

// Event handler for progress updates
function createEventHandler(verbose: boolean): (event: BehavioralAuditEvent) => void {
  return (event: BehavioralAuditEvent) => {
    switch (event.type) {
      case 'audit_started':
        console.log(`\n🔍 Starting WCAG Behavioral Audit for ${event.url}`);
        console.log(`   Level: ${event.options.level}, Max Tasks: ${event.options.maxTasks}`);
        break;

      case 'crawl_started':
        console.log(`\n📡 Crawling website: ${event.url}`);
        break;

      case 'crawl_progress':
        if (verbose) {
          process.stdout.write(`\r   Pages analyzed: ${event.pagesAnalyzed}/${event.totalPages}`);
        }
        break;

      case 'crawl_completed':
        console.log(`\n✅ Crawl completed: ${event.pageCount} pages analyzed`);
        break;

      case 'tasks_generated':
        console.log(`\n📝 Generated ${event.taskCount} test tasks`);
        if (verbose) {
          console.log(`   By category: ${JSON.stringify(event.byCategory)}`);
        }
        break;

      case 'task_started':
        if (verbose) {
          console.log(`\n▶️  Starting task: ${event.taskId}`);
          console.log(`   Goal: ${event.goal.substring(0, 80)}...`);
        }
        break;

      case 'task_completed':
        const status = event.passed ? '✅' : '❌';
        if (verbose) {
          console.log(`   ${status} Completed in ${event.stepsCount} steps`);
        } else {
          process.stdout.write(event.passed ? '.' : 'F');
        }
        break;

      case 'audit_completed':
        console.log('\n');
        console.log('═'.repeat(60));
        console.log('📊 WCAG Behavioral Audit Report');
        console.log('═'.repeat(60));
        console.log(`\nURL: ${event.report.url}`);
        console.log(`Duration: ${formatDuration(event.report.durationMs)}`);
        console.log(`Pages Analyzed: ${event.report.pagesAnalyzed}`);
        console.log(`Workflows Generated: ${event.report.workflowsGenerated}`);

        console.log('\n📈 Summary:');
        console.log(`   Total Tasks: ${event.report.summary.totalTasks}`);
        console.log(`   Passed: ${event.report.summary.passed}`);
        console.log(`   Failed: ${event.report.summary.failed}`);
        console.log(`   Pass Rate: ${event.report.summary.passRate.toFixed(1)}%`);

        console.log('\n🎯 WCAG Coverage:');
        const cov = event.report.summary.wcagCoverage;
        console.log(`   Criteria Tested: ${cov.testedCriteria}/${cov.totalCriteria} (${cov.coveragePercent.toFixed(1)}%)`);
        console.log(`   Level A: ${cov.byLevel.A.passed}/${cov.byLevel.A.tested} passed`);
        console.log(`   Level AA: ${cov.byLevel.AA.passed}/${cov.byLevel.AA.tested} passed`);

        if (event.report.byCategory.length > 0) {
          console.log('\n📁 By Category:');
          for (const cat of event.report.byCategory) {
            console.log(`   ${cat.category}: ${cat.passed}/${cat.totalTasks} passed (${cat.passRate.toFixed(1)}%)`);
          }
        }

        if (event.report.recommendations.length > 0) {
          console.log('\n💡 Recommendations:');
          for (const rec of event.report.recommendations.slice(0, 5)) {
            console.log(`   • ${rec}`);
          }
        }

        console.log('\n' + '═'.repeat(60));
        break;

      case 'audit_error':
        console.error(`\n❌ Audit error: ${event.error}`);
        break;
    }
  };
}

// Main function
async function main(): Promise<void> {
  const { url, options } = parseArgs();

  // Check for API key
  if (!process.env.OPENROUTER_API_KEY) {
    console.warn('⚠️  Warning: OPENROUTER_API_KEY not set. LLM task generation will be limited.');
  }

  // Create and configure audit
  const audit = new BehavioralAudit(options);
  audit.setEventCallback(createEventHandler(options.verbose || false));

  try {
    // Run audit
    const report = await audit.run(url);

    // Save report
    const outputPath = options.outputPath;
    fs.writeFileSync(outputPath, JSON.stringify(report, null, 2));
    console.log(`\n💾 Report saved to: ${outputPath}`);

    // Exit with appropriate code
    const passRate = report.summary.passRate;
    if (passRate < 50) {
      console.log('\n⚠️  Warning: Pass rate below 50%. Accessibility issues detected.');
      process.exit(1);
    } else if (passRate < 80) {
      console.log('\n📝 Some accessibility issues found. Review the report.');
      process.exit(0);
    } else {
      console.log('\n✅ Good accessibility compliance!');
      process.exit(0);
    }
  } catch (error) {
    console.error('\n❌ Audit failed:', error);
    process.exit(2);
  }
}

main();
