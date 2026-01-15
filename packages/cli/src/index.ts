#!/usr/bin/env node
// @at-agent/cli - Accessibility testing command-line interface
import { createProgram } from './cli.js'

const program = createProgram()
program.parse(process.argv)
