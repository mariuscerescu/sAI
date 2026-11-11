/**
 * Browser half of sAI: the bundle's configuration page with a local preview,
 * and the "Model view" Conversation tab that shows the last exchange exactly
 * as the provider saw it. The page registers while the Host serves the `sai`
 * form; the tab registers once the Host Remote is mounted.
 */

import type { Context } from '@deepseek-ai/cordis'
import type {} from '@deepseek-ai/dsh-api-remotes/client'
import type {} from '@deepseek-ai/dsh-client-locale/client'
import type {} from '@deepseek-ai/dsh-client-ui-conversation/client'
import type {} from '@deepseek-ai/dsh-client-ui-renderer/client'
import type {} from '@deepseek-ai/dsh-client-ui-settings/client'
import type {} from '@deepseek-ai/dsh-client-ui-plugin-manager/client'
import remote from '@deepseek-ai/dsh-experimental-sai/remote'
import type { SaiSettings } from '../core/index.ts'
import { en, NS, zh, type SaiLocaleKey } from './locales.ts'
import { ModelView, type ModelViewFace } from './ModelView.tsx'
import { SaiSettingsPage } from './SaiSettingsPage.tsx'
import { SAI_NS, SaiSettingsForm } from './settings-form.ts'

export type { SaiSettingsPageProps } from './SaiSettingsPage.tsx'
export type { ModelViewFace, ModelViewProps } from './ModelView.tsx'
export type { SaiFormFace, SaiFormState } from './settings-form.ts'
export type { SaiLocaleKey } from './locales.ts'

declare module '@deepseek-ai/dsh-client-ui-slots' {
  interface LocaleNamespaceMap {
    /** sAI settings page and Model view copy. */
    sai: SaiLocaleKey
  }
}

/** Package name of the bundle whose page shows this form. */
export const SAI_BUNDLE = '@deepseek-ai/dsh-experimental-sai-bundle'

/** Required browser services. */
export const inject = ['remote', 'slots', 'locale', 'configForms']

/**
 * Mount the configuration page and the Model view tab.
 * @param ctx - browser plugin context.
 * @returns disposer withdrawing the Remote contribution after the UI.
 */
export async function apply(ctx: Context): Promise<() => Promise<void>> {
  ctx.effect(() => ctx.locale.register(NS, { en, zh }), 'sai: dictionaries')
  const form = new SaiSettingsForm(ctx.configForms.get<SaiSettings>(SAI_NS))
  ctx.effect(() => () => { form.dispose() }, 'sai: form subscription')
  ctx.effect(() => ctx.configForms.whileServed([SAI_NS], () => ctx.slots.inject('plugins.bundle.config', () => ctx.slots.register({
    name: 'plugins.bundle.config', key: SAI_BUNDLE, locale: NS, inject: () => form.inject(),
  }, SaiSettingsPage))), 'sai: page')

  const unmountRemote = await ctx.remote.$mount(remote)
  const t = ctx.locale.bind(NS)
  const view = ctx.inject(['remote.saiModelView', 'slots'], (child) => {
    const face: ModelViewFace = {
      readView: async (sessionId, signal) => {
        const result = await child.remote.saiModelView.snapshot(sessionId, signal)
        if (!result.ok) throw result.error
        return result.value
      },
    }
    child.slots.inject('conversation.view', () => child.slots.register({
      name: 'conversation.view', id: 'sai-model-view', order: 50, label: () => t('modelViewTab'), locale: NS, inject: () => face,
    }, ModelView))
  })
  return async () => { await view.dispose(); await unmountRemote() }
}
