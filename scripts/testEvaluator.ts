import { Evaluator } from '../evaluation/src/Evaluator';
import { AXNode } from '../browser/src/types';
import { AgentTrace } from '../agent/src/types';
import { PageMetadata } from '../evaluation/src/types';

const evaluator = new Evaluator();

// Mock Data
const mockTrace: AgentTrace = {
  goal: 'test',
  steps: [],
  success: true
};

const mockMetadata: PageMetadata = {
  title: '', // Violation: Missing Title
  lang: '',  // Violation: Missing Lang
  duplicateIds: ['header', 'header'] // Violation: Duplicate IDs
};

const mockAXTree: AXNode[] = [
  {
    nodeId: '1',
    backendDOMNodeId: 1,
    ignored: false,
    role: { type: 'role', value: 'image' },
    name: { type: 'string', value: '' } // Violation: Image missing alt
  },
  {
    nodeId: '2',
    backendDOMNodeId: 2,
    ignored: false,
    role: { type: 'role', value: 'link' },
    name: { type: 'string', value: 'click here' } // Violation: Suspicious link text
  },
  {
    nodeId: '3',
    backendDOMNodeId: 3,
    ignored: false,
    role: { type: 'role', value: 'button' },
    name: { type: 'string', value: '' } // Violation: Button missing name
  }
];

// Run Evaluation
console.log("Running Evaluator Test...");
const violations = evaluator.evaluate(mockAXTree, mockTrace, mockMetadata);

// Check Results
const expectedRuleIds = [
  'WCAG-2.4.2', // Missing Title
  'WCAG-3.1.1', // Missing Lang
  'WCAG-4.1.1', // Duplicate IDs
  'WCAG-1.1.1', // Image missing alt
  'WCAG-2.4.4', // Suspicious link text
  'WCAG-4.1.2', // Button missing name
  'WCAG-2.4.1'  // Missing Landmarks (implicit since no landmarks in tree)
];

let passed = true;
expectedRuleIds.forEach(ruleId => {
  const found = violations.find(v => v.ruleId === ruleId);
  if (found) {
    console.log(`✅ Detected ${ruleId}: ${found.description}`);
  } else {
    console.log(`❌ Failed to detect ${ruleId}`);
    passed = false;
  }
});

if (passed) {
  console.log("\nAll checks passed!");
} else {
  console.log("\nSome checks failed.");
  process.exit(1);
}
