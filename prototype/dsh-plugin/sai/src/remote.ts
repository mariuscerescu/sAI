/** Remote access to the model's view of a Session, for the browser "Model view" tab. */

import type { Context } from '@deepseek-ai/cordis'
import { Remote, TypertRemoteService } from '@deepseek-ai/dsh-typert-protocol'
import type { SaiModelView } from './view-types.ts'
import type { ModelViewStore } from './view.ts'

declare module '@deepseek-ai/cordis' {
  interface Context {
    /** Remote reader of the model's view of each Session. */
    saiModelView: SaiModelViewRemote
  }
}

/** Serves the last request and raw answer exactly as the provider saw them. */
export class SaiModelViewRemote extends TypertRemoteService {
  static inject = ['typert']

  /**
   * @param ctx - plugin context.
   * @param store - the request wrapper's in-memory record.
   */
  constructor(ctx: Context, private readonly store: ModelViewStore) {
    super(ctx, 'saiModelView', { namespace: 'saiModelView' })
  }

  /**
   * Read the model's view of one Session.
   * @param sessionId - Session whose last exchange to return.
   * @param signal - browser query cancellation.
   * @returns the last request and raw answer, or null before the first request since the Host started.
   */
  @Remote
  async snapshot(sessionId: string, signal: AbortSignal): Promise<SaiModelView | null> {
    signal.throwIfAborted()
    return this.store.get(sessionId) ?? null
  }
}
