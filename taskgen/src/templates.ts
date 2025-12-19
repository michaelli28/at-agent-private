/**
 * Task Templates - Structured step-by-step task templates for accessibility testing.
 *
 * Each template generates goals with numbered steps that guide the agent through
 * specific accessibility testing scenarios.
 *
 * Goal Structure:
 * - Each step is numbered (1. 2. 3.)
 * - Steps start with action verbs (Navigate to, Click, Type, Report)
 * - Final step reports success/failure with specific reason
 */

import { TaskStep, AccessibilityTask, ElementNode, PageElementGraph } from './types';

// ==================== Template Types ====================

export interface TaskTemplate {
  type: 'atomic' | 'journey';
  name: string;
  description: string;
  wcagCriteria: string[];
  generateGoal: (context: TemplateContext) => string;
  generateSteps: (context: TemplateContext) => TaskStep[];
}

export interface TemplateContext {
  pageUrl: string;
  pageTitle: string;
  elements: ElementNode[];
  sectionName?: string;
  formName?: string;
  targetUrl?: string;
  searchQuery?: string;
  email?: string;
  password?: string;
}

// ==================== Atomic Task Templates ====================

export const ATOMIC_TEMPLATES: Record<string, TaskTemplate> = {
  headings: {
    type: 'atomic',
    name: 'Heading Navigation',
    description: 'Navigate through all headings and verify hierarchy',
    wcagCriteria: ['1.3.1', '2.4.6'],
    generateGoal: (ctx) => {
      const headingNames = ctx.elements
        .filter((e) => e.typeFlags.headingLevel)
        .slice(0, 5)
        .map((e) => e.name || `heading level ${e.typeFlags.headingLevel}`)
        .join(', ');

      return [
        `1. Navigate to first heading using H key.`,
        `2. Note the heading level and text.`,
        `3. Navigate to next heading using H key.`,
        `4. Continue navigating through all headings (expected: ${headingNames || 'various headings'}).`,
        `5. Report success with the reason listing all headings found (e.g., "h1: Title, h2: Section1, h2: Section2") and any hierarchy issues (e.g., h1 followed by h4 skipping h2/h3).`,
      ].join(' ');
    },
    generateSteps: (ctx) => [
      { stepNumber: 1, action: 'navigate', target: 'first heading', key: 'h' },
      { stepNumber: 2, action: 'traverse', key: 'h' },
      { stepNumber: 3, action: 'report', expectedOutcome: 'list of all headings with levels and hierarchy analysis' },
    ],
  },

  landmarks: {
    type: 'atomic',
    name: 'Landmark Navigation',
    description: 'Navigate through all landmarks and verify page structure',
    wcagCriteria: ['1.3.1', '2.4.1'],
    generateGoal: (ctx) => {
      const landmarkNames = ctx.elements
        .filter((e) => e.typeFlags.isLandmark)
        .map((e) => e.typeFlags.landmarkRole || 'region')
        .join(', ');

      return [
        `1. Navigate to banner landmark using D key.`,
        `2. Navigate to navigation landmark using D key.`,
        `3. Navigate to main landmark using D key.`,
        `4. Navigate to contentinfo landmark using D key.`,
        `5. Continue through all landmarks on the page.`,
        `6. Report success with the reason listing all landmarks found (expected: ${landmarkNames || 'banner, navigation, main, contentinfo'}) and any missing required landmarks.`,
      ].join(' ');
    },
    generateSteps: (ctx) => [
      { stepNumber: 1, action: 'navigate', target: 'banner landmark', key: 'd' },
      { stepNumber: 2, action: 'navigate', target: 'navigation landmark', key: 'd' },
      { stepNumber: 3, action: 'navigate', target: 'main landmark', key: 'd' },
      { stepNumber: 4, action: 'navigate', target: 'contentinfo landmark', key: 'd' },
      { stepNumber: 5, action: 'report', expectedOutcome: 'list of all landmarks and missing required landmarks' },
    ],
  },

  buttons: {
    type: 'atomic',
    name: 'Button Accessibility',
    description: 'Find and verify all buttons have accessible names',
    wcagCriteria: ['4.1.2', '2.1.1'],
    generateGoal: (ctx) => {
      const buttonCount = ctx.elements.filter((e) => e.typeFlags.isButton).length;
      const buttonNames = ctx.elements
        .filter((e) => e.typeFlags.isButton)
        .slice(0, 3)
        .map((e) => e.name || '[unnamed]')
        .join(', ');

      return [
        `1. Navigate to first button on page using B key.`,
        `2. Note the button's accessible name.`,
        `3. Navigate to next button using B key.`,
        `4. Continue through all buttons (expected count: ${buttonCount}, examples: ${buttonNames || 'various buttons'}).`,
        `5. For each button, verify it has a descriptive accessible name.`,
        `6. Report success with the reason listing all buttons found and any that lacked accessible names or had generic names like "button" or "click here".`,
      ].join(' ');
    },
    generateSteps: (ctx) => [
      { stepNumber: 1, action: 'navigate', target: 'first button', key: 'b' },
      { stepNumber: 2, action: 'traverse', key: 'b' },
      { stepNumber: 3, action: 'report', expectedOutcome: 'list of buttons with their accessible names' },
    ],
  },

  forms: {
    type: 'atomic',
    name: 'Form Field Accessibility',
    description: 'Navigate through form fields and verify labels',
    wcagCriteria: ['1.3.1', '4.1.2', '3.3.2'],
    generateGoal: (ctx) => {
      const formFields = ctx.elements.filter((e) => e.typeFlags.isFormField);
      const fieldNames = formFields
        .slice(0, 3)
        .map((e) => e.name || e.role)
        .join(', ');

      return [
        `1. Navigate to ${ctx.formName || 'the form'} using landmarks or headings.`,
        `2. Navigate to first form field using F key or Tab.`,
        `3. Note the field's accessible label/name.`,
        `4. Type sample data into text fields (use "test" for text, "test@example.com" for email).`,
        `5. Navigate to next field using Tab.`,
        `6. Continue through all form fields (expected: ${fieldNames || 'various fields'}).`,
        `7. Navigate to and click Submit button.`,
        `8. Report success with the reason listing all form fields found, any unlabeled fields, and the form submission result.`,
      ].join(' ');
    },
    generateSteps: (ctx) => [
      { stepNumber: 1, action: 'navigate', target: ctx.formName || 'form' },
      { stepNumber: 2, action: 'navigate', target: 'first form field', key: 'f' },
      { stepNumber: 3, action: 'type', target: 'text field', text: 'test' },
      { stepNumber: 4, action: 'traverse', key: 'Tab' },
      { stepNumber: 5, action: 'navigate_click', target: 'Submit button' },
      { stepNumber: 6, action: 'report', expectedOutcome: 'form fields found and submission result' },
    ],
  },

  links: {
    type: 'atomic',
    name: 'Link Accessibility',
    description: 'Navigate through links and verify descriptive text',
    wcagCriteria: ['2.4.4', '2.1.1', '2.4.7'],
    generateGoal: (ctx) => {
      const linkCount = ctx.elements.filter((e) => e.typeFlags.isLink).length;

      return [
        `1. Navigate to first link on page using K key.`,
        `2. Note the link's accessible name and whether it's descriptive.`,
        `3. Navigate to next link using K key.`,
        `4. Continue through all links (expected count: approximately ${linkCount}).`,
        `5. For each link, assess if the link text alone conveys the destination/purpose.`,
        `6. Report success with the reason listing link names that are non-descriptive (e.g., "click here", "read more", "link") and total link count.`,
      ].join(' ');
    },
    generateSteps: (ctx) => [
      { stepNumber: 1, action: 'navigate', target: 'first link', key: 'k' },
      { stepNumber: 2, action: 'traverse', key: 'k' },
      { stepNumber: 3, action: 'report', expectedOutcome: 'list of non-descriptive link names' },
    ],
  },

  tables: {
    type: 'atomic',
    name: 'Table Accessibility',
    description: 'Navigate through tables and verify header associations',
    wcagCriteria: ['1.3.1', '1.3.2'],
    generateGoal: (ctx) => {
      const tableCount = ctx.elements.filter((e) => e.typeFlags.isTable).length;

      return [
        `1. Navigate to table using T key.`,
        `2. Navigate through table headers (th elements).`,
        `3. Navigate through first row of data cells.`,
        `4. Verify screen reader announces header associations with data cells.`,
        `5. Navigate to next row and verify header associations.`,
        `6. If multiple tables exist (found: ${tableCount}), navigate to next table using T key.`,
        `7. Report success with the reason describing table structure (number of headers, rows, columns) and any missing header associations or scope attributes.`,
      ].join(' ');
    },
    generateSteps: (ctx) => [
      { stepNumber: 1, action: 'navigate', target: 'table', key: 't' },
      { stepNumber: 2, action: 'traverse', key: 'ArrowDown' },
      { stepNumber: 3, action: 'report', expectedOutcome: 'table structure and header associations' },
    ],
  },

  navigation: {
    type: 'atomic',
    name: 'Navigation Menu',
    description: 'Navigate through all navigation links',
    wcagCriteria: ['2.4.4', '2.1.1', '2.4.7'],
    generateGoal: (ctx) => {
      const navLinks = ctx.elements
        .filter((e) => e.typeFlags.isLink)
        .slice(0, 5)
        .map((e) => e.name)
        .filter(Boolean)
        .join(', ');

      return [
        `1. Navigate to main navigation landmark using D key.`,
        `2. Navigate to first navigation link.`,
        `3. Note the link's accessible name.`,
        `4. Navigate to and click the first nav link.`,
        `5. Use browser back or navigate back to ${ctx.pageTitle || 'the page'}.`,
        `6. Navigate to and click the second nav link.`,
        `7. Continue for remaining navigation links (expected: ${navLinks || 'various links'}).`,
        `8. Report success with the reason listing all navigation links visited and their destinations.`,
      ].join(' ');
    },
    generateSteps: (ctx) => [
      { stepNumber: 1, action: 'navigate', target: 'navigation landmark', key: 'd' },
      { stepNumber: 2, action: 'navigate_click', target: 'first nav link' },
      { stepNumber: 3, action: 'navigate_click', target: 'second nav link' },
      { stepNumber: 4, action: 'report', expectedOutcome: 'navigation links and destinations' },
    ],
  },

  fullPageTraversal: {
    type: 'atomic',
    name: 'Full Page Traversal',
    description: 'Traverse all elements on a page',
    wcagCriteria: ['4.1.2', '2.1.1'],
    generateGoal: (ctx) => {
      return [
        `1. Navigate to main landmark using D key.`,
        `2. Navigate through all elements using Arrow Down key.`,
        `3. For each interactive element encountered, note its name and role.`,
        `4. Continue until reaching the end of the page or footer.`,
        `5. Navigate back to top using Arrow Up repeatedly or page reload.`,
        `6. Report success with the reason listing total elements traversed, interactive elements found, and any elements without accessible names.`,
      ].join(' ');
    },
    generateSteps: (ctx) => [
      { stepNumber: 1, action: 'navigate', target: 'main landmark', key: 'd' },
      { stepNumber: 2, action: 'traverse', key: 'ArrowDown' },
      { stepNumber: 3, action: 'report', expectedOutcome: 'total elements and any without accessible names' },
    ],
  },
};

// ==================== Journey Task Templates ====================

export const JOURNEY_TEMPLATES: Record<string, TaskTemplate> = {
  login: {
    type: 'journey',
    name: 'Login Flow',
    description: 'Complete a login flow using keyboard navigation',
    wcagCriteria: ['2.1.1', '4.1.2', '3.3.2'],
    generateGoal: (ctx) => {
      return [
        `1. Navigate to and click Login link.`,
        `2. Navigate to username/email field and type '${ctx.email || 'test@example.com'}'.`,
        `3. Navigate to password field and type '${ctx.password || 'TestPassword123'}'.`,
        `4. Navigate to and click Sign In/Login button.`,
        `5. Report success with the reason as the authenticated page URL or any error message displayed.`,
      ].join(' ');
    },
    generateSteps: (ctx) => [
      { stepNumber: 1, action: 'navigate_click', target: 'Login link' },
      { stepNumber: 2, action: 'type', target: 'email field', text: ctx.email || 'test@example.com' },
      { stepNumber: 3, action: 'type', target: 'password field', text: ctx.password || 'TestPassword123' },
      { stepNumber: 4, action: 'navigate_click', target: 'Sign In button' },
      { stepNumber: 5, action: 'report', expectedOutcome: 'authenticated page URL or error message' },
    ],
  },

  search: {
    type: 'journey',
    name: 'Search Flow',
    description: 'Use search functionality with keyboard navigation',
    wcagCriteria: ['2.1.1', '4.1.2', '1.3.1'],
    generateGoal: (ctx) => {
      return [
        `1. Navigate to search input field.`,
        `2. Type '${ctx.searchQuery || 'accessibility'}'.`,
        `3. Navigate to and click Search button (or press Enter to submit).`,
        `4. Navigate to first search result.`,
        `5. Navigate to and click first result link.`,
        `6. Report success with the reason as the number of results found and destination URL.`,
      ].join(' ');
    },
    generateSteps: (ctx) => [
      { stepNumber: 1, action: 'navigate', target: 'search input' },
      { stepNumber: 2, action: 'type', target: 'search input', text: ctx.searchQuery || 'accessibility' },
      { stepNumber: 3, action: 'activate', target: 'search', key: 'Enter' },
      { stepNumber: 4, action: 'navigate_click', target: 'first result' },
      { stepNumber: 5, action: 'report', expectedOutcome: 'number of results and destination URL' },
    ],
  },

  navigation: {
    type: 'journey',
    name: 'Page Navigation',
    description: 'Navigate from one page to another using keyboard',
    wcagCriteria: ['2.1.1', '2.4.4', '2.4.7'],
    generateGoal: (ctx) => {
      return [
        `1. Navigate to main navigation using D key.`,
        `2. Navigate to and click ${ctx.targetUrl ? 'target page' : 'first navigation'} link.`,
        `3. Verify the page loads and main content is accessible.`,
        `4. Navigate to main landmark on new page.`,
        `5. Navigate through first few elements to verify page structure.`,
        `6. Report success with the reason as the destination URL and confirmation that main content is keyboard accessible.`,
      ].join(' ');
    },
    generateSteps: (ctx) => [
      { stepNumber: 1, action: 'navigate', target: 'navigation landmark', key: 'd' },
      { stepNumber: 2, action: 'navigate_click', target: 'target link' },
      { stepNumber: 3, action: 'navigate', target: 'main landmark', key: 'd' },
      { stepNumber: 4, action: 'report', expectedOutcome: 'destination URL and main content accessibility' },
    ],
  },

  addToCart: {
    type: 'journey',
    name: 'Add to Cart',
    description: 'Add a product to cart using keyboard navigation',
    wcagCriteria: ['2.1.1', '4.1.2', '3.3.2'],
    generateGoal: (ctx) => {
      return [
        `1. Navigate to and click Products/Shop link in navigation.`,
        `2. Navigate to first product in the listing.`,
        `3. Navigate to and click product link or image.`,
        `4. Navigate to and click Add to Cart button.`,
        `5. Navigate to and click Cart/Checkout link.`,
        `6. Report success with the reason as the cart contents announced by screen reader.`,
      ].join(' ');
    },
    generateSteps: (ctx) => [
      { stepNumber: 1, action: 'navigate_click', target: 'Products link' },
      { stepNumber: 2, action: 'navigate_click', target: 'first product' },
      { stepNumber: 3, action: 'navigate_click', target: 'Add to Cart button' },
      { stepNumber: 4, action: 'navigate_click', target: 'Cart link' },
      { stepNumber: 5, action: 'report', expectedOutcome: 'cart contents' },
    ],
  },

  checkout: {
    type: 'journey',
    name: 'Checkout Flow',
    description: 'Complete a checkout flow using keyboard navigation',
    wcagCriteria: ['2.1.1', '4.1.2', '3.3.2', '3.3.1'],
    generateGoal: (ctx) => {
      return [
        `1. Navigate to Cart/Checkout link and click.`,
        `2. Navigate to and click Proceed to Checkout button.`,
        `3. Navigate through shipping form fields using Tab.`,
        `4. Fill in required shipping fields (name, address, etc.) using test data.`,
        `5. Navigate to and click Continue/Next button.`,
        `6. Navigate through payment form if present.`,
        `7. Navigate to and click Place Order/Complete button.`,
        `8. Report success with the reason as order confirmation or any validation errors encountered.`,
      ].join(' ');
    },
    generateSteps: (ctx) => [
      { stepNumber: 1, action: 'navigate_click', target: 'Cart link' },
      { stepNumber: 2, action: 'navigate_click', target: 'Checkout button' },
      { stepNumber: 3, action: 'traverse', key: 'Tab' },
      { stepNumber: 4, action: 'type', target: 'name field', text: 'Test User' },
      { stepNumber: 5, action: 'navigate_click', target: 'Place Order button' },
      { stepNumber: 6, action: 'report', expectedOutcome: 'order confirmation or validation errors' },
    ],
  },

  contactForm: {
    type: 'journey',
    name: 'Contact Form',
    description: 'Submit a contact form using keyboard navigation',
    wcagCriteria: ['2.1.1', '4.1.2', '3.3.2'],
    generateGoal: (ctx) => {
      return [
        `1. Navigate to and click Contact link.`,
        `2. Navigate to name field and type 'Test User'.`,
        `3. Navigate to email field and type 'test@example.com'.`,
        `4. Navigate to message/textarea field and type 'This is a test message for accessibility testing.'.`,
        `5. Navigate to and click Submit/Send button.`,
        `6. Report success with the reason as the confirmation message or any validation errors.`,
      ].join(' ');
    },
    generateSteps: (ctx) => [
      { stepNumber: 1, action: 'navigate_click', target: 'Contact link' },
      { stepNumber: 2, action: 'type', target: 'name field', text: 'Test User' },
      { stepNumber: 3, action: 'type', target: 'email field', text: 'test@example.com' },
      { stepNumber: 4, action: 'type', target: 'message field', text: 'This is a test message for accessibility testing.' },
      { stepNumber: 5, action: 'navigate_click', target: 'Submit button' },
      { stepNumber: 6, action: 'report', expectedOutcome: 'confirmation message or validation errors' },
    ],
  },
};

// ==================== Template Helpers ====================

/**
 * Generate a unique task ID.
 */
export function generateTaskId(): string {
  return `task-${Date.now()}-${Math.random().toString(36).substring(2, 8)}`;
}

/**
 * Build a task from a template and context.
 */
export function buildTaskFromTemplate(
  template: TaskTemplate,
  context: TemplateContext,
  targetElements: string[] = [],
  priority: number = 5
): AccessibilityTask {
  return {
    id: generateTaskId(),
    type: template.type,
    url: context.pageUrl,
    goal: template.generateGoal(context),
    steps: template.generateSteps(context),
    targetElements,
    requiredActions: [],
    expectedCoverage: targetElements.length,
    wcagCriteria: template.wcagCriteria,
    elementTypes: [],
    priority,
    dependencies: [],
    attempts: 0,
  };
}

/**
 * Get all available atomic templates.
 */
export function getAtomicTemplates(): TaskTemplate[] {
  return Object.values(ATOMIC_TEMPLATES);
}

/**
 * Get all available journey templates.
 */
export function getJourneyTemplates(): TaskTemplate[] {
  return Object.values(JOURNEY_TEMPLATES);
}
