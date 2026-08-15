/**
 * Client half of dsh-peekedit: registers the "📁 文件" header action on the
 * Web Client session header, toggling the file-browser drawer. Value imports
 * stay within the platform word table (react, react-dom); everything else is
 * type-only and erased at build.
 * @module dsh-peekedit/client
 */

import type { ClientContext } from '@deepseek-ai/dsh-client-runtime/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-slots'
import { HeaderActionButton } from './FileBrowser.tsx'

export const name = 'dsh-peekedit'
export const inject = ['slots']

/** Mount the header action once the session header declares its actions slot. */
export function apply(ctx: ClientContext): void {
  ctx.slots.inject('conversation.session.header.actions', () => ctx.slots.register({
    name: 'conversation.session.header.actions',
    id: 'peekedit-file-browser',
    order: 100,
  }, HeaderActionButton))
}
