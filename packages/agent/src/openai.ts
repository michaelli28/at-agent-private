import OpenAI from 'openai'
import { ActionSchema, type Action, type Step } from './types.js'

export function createOpenAIClient(apiKey: string): OpenAI {
  return new OpenAI({ apiKey })
}

const SYSTEM_PROMPT = `You are an accessibility testing agent. Your goal is to navigate web pages and test them for accessibility issues.

You can perform these actions:
- navigate: Go to a URL (target = URL)
- click: Click an element (target = role/text description like "button named Submit")
- fill: Fill a form field (target = field description, value = text to enter)
- audit: Run accessibility audit on current page
- observe: Get current page state and accessibility tree
- done: Goal is complete or cannot be achieved

Respond with a JSON object containing:
{
  "type": "action_type",
  "target": "optional target",
  "value": "optional value for fill",
  "reason": "why this action"
}

Think step by step. After navigating, observe the page. Run audits to find issues. Report done when goal is achieved or blocked.`

export async function generateAction(
  client: OpenAI,
  model: string,
  goal: string,
  observation: string,
  history: Step[]
): Promise<Action> {
  const historyText = history
    .map((s) => `Step ${s.stepNumber}: ${s.action.type} - ${s.result.observation}`)
    .join('\n')

  const userPrompt = `Goal: ${goal}

Previous steps:
${historyText || 'None'}

Current observation:
${observation}

What action should I take next?`

  const response = await client.chat.completions.create({
    model,
    messages: [
      { role: 'system', content: SYSTEM_PROMPT },
      { role: 'user', content: userPrompt },
    ],
    response_format: { type: 'json_object' },
  })

  const content = response.choices[0]?.message?.content
  if (!content) {
    throw new Error('No response from model')
  }

  const parsed = JSON.parse(content)
  return ActionSchema.parse(parsed)
}
