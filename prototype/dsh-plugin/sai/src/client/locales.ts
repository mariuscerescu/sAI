/** Locale-owned copy for the sAI settings page. */
import type { SettingsFormLabels } from '@deepseek-ai/dsh-client-ui-primitives'

/** Dictionary namespace for this plugin. */
export const NS = 'sai'

/** English copy and key source. */
export const en = {
  intro: 'sAI replaces protected terms with symbols before a request leaves this machine and restores them in the answer. The local conversation log keeps the original text.',
  enabled: 'Protect model requests',
  strategyTitle: 'Symbols sent to the model',
  typed: 'Typed ⟦CLASS_N⟧',
  greek: 'Greek letters',
  typedHint: 'The model sees the class of each value (for example ⟦PERSON_1⟧) but never the value.',
  greekHint: 'The model sees an isolated Greek letter per value; even the class stays hidden. Letters already present in the text are never used.',
  preamble: 'Explain the symbols to the model in the system prompt',
  preambleText: 'Text added to the system prompt ({strategy})',
  preambleCustom: 'Edited',
  preambleReset: 'Restore the default text',
  preambleHint:'Adds a short note telling the model that the symbols stand for confidential values, that it must copy them exactly (also in code and tool arguments), and that it must not guess what they mean.',
  vocabularyTitle: 'Vocabulary',
  vocabularyHint: 'One row per protected entity. Every spelling in a row gets the same symbol. Matching ignores case and diacritics. Inflected forms, a person\'s first name and surname alone, and a company name without its legal form (Corp, Ltd, SRL…) are found automatically.',
  verifierTitle: 'Verifier of lowercase name forms',
  verifierEnabled: 'Ask a local model about lowercase name forms',
  verifierHint: 'A part of a declared name written in lowercase ("bill" for Bill Turner) may be a name or an ordinary word. Without the verifier, sAI guesses from the text: it sends the word as written when the text writes names with capitals, and replaces it when the text has none. With the verifier, a model running on this computer reads each such word in its sentence: a name is replaced, an ordinary word stays, and when the model is unsure or does not answer, the word is replaced. Words written with a capital are replaced as before. All the words of a request go to the model in one call; a request with none makes no call. Words that are not in the vocabulary are never protected.',
  verifierUrl: 'Address of the local verifier service',
  egressTitle: 'What else leaves this computer',
  allowImages: 'Send images',
  allowImagesHint: 'sAI cannot read the pixels of an image, so a photo or screenshot with a name in it would reach the model unprotected. While this is off, a request with an image is refused.',
  externalToolsHint: 'Tools that send their arguments off this computer (one per line; a trailing * matches a prefix). Their arguments keep the symbols instead of the real values, so a web search never receives a protected name.',
  languagesTitle: 'Languages of your texts',
  languagesHint: 'Each language adds its own inflected forms of names (Romanian: Popescului, Ioane; English: the Smiths), titles, and company legal forms.',
  language_ro: 'Romanian',
  language_en: 'English',
  classLabel: 'Class',
  otherClass: 'Other (type a new class)…',
  termsLabel: 'Spellings (one per line)',
  restoreAsLabel: 'Restore as (optional)',
  addEntry: 'Add entity',
  remove: 'Remove',
  detectorsTitle: 'Detectors',
  detectorsHint: 'sAI protects exactly what you declare in the vocabulary, plus the formats you enable below. Anything else, including people you have not declared, reaches the model as written.',
  pattern_idnp: 'IDNP / IDNO (Moldova)',
  'pattern_cnp': 'CNP (Romania)',
  'pattern_phone-md': 'Phone numbers (Moldova)',
  'pattern_phone-ro': 'Mobile numbers (Romania)',
  pattern_iban: 'IBAN',
  pattern_card: 'Payment cards',
  pattern_email: 'E-mail addresses',
  pattern_ipv4: 'IPv4 addresses',
  'pattern_ssn-us': 'Social Security numbers (US)',
  'pattern_phone-us': 'Phone numbers (US, Canada)',
  'pattern_phone-uk': 'Phone numbers (UK)',
  'pattern_nino-uk': 'National Insurance numbers (UK)',
  policyTitle: 'Policy per class',
  policyHint: 'Every finding of a class gets its action; nothing depends on a score. Ignore sends that class as written. Blocking stops the whole request.',
  actionLabel: 'Action',
  action_tokenize: 'Replace with a symbol',
  action_mask: 'Mask (irreversible)',
  action_ignore: 'Ignore (send as written)',
  action_block: 'Block the request',
  addClass: 'Add class',
  newClassPlaceholder: 'CLASS',
  allowlistTitle: 'Never protect',
  allowlistHint: 'One word or phrase per line.',
  previewTitle: 'Try it',
  previewHint: 'Runs locally in this page with the settings above, including unsaved edits. Nothing is sent anywhere.',
  previewInput: 'Text sent to the model',
  previewOutput: 'What the model receives',
  previewFindings: 'Findings',
  previewReply: 'Simulated model answer',
  previewRestored: 'Restored answer',
  previewBlocked: 'Blocked: {code}',
  previewNothing: 'Nothing to protect.',
  findingText: 'Text',
  findingClass: 'Class',
  findingDetector: 'Detector',
  findingAction: 'Action',
  modelViewTab: 'Model view',
  modelViewIntro: 'The conversation as the model saw it: symbols instead of protected values, before restoration.',
  modelViewFull: 'Show everything sent (system prompt, tools, context)',
  modelViewEmpty: 'No request has been sent in this conversation since the app started. Send a message to see it here.',
  modelViewFailed: 'Could not refresh the model view; showing the last one received.',
  modelViewMeta: 'Strategy {strategy} · sent at {time}',
  modelViewSystem: 'System prompt',
  modelViewRole_user: 'User',
  modelViewRole_assistant: 'Assistant',
  modelViewRole_tool: 'Tool result',
  modelViewRole_system: 'System',
  modelViewReply: 'Model answer (before restoration)',
  modelViewStreaming: 'streaming',
  invalidJson:'This field could not be read.',
  problems: 'Settings problems: {problems}',
  overridden: 'Overridden', reset: 'Reset to default',
  unavailable: 'sAI settings are unavailable.', readOnly: 'This deployment stores settings read-only.',
  saveFailed: 'The deployment did not accept these values; they were left for you to correct.', save: 'Save', saving: 'Saving…',
}

/** Locale dictionary key union. */
export type SaiLocaleKey = keyof typeof en

/** Chinese copy falls back to English until translated. */
export const zh: Record<SaiLocaleKey, string> = { ...en }

/**
 * Read shared form chrome from the plugin dictionary.
 * @param t - current locale reader.
 * @returns localized form labels.
 */
export function formLabels(t: (key: SaiLocaleKey) => string): SettingsFormLabels {
  return { unavailable: t('unavailable'), readOnly: t('readOnly'), saveFailed: t('saveFailed'), save: t('save'), saving: t('saving') }
}
