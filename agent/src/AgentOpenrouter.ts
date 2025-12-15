import { IAccessibilityDriver, ActionResult, PerceptualSnapshot, UserAction } from '@adf/virtual-screen-reader';
import * as fs from 'fs';
import * as path from 'path';
import { AgentStep, AgentTrace, DebugEvent, DebugEventCallback, BeforeLlmRequestCallback, LogCallback } from './types';

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
  tool_calls?: OpenRouterToolCall[];
}

interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: OpenRouterMessage;
    finish_reason: string;
  }>;
}

const SYSTEM_PROMPT = fs.readFileSync(path.join(__dirname, '../system_prompt.txt'), 'utf-8').trim();

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

export interface AgentOpenrouterOptions {
  driver: IAccessibilityDriver;
  onStep?: (step: AgentStep) => void;
  apiKey?: string;
  model?: string;
  onDebug?: DebugEventCallback;
  beforeLlmRequest?: BeforeLlmRequestCallback;
  onLog?: LogCallback;
}

export class AgentOpenrouter {
  private apiKey: string;
  private model: string;
  private driver: IAccessibilityDriver;
  private onStep?: (step: AgentStep) => void;
  private onDebug?: DebugEventCallback;
  private beforeLlmRequest?: BeforeLlmRequestCallback;
  private onLog?: LogCallback;

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

    if ('driver' in driverOrOptions) {
      // Options object
      driver = driverOrOptions.driver;
      resolvedOnStep = driverOrOptions.onStep;
      resolvedApiKey = driverOrOptions.apiKey;
      resolvedModel = driverOrOptions.model;
      resolvedOnDebug = driverOrOptions.onDebug;
      resolvedBeforeLlmRequest = driverOrOptions.beforeLlmRequest;
      resolvedOnLog = driverOrOptions.onLog;
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

  private async callLLMWithRetry(messages: any[], maxRetries = 3): Promise<OpenRouterResponse> {
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
            tools: TOOLS,
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
      const initialSnapshot = await this.driver.getPerceptualOutput();

      const systemMessage = { role: 'system', content: SYSTEM_PROMPT };
      const initialObservation = this.buildObservationMessage(goal, initialSnapshot);

      const messages: any[] = [systemMessage, initialObservation];

      // Emit init event with all initial data
      this.emitDebug('init', {
        goal,
        model: this.model,
        systemPrompt: SYSTEM_PROMPT,
        tools: TOOLS,
      });

      this.emitDebug('observation', { type: 'initial', snapshot: initialSnapshot });

      const steps: AgentStep[] = [];
      let loopCount = 0;
      const maxLoops = 50;

      this.log(`\n--- Starting Agent Goal: ${goal} ---\n`);

      while (loopCount < maxLoops) {
        loopCount++;

        // Emit LLM request with full context
        const llmRequest = {
          model: this.model,
          tools: TOOLS,
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
        const result = await this.callLLMWithRetry(messages);

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

              // Emit finish event
              this.emitDebug('finish', {
                success: successResult,
                reason: errorResult,
                totalSteps: steps.length,
                totalLoops: loopCount,
              });

              finished = true;
              break;
            }

            const map = mapToolToAction(toolName);

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
              const observationMsg = this.buildObservationMessage(goal, actionResult.snapshot);
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
              error: !successResult ? errorResult : undefined
            };
          }

        } else {
          // No tool calls -> Reminder
          this.log(`[Warning]: No tool calls. Reminding model.`);
          messages.push({ role: 'user', content: 'No tool calls returned. Use the available tools or call finish_run when done.' });
        }
      }

      // Max loops reached
      this.log(`[Finish]: Success=false, Reason=Max loops reached (${loopCount} loops)`);
      this.emitDebug('finish', {
        success: false,
        reason: 'Max loops reached',
        totalSteps: steps.length,
        totalLoops: loopCount,
      });

      return {
        goal,
        success: false,
        steps,
        error: 'Max loops reached'
      };

    } finally {
      await this.driver.disable();
    }
  }

  private buildObservationMessage(goal: string, snapshot?: PerceptualSnapshot) {
    const snapshotText = formatSnapshot(snapshot);
    return {
      role: 'user',
      content: `
<observation_context>
  <user_goal>
    ${goal}
  </user_goal>

  <screen_reader_status>
    ${snapshotText}
  </screen_reader_status>

  <instructions>
    Based on the screen reader output above, determine the next necessary action to progress towards the goal. Select the appropriate tool.
  </instructions>
</observation_context>
`
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

function mapToolToAction(name: string | undefined): { action?: UserAction; message?: string } {
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
