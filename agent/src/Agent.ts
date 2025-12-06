import { IAccessibilityDriver, ActionResult, PerceptualSnapshot, UserAction } from '@adf/virtual-screen-reader';
import { BaseChatModel } from '@langchain/core/language_models/chat_models';
import { AIMessage, BaseMessage, HumanMessage, SystemMessage, ToolMessage, isAIMessage } from '@langchain/core/messages';
import { tool } from '@langchain/core/tools';
import { END, MessagesZodState, START, StateGraph } from '@langchain/langgraph';
import { z } from 'zod';
import { AgentGraphState, AgentStep, AgentTrace } from './types';

const SYSTEM_PROMPT = `<instructions>
- Complete the task using ONLY your tools and previous screen reader output.
- Consider chaining multiple tool calls for faster navigation.
- Keep persisting until the task is complete. Try new things, do not repeat things that don't work.
- However, if after several failed attempts and there is evidence that a task can't be completed due to keyboard accessbility issues, you should fail the run with a specific reason (i.e. which element was inaccessible).
</instructions>`;

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
  description: 'Jump to the next heading using the screen reader "H" command. Use to skim page structure.',
  schema: z.object({}),
});

const pressTab = tool(async () => `Pressed Tab`, {
  name: 'press_tab',
  description: 'Move focus to the next focusable element (Tab key). Use to navigate between form fields, links, and buttons.',
  schema: z.object({}),
});

const pressShiftTab = tool(async () => `Pressed Shift+Tab`, {
  name: 'press_shift_tab',
  description: 'Move focus to the previous focusable element (Shift+Tab). Use to go back to previous form field or control.',
  schema: z.object({}),
});

const pressEscape = tool(async () => `Pressed Escape`, {
  name: 'press_escape',
  description: 'Press Escape key. Use to close dialogs, menus, or cancel current operation.',
  schema: z.object({}),
});

const typeText = tool(async ({ text }: { text: string }) => `Typed: ${text}`, {
  name: 'type_text',
  description: 'Type text into the currently focused input field. Use after focusing on a text input, textarea, or editable element.',
  schema: z.object({ text: z.string().describe('The text to type into the focused element') }),
});

const pressKey = tool(async ({ key }: { key: string }) => `Pressed: ${key}`, {
  name: 'press_key',
  description: 'Press an arbitrary keyboard key or key combination. Use for keys not covered by other tools. Examples: "Backspace", "Delete", "Control+A", "Shift+End", "F", "B" (for next form field/button in screen reader).',
  schema: z.object({ key: z.string().describe('The key or key combination to press (e.g., "Backspace", "Control+A", "F1")') }),
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
  [pressTab.name]: pressTab,
  [pressShiftTab.name]: pressShiftTab,
  [pressEscape.name]: pressEscape,
  [typeText.name]: typeText,
  [pressKey.name]: pressKey,
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
  reason: z.string().optional(),
}) as unknown as z.ZodType<AgentState>;

export class Agent {
  constructor(
    private driver: IAccessibilityDriver,
    private model: BaseChatModel,
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

      const initialState: AgentState = {
        goal,
        messages: [
          new SystemMessage(SYSTEM_PROMPT),
          this.buildObservationMessage(goal, initialSnapshot),
        ],
        steps: [],
        done: false,
        success: false,
      };

      const recursionLimit = 200;
      const app = this.buildGraph(goal).compile();
      const finalState = await app.invoke(initialState, { recursionLimit });

      return {
        goal,
        success: finalState.success,
        steps: finalState.steps,
        error: finalState.error,
        reason: finalState.reason,
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
    const onStep = this.onStep;

    // Node: Call Model
    const callModel = async (state: AgentState) => {
      const response = await boundModel.invoke(state.messages);
      return { messages: [response] };
    };

    // Node: Execute Tools
    const executeTools = async (state: AgentState) => {
      const aiMessage = state.messages[state.messages.length - 1] as AIMessage;

      const currentSteps = state.steps;
      const toolMessages: BaseMessage[] = [];
      const observationMessages: BaseMessage[] = [];
      let done = state.done;
      let success = state.success;
      let error = state.error;
      let reason = state.reason;
      let nextSteps = [...currentSteps];

      for (const call of aiMessage.tool_calls ?? []) {
        // If we have already finished in this batch, we must still provide a ToolMessage
        // for subsequent calls to satisfy the protocol, but we skip execution.
        if (done) {
          toolMessages.push(new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({ status: 'ignored', message: 'Agent finished in the same step.' })
          }));
          continue;
        }

        const args = normalizeArgs(call.args);
        const mapped = mapToolToAction(call.name, args);

        if (mapped.finish) {
          done = true;
          success = mapped.finish.success;
          reason = mapped.finish.reason;
          toolMessages.push(new ToolMessage({
            tool_call_id: call.id,
            name: call.name,
            content: JSON.stringify({ status: 'finished', success: mapped.finish.success, reason: mapped.finish.reason || '' })
          }));
          // Continue to next tool call to ensure all IDs are handled
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

        const result = await driver.performAction(mapped.action);
        const step: AgentStep = {
          stepNumber: nextSteps.length + 1,
          observation: result.snapshot,
          thought: toThought(aiMessage),
          action: mapped.action,
          result,
        };

        if (onStep) {
          onStep(step);
        }

        nextSteps.push(step);

        toolMessages.push(new ToolMessage({
          tool_call_id: call.id,
          name: call.name,
          content: JSON.stringify(formatActionResult(mapped.action, result))
        }));

        observationMessages.push(this.buildObservationMessage(goal, result.snapshot));
      }

      return {
        messages: [...toolMessages, ...observationMessages],
        steps: nextSteps,
        done,
        success,
        error,
        reason,
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
   * Construct a HumanMessage containing structured text blocks describing the goal
   * and the latest perceptual snapshot.
   */
  private buildObservationMessage(goal: string, snapshot?: PerceptualSnapshot) {
    const snapshotText = formatSnapshot(snapshot);
    return new HumanMessage({
      content: `
<observation_context>
  <user_goal>
    ${goal}
  </user_goal>

  <screen_reader_status>
    ${snapshotText}
  </screen_reader_status>
</observation_context>
`
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
    case 'press_previous_heading':
      return { action: { type: 'KEY_PRESS', key: 'Shift+H' } };
    case 'press_tab':
      return { action: { type: 'KEY_PRESS', key: 'Tab' } };
    case 'press_shift_tab':
      return { action: { type: 'KEY_PRESS', key: 'Shift+Tab' } };
    case 'press_escape':
      return { action: { type: 'KEY_PRESS', key: 'Escape' } };
    case 'type_text':
      if (typeof args.text !== 'string' || args.text.length === 0) {
        return { message: 'type_text requires a non-empty "text" argument' };
      }
      return { action: { type: 'TYPE', text: args.text } };
    case 'press_key':
      if (typeof args.key !== 'string' || args.key.length === 0) {
        return { message: 'press_key requires a non-empty "key" argument' };
      }
      return { action: { type: 'KEY_PRESS', key: args.key } };
    case 'instant_traverse':
      return { action: { type: 'KEY_PRESS', key: 'Shift+A' } };
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
  if (typeof message.content === 'string') return message.content.trim();

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