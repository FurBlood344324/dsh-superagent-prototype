/**
 * Model-facing tools for automated tasks: assign, inspect, and control the standing work a role runs on a schedule.
 * The plugin mounts inside an agent preset, so the chief of staff carries it and hands recurring work to specialists.
 */
import type { Context } from '@deepseek-ai/cordis'
import { z } from 'zod'
import type { Automation } from '../app/automation.ts'
import { describeCadence } from '../core/tasks.ts'
import { jsonSchema } from '../tool-schema.ts'

export const name = 'dsh-superagent/assign'
export const inject = ['tools']

/** The one-line cadence grammar, repeated in every error the tools return. */
const WHEN_HELP = 'when is one of: "every 30m", "every 2h", "daily 09:00", "weekly mon,thu 09:00"'

const Assignment = z.strictObject({
  role: z.string().min(1).describe('Agent preset id the run starts under, for example superagent-researcher'),
  title: z.string().min(3).max(80).describe('Short name; also becomes the task id and the title of each run Session'),
  prompt: z.string().min(20).describe('What the role should do when the task fires, written as a complete instruction'),
  when: z.string().min(3).describe(WHEN_HELP),
})
const Control = z.strictObject({
  id: z.string().min(1).describe('Task id, as assign_task and list_tasks report it'),
  action: z.enum(['pause', 'resume', 'run', 'delete']).describe('pause stops future runs, resume restarts them, run fires now, delete removes it'),
})

/** Registers the task tools; each one reaches the Host scheduler through the Runtime service. */
export function apply(ctx: Context): void {
  const automation = (): Automation => {
    const runtime = (ctx.get as (name: string) => unknown)('orchestrator') as { tasks?: Automation } | undefined
    if (!runtime?.tasks) throw new Error('automated tasks are unavailable: dsh-superagent is not running')
    return runtime.tasks
  }
  const toolbar = { schema: { type: 'object' as const, additionalProperties: true },
    render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }] }

  ctx.tools.register({
    name: 'assign_task',
    description: 'Assign a recurring automated task to a role agent. The task starts a fresh Session under that role at each run, so the role does its work on its own schedule. ' + WHEN_HELP,
    parameters: jsonSchema(Assignment),
    output: toolbar,
    execute: async (args: unknown) => {
      const input = Assignment.parse(args)
      const task = await automation().assign({ title: input.title, preset: input.role, prompt: input.prompt, when: input.when })
      return { ...task, cadenceText: describeCadence(task.cadence) }
    },
  })
  ctx.tools.register({
    name: 'list_tasks',
    description: 'List the automated tasks this Host runs: id, role, cadence, next run in local time, last attempt and its Session.',
    parameters: jsonSchema(z.strictObject({})),
    output: toolbar,
    execute: async () => ({ tasks: automation().list().map(task => ({ id: task.id, title: task.title, role: task.preset,
      when: describeCadence(task.cadence), nextRun: task.nextRunLocal, runs: task.runs, enabled: task.enabled,
      lastRun: task.lastRun ?? null })) }),
  })
  ctx.tools.register({
    name: 'control_task',
    description: 'Pause, resume, run now, or delete one automated task by id.',
    parameters: jsonSchema(Control),
    output: toolbar,
    execute: async (args: unknown) => {
      const input = Control.parse(args)
      const result = await automation().control(input.id, input.action)
      return 'deleted' in result ? result : { ...result, cadenceText: describeCadence(result.cadence) }
    },
  })
}

