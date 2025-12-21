import { Page, CDPSession } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';
import { PageFinder, PageRankResult } from './PageFinder';
import { AXTreeNavigator } from '../../virtual-screen-reader/src/AXTreeNavigator';
import { AXNode } from '../../virtual-screen-reader/src/types';

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

// Page element from accessibility tree
interface PageElement {
  position: number;
  name: string;
  role: string;
  backendNodeId: number; // CDP backend DOM node ID for direct focus
  states?: {
    expanded?: boolean;
    hasPopup?: boolean | string;
    level?: number; // For headings
  };
}

export interface MinimalTrace {
  goal: string;
  success: boolean;
  steps: MinimalStep[];
  reason?: string;
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

  // CDP session for accessibility tree access
  private cdpSession: CDPSession | null = null;
  private axNavigator: AXTreeNavigator = new AXTreeNavigator();

  // Page element scanning state
  private currentPageElements: PageElement[] = [];
  private currentPosition: number = 0;
  private lastUrl: string = '';
  private elementsChangedSinceLastObservation: boolean = true; // Start true to include in first observation

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
   * Ensure CDP session is initialized for accessibility tree access.
   */
  private async ensureCDPSession(): Promise<CDPSession> {
    if (!this.cdpSession) {
      // Get CDP session from Playwright's Chrome DevTools Protocol
      this.cdpSession = await this.page.context().newCDPSession(this.page);
    }
    return this.cdpSession;
  }

  /**
   * Wait for the AX tree to stabilize after DOM changes.
   * Polls the AX tree until the node count stops changing.
   * Returns early if tree stabilizes, otherwise waits up to maxWaitMs.
   */
  private async waitForAXTreeStable(maxWaitMs = 1000, checkIntervalMs = 100): Promise<void> {
    const cdp = await this.ensureCDPSession();
    let lastNodeCount = -1;
    let stableChecks = 0;
    const requiredStableChecks = 2; // Tree must be stable for 2 consecutive checks
    const startTime = Date.now();

    while (Date.now() - startTime < maxWaitMs) {
      // Force refresh and get tree
      await cdp.send('Accessibility.disable').catch(() => {});
      await cdp.send('Accessibility.enable');
      const result = await cdp.send('Accessibility.getFullAXTree');
      const nodes = (result as unknown as { nodes: AXNode[] }).nodes;

      // Count non-ignored nodes (these are the ones that matter)
      const currentCount = nodes.filter(n => !n.ignored).length;

      if (currentCount === lastNodeCount) {
        stableChecks++;
        if (stableChecks >= requiredStableChecks) {
          this.log(`[AX Tree]: Stabilized at ${currentCount} nodes after ${Date.now() - startTime}ms`);
          return;
        }
      } else {
        stableChecks = 0;
        lastNodeCount = currentCount;
      }

      await new Promise(resolve => setTimeout(resolve, checkIntervalMs));
    }

    this.log(`[AX Tree]: Timeout waiting for stability (last count: ${lastNodeCount})`);
  }

  /**
   * Scan all accessible elements using the Accessibility Tree via CDP.
   * This captures ALL meaningful elements including those inside dropdowns,
   * hidden content with aria-expanded, etc.
   */
  private async scanPageElements(): Promise<PageElement[]> {
    const elements: PageElement[] = [];

    try {
      const cdp = await this.ensureCDPSession();

      // Force refresh of accessibility tree by toggling the domain
      // This ensures we get the latest state after DOM changes
      await cdp.send('Accessibility.disable').catch(() => {});
      await cdp.send('Accessibility.enable');

      // Get the full accessibility tree from CDP
      // Cast through unknown because CDP types differ slightly from our AXNode interface
      const result = await cdp.send('Accessibility.getFullAXTree');
      const nodes = (result as unknown as { nodes: AXNode[] }).nodes;

      // Debug: log node counts
      const ignoredCount = nodes.filter(n => n.ignored).length;
      this.log(`[Scan]: Total AX nodes: ${nodes.length}, Ignored: ${ignoredCount}`);

      // Build navigable tree and filter to interesting nodes
      this.axNavigator.buildNavigableTree(nodes);
      const interestingNodes = this.axNavigator.getAllInterestingNodes();

      // Convert to PageElement format
      for (let i = 0; i < interestingNodes.length; i++) {
        const node = interestingNodes[i];

        // Skip nodes without a backend DOM node ID (can't focus them)
        if (node.backendDOMNodeId === undefined) {
          continue;
        }

        elements.push({
          position: elements.length + 1, // 1-indexed
          name: node.computedName || '',
          role: node.computedRole,
          backendNodeId: node.backendDOMNodeId,
          states: {
            expanded: node.states.expanded,
            hasPopup: node.states.hasPopup,
            level: node.states.level,
          },
        });
      }

      this.log(`[Scan]: Found ${elements.length} accessible elements (via AX tree)`);
    } catch (error: any) {
      this.log(`[Scan]: Error getting accessibility tree: ${error.message}`);
      // Return empty list on error
    }

    // Reset position since we're starting fresh
    this.currentPosition = 0;
    // Mark that elements changed so they'll be included in next observation
    this.elementsChangedSinceLastObservation = true;
    this.log(`[Scan]: Completed - flag set to true, ${elements.length} elements`);

    return elements;
  }

  /**
   * Format page elements as a simple numbered list for the LLM.
   * Format: "position. name, role [modifiers]"
   */
  private formatPageElements(): string {
    if (this.currentPageElements.length === 0) {
      return 'No interactive elements found on page.';
    }

    const lines = this.currentPageElements.map(el => {
      // Base format: "name, role" or just "role" if no name
      let display = el.name ? `${el.name}, ${el.role}` : el.role;

      // Add modifiers for important states
      if (el.states?.hasPopup) display += ' [popup]';
      // Only show heading level for actual headings
      if (el.states?.level && el.role === 'heading') display += ` [h${el.states.level}]`;

      return `${el.position}. ${display}`;
    });

    return `Interactive elements (${this.currentPageElements.length}):\n${lines.join('\n')}`;
  }

  /**
   * Build the system message (static, does not include page elements).
   * Page elements are included in observation messages instead.
   */
  private buildSystemMessage(goal: string): { role: string; content: string } {
    const activePrompt = this.navigationMode === 'pagerank' ? PAGERANK_SYSTEM_PROMPT : SYSTEM_PROMPT;
    const content = `${activePrompt}\n\n<goal>${goal}</goal>`;

    return {
      role: 'system',
      content,
    };
  }

  /**
   * Build an observation message with current page state.
   * Only includes page_elements when they've changed to save tokens.
   */
  private buildObservationMessage(focusedElement: string): { role: string; content: string } {
    const currentUrl = this.page.url();
    let content = `<url>${currentUrl}</url>\n`;

    if (this.navigationMode === 'pagerank') {
      // PageRank mode: include suggested pages
      if (this.currentSuggestions.length > 0) {
        const suggestionsText = this.currentSuggestions
          .map((s, i) => `${i + 1}. ${s.title} - ${s.url}`)
          .join('\n');
        content += `<suggested_pages>\n${suggestionsText}\n</suggested_pages>\n`;
      }
      content += `<status>${focusedElement}</status>`;
    } else {
      // Default mode: only include page elements when they've changed
      if (this.elementsChangedSinceLastObservation) {
        this.log(`[Observation]: Including page_elements (${this.currentPageElements.length} items)`);
        content += `${this.formatPageElements()}\n`;
        this.elementsChangedSinceLastObservation = false;
      }
      content += `Currently focused: [${this.currentPosition}] ${focusedElement}`;
    }

    return { role: 'user', content };
  }

  /**
   * Move to a specific position by directly focusing the element.
   * Uses CDP DOM.focus with backendNodeId for direct element access.
   */
  private async moveToPosition(targetPosition: number): Promise<{ success: boolean; error?: string }> {
    const maxPosition = this.currentPageElements.length;

    if (targetPosition < 1 || targetPosition > maxPosition) {
      return { success: false, error: `Invalid position ${targetPosition}. Valid range: 1-${maxPosition}` };
    }

    // Already at target
    if (targetPosition === this.currentPosition) {
      return { success: true };
    }

    // Find the element in our list
    const element = this.currentPageElements.find(el => el.position === targetPosition);
    if (!element) {
      return { success: false, error: `Could not find element at position ${targetPosition}` };
    }

    try {
      const cdp = await this.ensureCDPSession();

      // Focus the element using CDP DOM.focus with backendNodeId
      await cdp.send('DOM.focus', { backendNodeId: element.backendNodeId });

      // Scroll the element into view using CDP
      await cdp.send('DOM.scrollIntoViewIfNeeded', { backendNodeId: element.backendNodeId });

      this.currentPosition = targetPosition;
      return { success: true };
    } catch (error: any) {
      return { success: false, error: `Failed to focus element: ${error.message}` };
    }
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
            tool_choice: 'required',
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

    // Build static system message (page elements go in observation messages)
    const systemMessage = this.buildSystemMessage(goal);

    // Initial observation includes page elements
    const initialMessage = this.buildObservationMessage('No element focused yet. Use move_to_position to focus an element.');

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

      // Preserve reasoning_details for models that require it (e.g., Gemini)
      const message: any = {
        role: rawMessage.role,
        content: rawMessage.content,
        tool_calls: toolCalls,
      };

      // Include reasoning_details if present (required by OpenRouter for some models)
      if ((rawMessage as any).reasoning_details) {
        message.reasoning_details = (rawMessage as any).reasoning_details;
      }

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
              reason,  // Always include the reason for containsText checks
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
              alreadyRescanned = true;

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

                // Wait for DOM to stabilize, then wait for AX tree to catch up
                await this.waitForDOMStable(3000, 200);
                await this.waitForAXTreeStable(1000, 100);

                this.currentPageElements = await this.scanPageElements();
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

                // Wait for DOM to stabilize, then wait for AX tree to catch up
                await this.waitForDOMStable(3000, 200);
                await this.waitForAXTreeStable(1000, 100);

                this.currentPageElements = await this.scanPageElements();
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

        // Only rescan if URL changed (navigation occurred) and we haven't already rescanned
        // Don't rescan after every action - it destroys focus and scrolls the page
        // Compare base URL only (ignore hash changes - some SPAs update hash on focus)
        if (!alreadyRescanned) {
          const currentUrl = this.page.url();
          const currentBase = currentUrl.split('#')[0];
          const lastBase = this.lastUrl.split('#')[0];
          if (currentBase !== lastBase) {
            this.log(`[Navigation detected]: ${this.lastUrl} -> ${currentUrl}`);
            this.lastUrl = currentUrl;
            this.currentPosition = 0;
            await this.waitForDOMStable(3000, 200);
            await this.waitForAXTreeStable(1000, 100);
            this.currentPageElements = await this.scanPageElements();
          } else if (currentUrl !== this.lastUrl) {
            // Hash changed but base URL same - just update lastUrl, no rescan
            this.lastUrl = currentUrl;
          }
        }

        lastObservation = await this.getFocusedElementInfoWithRetry();

        // Single observation message after all tool calls (includes page elements)
        messages.push(this.buildObservationMessage(lastObservation));

        this.emitDebug('observation', {
          type: 'step',
          loopCount,
          observation: lastObservation,
          url: this.page.url(),
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
