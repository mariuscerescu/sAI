/**
 * A name a detector recognizes in one place of a text must be replaced everywhere
 * in that text; otherwise the final leak check refuses the whole request, which in a
 * long conversation (resent in full on every turn) would block it for good.
 */
import { describe, expect, it } from 'vitest'
import { Engine } from '../src/core/index.ts'

describe('repeated spellings within one text', () => {
  it('replaces a first name joined to a protected surname everywhere in the text', () => {
    const session = new Engine({ vocabulary: [{ id: 'm', class: 'PERSON', terms: ['Cristina Munteanu'] }] }).session()
    const text = 'Am vorbit cu Floare Munteanu ieri. Floare Munteanu a plecat acasă.'
    const out = session.redact(text)
    expect(out.verdict.kind).toBe('proceed')
    expect(out.text).not.toContain('Floare')
    expect(session.restore(out.text).text).toBe(text)
  })

  it('does not block a long text', () => {
    const paragraph = 'Domnul Botezatu a semnat. Mare a fost surpriza, iar dl. Mare a confirmat. Mircea a vorbit cu Mircea Tudose. '
    const out = new Engine({ vocabulary: [{ id: 'a', class: 'PERSON', terms: ['Ion Popescu'] }] }).session().redact(paragraph.repeat(400))
    expect(out.verdict.kind).toBe('proceed')
  })
})
