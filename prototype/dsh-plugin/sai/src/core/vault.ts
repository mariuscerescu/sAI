/** Session vault: the bijection between entities and symbols. */

import type { ClassId, EntityKey, VaultEntry } from './types.ts'

/**
 * Stable string form of an entity key.
 * @param key - entity key.
 * @returns a map key that is equal exactly when the keys denote the same entity.
 */
export function keyString(key: EntityKey): string {
  switch (key.kind) {
    case 'entry': return `entry\u0000${key.entryId}`
    case 'canonical': return `canonical\u0000${key.classId}\u0000${key.value}`
    case 'literal': return `literal\u0000${key.value}`
  }
}

/** Bidirectional entity ↔ symbol map for one session. */
export class Vault {
  private readonly byKey = new Map<string, VaultEntry>()
  private readonly tokens = new Map<string, VaultEntry>()
  private readonly forms = new Map<string, string>()

  /**
   * @param key - entity key.
   * @returns the entry for that entity, when assigned.
   */
  get(key: EntityKey): VaultEntry | undefined { return this.byKey.get(keyString(key)) }

  /**
   * @param token - canonical symbol spelling.
   * @returns the entry the symbol stands for, when assigned.
   */
  byToken(token: string): VaultEntry | undefined { return this.tokens.get(token) }

  /**
   * Record a new assignment.
   * @param token - the new symbol; must be unused.
   * @param classId - entity class.
   * @param key - entity key; must be unassigned.
   * @returns the created entry.
   */
  put(token: string, classId: ClassId, key: EntityKey): VaultEntry {
    const entry: VaultEntry = { token, classId, key, surfaceForms: [], symbols: new Map() }
    this.byKey.set(keyString(key), entry)
    this.tokens.set(token, entry)
    return entry
  }

  /**
   * Remember one exact spelling replaced by the entry's symbol.
   * @param entry - vault entry.
   * @param form - original text of the replaced span.
   */
  addSurfaceForm(entry: VaultEntry, form: string): void {
    if (!entry.surfaceForms.includes(form)) entry.surfaceForms.push(form)
  }

  /**
   * The symbol of one form of an entity: the entity's symbol for its first form, a related one for each other form,
   * so a first name and a surname of one person are told apart when restored.
   * @param entry - vault entry.
   * @param form - the spelling this symbol restores.
   * @param related - the n-th related symbol of the entry (n starts at 2).
   * @returns the symbol, the same for the same form.
   */
  formSymbol(entry: VaultEntry, form: string, related: (n: number) => string): string {
    const known = entry.symbols.get(form)
    if (known !== undefined) return known
    let token = entry.token
    if (entry.symbols.size > 0) {
      let n = entry.symbols.size + 1
      do token = related(n++); while (this.tokens.has(token))
      this.tokens.set(token, entry)
    }
    entry.symbols.set(form, token)
    this.forms.set(token, form)
    return token
  }

  /**
   * @param token - canonical symbol spelling.
   * @returns the form that symbol restores, when it was used for one.
   */
  formOf(token: string): string | undefined { return this.forms.get(token) }

  /** @returns every entry in assignment order. */
  entries(): readonly VaultEntry[] { return [...this.byKey.values()] }

  /** @returns the number of assigned symbols. */
  get size(): number { return this.byKey.size }

  /** Forget every assignment. */
  wipe(): void { this.byKey.clear(); this.tokens.clear(); this.forms.clear() }
}
