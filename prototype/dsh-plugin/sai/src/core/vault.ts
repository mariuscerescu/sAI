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
    const entry: VaultEntry = { token, classId, key, surfaceForms: [] }
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

  /** @returns every entry in assignment order. */
  entries(): readonly VaultEntry[] { return [...this.byKey.values()] }

  /** @returns the number of assigned symbols. */
  get size(): number { return this.byKey.size }

  /** Forget every assignment. */
  wipe(): void { this.byKey.clear(); this.tokens.clear() }
}
