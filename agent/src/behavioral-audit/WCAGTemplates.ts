/**
 * WCAG Task Templates
 *
 * Defines task templates for WCAG 2.1 Level A and AA criteria.
 * Templates use placeholders that are instantiated with actual page elements.
 */

import { WCAGTaskTemplate, TaskCategory, WCAGLevel } from './types';

// ==================== Level A Templates ====================

const LEVEL_A_TEMPLATES: WCAGTaskTemplate[] = [
  // 1.1.1 Non-text Content
  {
    id: 'wcag-1.1.1-image-alt',
    wcagCriteria: ['1.1.1'],
    level: 'A',
    category: 'content',
    goalTemplate: 'Navigate through the page using arrow keys and identify all images. Verify that each image has a descriptive announcement. Report any images that are announced without meaningful descriptions.',
    applicableTo: { hasImages: true },
    successCriteria: { type: 'agent_success' },
    priority: 8,
    isCompound: false,
    estimatedSteps: 15,
  },

  // 1.3.1 Info and Relationships
  {
    id: 'wcag-1.3.1-form-labels',
    wcagCriteria: ['1.3.1'],
    level: 'A',
    category: 'forms',
    goalTemplate: 'Navigate to the {formName} form. For each form field, verify that the field\'s purpose is announced (e.g., "Email, edit text" or "Password, edit text, required"). Report any fields that lack clear labels.',
    applicableTo: { hasForm: true },
    successCriteria: { type: 'agent_success' },
    priority: 9,
    isCompound: false,
    estimatedSteps: 12,
  },
  {
    id: 'wcag-1.3.1-table-headers',
    wcagCriteria: ['1.3.1'],
    level: 'A',
    category: 'content',
    goalTemplate: 'Navigate to the data table on the page. Use table navigation (Ctrl+Alt+Arrow keys) to verify that row and column headers are announced when moving between cells.',
    applicableTo: { hasTable: true },
    successCriteria: { type: 'agent_success' },
    priority: 7,
    isCompound: false,
    estimatedSteps: 20,
  },

  // 2.1.1 Keyboard
  {
    id: 'wcag-2.1.1-keyboard-nav',
    wcagCriteria: ['2.1.1'],
    level: 'A',
    category: 'navigation',
    goalTemplate: 'Navigate to the "{pageName}" page using only keyboard. Use Tab to reach the navigation menu, find "{pageName}", and press Enter to activate the link.',
    applicableTo: { minPageRank: 0.01 },
    successCriteria: { type: 'agent_success' },
    priority: 10,
    isCompound: false,
    estimatedSteps: 8,
  },
  {
    id: 'wcag-2.1.1-interactive-keyboard',
    wcagCriteria: ['2.1.1'],
    level: 'A',
    category: 'widgets',
    goalTemplate: 'Find and interact with all {elementType} elements on the page using only keyboard. Press Tab to navigate between them and Enter or Space to activate. Verify each responds to keyboard interaction.',
    applicableTo: { hasInteractiveElements: ['button', 'link', 'menuitem'] },
    successCriteria: { type: 'agent_success' },
    priority: 10,
    isCompound: false,
    estimatedSteps: 15,
  },

  // 2.1.2 No Keyboard Trap
  {
    id: 'wcag-2.1.2-no-trap',
    wcagCriteria: ['2.1.2'],
    level: 'A',
    category: 'navigation',
    goalTemplate: 'Navigate through all interactive elements on the page using Tab. Verify that you can always move forward and that focus never gets stuck. If you encounter a modal or dropdown, verify you can escape using Escape key or Tab.',
    applicableTo: {},
    successCriteria: { type: 'agent_success' },
    priority: 10,
    isCompound: false,
    estimatedSteps: 25,
  },
  {
    id: 'wcag-2.1.2-dialog-escape',
    wcagCriteria: ['2.1.2'],
    level: 'A',
    category: 'widgets',
    goalTemplate: 'Find and open any dialog, modal, or dropdown menu on the page. Once inside, verify you can close it using the Escape key and that focus returns to a logical position.',
    applicableTo: { hasInteractiveElements: ['dialog', 'menu', 'combobox'] },
    successCriteria: { type: 'agent_success' },
    priority: 9,
    isCompound: false,
    estimatedSteps: 12,
  },

  // 2.4.1 Bypass Blocks
  {
    id: 'wcag-2.4.1-skip-link',
    wcagCriteria: ['2.4.1'],
    level: 'A',
    category: 'navigation',
    goalTemplate: 'From the very start of the page, press Tab once or twice. Look for a "Skip to main content" or similar skip link. If found, activate it and verify focus moves past the navigation to the main content area.',
    applicableTo: {},
    successCriteria: { type: 'agent_success' },
    priority: 8,
    isCompound: false,
    estimatedSteps: 6,
  },
  {
    id: 'wcag-2.4.1-landmark-nav',
    wcagCriteria: ['2.4.1'],
    level: 'A',
    category: 'navigation',
    goalTemplate: 'Use landmark navigation to quickly move between page sections. Press "D" to jump to landmarks and verify that main content areas (main, navigation, banner, contentinfo) can be reached directly.',
    applicableTo: { hasLandmarks: ['main', 'navigation'] },
    successCriteria: { type: 'agent_success' },
    priority: 7,
    isCompound: false,
    estimatedSteps: 10,
  },

  // 2.4.2 Page Titled
  {
    id: 'wcag-2.4.2-page-title',
    wcagCriteria: ['2.4.2'],
    level: 'A',
    category: 'content',
    goalTemplate: 'Verify that the page has a descriptive title that is announced when the page loads. The title should clearly describe the page\'s purpose or topic.',
    applicableTo: {},
    successCriteria: { type: 'agent_success' },
    priority: 6,
    isCompound: false,
    estimatedSteps: 3,
  },

  // 2.4.4 Link Purpose (In Context)
  {
    id: 'wcag-2.4.4-link-purpose',
    wcagCriteria: ['2.4.4'],
    level: 'A',
    category: 'navigation',
    goalTemplate: 'Navigate through the links on the page using Tab. For each link, verify that its purpose can be understood from the link text alone or from its surrounding context. Report any links with vague text like "click here" or "read more" without context.',
    applicableTo: { hasInteractiveElements: ['link'] },
    successCriteria: { type: 'agent_success' },
    priority: 7,
    isCompound: false,
    estimatedSteps: 20,
  },

  // 3.1.1 Language of Page
  {
    id: 'wcag-3.1.1-language',
    wcagCriteria: ['3.1.1'],
    level: 'A',
    category: 'content',
    goalTemplate: 'Navigate to the start of the page and verify that the page language is properly announced or can be inferred from the content structure.',
    applicableTo: {},
    successCriteria: { type: 'agent_success' },
    priority: 5,
    isCompound: false,
    estimatedSteps: 3,
  },

  // 3.3.1 Error Identification
  {
    id: 'wcag-3.3.1-form-errors',
    wcagCriteria: ['3.3.1'],
    level: 'A',
    category: 'forms',
    goalTemplate: 'Navigate to the {formName} form and submit it with empty or invalid data. Verify that error messages are announced and clearly identify which fields have errors.',
    applicableTo: { hasForm: true },
    successCriteria: { type: 'agent_success' },
    priority: 9,
    isCompound: true,
    estimatedSteps: 15,
  },

  // 3.3.2 Labels or Instructions
  {
    id: 'wcag-3.3.2-labels',
    wcagCriteria: ['3.3.2'],
    level: 'A',
    category: 'forms',
    goalTemplate: 'Navigate to the {formName} form using Tab. For each field, verify that a label is announced before or when the field receives focus. Note any fields that require specific formatting (like dates or phone numbers) and verify instructions are provided.',
    applicableTo: { hasForm: true },
    successCriteria: { type: 'agent_success' },
    priority: 8,
    isCompound: false,
    estimatedSteps: 12,
  },

  // 4.1.2 Name, Role, Value
  {
    id: 'wcag-4.1.2-widget-states',
    wcagCriteria: ['4.1.2'],
    level: 'A',
    category: 'widgets',
    goalTemplate: 'Find interactive widgets on the page (buttons, checkboxes, accordions, tabs). For each widget, verify that: 1) Its name/purpose is announced, 2) Its role is announced (button, checkbox, etc.), 3) Its current state is announced (expanded/collapsed, checked/unchecked).',
    applicableTo: { hasInteractiveElements: ['button', 'checkbox', 'tab', 'menuitem'] },
    successCriteria: { type: 'agent_success' },
    priority: 9,
    isCompound: false,
    estimatedSteps: 18,
  },
  {
    id: 'wcag-4.1.2-state-changes',
    wcagCriteria: ['4.1.2'],
    level: 'A',
    category: 'widgets',
    goalTemplate: 'Find a toggle element (accordion, disclosure, or expandable section) and activate it. Verify that the state change is announced (e.g., "expanded" to "collapsed"). Repeat for other toggleable elements.',
    applicableTo: { hasInteractiveElements: ['button'] },
    successCriteria: { type: 'agent_success' },
    priority: 8,
    isCompound: true,
    estimatedSteps: 10,
  },
];

// ==================== Level AA Templates ====================

const LEVEL_AA_TEMPLATES: WCAGTaskTemplate[] = [
  // 2.4.5 Multiple Ways
  {
    id: 'wcag-2.4.5-multiple-ways',
    wcagCriteria: ['2.4.5'],
    level: 'AA',
    category: 'navigation',
    goalTemplate: 'Find the "{pageName}" page using two different methods: first using the main navigation menu, then using the site search (if available) or sitemap. Verify both paths lead to the same destination.',
    applicableTo: { minPageRank: 0.02 },
    successCriteria: { type: 'agent_success' },
    priority: 7,
    isCompound: true,
    estimatedSteps: 20,
  },

  // 2.4.6 Headings and Labels
  {
    id: 'wcag-2.4.6-heading-nav',
    wcagCriteria: ['2.4.6'],
    level: 'AA',
    category: 'navigation',
    goalTemplate: 'Use heading navigation (press H repeatedly) to move through all headings on the page. Verify that headings describe the content that follows them and that you can locate the main content sections by their headings alone.',
    applicableTo: { hasHeadings: true },
    successCriteria: { type: 'agent_success' },
    priority: 8,
    isCompound: false,
    estimatedSteps: 15,
  },
  {
    id: 'wcag-2.4.6-heading-hierarchy',
    wcagCriteria: ['2.4.6'],
    level: 'AA',
    category: 'content',
    goalTemplate: 'Navigate through all headings on the page and verify that the heading levels create a logical hierarchy (H1 followed by H2, not skipping to H4). Note any heading level skips or misuse.',
    applicableTo: { hasHeadings: true },
    successCriteria: { type: 'agent_success' },
    priority: 6,
    isCompound: false,
    estimatedSteps: 12,
  },

  // 2.4.7 Focus Visible
  {
    id: 'wcag-2.4.7-focus-visible',
    wcagCriteria: ['2.4.7'],
    level: 'AA',
    category: 'navigation',
    goalTemplate: 'Tab through all interactive elements on the page. For each element, verify that you receive a clear announcement indicating which element has focus. This confirms focus is programmatically visible to assistive technology.',
    applicableTo: {},
    successCriteria: { type: 'agent_success' },
    priority: 8,
    isCompound: false,
    estimatedSteps: 20,
  },

  // 3.2.3 Consistent Navigation
  {
    id: 'wcag-3.2.3-consistent-nav',
    wcagCriteria: ['3.2.3'],
    level: 'AA',
    category: 'workflow',
    goalTemplate: 'Navigate from {startPage} to {endPage} using the main navigation. Note the order and structure of navigation items. Then navigate to a different page and verify the navigation maintains the same structure and order.',
    applicableTo: { minPageRank: 0.01 },
    successCriteria: { type: 'agent_success' },
    priority: 6,
    isCompound: true,
    estimatedSteps: 25,
  },

  // 3.2.4 Consistent Identification
  {
    id: 'wcag-3.2.4-consistent-id',
    wcagCriteria: ['3.2.4'],
    level: 'AA',
    category: 'workflow',
    goalTemplate: 'Find the search functionality on the current page and note how it is announced. Navigate to another page and find the search again. Verify it has the same accessible name and behavior.',
    applicableTo: {},
    successCriteria: { type: 'agent_success' },
    priority: 5,
    isCompound: true,
    estimatedSteps: 18,
  },

  // 3.3.3 Error Suggestion
  {
    id: 'wcag-3.3.3-error-suggestion',
    wcagCriteria: ['3.3.3'],
    level: 'AA',
    category: 'forms',
    goalTemplate: 'Navigate to the {formName} form and intentionally enter invalid data (e.g., invalid email format, password too short). Submit the form and verify that error messages not only identify the error but also suggest how to fix it.',
    applicableTo: { hasForm: true },
    successCriteria: { type: 'agent_success' },
    priority: 8,
    isCompound: true,
    estimatedSteps: 18,
  },

  // 3.3.4 Error Prevention
  {
    id: 'wcag-3.3.4-confirmation',
    wcagCriteria: ['3.3.4'],
    level: 'AA',
    category: 'forms',
    goalTemplate: 'Complete the {formName} form with valid data. Before final submission, verify that there is a review/confirmation step or that submissions can be reversed. Look for a summary of entered data before committing.',
    applicableTo: { hasForm: true },
    successCriteria: { type: 'agent_success' },
    priority: 7,
    isCompound: true,
    estimatedSteps: 22,
  },
];

// ==================== Compound Workflow Templates ====================

const WORKFLOW_TEMPLATES: WCAGTaskTemplate[] = [
  // Complete form workflow
  {
    id: 'wcag-workflow-form-complete',
    wcagCriteria: ['2.1.1', '3.3.1', '3.3.2', '3.3.3', '4.1.2'],
    level: 'AA',
    category: 'workflow',
    goalTemplate: 'Complete the {formName} form end-to-end using only keyboard: 1) Navigate to the form using Tab, 2) Fill in each required field, 3) Submit with incomplete data to verify error announcements, 4) Correct the errors and resubmit, 5) Verify success feedback is announced.',
    applicableTo: { hasForm: true },
    successCriteria: { type: 'agent_success' },
    priority: 10,
    isCompound: true,
    estimatedSteps: 35,
  },

  // Multi-page navigation workflow
  {
    id: 'wcag-workflow-navigation',
    wcagCriteria: ['2.1.1', '2.4.1', '2.4.4', '2.4.6'],
    level: 'A',
    category: 'workflow',
    goalTemplate: 'Complete a navigation journey from {startPage} to {endPage}: 1) Use skip link if available, 2) Navigate to main content, 3) Use heading navigation to find relevant section, 4) Follow link to next page, 5) Verify you reached the destination.',
    applicableTo: { minPageRank: 0.01 },
    successCriteria: { type: 'agent_success' },
    priority: 9,
    isCompound: true,
    estimatedSteps: 20,
  },

  // Search and results workflow
  {
    id: 'wcag-workflow-search',
    wcagCriteria: ['2.1.1', '2.4.5', '4.1.2'],
    level: 'AA',
    category: 'workflow',
    goalTemplate: 'Use the site search to find "{searchTerm}": 1) Locate the search form using keyboard, 2) Enter the search term and submit, 3) Wait for results to load (verify live region announcement if available), 4) Navigate through search results using headings or Tab, 5) Select and activate a relevant result.',
    applicableTo: {},
    successCriteria: { type: 'agent_success' },
    priority: 8,
    isCompound: true,
    estimatedSteps: 18,
  },

  // Interactive widget workflow
  {
    id: 'wcag-workflow-widgets',
    wcagCriteria: ['2.1.1', '2.1.2', '4.1.2'],
    level: 'A',
    category: 'workflow',
    goalTemplate: 'Test all interactive widgets on the page: 1) Find each accordion/disclosure and toggle it, verifying state announcements, 2) Find any dropdown menus and navigate within them, 3) Verify you can escape from all widgets, 4) Confirm all widgets respond to keyboard.',
    applicableTo: { hasInteractiveElements: ['button', 'combobox', 'menu'] },
    successCriteria: { type: 'agent_success' },
    priority: 8,
    isCompound: true,
    estimatedSteps: 30,
  },

  // Table navigation workflow
  {
    id: 'wcag-workflow-table',
    wcagCriteria: ['1.3.1', '2.1.1'],
    level: 'A',
    category: 'workflow',
    goalTemplate: 'Navigate and understand the data table: 1) Locate the table using arrow keys or landmarks, 2) Enter table navigation mode, 3) Move through rows and columns using Ctrl+Alt+Arrows, 4) Verify headers are announced for each cell, 5) Find a specific piece of data in the table.',
    applicableTo: { hasTable: true },
    successCriteria: { type: 'agent_success' },
    priority: 7,
    isCompound: true,
    estimatedSteps: 25,
  },
];

// ==================== Exports ====================

export const WCAG_TASK_TEMPLATES: WCAGTaskTemplate[] = [
  ...LEVEL_A_TEMPLATES,
  ...LEVEL_AA_TEMPLATES,
  ...WORKFLOW_TEMPLATES,
];

export function getTemplatesByLevel(level: WCAGLevel | 'both'): WCAGTaskTemplate[] {
  if (level === 'both') {
    return WCAG_TASK_TEMPLATES;
  }
  if (level === 'A') {
    return WCAG_TASK_TEMPLATES.filter(t => t.level === 'A');
  }
  // AA includes A level templates as well (AA compliance requires A)
  return WCAG_TASK_TEMPLATES;
}

export function getTemplatesByCategory(category: TaskCategory): WCAGTaskTemplate[] {
  return WCAG_TASK_TEMPLATES.filter(t => t.category === category);
}

export function getTemplatesByCriterion(criterionId: string): WCAGTaskTemplate[] {
  return WCAG_TASK_TEMPLATES.filter(t => t.wcagCriteria.includes(criterionId));
}

export function getWorkflowTemplates(): WCAGTaskTemplate[] {
  return WCAG_TASK_TEMPLATES.filter(t => t.isCompound);
}

export function getSimpleTemplates(): WCAGTaskTemplate[] {
  return WCAG_TASK_TEMPLATES.filter(t => !t.isCompound);
}
