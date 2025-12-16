import { BaseMessage } from '@langchain/core/messages';
import { PerceptualSnapshot, UserAction, ActionResult } from '@adf/virtual-screen-reader';

export interface AgentStep {
  stepNumber: number;
  observation: PerceptualSnapshot;
  thought: string;
  action: UserAction;
  result: ActionResult;
  screenshotBase64?: string;
}

export interface AgentTrace {
  goal: string;
  success: boolean;
  steps: AgentStep[];
  error?: string;
  reason?: string;
}

export interface AgentGraphState {
  goal: string;
  messages: BaseMessage[];
  steps: AgentStep[];
  done: boolean;
  success: boolean;
  error?: string;
  reason?: string;
}

// Debug event types for the debug UI
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

// Callback that can pause execution before LLM requests (for manual oversight)
export type BeforeLlmRequestCallback = (loopCount: number, messages: unknown[]) => Promise<void>;

// Callback for logging agent activity
export type LogCallback = (message: string) => void;
