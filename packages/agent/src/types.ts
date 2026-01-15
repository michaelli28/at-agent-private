import { z } from 'zod'
import { ViolationSchema } from '@at-agent/accessibility'

// Action types the agent can perform
export const ActionTypeSchema = z.enum([
  'navigate',
  'click',
  'fill',
  'audit',
  'observe',
  'done',
])
export type ActionType = z.infer<typeof ActionTypeSchema>

// An action the agent wants to perform
export const ActionSchema = z.object({
  type: ActionTypeSchema,
  target: z.string().optional(),
  value: z.string().optional(),
  reason: z.string(),
})
export type Action = z.infer<typeof ActionSchema>

// Result of executing an action
export const ActionResultSchema = z.object({
  success: z.boolean(),
  observation: z.string(),
  violations: z.array(ViolationSchema).optional(),
})
export type ActionResult = z.infer<typeof ActionResultSchema>

// A single step in agent execution
export const StepSchema = z.object({
  stepNumber: z.number(),
  action: ActionSchema,
  result: ActionResultSchema,
  timestamp: z.string(),
})
export type Step = z.infer<typeof StepSchema>

// Agent configuration options
export const AgentOptionsSchema = z.object({
  startUrl: z.string().url(),
  maxSteps: z.number().positive().default(20),
  model: z.string().default('gpt-4o'),
})
export type AgentOptions = z.infer<typeof AgentOptionsSchema>

// Final result of agent execution
export const AgentResultSchema = z.object({
  success: z.boolean(),
  goal: z.string(),
  steps: z.array(StepSchema),
  violations: z.array(ViolationSchema),
  summary: z.string(),
})
export type AgentResult = z.infer<typeof AgentResultSchema>
