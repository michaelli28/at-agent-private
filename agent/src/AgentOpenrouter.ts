import { IAccessibilityDriver, ActionResult, PerceptualSnapshot, UserAction } from '@adf/virtual-screen-reader';
import * as fs from 'fs';
import * as path from 'path';
import { AgentStep, AgentTrace, DebugEvent, DebugEventCallback, BeforeLlmRequestCallback, LogCallback } from './types';
import { PageFinder, PageRankResult } from './PageFinder';

export type NavigationMode = 'default' | 'pagerank';

// Raw OpenRouter response types (more lenient than SDK)
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
  reasoning_details?: unknown[]; // Required for Gemini models - must be preserved in each request
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

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '../system_prompt.txt'), 'utf-8').trim();
const PAGERANK_SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '../pagerank_system_prompt.txt'), 'utf-8').trim();

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'press_arrow_down',
      description: 'Move to the next element on the page. Use to read content sequentially or find something nearby.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'press_arrow_up',
      description: 'Move to the previous element. Use to go back if you passed something.',
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
      description: 'Click or activate the current element. Use after navigating to a link or button you want to interact with.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'press_heading',
      description: 'Jump directly to the next heading. Efficient for finding page sections or skipping past content.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'press_previous_heading',
      description: 'Jump back to the previous heading. Use to return to an earlier section.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'press_tab',
      description: 'Jump to the next interactive element (link, button, form field). Faster than arrows for finding clickable items.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'press_shift_tab',
      description: 'Jump to the previous interactive element. Use to go back if you passed an interactive element.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'go_back',
      description: 'Navigate back to the previous page. Use when you clicked the wrong link or need to return to the previous page.',
      parameters: {
        type: 'object',
        properties: {},
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'type_text',
      description: 'Type text into the currently focused input field. Navigate to a text field first, then use this to enter text.',
      parameters: {
        type: 'object',
        properties: {
          text: {
            type: 'string',
            description: 'The text to type into the input field',
          },
        },
        required: ['text'],
      },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'finish_run',
      description: 'Call when you have completed the goal or determined it cannot be done. Set success=true if goal achieved, false otherwise.',
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

// Additional tools for PageRank navigation mode
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
];

export interface AgentOpenrouterOptions {
  driver: IAccessibilityDriver;
  onStep?: (step: AgentStep) => void;
  apiKey?: string;
  model?: string;
  onDebug?: DebugEventCallback;
  beforeLlmRequest?: BeforeLlmRequestCallback;
  onLog?: LogCallback;
  /** Navigation mode: 'default' uses LLM-only navigation, 'pagerank' discovers reachable pages */
  navigationMode?: NavigationMode;
}

export class AgentOpenrouter {
  private apiKey: string;
  private model: string;
  private driver: IAccessibilityDriver;
  private onStep?: (step: AgentStep) => void;
  private onDebug?: DebugEventCallback;
  private beforeLlmRequest?: BeforeLlmRequestCallback;
  private onLog?: LogCallback;

  // PageRank navigation properties
  private navigationMode: NavigationMode;
  private pageFinder?: PageFinder;
  private currentSuggestions: PageRankResult[] = [];

  constructor(options: AgentOpenrouterOptions);
  constructor(
    driver: IAccessibilityDriver,
    onStep?: (step: AgentStep) => void,
    apiKey?: string,
    model?: string,
    onDebug?: DebugEventCallback,
  );
  constructor(
    driverOrOptions: IAccessibilityDriver | AgentOpenrouterOptions,
    onStep?: (step: AgentStep) => void,
    apiKey?: string,
    model?: string,
    onDebug?: DebugEventCallback,
  ) {
    // Handle both constructor signatures
    let driver: IAccessibilityDriver;
    let resolvedApiKey: string | undefined;
    let resolvedModel: string | undefined;
    let resolvedOnStep: ((step: AgentStep) => void) | undefined;
    let resolvedOnDebug: DebugEventCallback | undefined;
    let resolvedBeforeLlmRequest: BeforeLlmRequestCallback | undefined;
    let resolvedOnLog: LogCallback | undefined;
    let resolvedNavigationMode: NavigationMode = 'default';

    if ('driver' in driverOrOptions) {
      // Options object
      driver = driverOrOptions.driver;
      resolvedOnStep = driverOrOptions.onStep;
      resolvedApiKey = driverOrOptions.apiKey;
      resolvedModel = driverOrOptions.model;
      resolvedOnDebug = driverOrOptions.onDebug;
      resolvedBeforeLlmRequest = driverOrOptions.beforeLlmRequest;
      resolvedOnLog = driverOrOptions.onLog;
      resolvedNavigationMode = driverOrOptions.navigationMode || 'default';
    } else {
      // Legacy positional arguments
      driver = driverOrOptions;
      resolvedOnStep = onStep;
      resolvedApiKey = apiKey;
      resolvedModel = model;
      resolvedOnDebug = onDebug;
    }

    this.driver = driver;
    this.onStep = resolvedOnStep;
    this.onDebug = resolvedOnDebug;
    this.beforeLlmRequest = resolvedBeforeLlmRequest;
    this.onLog = resolvedOnLog;
    this.apiKey = resolvedApiKey || process.env['OPENROUTER_API_KEY'] || '';
    this.model = resolvedModel || 'google/gemini-2.0-flash-001';
    this.navigationMode = resolvedNavigationMode;
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
            'X-Title': 'Accessibility Agent',
          },
          body: JSON.stringify({
            model: this.model,
            tools,
            messages,
            stream: false,
            parallel_tool_calls: true,
          }),
        });

        // Retry on rate limits and server errors
        if (!response.ok) {
          const errorText = await response.text();
          const isRetryable = [429, 500, 502, 503, 504].includes(response.status);

          if (isRetryable && attempt < maxRetries) {
            const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000); // Exponential backoff, max 10s
            this.log(`[Retry ${attempt}/${maxRetries}]: Status ${response.status}, retrying in ${delay}ms...`);
            this.emitDebug('error', {
              message: 'OpenRouter API error (retrying)',
              status: response.status,
              error: errorText,
              attempt,
              maxRetries,
              retryDelay: delay
            });
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

        // Retry on network errors
        const isNetworkError = error.message?.includes('fetch') ||
          error.code === 'ECONNRESET' ||
          error.code === 'ETIMEDOUT';

        if (isNetworkError && attempt < maxRetries) {
          const delay = Math.min(1000 * Math.pow(2, attempt - 1), 10000);
          this.log(`[Retry ${attempt}/${maxRetries}]: Network error, retrying in ${delay}ms...`);
          this.emitDebug('error', {
            message: 'Network error (retrying)',
            error: error.message,
            attempt,
            maxRetries,
            retryDelay: delay
          });
          await new Promise(resolve => setTimeout(resolve, delay));
          continue;
        }

        throw error;
      }
    }

    throw lastError || new Error('Max retries exceeded');
  }

  async run(goal: string): Promise<AgentTrace> {
    await this.driver.enable();

    try {
      // Initialize PageFinder if in pagerank mode
      if (this.navigationMode === 'pagerank') {
        const page = this.driver.getPage();
        if (!page) {
          this.log('[PageRank] Warning: Could not get Page object from driver, skipping PageRank initialization');
        } else {
          this.log('[PageRank] Initializing PageFinder...');
          this.pageFinder = new PageFinder(page, this.log.bind(this));
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
      }

      // Select active tools based on navigation mode
      const activeTools = this.navigationMode === 'pagerank'
        ? [...TOOLS, ...PAGERANK_TOOLS]
        : TOOLS;

      const initialSnapshot = await this.driver.getPerceptualOutput();

      const activeSystemPrompt = this.navigationMode === 'pagerank' ? PAGERANK_SYSTEM_PROMPT : SYSTEM_PROMPT;
      const systemMessage = { role: 'system', content: `${activeSystemPrompt}\n\n<goal>${goal}</goal>` };
      const initialObservation = this.buildObservationMessage(initialSnapshot, goal);

      const messages: any[] = [systemMessage, initialObservation];

      // Emit init event with all initial data
      this.emitDebug('init', {
        goal,
        model: this.model,
        systemPrompt: activeSystemPrompt,
        tools: activeTools,
        navigationMode: this.navigationMode,
        pageFinderInitialized: this.pageFinder?.isInitialized() || false,
        suggestedPages: this.currentSuggestions,
      });

      this.emitDebug('observation', { type: 'initial', snapshot: initialSnapshot });

      const steps: AgentStep[] = [];
      let loopCount = 0;
      const maxLoops = 200;

      // Token tracking
      let totalPromptTokens = 0;
      let totalCompletionTokens = 0;

      this.log(`\n--- Starting Agent Goal: ${goal} ---\n`);

      while (loopCount < maxLoops) {
        loopCount++;

        // Emit LLM request with full context
        const llmRequest = {
          model: this.model,
          tools: activeTools,
          messages: [...messages], // Copy to avoid mutation
          stream: false,
          parallel_tool_calls: true,
        };
        this.emitDebug('llm_request', { loopCount, request: llmRequest });

        // Wait for manual oversight confirmation if callback is provided
        if (this.beforeLlmRequest) {
          await this.beforeLlmRequest(loopCount, messages);
        }

        // 1. Call LLM with retry logic
        const result = await this.callLLMWithRetry(messages, activeTools);

        // Accumulate token usage
        if (result.usage) {
          totalPromptTokens += result.usage.prompt_tokens;
          totalCompletionTokens += result.usage.completion_tokens;
        }

        const rawMessage = result.choices[0].message;

        // Keep tool_calls in snake_case for API compatibility
        const toolCalls = rawMessage.tool_calls?.map(tc => ({
          id: tc.id,
          type: tc.type,
          function: {
            name: tc.function.name,
            arguments: tc.function.arguments || '{}', // Default to empty object if missing
          },
        }));

        const message: any = {
          role: rawMessage.role,
          content: rawMessage.content,
          tool_calls: toolCalls, // snake_case for API
          // Preserve reasoning_details for Gemini models (required by OpenRouter)
          reasoning_details: rawMessage.reasoning_details,
        };
        messages.push(message);

        // Emit raw LLM response
        this.emitDebug('llm_response', { loopCount, rawResponse: result, message, toolCalls });

        const reasoning = rawMessage.reasoning;
        const content = message.content;

        if (reasoning) {
          this.log(`[Thought]: ${reasoning}`);
        }

        if (content) {
          this.log(`[Content]: ${content}`);
        }

        // 2. Handle Tool Calls or Reminder
        if (toolCalls && toolCalls.length > 0) {
          let finished = false;
          let successResult = false;
          let errorResult: string | undefined;

          // Process all tool calls in the batch
          for (const toolCall of toolCalls) {
            const toolName = toolCall.function.name;
            const args = normalizeArgs(toolCall.function.arguments);

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
              successResult = Boolean(args.success);
              errorResult = args.reason || '';
              this.log(`[Finish]: Success=${successResult}, Reason=${errorResult}`);

              const toolResponse = { status: 'finished', success: successResult, reason: errorResult };
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(toolResponse)
              });

              // Emit tool result
              this.emitDebug('tool_result', {
                loopCount,
                toolCallId: toolCall.id,
                toolName,
                result: toolResponse,
              });

              const tokenUsage = {
                prompt: totalPromptTokens,
                completion: totalCompletionTokens,
                total: totalPromptTokens + totalCompletionTokens,
              };

              // Emit finish event
              this.emitDebug('finish', {
                success: successResult,
                reason: errorResult,
                totalSteps: steps.length,
                totalLoops: loopCount,
                totalTokens: tokenUsage,
              });

              finished = true;
              break;
            }

            // Handle PageRank-specific tools
            if (toolName === 'navigate_to_page') {
              const pageNumber = args.page_number || 1;
              const pageIndex = pageNumber - 1;

              if (pageIndex >= 0 && pageIndex < this.currentSuggestions.length) {
                const targetPage = this.currentSuggestions[pageIndex];
                this.log(`[PageRank] Navigating to page ${pageNumber}: ${targetPage.url}`);

                // Navigate to the page
                await this.driver.navigateTo(targetPage.url);
                const newSnapshot = await this.driver.getPerceptualOutput();

                const toolResponse = {
                  status: 'ok',
                  message: `Navigated to: ${targetPage.title}`,
                  url: targetPage.url,
                };
                messages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(toolResponse)
                });

                this.emitDebug('tool_result', {
                  loopCount,
                  toolCallId: toolCall.id,
                  toolName,
                  result: toolResponse,
                });

                // Add observation
                const observationMsg = this.buildObservationMessage(newSnapshot, goal);
                messages.push(observationMsg);
                this.emitDebug('observation', { type: 'step', loopCount, snapshot: newSnapshot });

                // Advance to next step and refresh suggestions
                if (this.pageFinder) {
                  this.pageFinder.advanceStep();
                  this.currentSuggestions = this.pageFinder.getSuggestedPages(100);
                  this.log(`[PageRank] Advanced to step ${this.pageFinder.getCurrentStep().index + 1}: ${this.pageFinder.getCurrentStep().text}`);
                }
              } else {
                const toolResponse = {
                  status: 'error',
                  message: `Invalid page number. Available: 1-${this.currentSuggestions.length}`,
                };
                messages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(toolResponse)
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
                this.log('[PageRank] Refreshed suggestions:');
                this.currentSuggestions.forEach((s, i) => {
                  this.log(`  ${i + 1}. ${s.title} (${s.url})`);
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
                  content: JSON.stringify(toolResponse)
                });

                this.emitDebug('tool_result', {
                  loopCount,
                  toolCallId: toolCall.id,
                  toolName,
                  result: toolResponse,
                });

                // Add observation with updated suggestions
                const currentSnapshot = await this.driver.getPerceptualOutput();
                const observationMsg = this.buildObservationMessage(currentSnapshot, goal);
                messages.push(observationMsg);
              } else {
                const toolResponse = {
                  status: 'error',
                  message: 'PageFinder not initialized',
                };
                messages.push({
                  role: 'tool',
                  tool_call_id: toolCall.id,
                  content: JSON.stringify(toolResponse)
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

            const map = mapToolToAction(toolName, args);

            if (map.action) {
              const actionResult = await this.driver.performAction(map.action);

              const step: AgentStep = {
                stepNumber: steps.length + 1,
                observation: actionResult.snapshot,
                thought: reasoning || content || '',
                action: map.action,
                result: actionResult,
              };

              steps.push(step);
              if (this.onStep) this.onStep(step);

              // Tool Response
              const toolResponse = formatActionResult(map.action, actionResult);
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(toolResponse)
              });

              // Emit tool result
              this.emitDebug('tool_result', {
                loopCount,
                toolCallId: toolCall.id,
                toolName,
                action: map.action,
                result: toolResponse,
              });

              // Interleaved Observation (User)
              const observationMsg = this.buildObservationMessage(actionResult.snapshot, goal);
              messages.push(observationMsg);

              // Emit observation
              this.emitDebug('observation', { type: 'step', loopCount, snapshot: actionResult.snapshot });
            } else {
              // Error or Unknown
              const errorMessage = map.message || `Unknown tool ${toolName}`;
              this.log(`[Error]: ${errorMessage}`);
              const toolResponse = { status: 'error', message: errorMessage };
              messages.push({
                role: 'tool',
                tool_call_id: toolCall.id,
                content: JSON.stringify(toolResponse)
              });

              // Emit tool error result
              this.emitDebug('tool_result', {
                loopCount,
                toolCallId: toolCall.id,
                toolName,
                error: errorMessage,
                result: toolResponse,
              });
            }
          }

          if (finished) {
            return {
              goal,
              success: successResult,
              steps,
              error: !successResult ? errorResult : undefined,
              totalTokens: {
                prompt: totalPromptTokens,
                completion: totalCompletionTokens,
                total: totalPromptTokens + totalCompletionTokens,
              },
            };
          }

        } else {
          // No tool calls -> Reminder
          this.log(`[Warning]: No tool calls. Reminding model.`);
          messages.push({ role: 'user', content: 'No tool calls returned. Use the available tools or call finish_run when done.' });
        }
      }

      // Max loops reached
      const tokenUsage = {
        prompt: totalPromptTokens,
        completion: totalCompletionTokens,
        total: totalPromptTokens + totalCompletionTokens,
      };

      this.log(`[Finish]: Success=false, Reason=Max loops reached (${loopCount} loops)`);
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

    } finally {
      await this.driver.disable();
    }
  }

  private buildObservationMessage(snapshot?: PerceptualSnapshot, goal?: string) {
    const snapshotText = formatSnapshot(snapshot);
    const url = snapshot?.pageUrl || '';

    let content = `<url>${url}</url>\n<screen_reader_status>${snapshotText}</screen_reader_status>`;

    // Add suggested pages if in PageRank mode and we have suggestions
    if (this.navigationMode === 'pagerank' && this.currentSuggestions.length > 0) {
      const suggestionsText = this.currentSuggestions
        .map((s, i) => `${i + 1}. ${s.title} - ${s.url}`)
        .join('\n');
      content += `\n<suggested_pages>\n${suggestionsText}\n</suggested_pages>`;
    }

    return {
      role: 'user',
      content,
    };
  }
}

function normalizeArgs(raw: unknown): Record<string, any> {
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

function mapToolToAction(name: string | undefined, args: Record<string, any> = {}): { action?: UserAction; message?: string } {
  switch (name) {
    case 'press_arrow_down':
      return { action: { type: 'KEY_PRESS', key: 'ArrowDown' } };
    case 'press_arrow_up':
      return { action: { type: 'KEY_PRESS', key: 'ArrowUp' } };
    case 'press_enter':
      return { action: { type: 'KEY_PRESS', key: 'Enter' } };
    case 'press_heading':
      return { action: { type: 'KEY_PRESS', key: 'H' } };
    case 'press_previous_heading':
      return { action: { type: 'KEY_PRESS', key: 'Shift+H' } };
    case 'press_tab':
      return { action: { type: 'KEY_PRESS', key: 'Tab' } };
    case 'press_shift_tab':
      return { action: { type: 'KEY_PRESS', key: 'Shift+Tab' } };
    case 'go_back':
      return { action: { type: 'GO_BACK' } };
    case 'type_text':
      return { action: { type: 'TYPE', text: args.text || '' } };
    case 'instant_traverse':
      return { action: { type: 'KEY_PRESS', key: 'Shift+A' } };
    default:
      return { message: `Unknown tool ${name}` };
  }
}

function formatActionResult(action: UserAction, result: ActionResult) {
  return {
    status: result.success ? 'ok' : 'error',
    action,
    message: result.message || '',
  };
}

function formatSnapshot(snapshot?: PerceptualSnapshot): string {
  if (!snapshot) return 'No observation yet';
  return snapshot.text;
}
