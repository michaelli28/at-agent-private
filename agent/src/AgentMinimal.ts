import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { PageFinder, PageRankResult } from './PageFinder';

export type NavigationMode = 'default' | 'pagerank';

// OpenRouter response types
interface OpenRouterToolCall {
  id: string;
  type: 'function';
  function: {
    name: string;
    arguments?: string;
  };
}

interface OpenRouterMessage {
  role: string;
  content: string | null;
  reasoning?: string;
  tool_calls?: OpenRouterToolCall[];
}

interface OpenRouterUsage {
  prompt_tokens: number;
  completion_tokens: number;
  total_tokens: number;
}

interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: OpenRouterMessage;
    finish_reason: string;
  }>;
  usage?: OpenRouterUsage;
}

// Minimal types (no virtual-screen-reader dependency)
export interface MinimalStep {
  stepNumber: number;
  observation: string;
  thought: string;
  action: string;
  success: boolean;
}

// Page element for tab map
interface PageElement {
  position: number;
  name: string;
  role: string;
}

export interface MinimalTrace {
  goal: string;
  success: boolean;
  steps: MinimalStep[];
  error?: string;
  totalTokens?: {
    prompt: number;
    completion: number;
    total: number;
  };
}

export type LogCallback = (message: string) => void;

// Debug event types (same as AgentOpenrouter for UI compatibility)
export type DebugEventType =
  | 'init'
  | 'llm_request'
  | 'llm_response'
  | 'tool_call'
  | 'tool_result'
  | 'observation'
  | 'finish'
  | 'error';

export interface DebugEvent {
  type: DebugEventType;
  timestamp: number;
  data: unknown;
}

export type DebugEventCallback = (event: DebugEvent) => void;

// Callback for manual oversight - called before each LLM request
export type BeforeLlmRequestCallback = (loopCount: number, messages: unknown[]) => Promise<void>;

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '../minimal_system_prompt.txt'), 'utf-8').trim();
const PAGERANK_SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '../pagerank_minimal_system_prompt.txt'), 'utf-8').trim();

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'move_to_position',
      description: 'Move to a specific position in the tab order. Use the position number from the page_elements list.',
      parameters: {
        type: 'object',
        properties: {
          position: { type: 'integer', description: 'Target position (1-indexed) from page_elements' },
        },
        required: ['position'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'press_enter',
      description: 'Click or activate the currently focused element.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'type_text',
      description: 'Type text into the currently focused input field.',
      parameters: {
        type: 'object',
        properties: {
          text: { type: 'string', description: 'The text to type' },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'go_back',
      description: 'Navigate back to the previous page.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'finish_run',
      description: 'Call when you have completed the goal or determined it cannot be done.',
      parameters: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['success', 'reason'],
      },
    },
  },
];

// Tools for PageRank navigation mode (no element list, just page-level navigation)
const PAGERANK_TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'navigate_to_page',
      description: 'Navigate directly to one of the suggested pages. Use the page number from the suggested pages list (1-indexed).',
      parameters: {
        type: 'object',
        properties: {
          page_number: {
            type: 'number',
            description: 'The number of the suggested page to navigate to (1 = first suggestion, 2 = second, etc.)',
          },
        },
        required: ['page_number'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'refresh_suggestions',
      description: 'Get new page suggestions based on current goal understanding. Use if current suggestions are not helpful.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'press_enter',
      description: 'Click or activate the currently focused element.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'go_back',
      description: 'Navigate back to the previous page.',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'finish_run',
      description: 'Call when you have completed the goal or determined it cannot be done.',
      parameters: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['success', 'reason'],
      },
    },
  },
];

export interface AgentMinimalOptions {
  page: Page;
  apiKey?: string;
  model?: string;
  onLog?: LogCallback;
  onDebug?: DebugEventCallback;
  beforeLlmRequest?: BeforeLlmRequestCallback;
  /** Navigation mode: 'default' uses position-based navigation, 'pagerank' discovers reachable pages */
  navigationMode?: NavigationMode;
}

export class AgentMinimal {
  private page: Page;
  private apiKey: string;
  private model: string;
  private onLog?: LogCallback;
  private onDebug?: DebugEventCallback;
  private beforeLlmRequest?: BeforeLlmRequestCallback;

  // Page element scanning state
  private currentPageElements: PageElement[] = [];
  private currentPosition: number = 0;
  private lastUrl: string = '';

  // PageRank navigation properties
  private navigationMode: NavigationMode;
  private pageFinder?: PageFinder;
  private currentSuggestions: PageRankResult[] = [];

  constructor(options: AgentMinimalOptions) {
    this.page = options.page;
    this.apiKey = options.apiKey || process.env['OPENROUTER_API_KEY'] || '';
    this.model = options.model || 'google/gemini-2.0-flash-001';
    this.onLog = options.onLog;
    this.onDebug = options.onDebug;
    this.beforeLlmRequest = options.beforeLlmRequest;
    this.navigationMode = options.navigationMode || 'default';
  }

  private log(message: string) {
    if (this.onLog) {
      this.onLog(message);
    }
  }

  private emitDebug(type: DebugEvent['type'], data: unknown) {
    if (this.onDebug) {
      this.onDebug({ type, timestamp: Date.now(), data });
    }
  }

  private async getFocusedElementInfo(): Promise<string> {
    return this.page.evaluate(() => {
      const el = document.activeElement;
      if (!el || el === document.body) return 'No element focused';

      const role = el.getAttribute('role') || el.tagName.toLowerCase();
      const name = el.getAttribute('aria-label')
        || el.getAttribute('title')
        || (el as HTMLElement).innerText?.slice(0, 100)?.trim()
        || '';

      if (name) {
        return `${name}, ${role}`;
      }
      return role;
    });
  }

  private async getFocusedElementInfoWithRetry(maxRetries = 3): Promise<string> {
    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        return await this.getFocusedElementInfo();
      } catch (error: any) {
        const isNavigationError =
          error.message?.includes('Execution context was destroyed') ||
          error.message?.includes('navigation') ||
          error.message?.includes('Target closed') ||
          error.message?.includes('frame was detached');

        if (isNavigationError && attempt < maxRetries) {
          // Wait for page to stabilize after navigation
          await this.page.waitForLoadState('domcontentloaded').catch(() => {});
          await new Promise(resolve => setTimeout(resolve, 300));
          continue;
        }
        throw error;
      }
    }
    return 'No element focused';
  }

  /**
   * Wait for the DOM to stabilize (no mutations for a period of time).
   * This ensures dynamic content has finished rendering before we scan.
   */
  private async waitForDOMStable(timeout = 2000, stableTime = 100): Promise<void> {
    // Use string evaluation to avoid bundler transformations that inject __name
    await this.page.evaluate(`
      new Promise(function(resolve) {
        var TIMEOUT = ${timeout};
        var STABLE_TIME = ${stableTime};
        var lastMutationTime = Date.now();
        var resolved = false;

        var observer = new MutationObserver(function() {
          lastMutationTime = Date.now();
        });

        observer.observe(document.body, {
          childList: true,
          subtree: true,
          attributes: true
        });

        function checkStable() {
          if (resolved) return;

          var timeSinceLastMutation = Date.now() - lastMutationTime;
          if (timeSinceLastMutation >= STABLE_TIME) {
            resolved = true;
            observer.disconnect();
            resolve();
          } else {
            setTimeout(checkStable, 20);
          }
        }

        setTimeout(checkStable, 20);

        setTimeout(function() {
          if (!resolved) {
            resolved = true;
            observer.disconnect();
            resolve();
          }
        }, TIMEOUT);
      })
    `);
  }

  /**
   * Scan all interactive elements on the page using DOM queries.
   * This doesn't move focus, so it won't disrupt dropdowns/modals.
   */
  private async scanPageElements(): Promise<PageElement[]> {
    const elements = await this.page.evaluate(() => {
      // Selector for interactive elements
      const selector = [
        'a[href]',
        'button',
        'input:not([type="hidden"])',
        'select',
        'textarea',
        '[tabindex]:not([tabindex="-1"])',
        '[role="button"]',
        '[role="link"]',
        '[role="menuitem"]',
        '[role="option"]',
        '[role="checkbox"]',
        '[role="radio"]',
        '[role="tab"]',
        '[role="combobox"]',
        '[role="listbox"]',
        '[role="menu"]',
        '[contenteditable="true"]',
      ].join(', ');

      const allElements = Array.from(document.querySelectorAll(selector));

      // Filter to visible, enabled elements
      const visible = allElements.filter(el => {
        const style = window.getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        const isVisible = style.display !== 'none' &&
          style.visibility !== 'hidden' &&
          style.opacity !== '0' &&
          rect.width > 0 &&
          rect.height > 0;
        const isDisabled = (el as HTMLButtonElement).disabled ||
          el.getAttribute('aria-disabled') === 'true';
        return isVisible && !isDisabled;
      });

      // Sort by tab order: positive tabindex first (ascending), then tabindex=0/none in DOM order
      const withTabIndex: Element[] = [];
      const withoutTabIndex: Element[] = [];

      visible.forEach(el => {
        const tabindex = parseInt(el.getAttribute('tabindex') || '0', 10);
        if (tabindex > 0) {
          withTabIndex.push(el);
        } else {
          withoutTabIndex.push(el);
        }
      });

      // Sort positive tabindex elements
      withTabIndex.sort((a, b) => {
        const aIdx = parseInt(a.getAttribute('tabindex') || '0', 10);
        const bIdx = parseInt(b.getAttribute('tabindex') || '0', 10);
        return aIdx - bIdx;
      });

      // Combine: positive tabindex first, then DOM order
      const sorted = [...withTabIndex, ...withoutTabIndex];

      // Map to element info
      return sorted.map((el, i) => {
        const role = el.getAttribute('role') || el.tagName.toLowerCase();
        const name = el.getAttribute('aria-label') ||
          el.getAttribute('title') ||
          el.getAttribute('placeholder') ||
          (el as HTMLElement).innerText?.trim().slice(0, 100) ||
          el.getAttribute('name') ||
          '';
        return { position: i + 1, name: name.replace(/\n+/g, ' ').trim(), role };
      });
    });

    this.log(`[Scan]: Found ${elements.length} interactive elements`);
    return elements;
  }

  /**
   * Format page elements as a string for the system prompt.
   */
  private formatPageElements(): string {
    if (this.currentPageElements.length === 0) {
      return '<page_elements count="0">No interactive elements found</page_elements>';
    }

    const lines = this.currentPageElements.map(el => {
      const display = el.name ? `${el.name}, ${el.role}` : el.role;
      return `${el.position}. ${display}`;
    });

    return `<page_elements count="${this.currentPageElements.length}">\n${lines.join('\n')}\n</page_elements>`;
  }

  /**
   * Build the system message with goal and current page elements.
   */
  private buildSystemMessage(goal: string): { role: string; content: string } {
    const activePrompt = this.navigationMode === 'pagerank' ? PAGERANK_SYSTEM_PROMPT : SYSTEM_PROMPT;

    let content = `${activePrompt}\n\n<goal>${goal}</goal>`;

    // In PageRank mode, only show suggested pages (no element list)
    // In default mode, show the element list
    if (this.navigationMode === 'pagerank') {
      if (this.currentSuggestions.length > 0) {
        const suggestionsText = this.currentSuggestions
          .map((s, i) => `${i + 1}. ${s.title} - ${s.url}`)
          .join('\n');
        content += `\n\n<suggested_pages>\n${suggestionsText}\n</suggested_pages>`;
      }
    } else {
      const elements = this.formatPageElements();
      content += `\n\n${elements}`;
    }

    return {
      role: 'system',
      content,
    };
  }

  /**
   * Move to a specific position using Tab/Shift+Tab key presses.
   */
  private async moveToPosition(targetPosition: number): Promise<{ success: boolean; error?: string }> {
    const maxPosition = this.currentPageElements.length;

    if (targetPosition < 1 || targetPosition > maxPosition) {
      return { success: false, error: `Invalid position ${targetPosition}. Valid range: 1-${maxPosition}` };
    }

    // If not positioned yet (position 0), start from body and tab to target
    if (this.currentPosition === 0) {
      await this.page.evaluate(() => {
        (document.activeElement as HTMLElement)?.blur();
        document.body.focus();
      });
      for (let i = 0; i < targetPosition; i++) {
        await this.page.keyboard.press('Tab');
      }
      this.currentPosition = targetPosition;
      return { success: true };
    }

    // Already at target
    if (targetPosition === this.currentPosition) {
      return { success: true };
    }

    // Calculate direction and number of presses
    const diff = targetPosition - this.currentPosition;
    const key = diff > 0 ? 'Tab' : 'Shift+Tab';
    const presses = Math.abs(diff);

    // Execute the key presses
    for (let i = 0; i < presses; i++) {
      await this.page.keyboard.press(key);
    }

    this.currentPosition = targetPosition;
    return { success: true };
  }

  private async callLLMWithRetry(messages: any[], tools: any[], maxRetries = 3): Promise<OpenRouterResponse> {
    let lastError: Error | null = null;

    for (let attempt = 1; attempt <= maxRetries; attempt++) {
      try {
        const response = await fetch('https://openrouter.ai/api/v1/chat/completions', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${this.apiKey}`,
            'HTTP-Referer': 'http://localhost:3000',
            'X-Title': 'Minimal Agent',
          },
          body: JSON.stringify({
            model: this.model,
            tools,
            messages,
            stream: false,
            parallel_tool_calls: true,
          }),
        });

        if (!response.ok) {
          const errorText = await response.text();
          const isRetryable = [429, 500, 502, 503, 504].includes(response.status);

          if (isRetryable && attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
            this.log(`[Retry ${attempt}/${maxRetries}]: Status ${response.status}, retrying in ${delay}ms...`);
            await new Promise(resolve => setTimeout(resolve, delay));
            continue;
          }

          throw new Error(`OpenRouter API error: ${response.status} - ${errorText}`);
        }

        const result: OpenRouterResponse = await response.json();

        if (!result || !result.choices || result.choices.length === 0) {
          throw new Error('Invalid response from OpenRouter: no choices returned');
        }

        return result;
      } catch (error: any) {
        lastError = error;

        const isNetworkError = error.message?.includes('fetch') ||
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT';

        if (isNetworkError && attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          this.log(`[Retry ${attempt}/${maxRetries}]: Network error, retrying in ${delay}ms...`);
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  async run(goal: string): Promise<MinimalTrace> {
    // Initialize PageFinder if in pagerank mode
    if (this.navigationMode === 'pagerank') {
      this.log('[PageRank] Initializing PageFinder...');
      this.pageFinder = new PageFinder(this.page, this.log.bind(this));
      this.pageFinder.setGoal(goal);

      this.log('[PageRank] Discovering reachable pages (clicking links)...');
      await this.pageFinder.discoverPages({
        maxPages: 100,
        timeout: 5000,
        onProgress: (discovered) => {
          this.log(`[PageRank] Discovered ${discovered} pages...`);
        },
      });
      this.log(`[PageRank] Discovery complete. Found ${this.pageFinder.getPageCount()} pages.`);

      // Get initial suggestions ranked by similarity to first step
      this.currentSuggestions = this.pageFinder.getSuggestedPages(100);
      const currentStep = this.pageFinder.getCurrentStep();
      this.log(`[PageRank] Suggestions for step ${currentStep.index + 1}: "${currentStep.text}":`);
      this.currentSuggestions.slice(0, 10).forEach((s, i) => {
        this.log(`  ${i + 1}. ${s.title} (score: ${s.score.toFixed(3)})`);
      });
    }

    // Select active tools based on navigation mode
    // PageRank mode uses a simpler toolset (no element positioning)
    const activeTools = this.navigationMode === 'pagerank'
      ? PAGERANK_TOOLS
      : TOOLS;

    // Initialize page state
    this.lastUrl = this.page.url();
    this.currentPageElements = await this.scanPageElements();
    this.currentPosition = 0; // Not positioned yet

    // Build system message with page elements
    const systemMessage = this.buildSystemMessage(goal);

    // Initial message differs by navigation mode
    let initialContent: string;
    if (this.navigationMode === 'pagerank') {
      initialContent = `<url>${this.lastUrl}</url>\n<status>Ready. Use navigate_to_page to go to a suggested page.</status>`;
    } else {
      initialContent = `<url>${this.lastUrl}</url>\n<focused_element>No element focused yet. Use move_to_position to focus an element.</focused_element>`;
    }
    const initialMessage = {
      role: 'user',
      content: initialContent,
    };

    const messages: any[] = [systemMessage, initialMessage];
    const steps: MinimalStep[] = [];
    let loopCount = 0;
    const maxLoops = 200;

    // Token tracking
    let totalPromptTokens = 0;
    let totalCompletionTokens = 0;

    // Get the active system prompt for debugging
    const activeSystemPrompt = this.navigationMode === 'pagerank' ? PAGERANK_SYSTEM_PROMPT : SYSTEM_PROMPT;

    // Emit init event
    this.emitDebug('init', {
      goal,
      model: this.model,
      systemPrompt: activeSystemPrompt,
      tools: activeTools,
      pageElements: this.currentPageElements,
      navigationMode: this.navigationMode,
      pageFinderInitialized: this.pageFinder?.isInitialized() || false,
      suggestedPages: this.currentSuggestions,
    });

    this.emitDebug('observation', { type: 'initial', observation: 'No element focused yet' });

    this.log(`\n--- Starting Minimal Agent Goal: ${goal} ---\n`);

    while (loopCount < maxLoops) {
      loopCount++;

      // Call beforeLlmRequest callback for manual oversight
      if (this.beforeLlmRequest) {
        await this.beforeLlmRequest(loopCount, messages);
      }

      // Emit LLM request
      this.emitDebug('llm_request', {
        loopCount,
        request: { model: this.model, tools: activeTools, messages: [...messages] },
      });

      const result = await this.callLLMWithRetry(messages, activeTools);

      // Accumulate token usage
      if (result.usage) {
        totalPromptTokens += result.usage.prompt_tokens;
        totalCompletionTokens += result.usage.completion_tokens;
      }

      const rawMessage = result.choices[0].message;

      const toolCalls = rawMessage.tool_calls?.map(tc => ({
        id: tc.id,
        type: tc.type,
        function: {
          name: tc.function.name,
          arguments: tc.function.arguments || '{}',
        },
      }));

      const message: any = {
        role: rawMessage.role,
        content: rawMessage.content,
        tool_calls: toolCalls,
      };
      messages.push(message);

      // Emit LLM response
      this.emitDebug('llm_response', { loopCount, rawResponse: result, message, toolCalls });

      const reasoning = rawMessage.reasoning;
      const content = message.content;

      if (reasoning) this.log(`[Thought]: ${reasoning}`);
      if (content) this.log(`[Content]: ${content}`);

      if (toolCalls && toolCalls.length > 0) {
        let lastObservation = '';
        let alreadyRescanned = false;

        // Process all tool calls, collecting tool responses
        for (const toolCall of toolCalls) {
          const toolName = toolCall.function.name;
          const args = this.parseArgs(toolCall.function.arguments);

          this.log(`[Action]: ${toolName} ${JSON.stringify(args)}`);

          // Emit tool call
          this.emitDebug('tool_call', {
            loopCount,
            toolCallId: toolCall.id,
            toolName,
            rawArguments: toolCall.function.arguments,
            parsedArguments: args,
          });

          if (toolName === 'finish_run') {
            const success = Boolean(args.success);
            const reason = args.reason || '';
            this.log(`[Finish]: Success=${success}, Reason=${reason}`);

            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: success ? 'done' : `failed: ${reason}`,
            });

            this.emitDebug('tool_result', {
              loopCount,
              toolCallId: toolCall.id,
              toolName,
              result: { success, reason },
            });

            const tokenUsage = {
              prompt: totalPromptTokens,
              completion: totalCompletionTokens,
              total: totalPromptTokens + totalCompletionTokens,
            };

            this.emitDebug('finish', {
              success,
              reason,
              totalSteps: steps.length,
              totalLoops: loopCount,
              totalTokens: tokenUsage,
            });

            return {
              goal,
              success,
              steps,
              error: !success ? reason : undefined,
              totalTokens: tokenUsage,
            };
          }

          // Handle PageRank-specific tools
          if (toolName === 'navigate_to_page') {
            const pageNumber = args.page_number || 1;
            const pageIndex = pageNumber - 1;

            if (pageIndex >= 0 && pageIndex < this.currentSuggestions.length) {
              const targetPage = this.currentSuggestions[pageIndex];
              this.log(`[PageRank] Navigating to page ${pageNumber}: ${targetPage.url}`);

              // Navigate to the page
              await this.page.goto(targetPage.url, { waitUntil: 'domcontentloaded' });
              await this.page.waitForLoadState('load').catch(() => {});
              await this.page.waitForLoadState('networkidle').catch(() => {});

              this.lastUrl = targetPage.url;
              this.currentPosition = 0;

              // Advance to next goal step and refresh suggestions
              if (this.pageFinder) {
                this.pageFinder.advanceStep();
                this.currentSuggestions = this.pageFinder.getSuggestedPages(100);
                const currentStep = this.pageFinder.getCurrentStep();
                this.log(`[PageRank] Now on step ${currentStep.index + 1}: "${currentStep.text}"`);
              }

              // Rescan page elements
              await this.waitForDOMStable();
              this.currentPageElements = await this.scanPageElements();
              messages[0] = this.buildSystemMessage(goal);

              const toolResponse = {
                status: 'ok',
                message: `Navigated to: ${targetPage.title}`,
                url: targetPage.url,
              };
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(toolResponse),
              });

              this.emitDebug('tool_result', {
                loopCount,
                toolCallId: toolCall.id,
                toolName,
                result: toolResponse,
              });

              this.log(`[Rescan after navigate]: ${this.currentPageElements.length} elements`);
            } else {
              const toolResponse = {
                status: 'error',
                message: `Invalid page number. Available: 1-${this.currentSuggestions.length}`,
              };
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(toolResponse),
              });

              this.emitDebug('tool_result', {
                loopCount,
                toolCallId: toolCall.id,
                toolName,
                error: toolResponse.message,
                result: toolResponse,
              });
            }
            continue;
          }

          if (toolName === 'refresh_suggestions') {
            if (this.pageFinder) {
              this.currentSuggestions = this.pageFinder.getSuggestedPages(100);
              const currentStep = this.pageFinder.getCurrentStep();
              this.log(`[PageRank] Refreshed suggestions for step ${currentStep.index + 1}:`);
              this.currentSuggestions.slice(0, 10).forEach((s, i) => {
                this.log(`  ${i + 1}. ${s.title} (score: ${s.score.toFixed(3)})`);
              });

              // Update system message with new suggestions
              messages[0] = this.buildSystemMessage(goal);

              const toolResponse = {
                status: 'ok',
                message: 'Suggestions refreshed',
                suggestions: this.currentSuggestions.map((s, i) => ({
                  number: i + 1,
                  title: s.title,
                  url: s.url,
                })),
              };
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(toolResponse),
              });

              this.emitDebug('tool_result', {
                loopCount,
                toolCallId: toolCall.id,
                toolName,
                result: toolResponse,
              });
            } else {
              const toolResponse = {
                status: 'error',
                message: 'PageFinder not initialized',
              };
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(toolResponse),
              });

              this.emitDebug('tool_result', {
                loopCount,
                toolCallId: toolCall.id,
                toolName,
                error: toolResponse.message,
                result: toolResponse,
              });
            }
            continue;
          }

          // Execute action
          let actionSuccess = true;
          let toolResultMsg = 'ok';

          try {
            switch (toolName) {
              case 'move_to_position': {
                const targetPos = parseInt(args.position, 10);
                const result = await this.moveToPosition(targetPos);
                if (!result.success) {
                  actionSuccess = false;
                  toolResultMsg = result.error || 'failed';
                } else {
                  toolResultMsg = `moved to ${targetPos}`;
                }
                break;
              }
              case 'press_enter': {
                await this.page.keyboard.press('Enter');
                await this.page.waitForLoadState('domcontentloaded').catch(() => {});

                // Check for page navigation
                const newUrl = this.page.url();
                if (newUrl !== this.lastUrl) {
                  await this.page.waitForLoadState('load').catch(() => {});
                  await this.page.waitForLoadState('networkidle').catch(() => {});
                  this.lastUrl = newUrl;
                  this.currentPosition = 0;
                  this.log(`[Navigation]: New page detected`);
                }

                // Wait for DOM to stabilize, then rescan immediately
                await this.waitForDOMStable();
                this.currentPageElements = await this.scanPageElements();
                messages[0] = this.buildSystemMessage(goal);
                alreadyRescanned = true;
                this.log(`[Rescan after Enter]: ${this.currentPageElements.length} elements`);

                toolResultMsg = 'ok';
                break;
              }
              case 'type_text':
                await this.page.keyboard.type(args.text || '');
                toolResultMsg = 'typed';
                break;
              case 'go_back': {
                await this.page.goBack();
                await this.page.waitForLoadState('domcontentloaded').catch(() => {});
                await this.page.waitForLoadState('load').catch(() => {});
                await this.page.waitForLoadState('networkidle').catch(() => {});

                this.lastUrl = this.page.url();
                this.currentPosition = 0;
                this.log(`[Navigation]: Went back`);

                // Wait for DOM to stabilize, then rescan immediately
                await this.waitForDOMStable();
                this.currentPageElements = await this.scanPageElements();
                messages[0] = this.buildSystemMessage(goal);
                alreadyRescanned = true;
                this.log(`[Rescan after Back]: ${this.currentPageElements.length} elements`);

                toolResultMsg = 'ok';
                break;
              }
              default:
                actionSuccess = false;
                toolResultMsg = `unknown tool: ${toolName}`;
            }
          } catch (error: any) {
            actionSuccess = false;
            toolResultMsg = `error: ${error.message}`;
          }

          // Minimal tool response
          messages.push({
            role: 'tool',
            tool_call_id: toolCall.id,
            content: toolResultMsg,
          });

          this.emitDebug('tool_result', {
            loopCount,
            toolCallId: toolCall.id,
            toolName,
            result: toolResultMsg,
          });

          steps.push({
            stepNumber: steps.length + 1,
            observation: toolResultMsg,
            thought: reasoning || content || '',
            action: toolName,
            success: actionSuccess,
          });
        }

        // If we haven't rescanned yet (e.g., after type_text), do it now
        if (!alreadyRescanned) {
          await this.waitForDOMStable();
          const previousCount = this.currentPageElements.length;
          this.currentPageElements = await this.scanPageElements();
          messages[0] = this.buildSystemMessage(goal);

          if (this.currentPageElements.length !== previousCount) {
            this.log(`[Rescan]: Elements changed ${previousCount} -> ${this.currentPageElements.length}`);
          }
        }

        const currentUrl = this.page.url();
        lastObservation = await this.getFocusedElementInfoWithRetry();

        // Single observation message after all tool calls
        // PageRank mode uses simplified format without position reference
        let observationContent: string;
        if (this.navigationMode === 'pagerank') {
          observationContent = `<url>${currentUrl}</url>\n<status>${lastObservation}</status>`;
        } else {
          observationContent = `<url>${currentUrl}</url>\n<focused_element position="${this.currentPosition}">${lastObservation}</focused_element>`;
        }
        messages.push({
          role: 'user',
          content: observationContent,
        });

        this.emitDebug('observation', {
          type: 'step',
          loopCount,
          observation: lastObservation,
          url: currentUrl,
          position: this.navigationMode === 'pagerank' ? undefined : this.currentPosition,
        });

        this.log(`[Observation]: pos=${this.currentPosition}, ${lastObservation}`);
      } else {
        this.log(`[Warning]: No tool calls. Reminding model.`);
        messages.push({ role: 'user', content: 'No tool calls returned. Use the available tools or call finish_run when done.' });
      }
    }

    const tokenUsage = {
      prompt: totalPromptTokens,
      completion: totalCompletionTokens,
      total: totalPromptTokens + totalCompletionTokens,
    };

    this.log(`[Finish]: Success=false, Reason=Max loops reached`);
    this.emitDebug('finish', {
      success: false,
      reason: 'Max loops reached',
      totalSteps: steps.length,
      totalLoops: loopCount,
      totalTokens: tokenUsage,
    });

    return {
      goal,
      success: false,
      steps,
      error: 'Max loops reached',
      totalTokens: tokenUsage,
    };
  }

  private parseArgs(raw: unknown): Record<string, any> {
    if (!raw) return {};
    if (typeof raw === 'string') {
      try {
        return JSON.parse(raw);
      } catch {
        return {};
      }
    }
    if (typeof raw === 'object') return raw as Record<string, any>;
    return {};
  }
}
