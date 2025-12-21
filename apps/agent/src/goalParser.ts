/**
 * Goal Parser Utility
 * Parses multi-step goals into individual steps for stepwise agent execution.
 */

export interface ParsedStep {
  stepNumber: number;
  text: string;
  isLast: boolean;
}

/**
 * Parse a multi-step goal string into individual steps.
 * Handles numbered steps like "1. Do X. 2. Do Y. 3. Do Z."
 *
 * @param goal - The full goal string with numbered steps
 * @returns Array of parsed steps
 */
export function parseGoalSteps(goal: string): ParsedStep[] {
  // Match patterns like "1. ", "2. ", etc. at the start or after whitespace/period
  const stepPattern = /(?:^|\s)(\d+)\.\s+/g;

  const steps: ParsedStep[] = [];
  const matches: { index: number; stepNumber: number }[] = [];

  let match;
  while ((match = stepPattern.exec(goal)) !== null) {
    matches.push({
      index: match.index + (match[0].startsWith(' ') ? 1 : 0), // Adjust for leading space
      stepNumber: parseInt(match[1], 10),
    });
  }

  if (matches.length === 0) {
    // No numbered steps found, treat the whole goal as a single step
    return [{
      stepNumber: 1,
      text: goal.trim(),
      isLast: true,
    }];
  }

  // Extract text between step markers
  for (let i = 0; i < matches.length; i++) {
    const currentMatch = matches[i];
    const nextMatch = matches[i + 1];

    // Find the start of the step text (after "N. ")
    const stepMarkerEnd = goal.indexOf('. ', currentMatch.index) + 2;

    // Find the end of the step text
    const stepTextEnd = nextMatch ? nextMatch.index : goal.length;

    // Extract and clean the step text
    let stepText = goal.substring(stepMarkerEnd, stepTextEnd).trim();

    // Remove trailing period if present (we'll add context later)
    if (stepText.endsWith('.')) {
      stepText = stepText.slice(0, -1).trim();
    }

    steps.push({
      stepNumber: currentMatch.stepNumber,
      text: stepText,
      isLast: i === matches.length - 1,
    });
  }

  return steps;
}

/**
 * Check if a step already contains termination instructions.
 * Looks for patterns like "finish run", "finish_run", "call finish", etc.
 */
function hasTerminationInstruction(text: string): boolean {
  const lowerText = text.toLowerCase();
  return (
    lowerText.includes('finish run') ||
    lowerText.includes('finish_run') ||
    lowerText.includes('call finish') ||
    lowerText.includes('report success')
  );
}

/**
 * Format a step as a goal for the agent.
 * Adds context to help the agent understand what to do.
 *
 * @param step - The parsed step
 * @param previousStepCompleted - Optional description of what was just completed
 * @returns Formatted goal string for the agent
 */
export function formatStepAsGoal(step: ParsedStep, previousStepCompleted?: string): string {
  let goal = step.text;

  // Don't add termination instruction if step already has one
  if (hasTerminationInstruction(goal)) {
    return goal;
  }

  // Add termination instruction for intermediate steps only
  if (!step.isLast) {
    goal += '. Once this step is done, call finish_run with success=true.';
  }

  return goal;
}

/**
 * Extract success criteria from the original goal if present.
 * Looks for phrases like "with the reason as the url" or similar.
 */
export function extractSuccessReasonHint(goal: string): string | null {
  // Look for "with the reason as X" pattern
  const reasonMatch = goal.match(/with the reason as ([^.]+)/i);
  if (reasonMatch) {
    return reasonMatch[1].trim();
  }
  return null;
}
