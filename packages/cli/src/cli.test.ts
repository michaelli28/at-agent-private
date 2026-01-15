import { describe, it, expect } from 'vitest'
import type { Command, Option } from 'commander'
import { createProgram } from './cli.js'

describe('CLI', () => {
  it('creates program with audit and flow commands', () => {
    const program = createProgram()

    expect(program.name()).toBe('at-agent')
    expect(program.commands.map((c: Command) => c.name())).toContain('audit')
    expect(program.commands.map((c: Command) => c.name())).toContain('flow')
  })

  it('audit command has required options', () => {
    const program = createProgram()
    const auditCmd = program.commands.find((c: Command) => c.name() === 'audit')

    expect(auditCmd).toBeDefined()
    expect(auditCmd?.options.some((o: Option) => o.long === '--json')).toBe(true)
  })

  it('flow command has required options', () => {
    const program = createProgram()
    const flowCmd = program.commands.find((c: Command) => c.name() === 'flow')

    expect(flowCmd).toBeDefined()
    expect(flowCmd?.options.some((o: Option) => o.long === '--goal')).toBe(true)
    expect(flowCmd?.options.some((o: Option) => o.long === '--json')).toBe(true)
    expect(flowCmd?.options.some((o: Option) => o.long === '--max-steps')).toBe(true)
  })
})
