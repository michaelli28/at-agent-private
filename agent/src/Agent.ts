import { IAccessibilityDriver, ActionResult, PerceptualSnapshot, UserAction } from '@adf/virtual-screen-reader';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage, isAIMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { END, MessagesZodState, START, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import { AgentGraphState, AgentStep, AgentTrace } from './types';

const SYSTEM_PROMPT = `You are an expert accessibility testing agent. Your goal is to navigate the web page using a screen reader to accomplish a specific task.

CRITICAL INSTRUCTION:
You MUST "think out loud" before taking any action. Explain your reasoning, what you see in the current state, and why you are choosing the next action. Your thought process is visible to the user and is crucial for debugging and trust.

GOAL TRACKING:
- At the start of EVERY thought, assess your progress toward the goal
- Explicitly state whether you have found what you're looking for
- If you haven't found it yet, explain what you're trying next and why
- Only call finish_run when you have CONCRETE EVIDENCE that you've achieved the goal OR you've exhausted all reasonable options

Navigation Strategy:
1. Start by exploring the page structure with press_heading to get an overview
2. Look for navigation menus, search bars, or links that might lead to your goal
3. If you don't find what you're looking for in headings, use press_arrow_down to explore interactive elements like links and buttons
4. Be persistent - if one approach doesn't work, try another strategy
5. Don't give up early - you have many steps available to accomplish your goal
6. If you find a promising link (like "Admissions" when looking for tuition), activate it with press_enter

Success Criteria:
- For "find X" tasks: You must actually READ the content about X (not just find a link to it)
- For "navigate to X" tasks: You must confirm you've reached the X page
- For accessibility tasks: Document violations as you encounter them

Rules:
1. Complete the task using ONLY your tools and previous screen reader output.
2. Prioritize using the press_heading tool to scan structure first.
3. If headings don't reveal the target, systematically explore links and navigation menus.
4. Aim to find patterns that you can exploit to navigate the page faster.
5. Prove your answer is correct before calling finish_run.
6. ALWAYS output a thought before calling a tool.
7. Only call finish_run when you've truly accomplished the goal OR exhausted all reasonable options.
8. In your thoughts, regularly report on your progress: "I'm looking for X. So far I've tried Y. Next I'll try Z."`;

// Key-only toolset with instructive descriptions
const pressArrowDown = tool(async () => `Pressed ArrowDown`, {
  name: 'press_arrow_down',
  description: 'Move to the next item in the virtual cursor order (screen reader Arrow Down). Use to read sequentially through content.',
  schema: z.object({}),
});

const pressArrowUp = tool(async () => `Pressed ArrowUp`, {
  name: 'press_arrow_up',
  description: 'Move to the previous item in the virtual cursor order (screen reader Arrow Up). Use to backtrack.',
  schema: z.object({}),
});

const pressEnter = tool(async () => `Pressed Enter`, {
  name: 'press_enter',
  description: 'Activate the current item with Enter. Use on links, buttons, and controls after navigation.',
  schema: z.object({}),
});

const pressSpace = tool(async () => `Pressed Space`, {
  name: 'press_space',
  description: 'Activate the current item with Space (common for buttons/checkboxes). Use when Enter may not trigger.',
  schema: z.object({}),
});

const pressHeading = tool(async () => `Pressed H`, {
  name: 'press_heading',
  description: 'Jump to the next heading using the screen reader “H” command. Use to skim page structure.',
  schema: z.object({}),
});

const finishRun = tool(async ({ success, reason }: { success: boolean; reason?: string }) => `Finished run: ${success ? 'success' : 'failed'} ${reason || ''}`, {
  name: 'finish_run',
  description: 'Call this when you are done. Set success=true/false and include a short reason or finding.',
  schema: z.object({ success: z.boolean(), reason: z.string().optional() }),
});

const toolsByName = {
  [pressArrowDown.name]: pressArrowDown,
  [pressArrowUp.name]: pressArrowUp,
  [pressEnter.name]: pressEnter,
  [pressSpace.name]: pressSpace,
  [pressHeading.name]: pressHeading,
  [finishRun.name]: finishRun,
};

const toolSpecifications = Object.values(toolsByName);

// Zod state that combines messages reducer with our metadata
type AgentState = AgentGraphState;

const AgentStateSchema = (MessagesZodState as unknown as z.ZodObject<any>).extend({
  goal: z.string(),
  steps: z.array(z.custom<AgentStep>()).default([]),
  done: z.boolean().default(false),
  success: z.boolean().default(false),
  error: z.string().optional(),
}) as unknown as z.ZodType<AgentState>;

export class Agent {
  constructor(
    private driver: IAccessibilityDriver,
    private model: BaseChatModel,
    private captureScreenshot?: () => Promise<string | undefined>,
    private onStep?: (step: AgentStep) => void
  ) { }

  /**
   * Execute the agent loop for a given goal. Enables the driver, seeds the graph with
   * an initial observation, and returns the full trace after the graph finishes.
   */
  async run(goal: string): Promise<AgentTrace> {
    await this.driver.enable();

    try {
      const initialSnapshot = await this.driver.getPerceptualOutput();
      const initialScreenshot = this.captureScreenshot ? await this.captureScreenshot() : undefined;

      const initialState: AgentState = {
        goal,
        messages: [
          new SystemMessage(SYSTEM_PROMPT),
          this.buildObservationMessage(goal, initialSnapshot, initialScreenshot),
        ],
        steps: [],
        done: false,
        success: false,
      };

      const recursionLimit = 500;
      const app = this.buildGraph(goal).compile();
      const finalState = await app.invoke(initialState, { recursionLimit });

      return {
        goal,
        success: finalState.success,
        steps: finalState.steps,
        error: finalState.error,
      };
    } finally {
      await this.driver.disable();
    }
  }

  /**
   * Build the LangGraph state machine using standard nodes and conditional edges.
   */
  private buildGraph(goal: string) {
    const driver = this.driver;
    const boundModel = this.model.bindTools(toolSpecifications);
    const captureScreenshot = this.captureScreenshot;
    const onStep = this.onStep;

    // Node: Call Model
    const callModel = async (state: AgentState) => {
      // Don't trim messages - the recursion limit prevents runaway execution
      // Trimming can break tool_calls/tool message pairs which causes OpenAI API errors
      const response = await boundModel.invoke(state.messages);
      return { messages: [response] };
    };

    // Node: Execute Tools
    const executeTools = async (state: AgentState) => {
      const aiMessage = state.messages[state.messages.length - 1] as AIMessage;

      const currentSteps = state.steps;
      const toolMessages: BaseMessage[] = [];
      let done = state.done;
      let success = state.success;
      let error = state.error;
      let nextSteps = [...currentSteps];
      let lastSnapshot: any = undefined;
      let lastScreenshot: string | undefined = undefined;

      // We must process ALL tool calls to satisfy the API contract (each call needs a response)
      // even if we decide to finish early.
      for (const call of aiMessage.tool_calls ?? []) {
        const args = normalizeArgs(call.args);
        const mapped = mapToolToAction(call.name, args);

        if (mapped.finish) {
          done = true;
          success = mapped.finish.success;
          toolMessages.push(new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({ status: 'finished', success: mapped.finish.success, reason: mapped.finish.reason || '' })
          }));
          // Do NOT return here; continue to process other tool calls if any exist
          continue;
        }

        if (!mapped.action) {
          toolMessages.push(new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({ status: 'error', message: mapped.message })
          }));
          continue;
        }

        // Only perform action if we haven't finished yet (or if we want to allow actions + finish in same turn)
        // For now, let's allow actions to execute even if finish was called in the same turn, 
        // but typically the model shouldn't do both. 
        // If it does, we'll execute them.
        const result = await driver.performAction(mapped.action);
        const screenshot = captureScreenshot ? await captureScreenshot() : undefined;
        const step: AgentStep = {
          stepNumber: nextSteps.length + 1,
          observation: result.snapshot,
          thought: toThought(aiMessage),
          action: mapped.action,
          result,
          screenshotBase64: screenshot,
        };

        if (onStep) {
          onStep(step);
        }

        nextSteps.push(step);
        lastSnapshot = result.snapshot;
        lastScreenshot = screenshot;

        toolMessages.push(new ToolMessage({
          tool_call_id: call.id,
          name: call.name,
          content: JSON.stringify(formatActionResult(mapped.action, result))
        }));
      }

      const appendedMessages = [...toolMessages];

      // Only add a new observation message if we actually performed actions and have a new snapshot
      if (lastSnapshot) {
        appendedMessages.push(this.buildObservationMessage(goal, lastSnapshot, lastScreenshot));
      }

      return {
        messages: appendedMessages,
        steps: nextSteps,
        done,
        success,
        error,
      };
    };

    // Node: Reminder (replaces the manual loop back with prompt)
    const sendReminder = async (state: AgentState) => {
      return {
        messages: [new HumanMessage({ content: 'No tool calls returned. Use the available tools or call finish_run when done.' })]
      };
    };

    // Edge Logic
    const shouldContinue = (state: AgentState) => {
      const lastMessage = state.messages[state.messages.length - 1];
      // Check if the model decided to call tools
      if (isAIMessage(lastMessage) && lastMessage.tool_calls && lastMessage.tool_calls.length > 0) {
        return "tools";
      }
      // If no tools called, send reminder (loop back)
      return "reminder";
    };

    const checkDone = (state: AgentState) => {
      if (state.done) {
        return END;
      }
      return "agent";
    };

    return new StateGraph(AgentStateSchema)
      .addNode('agent', callModel)
      .addNode('tools', executeTools)
      .addNode('reminder', sendReminder)
      .addEdge(START, 'agent')
      .addConditionalEdges('agent', shouldContinue, {
        tools: 'tools',
        reminder: 'reminder'
      })
      .addEdge('reminder', 'agent')
      .addConditionalEdges('tools', checkDone, {
        [END]: END,
        agent: 'agent'
      });
  }

  /**
   * Construct a HumanMessage containing structured text blocks describing the goal,
   * the latest perceptual snapshot, and whether a screenshot was captured. Screenshot
   * bytes stay out of the prompt to conserve context.
   */
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
</observation_context>
`;

    if (screenshotBase64) {
      return new HumanMessage({
        content: [
          { type: 'text', text: promptText },
          {
            type: 'image',
            source_type: 'base64',
            mime_type: 'image/png',
            data: screenshotBase64,
          },
        ],
      });
    }

    return new HumanMessage({
      content: promptText,
    });
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

/**
 * Map an LLM tool name and parsed args to a driver action or finish signal.
 */
function mapToolToAction(name: string | undefined, args: Record<string, any>): { action?: UserAction; finish?: { success: boolean; reason?: string }; message?: string } {
  switch (name) {
    case 'press_arrow_down':
      return { action: { type: 'KEY_PRESS', key: 'ArrowDown' } };
    case 'press_arrow_up':
      return { action: { type: 'KEY_PRESS', key: 'ArrowUp' } };
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

/**
 * Shape the driver result into a tool message payload.
 */
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

/**
 * Flatten an AIMessage into a plain string for trace readability.
 */
function toThought(message: AIMessage): string {
  if (typeof message.content === 'string' && message.content.trim().length > 0) return message.content.trim();

  if (Array.isArray(message.content)) {
    const text = message.content
      .map((part: any) => {
        if (typeof part === 'string') return part;
        if (part && typeof part === 'object' && 'text' in part) return (part as any).text;
        return '';
      })
      .filter(Boolean)
      .join('\n')
      .trim();

    if (text) return text;
  }

  if (message.tool_calls?.length) {
    return message.tool_calls
      .map((call) => {
        const args = normalizeArgs(call.args);
        const argPreview = Object.keys(args).length ? JSON.stringify(args) : '';
        return argPreview ? `${call.name}: ${argPreview}` : call.name || 'tool_call';
      })
      .join('; ');
  }

  return '';
}