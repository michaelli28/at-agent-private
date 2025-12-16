import { Page } from 'playwright';
import * as fs from 'fs';
import * as path from 'path';

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

interface OpenRouterResponse {
  id: string;
  choices: Array<{
    message: OpenRouterMessage;
    finish_reason: string;
  }>;
}

// Minimal types (no virtual-screen-reader dependency)
export interface MinimalStep {
  stepNumber: number;
  observation: string;
  thought: string;
  action: string;
  success: boolean;
}

export interface MinimalTrace {
  goal: string;
  success: boolean;
  steps: MinimalStep[];
  error?: string;
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

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'press_tab',
      description: 'Move to the next interactive element (link, button, form field).',
      parameters: { type: 'object', properties: {} },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'press_shift_tab',
      description: 'Move to the previous interactive element.',
      parameters: { type: 'object', properties: {} },
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

export interface AgentMinimalOptions {
  page: Page;
  apiKey?: string;
  model?: string;
  onLog?: LogCallback;
  onDebug?: DebugEventCallback;
  beforeLlmRequest?: BeforeLlmRequestCallback;
}

export class AgentMinimal {
  private page: Page;
  private apiKey: string;
  private model: string;
  private onLog?: LogCallback;
  private onDebug?: DebugEventCallback;
  private beforeLlmRequest?: BeforeLlmRequestCallback;

  constructor(options: AgentMinimalOptions) {
    this.page = options.page;
    this.apiKey = options.apiKey || process.env['OPENROUTER_API_KEY'] || '';
    this.model = options.model || 'google/gemini-2.0-flash-001';
    this.onLog = options.onLog;
    this.onDebug = options.onDebug;
    this.beforeLlmRequest = options.beforeLlmRequest;
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
            'X-Title': 'Minimal Agent',
          },
          body: JSON.stringify({
            model: this.model,
            tools: TOOLS,
            messages,
            stream: false,
            parallel_tool_calls: false,
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
    const initialObservation = await this.getFocusedElementInfo();
    const initialUrl = this.page.url();

    const systemMessage = { role: 'system', content: `${SYSTEM_PROMPT}\n\n<goal>${goal}</goal>` };
    const initialMessage = { role: 'user', content: `<url>${initialUrl}</url>\n<focused_element>${initialObservation}</focused_element>` };

    const messages: any[] = [systemMessage, initialMessage];
    const steps: MinimalStep[] = [];
    let loopCount = 0;
    const maxLoops = 50;

    // Emit init event
    this.emitDebug('init', {
      goal,
      model: this.model,
      systemPrompt: SYSTEM_PROMPT,
      tools: TOOLS,
    });

    this.emitDebug('observation', { type: 'initial', observation: initialObservation });

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
        request: { model: this.model, tools: TOOLS, messages: [...messages] },
      });

      const result = await this.callLLMWithRetry(messages);
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

            const toolResponse = { status: 'finished', success, reason };
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(toolResponse)
            });

            // Emit tool result and finish
            this.emitDebug('tool_result', {
              loopCount,
              toolCallId: toolCall.id,
              toolName,
              result: toolResponse,
            });

            this.emitDebug('finish', {
              success,
              reason,
              totalSteps: steps.length,
              totalLoops: loopCount,
            });

            return {
              goal,
              success,
              steps,
              error: !success ? reason : undefined
            };
          }

          // Execute action
          let actionSuccess = true;
          let observation = '';

          try {
            switch (toolName) {
              case 'press_tab':
                await this.page.keyboard.press('Tab');
                break;
              case 'press_shift_tab':
                await this.page.keyboard.press('Shift+Tab');
                break;
              case 'press_enter':
                await this.page.keyboard.press('Enter');
                await this.page.waitForLoadState('domcontentloaded').catch(() => {});
                break;
              case 'type_text':
                await this.page.keyboard.type(args.text || '');
                break;
              case 'go_back':
                await this.page.goBack();
                await this.page.waitForLoadState('domcontentloaded').catch(() => {});
                break;
              default:
                actionSuccess = false;
                observation = `Unknown tool: ${toolName}`;
            }

            if (actionSuccess) {
              // Small delay for UI to settle
              await new Promise(resolve => setTimeout(resolve, 100));
              observation = await this.getFocusedElementInfo();
            }
          } catch (error: any) {
            actionSuccess = false;
            observation = `Error: ${error.message}`;
          }

          steps.push({
            stepNumber: steps.length + 1,
            observation,
            thought: reasoning || content || '',
            action: toolName,
            success: actionSuccess,
          });

          const toolResponse = { status: actionSuccess ? 'ok' : 'error', message: observation };
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

          const currentUrl = this.page.url();
          messages.push({
            role: 'user',
            content: `<url>${currentUrl}</url>\n<focused_element>${observation}</focused_element>`
          });

          // Emit observation
          this.emitDebug('observation', { type: 'step', loopCount, observation, url: currentUrl });

          this.log(`[Observation]: ${observation}`);
        }
      } else {
        this.log(`[Warning]: No tool calls. Reminding model.`);
        messages.push({ role: 'user', content: 'No tool calls returned. Use the available tools or call finish_run when done.' });
      }
    }

    this.log(`[Finish]: Success=false, Reason=Max loops reached`);
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
