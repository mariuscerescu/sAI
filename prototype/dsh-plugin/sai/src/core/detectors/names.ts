/**
 * Person-name detector for names the user did not declare. It scores
 * capitalized words found in public first/last-name lists by adding context
 * signals; the score is a rule-based heuristic, not a probability, and the
 * policy compares it with the class threshold.
 */

import { isSentenceStart, normalizeTerm } from '../normalize.ts'
import type { Candidate, NormalizedText } from '../types.ts'

/** Priority of name findings: lowest, so any declared or shaped finding wins. */
export const NAMES_PRIORITY = 100

const FIRST_NAMES = `ion ioana ana maria elena mihai andrei alexandru alexandra vasile gheorghe nicolae
dumitru constantin petru pavel victor victoria natalia tatiana olga svetlana irina ina inna cristina cristian
daniel daniela dan diana doina dorin dorina eugen eugenia sergiu serghei igor oleg vladimir vlad valeriu valentina
valentin veronica viorel viorica ludmila lilia liliana larisa lucia lucian marin marina mariana mircea mihaela
nadejda nina octavian radu raisa rodica roman ruslan sandu silvia stefan stela tudor ursula vadim vitalie vera
adrian adriana alina angela anatol artur aurel aurelia boris calin carolina catalin ciprian corina cornel dragos
emil emilia florin gabriel gabriela george georgeta gelu grigore iulia iulian iurie lavinia laurentiu leonid
liviu loredana marcel marius matei nicoleta oana ovidiu paul paula petru razvan sabina sebastian simona sorin
teodor teodora tiberiu traian valeria vasilica petre ioan costel ionel bogdan mihail floare floarea
john james robert michael william david richard joseph thomas charles christopher daniel matthew anthony mark donald
steven paul andrew joshua kenneth kevin brian george timothy ronald edward jason jeffrey ryan jacob gary nicholas eric
jonathan stephen larry justin scott brandon benjamin samuel gregory alexander frank patrick raymond jack dennis jerry
tyler aaron jose adam nathan henry douglas zachary peter kyle noah ethan jeremy walter christian keith roger terry
austin sean gerald carl harold dylan arthur lawrence jordan jesse bryan billy bruce gabriel joe logan albert willie
alan eugene russell vincent philip bobby johnny bradley roy ralph louis randy wayne liam oliver harry jamie connor
callum lewis owen alfie freddie archie theo leo oscar max finn luke hugh rory angus
mary patricia jennifer linda elizabeth barbara susan jessica sarah karen lisa nancy betty sandra margaret ashley
kimberly emily donna michelle carol amanda melissa deborah stephanie dorothy rebecca sharon laura cynthia amy kathleen
angela shirley brenda emma anna pamela nicole samantha katherine christine helen debra rachel carolyn janet maria
catherine heather diane olivia julie joyce victoria ruth virginia lauren kelly christina joan evelyn judith andrea
hannah megan cheryl jacqueline martha madison teresa gloria sara janice ann kathryn abigail sophia frances jean alice
judy isabella julia grace amber denise danielle marilyn beverly charlotte natalie theresa diana brittany doris kayla
alexis lori marie rose ava mia chloe sophie amelia isla poppy freya ella lily evie ruby daisy jessica holly lucy
eleanor imogen phoebe zoe megan bethany fiona siobhan
will bill bob rob mike tom jim joe dave steve tony nick ben sam alex chris matt dan kate liz beth jen meg jenny
katie becky sally molly ellie annie josh jake luke tim ted fred greg phil ron`

/** Surnames, also used to read "Mr. X" and pairs; English list after the Moldovan and Romanian one. */

const LAST_NAMES = `popescu ionescu popa pop rusu ceban ciobanu cebotari rotari munteanu lungu cojocaru moraru
sandu bivol bodiu botnari bulgaru burlacu cazacu chiriac cojocari croitoru dodon donica gutu jardan lupu melnic
mocanu morari negru nistor plesca postica railean rotaru russu sirbu spinu tabacaru turcanu ursu vasilache
zaharia ababii andronic arnaut balan banari bejan bostan bradu buzu caraman chirtoaca cimpoi ciorba ciubotaru
cozma creanga dumitrescu enache gheorghiu georgescu grosu iordache lazar manole marin matei mihai mihailescu
nedelcu niculescu oprea paduraru preda radu radulescu sava serban stan stanciu stoica tanase toma tudor
constantinescu diaconu dinu dobre florea ilie lupascu nastase neagu petrescu popovici roman stefanescu munteanu
smith johnson williams brown jones garcia miller davis rodriguez martinez hernandez lopez gonzalez wilson anderson
thomas taylor moore jackson martin lee perez thompson white harris sanchez clark ramirez lewis robinson walker young
allen king wright scott torres nguyen hill flores green adams nelson baker hall rivera campbell mitchell carter roberts
gomez phillips evans turner diaz parker cruz edwards collins reyes stewart morris morales murphy cook rogers gutierrez
ortiz morgan cooper peterson bailey reed kelly howard ramos kim cox ward richardson watson brooks chavez wood james
bennett gray mendoza ruiz hughes price alvarez castillo sanders patel myers long ross foster jimenez powell jenkins
perry russell sullivan bell coleman butler henderson barnes gonzales fisher vasquez simmons romero jordan patterson
alexander hamilton graham reynolds griffin wallace moreno west cole hayes bryant herrera gibson ellis tran medina
aguilar stevens murray ford castro marshall owens harrison fernandez mcdonald woods washington kennedy wells vargas
henry chen freeman webb tucker guzman burns crawford olson simpson porter hunter gordon mendez silva shaw snyder mason
dixon munoz hunt hicks holmes palmer wagner black robertson boyd rose stone salazar fox warren mills meyer rice
schmidt garza daniels ferguson nichols stephens soto weaver ryan gardner payne grant dunn kelley spencer hawkins
arnold pierce hansen peters santos hart bradley knight elliott cunningham duncan armstrong hudson carroll lane riley
andrews ray berry perkins hoffman johnston matthews pena richards willis carpenter lawrence sandoval walsh obrien
o'brien o'connor o'neill byrne doyle davies jenkins hughes wilkinson thompson`

/** Words that are also names but are frequent in ordinary text. */
const COMMON_WORDS = new Set(`mare dor floare lupu ursu negru roman pop radu marin bun stan toma lazar dinu spinu
bradu sandu paul tudor matei mihai
will mark bill rose grace may june april hope joy faith king white green brown black young long hunter cook baker
art dean frank sue pat guy jack ray gene carol summer ivy lily iris ruby amber dawn eve holly daisy poppy max lane
hill wood stone fox rice price bell hall cox ward gray grant hart lee rogers reed parker turner walker mason miller
smith carter cooper bishop church page major love moss wells ford west north south mills brooks banks chase
august justice victoria virginia charlotte jordan austin lewis owen florence`.split(/\s+/).filter(Boolean))

const TITLES = new Set([
  'dl', 'dna', 'd-na', 'd-l', 'domnul', 'doamna', 'domnului', 'doamnei', 'dr', 'av', 'prof', 'ing',
  'sr', 'mr', 'mrs', 'ms', 'miss', 'mx', 'sir', 'madam', 'lady', 'lord',
])

const SIGNAL_TITLE = 0.4
const SIGNAL_PAIR = 0.4
const SIGNAL_PAIR_UNKNOWN = 0.3
const SIGNAL_COMMON_WORD = -0.3
const BASE = 0.5

interface Token { readonly norm: string; readonly start: number; readonly end: number; readonly capitalized: boolean }

const WORD = /[\p{L}][\p{L}'-]*/gu

function listOf(source: string): ReadonlySet<string> {
  return new Set(source.split(/\s+/).map(normalizeTerm).filter(Boolean))
}

let firstNames: ReadonlySet<string> | undefined
let lastNames: ReadonlySet<string> | undefined

/**
 * @param word - one normalized word.
 * @returns whether the word is in the first-name list.
 */
export function isFirstName(word: string): boolean {
  firstNames ??= listOf(FIRST_NAMES)
  return firstNames.has(word)
}

/**
 * @param word - one normalized word.
 * @returns whether the word is in the surname list.
 */
export function isLastName(word: string): boolean {
  lastNames ??= listOf(LAST_NAMES)
  return lastNames.has(word)
}

let knownNames: ReadonlySet<string> | undefined

/**
 * @param word - one normalized word.
 * @returns whether the word is a first name or surname in its own right, so a generated
 *   form spelled like it ("Petre", vocative of "Petru") may stand for another person.
 */
export function isKnownName(word: string): boolean {
  knownNames ??= new Set([...listOf(FIRST_NAMES), ...listOf(LAST_NAMES)])
  return knownNames.has(word)
}

/** Detects probable person names from lists and context. */
export class NameDetector {
  readonly id = 'names'
  private readonly first = listOf(FIRST_NAMES)
  private readonly last = listOf(LAST_NAMES)

  /**
   * Find scored name candidates.
   * @param text - normalized view.
   * @returns candidates, one per name or name pair.
   */
  detect(text: NormalizedText): Candidate[] {
    const tokens: Token[] = []
    for (const match of text.norm.matchAll(WORD)) {
      // "Baker's", "Jones'": the possessive ending is not part of the name.
      const word = match[0].replace(/-+$/, '').replace(/(?<=\p{L}{2})'s?$/u, '')
      const start = text.startOf[match.index]!
      const end = text.endOf[match.index + word.length - 1]!
      const firstChar = text.original.slice(start, start + 2).codePointAt(0)
      const char = firstChar === undefined ? '' : String.fromCodePoint(firstChar)
      tokens.push({ norm: word, start, end, capitalized: char !== char.toLowerCase() && char === char.toUpperCase() })
    }
    const found: Candidate[] = []
    for (let i = 0; i < tokens.length; i++) {
      const token = tokens[i]!
      if (!token.capitalized) continue
      const known = this.first.has(token.norm) || this.last.has(token.norm)
      const previous = tokens[i - 1]
      const titled = previous !== undefined && TITLES.has(previous.norm) && this.adjacent(text, previous, token, true)
      const next = tokens[i + 1]
      const nextAdjacent = next !== undefined && next.capitalized && this.adjacent(text, token, next, false)
      const nextKnown = nextAdjacent && (this.first.has(next.norm) || this.last.has(next.norm))
      // An unknown capitalized word inside a sentence, right before a known surname, is its first name ("Zinovia Popescu").
      const unknownFirst = !known && !titled && nextAdjacent && this.last.has(next.norm)
        && !TITLES.has(token.norm) && !isSentenceStart(text.original, token.start)
      if (!known && !titled && !unknownFirst) continue
      let score = BASE
      let end = token.end
      let consumed = 0
      if (titled) score += SIGNAL_TITLE
      if (nextAdjacent && (known || titled || unknownFirst)) {
        score += nextKnown && known ? SIGNAL_PAIR : SIGNAL_PAIR_UNKNOWN
        end = next.end
        consumed = 1
      } else if (known && COMMON_WORDS.has(token.norm) && !titled) {
        // "Will you sign?", "Green light ahead": alone at the start of a sentence, the capital proves nothing.
        if (isSentenceStart(text.original, token.start)) continue
        score += SIGNAL_COMMON_WORD
      }
      const value = normalizeTerm(text.original.slice(token.start, end))
      found.push({
        start: token.start, end, classId: 'PERSON', detector: this.id, priority: NAMES_PRIORITY,
        confidence: Math.max(0, Math.min(1, Math.round(score * 100) / 100)),
        key: { kind: 'canonical', classId: 'PERSON', value },
      })
      i += consumed
    }
    return found
  }

  /** Whether two tokens are separated only by spaces (and a dot after a title). */
  private adjacent(text: NormalizedText, left: Token, right: Token, allowDot: boolean): boolean {
    const between = text.original.slice(left.end, right.start)
    return allowDot ? /^\.?\s+$|^\.$/.test(between) : /^ +$/.test(between)
  }
}
