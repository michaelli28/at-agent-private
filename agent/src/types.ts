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
