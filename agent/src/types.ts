import { PerceptualSnapshot, UserAction, ActionResult } from '@adf/drivers/src/types';

export interface AgentStep {
  stepNumber: number;
  observation: PerceptualSnapshot;
  thought: string;
  action: UserAction;
  result: ActionResult;
}

export interface AgentTrace {
  goal: string;
  success: boolean;
  steps: AgentStep[];
  error?: string;
}

export interface LLMResponse {
  thought: string;
  action: UserAction;
  done: boolean;
  success?: boolean; // If done is true
}

export interface LLMClient {
  generate(prompt: string): Promise<LLMResponse>;
}
