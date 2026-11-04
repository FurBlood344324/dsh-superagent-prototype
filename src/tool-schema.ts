/** Model-facing tool schemas, projected to plain JSON data. */
import { z } from 'zod'

/**
 * Returns the JSON Schema a tool registers as its parameters.
 *
 * zod v4 marks every `toJSONSchema` result with a non-enumerable `~standard` key. DSH holds tool
 * schemas to lossless JSON and rejects an object whose own keys are not all enumerable strings, so
 * the marker is dropped here instead of reaching registration and aborting the whole turn.
 */
export function jsonSchema(schema: z.ZodType): Record<string, unknown> {
  return JSON.parse(JSON.stringify(z.toJSONSchema(schema))) as Record<string, unknown>
}
