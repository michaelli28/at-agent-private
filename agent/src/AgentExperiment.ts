import { IAccessibilityDriver, ActionResult, PerceptualSnapshot, UserAction } from '@adf/virtual-screen-reader';
import Cerebras from '@cerebras/cerebras_cloud_sdk';
import { AgentStep, AgentTrace } from './types';

const SYSTEM_PROMPT = `Complete the task using ONLY your tools and previous screen reader output. Do not rush to conclusions. Prove your answer is correct. Don't be fucking stupid or try to do things you can't do or I'll kill myself and everyone else around me.`;

const TOOLS = [
  {
    type: 'function' as const,
    function: {
      name: 'press_arrow_down',
      description: 'Move to the next item in the virtual cursor order (screen reader Arrow Down). Use to read sequentially through content.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'press_arrow_up',
      description: 'Move to the previous item in the virtual cursor order (screen reader Arrow Up). Use to backtrack.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'press_tab',
      description: 'Move system focus to the next focusable element using Tab. Use to follow the focus order.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'press_enter',
      description: 'Activate the current item with Enter. Use on links, buttons, and controls after navigation.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'press_space',
      description: 'Activate the current item with Space (common for buttons/checkboxes). Use when Enter may not trigger.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'press_heading',
      description: 'Jump to the next heading using the screen reader “H” command. Use to skim page structure.',
      parameters: { type: 'object', properties: {}, required: [] },
    },
  },
  {
    type: 'function' as const,
    function: {
      name: 'finish_run',
      description: 'Call this when you are done. Set success=true/false and include a short reason or finding.',
      parameters: {
        type: 'object',
        properties: {
          success: { type: 'boolean' },
          reason: { type: 'string' },
        },
        required: ['success'],
      },
    },
  },
];

export class AgentExperiment {
  private client: Cerebras;

  constructor(
    private driver: IAccessibilityDriver,
    private captureScreenshot?: () => Promise<string | undefined>,
    private onStep?: (step: AgentStep) => void,
    apiKey?: string
  ) {
    this.client = new Cerebras({
      apiKey: apiKey || process.env['CEREBRAS_API_KEY'],
    });
  }

  async run(goal: string): Promise<AgentTrace> {
    await this.driver.enable();

    try {
      const initialSnapshot = await this.driver.getPerceptualOutput();
      const initialScreenshot = this.captureScreenshot ? await this.captureScreenshot() : undefined;

      // We'll maintain a raw message history compatible with the Groq/OpenAI SDK
      const messages: any[] = [
        { role: 'system', content: SYSTEM_PROMPT },
        this.buildObservationMessage(goal, initialSnapshot, initialScreenshot),
      ];

      const steps: AgentStep[] = [];
      let loopCount = 0;
      const maxLoops = 50; // Guard against infinite loops

      console.log(`
--- Starting Agent Goal: ${goal} ---
`);

      while (loopCount < maxLoops) {
        loopCount++;

        // Call Model
        let chatCompletion;
        try {
          chatCompletion = await this.client.chat.completions.create({
            model: 'llama3.1-70b',
            messages: messages,
            tools: TOOLS,
          });
        } catch (e) {
          console.error('Error calling Cerebras API:', e);
          return {
            goal,
            success: false,
            steps,
            error: `API Error: ${e}`
          };
        }

        const choice = chatCompletion.choices[0];
        const message = choice.message;

        // Log model thought/content
        if (message.content) {
          console.log(`[Thought]: ${message.content}`);
        }

        messages.push(message);

        // If no tools called, remind the model (similar to 'reminder' node in Agent.ts)
        if (!message.tool_calls || message.tool_calls.length === 0) {
          console.log(`[Warning]: No tool calls. Reminding model.`);
          messages.push({ role: 'user', content: 'No tool calls returned. Use the available tools or call finish_run when done.' });
          continue;
        }

        // Process tool calls
        let finished = false;
        let successResult = false;
        let errorResult: string | undefined;

        for (const toolCall of message.tool_calls) {
          const args = normalizeArgs(toolCall.function.arguments);
          const toolName = toolCall.function.name;

          console.log(`[Action]: ${toolName} ${JSON.stringify(args)}`);

          if (toolName === 'finish_run') {
            successResult = Boolean(args.success);
            errorResult = args.reason || '';
            console.log(`[Finish]: Success=${successResult}, Reason=${errorResult}`);

            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ status: 'finished', success: successResult, reason: errorResult })
            });

            finished = true;
            break; // Stop processing further tools if finished
          }

          const map = mapToolToAction(toolName, args);

          if (map.finish) {
            // Handle case where mapToolToAction returns finish (though we handled explicit finish_run above, this is for consistency)
            successResult = map.finish.success;
            errorResult = map.finish.reason;
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ status: 'finished', success: successResult, reason: errorResult })
            });
            finished = true;
            break;
          }

          if (map.action) {
            const result = await this.driver.performAction(map.action);
            const screenshot = this.captureScreenshot ? await this.captureScreenshot() : undefined;

            const step: AgentStep = {
              stepNumber: steps.length + 1,
              observation: result.snapshot,
              thought: message.content || '',
              action: map.action,
              result,
              screenshotBase64: screenshot
            };

            steps.push(step);
            if (this.onStep) this.onStep(step);

            // 1. Add Tool Output
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify(formatActionResult(map.action, result))
            });

            // 2. Add Observation (User Message) - Interleaved as per Agent.ts logic
            messages.push(this.buildObservationMessage(goal, result.snapshot, screenshot));

          } else {
            // Handle unknown tool or error
            const errorMessage = map.message || `Unknown tool ${toolName}`;
            console.log(`[Error]: ${errorMessage}`);
            messages.push({
              role: 'tool',
              tool_call_id: toolCall.id,
              content: JSON.stringify({ status: 'error', message: errorMessage })
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
      }

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

  private buildObservationMessage(goal: string, snapshot?: PerceptualSnapshot, screenshotBase64?: string) {
    const snapshotText = formatSnapshot(snapshot);
    const promptText = `
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
`;

    // Groq/OpenAI content array format
    // Llama 3 models on Groq are typically text-only for now, but we'll structure it cleanly.
    if (screenshotBase64) {
      // Note: Current Groq vision support might be limited or require specific models (like Llama 3.2 Vision).
      // 'llama-3.3-70b-versatile' is text-only. We will ignore the screenshot for now to avoid errors.
      return {
        role: 'user',
        content: promptText
      };
    }

    return {
      role: 'user',
      content: promptText
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

function mapToolToAction(name: string | undefined, args: Record<string, any>): { action?: UserAction; finish?: { success: boolean; reason?: string }; message?: string } {
  switch (name) {
    case 'press_arrow_down':
      return { action: { type: 'KEY_PRESS', key: 'ArrowDown' } };
    case 'press_arrow_up':
      return { action: { type: 'KEY_PRESS', key: 'ArrowUp' } };
    case 'press_tab':
      return { action: { type: 'KEY_PRESS', key: 'Tab' } };
    case 'press_enter':
      return { action: { type: 'KEY_PRESS', key: 'Enter' } };
    case 'press_space':
      return { action: { type: 'KEY_PRESS', key: 'Space' } };
    case 'press_heading':
      return { action: { type: 'KEY_PRESS', key: 'H' } };
    case 'finish_run':
      return { finish: { success: Boolean(args.success), reason: typeof args.reason === 'string' ? args.reason : undefined } };
    default:
      return { message: `Unknown tool ${name}` };
  }
}

function formatActionResult(action: UserAction, result: ActionResult) {
  return {
    status: result.success ? 'ok' : 'error',
    action,
    message: result.message || '',
    snapshot: result.snapshot,
  };
}

function formatSnapshot(snapshot?: PerceptualSnapshot): string {
  if (!snapshot) return 'No observation yet';
  const box = snapshot.cursorBox ? ` (box: x=${snapshot.cursorBox.x}, y=${snapshot.cursorBox.y}, w=${snapshot.cursorBox.width}, h=${snapshot.cursorBox.height})` : '';
  return `${snapshot.text}${box}`;
}
