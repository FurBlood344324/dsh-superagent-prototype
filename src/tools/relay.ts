/** The one channel by which a role, or the chief of staff, puts something in the operator's inbox. */
import type { ToolDefinition } from '@deepseek-ai/dsh-tools'
import { z } from 'zod'
import type { Inbox } from '../app/inbox.ts'
import { jsonSchema } from '../tool-schema.ts'

/** The tool's name, so the handoff prompt and the panel agree on it. */
export const RELAY_TOOL = 'relay_to_user'

const Relay = z.strictObject({
  text: z.string().trim().min(1).max(2000)
    .describe('What the operator must read: what happened, what it means, and what they must decide or do. Short, plain, in the operator\'s language; never a status dump.'),
  title: z.string().trim().min(1).max(80).optional().describe('A short label the inbox lists; the first line of the text when omitted.'),
  session: z.string().min(1).optional().describe('Id of the Session the message is about, so the panel can open it.'),
})

/**
 * Builds `relay_to_user`. It writes one message into the Host's inbox and returns its id, which is the whole effect:
 * the message outlives the Session that wrote it, and the panel is what shows it to the operator.
 */
export function relayTool(inbox: () => Pick<Inbox, 'add' | 'view'>): ToolDefinition {
  return {
    name: RELAY_TOOL,
    description: 'Put a short message in the operator\'s inbox, the one place they read what an agent decided they must know. '
      + 'Use it when the operator has to learn something or decide something; do not use it for routine progress, and never as a log.',
    parameters: jsonSchema(Relay),
    output: {
      schema: { type: 'object', additionalProperties: true },
      render: (_args: unknown, value: unknown) => [{ type: 'text' as const, text: JSON.stringify(value) }],
    },
    execute: async (args: unknown, exec: { readonly agent?: { readonly session: { readonly header: { readonly agentPreset?: string } } } }) => {
      const input = Relay.parse(args)
      const from = exec.agent?.session.header.agentPreset ?? 'panel'
      const item = inbox().add({ from, text: input.text, ...(input.title ? { title: input.title } : {}),
        ...(input.session ? { sessionId: input.session } : {}) })
      return { id: item.id, title: item.title, unread: inbox().view().unread }
    },
  }
}
