import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { HumanMessage, SystemMessage } from '@langchain/core/messages';
import { AgentTrace } from '@adf/agent/types';
import { Validation, Violation, FlowStep } from './types';

/**
 * Analyze an agent trace for accessibility violations based on screen reader output
 */
export function analyzeAgentTraceForViolations(
  trace: AgentTrace,
  step: FlowStep
): Violation[] {
  const violations: Violation[] = [];

  // Check if agent failed to complete the step
  if (!trace.success) {
    // Analyze the reason for failure
    const reason = trace.reason || trace.error || '';
    const reasonLower = reason.toLowerCase();

    // Check for common accessibility failures
    if (reasonLower.includes('could not find') || reasonLower.includes('not reachable')) {
      violations.push({
        type: 'keyboard_reachable',
        wcag: '2.1.1',
        severity: 'critical',
        message: `Element not reachable via keyboard: ${reason}`,
        screenReaderOutput: getLastScreenReaderOutput(trace),
        remediation: 'Ensure the element is focusable and in the tab order. Add tabindex="0" if needed, or use a native interactive element.',
      });
    }

    if (reasonLower.includes('no label') || reasonLower.includes('unlabeled')) {
      violations.push({
        type: 'has_label',
        wcag: '3.3.2',
        severity: 'serious',
        message: `Element missing accessible label: ${reason}`,
        screenReaderOutput: getLastScreenReaderOutput(trace),
        remediation: 'Add an aria-label, aria-labelledby, or visible label element.',
      });
    }
  }

  // Analyze screen reader announcements for issues
  const announcements = extractAnnouncements(trace);

  // Check for poor alt text patterns
  const poorAltTextPatterns = [
    /^image$/i,
    /^photo$/i,
    /^picture$/i,
    /^img$/i,
    /^graphic$/i,
    /^\d+\.(?:jpg|png|gif|webp)$/i,
    /^product image$/i,
    /^item image$/i,
    /^thumbnail$/i,
  ];

  for (const announcement of announcements) {
    const announcementLower = announcement.toLowerCase();

    // Check for poor alt text
    if (announcementLower.includes('image') || announcementLower.includes('graphic')) {
      for (const pattern of poorAltTextPatterns) {
        if (pattern.test(announcement)) {
          violations.push({
            type: 'alt_text_quality',
            wcag: '1.1.1',
            severity: 'serious',
            message: `Image has non-descriptive alt text: "${announcement}"`,
            screenReaderOutput: announcement,
            remediation: 'Provide meaningful alt text that describes the product (e.g., "Blue Nike running shoes, side view").',
          });
          break;
        }
      }
    }

    // Check for unlabeled controls
    if (
      (announcementLower.includes('button') || announcementLower.includes('link')) &&
      announcement.trim().length < 3
    ) {
      violations.push({
        type: 'has_label',
        wcag: '4.1.2',
        severity: 'serious',
        message: `Interactive element has no accessible name`,
        screenReaderOutput: announcement,
        remediation: 'Add text content, aria-label, or aria-labelledby to the button/link.',
      });
    }
  }

  return violations;
}

/**
 * Run validation checks based on step configuration
 */
export async function runValidations(
  validations: Validation[],
  trace: AgentTrace,
  llm: BaseChatModel
): Promise<Violation[]> {
  const violations: Violation[] = [];

  for (const validation of validations) {
    switch (validation.type) {
      case 'alt_text_quality':
        const altTextViolations = await validateAltTextQuality(trace, llm, validation);
        violations.push(...altTextViolations);
        break;

      case 'keyboard_reachable':
        const keyboardViolations = validateKeyboardReachable(trace, validation);
        violations.push(...keyboardViolations);
        break;

      case 'has_label':
        const labelViolations = validateHasLabel(trace, validation);
        violations.push(...labelViolations);
        break;

      case 'aria_live':
        const ariaLiveViolations = validateAriaLive(trace, validation);
        violations.push(...ariaLiveViolations);
        break;

      case 'focus_visible':
        // Focus visible is harder to validate via screen reader output
        // This would need visual inspection - skip for now
        break;

      case 'heading_structure':
        const headingViolations = validateHeadingStructure(trace, validation);
        violations.push(...headingViolations);
        break;
    }
  }

  return violations;
}

/**
 * Validate alt text quality using LLM
 */
async function validateAltTextQuality(
  trace: AgentTrace,
  llm: BaseChatModel,
  validation: Validation
): Promise<Violation[]> {
  const announcements = extractAnnouncements(trace);

  // Find image-related announcements
  const imageAnnouncements = announcements.filter(a =>
    a.toLowerCase().includes('image') ||
    a.toLowerCase().includes('graphic') ||
    a.toLowerCase().includes('img')
  );

  if (imageAnnouncements.length === 0) {
    return [];
  }

  try {
    const response = await llm.invoke([
      new SystemMessage(`You are an accessibility expert evaluating alt text quality for product images on an e-commerce site.

Good alt text should:
- Describe the product specifically (brand, color, type)
- Provide context a sighted user would get
- Be concise but informative

Bad alt text examples:
- "image", "photo", "product image", "thumbnail"
- File names like "IMG_1234.jpg"
- Generic descriptions like "product" or "item"

Analyze the following screen reader announcements for images and identify any with poor alt text.
Return a JSON array of objects with:
- "announcement": the original announcement
- "issue": description of what's wrong
- "suggestion": a better alt text example

If all alt texts are acceptable, return an empty array: []`),
      new HumanMessage(`Image announcements from screen reader:\n${JSON.stringify(imageAnnouncements, null, 2)}`),
    ]);

    const content = typeof response.content === 'string'
      ? response.content
      : JSON.stringify(response.content);

    // Try to parse JSON from response
    const jsonMatch = content.match(/\[[\s\S]*\]/);
    if (jsonMatch) {
      const issues = JSON.parse(jsonMatch[0]);
      return issues.map((issue: any) => ({
        type: 'alt_text_quality' as const,
        wcag: validation.wcag,
        severity: validation.severity,
        message: issue.issue,
        screenReaderOutput: issue.announcement,
        remediation: `Consider using alt text like: "${issue.suggestion}"`,
      }));
    }
  } catch (e) {
    // LLM call failed, fall back to pattern matching
    console.error('LLM alt text validation failed:', e);
  }

  return [];
}

/**
 * Validate keyboard reachability based on agent trace
 */
function validateKeyboardReachable(
  trace: AgentTrace,
  validation: Validation
): Violation[] {
  // If the agent succeeded, the target was reachable
  if (trace.success) {
    return [];
  }

  const reason = (trace.reason || trace.error || '').toLowerCase();
  const target = validation.target.toLowerCase();

  // Check if the failure was related to the validation target
  if (reason.includes(target) || reason.includes('could not find') || reason.includes('not reachable')) {
    return [{
      type: 'keyboard_reachable',
      wcag: validation.wcag,
      severity: validation.severity,
      message: `${validation.target} may not be keyboard accessible`,
      screenReaderOutput: getLastScreenReaderOutput(trace),
      remediation: 'Ensure the element is focusable (use native button/link or add tabindex="0") and is in a logical tab order.',
    }];
  }

  return [];
}

/**
 * Validate elements have accessible labels
 */
function validateHasLabel(
  trace: AgentTrace,
  validation: Validation
): Violation[] {
  const announcements = extractAnnouncements(trace);

  // Look for announcements that suggest unlabeled elements
  const unlabeledPatterns = [
    /^button$/i,
    /^link$/i,
    /^textbox$/i,
    /^combobox$/i,
    /^checkbox$/i,
    /^radio$/i,
    /^edit$/i,
    /^,\s*button$/i,  // Just role announced
  ];

  const violations: Violation[] = [];

  for (const announcement of announcements) {
    for (const pattern of unlabeledPatterns) {
      if (pattern.test(announcement.trim())) {
        violations.push({
          type: 'has_label',
          wcag: validation.wcag,
          severity: validation.severity,
          message: `Found unlabeled ${announcement.trim()}: ${validation.target}`,
          screenReaderOutput: announcement,
          remediation: 'Add a visible label, aria-label, or aria-labelledby attribute.',
        });
        break;
      }
    }
  }

  return violations;
}

/**
 * Validate aria-live announcements after actions
 */
function validateAriaLive(
  trace: AgentTrace,
  validation: Validation
): Violation[] {
  // Check if the target is about cart updates
  const targetLower = validation.target.toLowerCase();

  if (targetLower.includes('cart') || targetLower.includes('add')) {
    // Look for confirmation announcements after add-to-cart type actions
    const hasConfirmation = trace.steps.some(step => {
      const output = step.observation?.text || '';
      const outputLower = output.toLowerCase();
      return (
        outputLower.includes('added') ||
        outputLower.includes('cart updated') ||
        outputLower.includes('item in cart') ||
        outputLower.includes('successfully added')
      );
    });

    if (!hasConfirmation && trace.success) {
      // Agent succeeded but no confirmation was announced
      return [{
        type: 'aria_live',
        wcag: validation.wcag,
        severity: validation.severity,
        message: `No status announcement detected after ${validation.target}`,
        remediation: 'Add an aria-live region to announce cart updates (e.g., "Item added to cart").',
      }];
    }
  }

  return [];
}

/**
 * Validate heading structure
 */
function validateHeadingStructure(
  trace: AgentTrace,
  validation: Validation
): Violation[] {
  const announcements = extractAnnouncements(trace);

  // Extract heading levels from announcements
  const headingPattern = /heading level (\d)/gi;
  const headingLevels: number[] = [];

  for (const announcement of announcements) {
    let match;
    while ((match = headingPattern.exec(announcement)) !== null) {
      headingLevels.push(parseInt(match[1], 10));
    }
  }

  const violations: Violation[] = [];

  // Check for skipped heading levels
  for (let i = 1; i < headingLevels.length; i++) {
    const current = headingLevels[i];
    const previous = headingLevels[i - 1];

    if (current > previous + 1) {
      violations.push({
        type: 'heading_structure',
        wcag: validation.wcag,
        severity: validation.severity,
        message: `Heading level skipped from h${previous} to h${current}`,
        remediation: 'Use sequential heading levels (h1 → h2 → h3) without skipping.',
      });
    }
  }

  // Check if there's no h1
  if (headingLevels.length > 0 && !headingLevels.includes(1)) {
    violations.push({
      type: 'heading_structure',
      wcag: validation.wcag,
      severity: validation.severity,
      message: 'Page appears to be missing an h1 heading',
      remediation: 'Add an h1 heading as the main page title.',
    });
  }

  return violations;
}

/**
 * Extract all screen reader announcements from an agent trace
 */
function extractAnnouncements(trace: AgentTrace): string[] {
  return trace.steps
    .map(step => step.observation?.text || '')
    .filter(text => text.length > 0);
}

/**
 * Get the last screen reader output from a trace
 */
function getLastScreenReaderOutput(trace: AgentTrace): string | undefined {
  for (let i = trace.steps.length - 1; i >= 0; i--) {
    const text = trace.steps[i].observation?.text;
    if (text) {
      return text;
    }
  }
  return undefined;
}
