import type { BrowserPage } from '@at-agent/browser'
import { Auditor, ScreenReaderSimulator, KeyboardTrapDetector } from '@at-agent/accessibility'
import {
  type Action,
  type ActionResult,
  ExecuteActionOptionsSchema,
  type ExecuteActionOptions,
} from './types.js'

export async function executeAction(
  action: Action,
  page: BrowserPage,
  options: Partial<ExecuteActionOptions> = {}
): Promise<ActionResult> {
  const opts = ExecuteActionOptionsSchema.parse(options)
  switch (action.type) {
    case 'navigate':
      return executeNavigate(action, page)
    case 'click':
      return executeClick(action, page, opts)
    case 'fill':
      return executeFill(action, page, opts)
    case 'audit':
      return executeAudit(page)
    case 'observe':
      return executeObserve(page)
    case 'tab':
      return executeTab(action, page)
    case 'checkTrap':
      return executeCheckTrap(opts)
    case 'done':
      return executeDone(action)
    default:
      return {
        success: false,
        observation: `Unknown action type: ${(action as Action).type}`,
      }
  }
}

async function executeNavigate(
  action: Action,
  page: BrowserPage
): Promise<ActionResult> {
  try {
    if (!action.target) {
      return { success: false, observation: 'No URL provided' }
    }
    await page.goto(action.target)
    const title = await page.title()
    return {
      success: true,
      observation: `Navigated to ${action.target}. Page title: "${title}"`,
    }
  } catch (error) {
    return {
      success: false,
      observation: `Navigation failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

const DEFAULT_CLICK_TIMEOUT = 5000

async function executeClick(
  action: Action,
  page: BrowserPage,
  opts: ExecuteActionOptions
): Promise<ActionResult> {
  try {
    if (!action.target) {
      return { success: false, observation: 'No target provided' }
    }

    // Parse target like "button named Submit" or "link named More information"
    const match = action.target.match(/(\w+)\s+named\s+"([^"]+)"/i)
    if (match) {
      const [, role, name] = match
      if (opts.headed) {
        await page.highlight(role, { name }, 'CLICK', 500)
      }
      await page.clickByRole(role, { name, timeout: DEFAULT_CLICK_TIMEOUT })
      return {
        success: true,
        observation: `Clicked ${role} named "${name}"`,
      }
    }

    // Try clicking by text
    await page.clickByText(action.target)
    return {
      success: true,
      observation: `Clicked element with text "${action.target}"`,
    }
  } catch (error) {
    return {
      success: false,
      observation: `Click failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

async function executeFill(
  action: Action,
  page: BrowserPage,
  opts: ExecuteActionOptions
): Promise<ActionResult> {
  try {
    if (!action.target || !action.value) {
      return { success: false, observation: 'No target or value provided' }
    }

    // Parse target like "textbox named Email"
    const match = action.target.match(/(\w+)\s+named\s+"([^"]+)"/i)
    if (match) {
      const [, role, name] = match
      if (opts.headed) {
        await page.highlight(role, { name }, 'FILL', 500)
      }
      await page.fillByRole(role, action.value, { name })
      return {
        success: true,
        observation: `Filled ${role} named "${name}" with "${action.value}"`,
      }
    }

    return {
      success: false,
      observation: `Could not parse target: ${action.target}`,
    }
  } catch (error) {
    return {
      success: false,
      observation: `Fill failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

async function executeAudit(page: BrowserPage): Promise<ActionResult> {
  try {
    const auditor = new Auditor()
    const result = await auditor.audit(page)
    const summary = auditor.getSummary(result)

    const observation = [
      `Accessibility audit complete:`,
      `- ${summary.totalViolations} violations found`,
      `- Critical: ${summary.byImpact.critical}`,
      `- Serious: ${summary.byImpact.serious}`,
      `- Moderate: ${summary.byImpact.moderate}`,
      `- Minor: ${summary.byImpact.minor}`,
      `- ${summary.totalPasses} rules passed`,
    ].join('\n')

    return {
      success: true,
      observation,
      violations: result.violations,
    }
  } catch (error) {
    return {
      success: false,
      observation: `Audit failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

async function executeObserve(page: BrowserPage): Promise<ActionResult> {
  try {
    const url = await page.url()
    const title = await page.title()
    const tree = await page.accessibilityTree()

    // Summarize accessibility tree
    const simulator = new ScreenReaderSimulator(page)
    const headings = await simulator.getHeadings()
    const landmarks = await simulator.getLandmarks()

    const observation = [
      `Current page: ${url}`,
      `Title: "${title}"`,
      `Headings: ${headings.map((h) => `"${h.text}"`).join(', ') || 'None'}`,
      `Landmarks: ${landmarks.map((l) => l.role).join(', ') || 'None'}`,
      `Accessibility tree root: ${tree.role} "${tree.name}"`,
    ].join('\n')

    return {
      success: true,
      observation,
    }
  } catch (error) {
    return {
      success: false,
      observation: `Observe failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

function executeDone(action: Action): ActionResult {
  return {
    success: true,
    observation: `Agent finished: ${action.reason}`,
  }
}

async function executeTab(
  action: Action,
  page: BrowserPage
): Promise<ActionResult> {
  try {
    const isReverse = action.target === 'previous'
    const count = action.value ? parseInt(action.value, 10) : 1
    const key = isReverse ? 'Shift+Tab' : 'Tab'

    for (let i = 0; i < count; i++) {
      await page.playwrightPage.keyboard.press(key)
    }

    // Get the currently focused element's description
    // Note: This callback runs in browser context via Playwright
    const focusedElement = await page.playwrightPage.evaluate<string>(`
      (() => {
        const el = document.activeElement;
        if (!el || el === document.body) {
          return 'body';
        }

        const tag = el.tagName.toLowerCase();
        const id = el.id ? '#' + el.id : '';
        const className = el.className && typeof el.className === 'string'
          ? '.' + el.className.split(' ').filter(Boolean).join('.')
          : '';
        const name = el.getAttribute('aria-label')
          || el.name
          || (el.textContent || '').slice(0, 30).trim()
          || '';

        return tag + id + className + (name ? ' "' + name + '"' : '');
      })()
    `)

    return {
      success: true,
      observation: `Focused on: ${focusedElement}`,
      focusedElement,
    }
  } catch (error) {
    return {
      success: false,
      observation: `Tab failed: ${error instanceof Error ? error.message : 'Unknown error'}`,
    }
  }
}

function executeCheckTrap(opts: ExecuteActionOptions): ActionResult {
  const trapContext = opts.trapContext
  if (!trapContext || !trapContext.focusHistory) {
    return {
      success: true,
      observation: 'No focus history available for trap detection',
      trapDetected: false,
    }
  }

  // Create a detector and replay the focus history
  const detector = new KeyboardTrapDetector({ minCycleCount: 5, maxHistorySize: 50 })

  for (const event of trapContext.focusHistory) {
    detector.recordFocus(event.element)
  }

  const result = detector.detectTrap()

  if (result.trapped) {
    return {
      success: true,
      observation: `Keyboard trap detected (WCAG 2.1.2 violation): Focus is cycling through ${result.cycleLength} element(s) starting at "${result.element}"`,
      trapDetected: true,
    }
  }

  return {
    success: true,
    observation: 'No keyboard trap detected',
    trapDetected: false,
  }
}
