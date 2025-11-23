import { IAccessibilityDriver } from '@adf/drivers/src/IAccessibilityDriver';
import { UserAction } from '@adf/drivers/src/types';
import { AgentTrace, AgentStep, LLMClient, LLMResponse } from './types';

export class Agent {
  private maxSteps = 200;

  constructor(
    private driver: IAccessibilityDriver,
    private llm: LLMClient
  ) { }

  async run(goal: string): Promise<AgentTrace> {
    console.log(`[Agent] Starting goal: "${goal}"`);
    await this.driver.enable();

    const trace: AgentTrace = {
      goal,
      success: false,
      steps: []
    };

    try {
      for (let i = 0; i < this.maxSteps; i++) {
        // 1. Observe
        const observation = await this.driver.getPerceptualOutput();

        // 2. Plan (Construct Prompt & Call LLM)
        const prompt = this.constructPrompt(goal, trace.steps, observation);
        const response = await this.llm.generate(prompt);

        console.log(`[Agent] Step ${i + 1}: ${response.thought}`);

        // Check for completion
        if (response.done) {
          trace.success = response.success || false;
          console.log(`[Agent] Finished. Success: ${trace.success}`);
          break;
        }

        // 3. Act
        const result = await this.driver.performAction(response.action);

        // 4. Record
        const step: AgentStep = {
          stepNumber: i + 1,
          observation,
          thought: response.thought,
          action: response.action,
          result
        };
        trace.steps.push(step);

        if (!result.success) {
          console.warn(`[Agent] Action failed: ${result.message}`);
        }
      }
    } catch (error: any) {
      trace.error = error.message;
      console.error(`[Agent] Error:`, error);
    } finally {
      await this.driver.disable();
    }

    return trace;
  }

  private constructPrompt(goal: string, history: AgentStep[], current: any): string {
    const historyText = history.map(h =>
      `Step ${h.stepNumber}:
       - Observed: "${h.observation.text}"
       - Action: ${JSON.stringify(h.action)}
       - Result: ${h.result.success ? 'Success' : 'Failed: ' + h.result.message}`
    ).join('\n');

    return `
You are an assistive technology user interacting with a web page via a Screen Reader.
Your Goal: "${goal}"

Screen Reader Output: "${current.text}"

History:
${historyText}

Instructions:
1. Analyze the current output and history.
2. Decide the next action to move closer to the goal.
3. You can use 'ArrowDown', 'ArrowUp', 'Enter', 'Tab', 'H' (next heading), etc.
4. If you have achieved the goal, set "done": true and "success": true.
5. If you are stuck or cannot achieve the goal, set "done": true and "success": false.

Respond ONLY in valid JSON format:
{
  "thought": "reasoning for the action",
  "action": { "type": "KEY_PRESS", "key": "..." },
  "done": false
}
    `.trim();
  }
}

/*
Example LLM Response:
{
  "thought": "I am on a heading 'Welcome'. I need to find the 'Sign Up' link. I will move down to read the next item.",
  "action": { "type": "KEY_PRESS", "key": "ArrowDown" },
  "done": false
}
*/
