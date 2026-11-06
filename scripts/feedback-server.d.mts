import type { IncomingMessage, ServerResponse } from 'node:http'

export function createFeedbackHandler(options?: { directory?: string }): (req: IncomingMessage, res: ServerResponse) => Promise<unknown>
