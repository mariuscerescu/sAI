"""Builds the frozen English test set for the sAI verifier (rules: SPEC.md). No model runs here.

Sources: the `train` split of NVIDIA Nemotron-PII (synthetic, CC BY 4.0; never used in earlier sAI tests) and hand-written
natural prompts with exact labels. Output, outside the repository: sai-model-bench/data/frozen-en/{calibration,final,reserve}.jsonl.
The script prints totals only. eval/frozen-en/manifest.json records the hash and the counts of each part.

Run with the bench environment:  venv/Scripts/python.exe -I eval/frozen-en/build_frozen_set.py
"""
import ast
import hashlib
import json
import random
import re
import sys
from collections import Counter, defaultdict
from pathlib import Path

import pyarrow.parquet as pq

sys.stdout.reconfigure(encoding="utf-8")
BENCH = Path(r"D:\Disk D 13-09-25\EC\sai-model-bench")
NEMOTRON = BENCH / "data" / "nvidia__Nemotron-PII" / "data" / "train-00000-of-00001.parquet"
OUT = BENCH / "data" / "frozen-en"
HERE = Path(__file__).resolve().parent
SEED = "sai-frozen-en-v1-2026-11-23"
SPLITS = ("calibration", "final", "reserve")
# One-word names and ordinary words wanted from Nemotron in each part (the natural prompts add more).
TARGET_NAMES = {"calibration": 1500, "final": 3000, "reserve": 500}
TARGET_ORDINARY = {"calibration": 1000, "final": 2000, "reserve": 330}
# One-word names that are also ordinary English words (Mark, Grace, Price): the cases that test the model.
TARGET_HARD = {"calibration": 400, "final": 800, "reserve": 130}

FIRST = set("""bill mark rose grace hope will may june april frank joy faith grant dean rich art drew chase wade lane
reed cliff glen heath iris ivy olive pearl ruby crystal dawn summer holly daisy lily violet angel jack rob sue pat gene
ray guy sterling hunter mason""".split())
SURNAME = set("""baker turner cook miller brown white young king wood hill stone price green black bell page ward fisher
carter porter cole smith taylor walker wright hall fox wolf lamb field marsh short long little small rice bush park love
best sharp moody rush""".split())
COMPANY = set("""apple shell target oracle amazon gap visa delta dove sprint square slack zoom subway orange jaguar puma
corona mercury sage monster unity notion discord signal tide ford mint""".split())


def is_hard(check) -> bool:
    """A one-word name that is also an ordinary English word."""
    return check["masked"] and check["route"] == "one" and check["word"].lower() in (FIRST | SURNAME | COMPANY)


def digest(*parts) -> int:
    return int(hashlib.sha256("\u0000".join((SEED, *map(str, parts))).encode("utf-8")).hexdigest(), 16)


def split_of(key: str) -> str:
    bucket = digest("split", key) % 100
    return "calibration" if bucket < 30 else "final" if bucket < 90 else "reserve"


# ---------------------------------------------------------------------------------------------------------------------
# Nemotron documents
# ---------------------------------------------------------------------------------------------------------------------
NAME_LABELS = {"first_name": "first", "last_name": "last", "company_name": "company"}


def bounded(text, start, end):
    before, after = text[start - 1] if start else "", text[end] if end < len(text) else ""
    return not before.isalnum() and not after.isalnum()


TITLE = re.compile(r"(?:^|[^\w])(?:dr|mr|mrs|ms|prof|sir|madam|judge|attorney|officer)\.?\s+$", re.I)


def line_or_sentence_start(text, at):
    """The start of a line, a sentence, a table cell, or a list item. After "Field:" a capitalized word is a value."""
    before = text[:at].rstrip(" \t")
    if not before or before.endswith("\n"):
        return True
    if before.rstrip("*_").endswith(":"):
        return False
    return before[-1] in ".!?|•*-" and len(before) < at


def is_ordinary(text, start, end):
    """A trap word counts as ordinary in lowercase, or capitalized at the start of a sentence or line. A capitalized
    brand word (Ford, Visa, Zoom) is a name, and a word after a title (Dr. Smith) is a person: neither is a trap."""
    word = text[start:end]
    if TITLE.search(text[max(0, start - 14):start]):
        return False
    if word.islower():
        return True
    if word.lower() in COMPANY:
        return False
    if not (word[0].isupper() and word[1:].islower()) or not line_or_sentence_start(text, start):
        return False
    rest = text[end:end + 2]
    if rest[:1] in ("'", "’"):
        return False
    following = re.match(r"\s+([A-Z])", text[end:end + 4])
    return following is None


def nemotron_case(row, used_words):
    text = row["text"]
    spans = ast.literal_eval(row["spans"]) if isinstance(row["spans"], str) else row["spans"]
    spans = [s for s in spans if 0 <= s["start"] < s["end"] <= len(text)]
    names = sorted((s for s in spans if s["label"] in NAME_LABELS), key=lambda s: s["start"])
    names = [s for s in names if text[s["start"]:s["end"]] == s["text"] and re.search(r"[^\W\d_]{2}", s["text"])
             and bounded(text, s["start"], s["end"])]
    if not names:
        return None

    # People: a first name right before a last name is one declared person.
    paired, full_names = set(), {}
    for a, b in zip(names, names[1:]):
        if a["label"] == "first_name" and b["label"] == "last_name" and text[a["end"]:b["start"]] == " ":
            paired.update((a["start"], b["start"]))
            full_names.setdefault(f"{a['text']} {b['text']}".lower(), f"{a['text']} {b['text']}")
    parts = {w for full in full_names for w in full.split()}
    terms: dict[str, tuple[str, str]] = {key: ("PERSON", value) for key, value in full_names.items()}
    for s in names:
        value, key = s["text"], s["text"].lower()
        if s["label"] == "company_name":
            terms.setdefault(key, ("COMPANY", value))
        elif key not in parts and s["start"] not in paired:
            term = f"{value} Vantoor" if s["label"] == "first_name" else f"Ysolde {value}"
            terms.setdefault(term.lower(), ("PERSON", term))
            parts.update(term.lower().split())

    gold_words = {w for s in names for w in re.findall(r"[^\W\d_]+", s["text"].lower())}
    checks = []
    for s in names:
        role = NAME_LABELS[s["label"]]
        one_word = len(s["text"].split()) == 1 and s["start"] not in paired
        checks.append({"start": s["start"], "end": s["end"], "word": s["text"], "masked": True, "role": role,
                       "route": "one" if one_word else "full"})

    # Trap words: ordinary words of this text that collide with an invented vocabulary entry.
    occupied = [(s["start"], s["end"]) for s in spans]
    found = defaultdict(list)
    for m in re.finditer(r"(?<![\w'’-])[A-Za-z]+(?![\w'’])", text):
        w = m.group().lower()
        if w in gold_words or not (w in FIRST or w in SURNAME or w in COMPANY):
            continue
        if any(a < m.end() and m.start() < b for a, b in occupied) or not is_ordinary(text, m.start(), m.end()):
            continue
        found[w].append(m)
    for w in sorted(found, key=lambda x: (used_words[x], digest("trap", row["uid"], x)))[:3]:
        cap = w.capitalize()
        term = f"{cap} Holdings" if w in COMPANY else f"{cap} Vantoor" if w in FIRST else f"Ysolde {cap}"
        terms.setdefault(term.lower(), ("COMPANY" if w in COMPANY else "PERSON", term))
        for m in found[w][:2]:
            checks.append({"start": m.start(), "end": m.end(), "word": m.group(), "masked": False, "role": "ordinary", "route": "ordinary"})

    vocabulary = [{"id": f"v{i}", "class": cls, "terms": [value]} for i, (cls, value) in enumerate(terms.values())]
    variant = "as-written"
    if row["document_format"] == "unstructured" and digest("chat", row["uid"]) % 5 == 0 and len(text.lower()) == len(text):
        text, variant = text.lower(), "lowercase-chat"
        checks = [{**c, "word": text[c["start"]:c["end"]]} for c in checks]
    return {"id": f"n-{row['uid']}", "source": "nemotron", "family": row["domain"], "format": row["document_format"],
            "variant": variant, "languages": ["en"], "vocabulary": vocabulary, "text": text, "checks": checks}


def build_nemotron():
    meta = pq.read_table(NEMOTRON, columns=["uid", "domain", "document_format", "text"]).to_pylist()
    buckets = {split: defaultdict(list) for split in SPLITS}
    for index, r in enumerate(meta):
        if 120 <= len(r["text"]) <= 1800:
            buckets[split_of(r["uid"])][(r["domain"], r["document_format"])].append((digest("order", r["uid"]), index))
    table = pq.read_table(NEMOTRON, columns=["uid", "domain", "document_format", "text", "spans"])
    result = {}
    for split in SPLITS:
        groups = [sorted(v) for _, v in sorted(buckets[split].items())]
        used, cases, names, ordinary, hard = Counter(), [], 0, 0, 0
        cap = max(20, int(TARGET_ORDINARY[split] * 0.04))
        cursor = 0
        while (names < TARGET_NAMES[split] or ordinary < TARGET_ORDINARY[split] or hard < TARGET_HARD[split]) and any(groups):
            group = groups[cursor % len(groups)]
            cursor += 1
            if not group:
                continue
            row = table.slice(group.pop(0)[1], 1).to_pylist()[0]
            case = nemotron_case(row, used)
            if case is None:
                continue
            kept, added = [], Counter()
            for c in case["checks"]:
                if c["route"] == "ordinary":
                    w = c["word"].lower()
                    if used[w] + added[w] >= cap or ordinary + sum(added.values()) >= TARGET_ORDINARY[split]:
                        continue
                    added[w] += 1
                kept.append(c)
            one_word = sum(c["route"] == "one" for c in kept)
            hard_here = sum(is_hard(c) for c in kept)
            # A document enters the set only if this part still needs what it brings.
            if not added and not (names < TARGET_NAMES[split] and one_word) and not (hard < TARGET_HARD[split] and hard_here):
                continue
            case["checks"] = kept
            used.update(added)
            ordinary += sum(added.values())
            names += one_word
            hard += hard_here
            cases.append(case)
        result[split] = cases
    return result


# ---------------------------------------------------------------------------------------------------------------------
# Natural prompts: exact labels from construction. All people and companies are invented.
# ---------------------------------------------------------------------------------------------------------------------
TRAP_FIRST = "Mark Bill Will Grant Rose Hope Frank Grace Dean Joy Faith Chase Drew Art".split()
TRAP_LAST = "Price Baker Cook Stone Green White Young King Page Ward Hill Bell Fox Rice".split()
PLAIN_FIRST = "Elena Tomas Priya Oscar Nadia Hugo Leila Marcus Ingrid Rafael Sonia Viktor Amara Julian Tessa Emil".split()
PLAIN_LAST = "Halvorsen Okafor Lindqvist Marchetti Novak Abernathy Castellano Drummond Yilmaz Ferreira Kowalski Whitlock".split()
KIN_FIRST = "Floare Anneke Bruno Celeste Dmitri Esme Fabian Greta Hamid Isolde".split()
COMPANIES = ["Brightwell Logistics", "Calder Systems", "Harrowgate Foods", "Northmere Freight", "Ostrava Tooling",
             "Pellham Analytics", "Quillon Software", "Redfern Textiles", "Stavely Energy", "Tamworth Biotech"]

# Sentences where the name-like word is an ordinary word; {x} marks it.
ORDINARY = {
    "mark": ["Please {mark} the deadline in the shared calendar.", "{Mark} this thread as resolved when you finish.", "The audit left a clear {mark} on our process.", "Sales passed the halfway {mark} last week."],
    "bill": ["We still need to pay the {bill} for the venue.", "The electricity {bill} went up again this quarter.", "{Bill} payments are due on the first of the month.", "Please send the {bill} to accounting."],
    "will": ["The update {will} go live on Tuesday.", "{Will} the new schedule work for the team?", "I {will} send the draft after lunch.", "This change {will} reduce the error rate."],
    "grant": ["We applied for a research {grant} in March.", "{Grant} applications close at the end of the month.", "Please {grant} the auditors read access.", "The {grant} covers travel and equipment."],
    "rose": ["Shipping costs {rose} sharply in October.", "Revenue {rose} by four percent this year.", "She left a {rose} on the reception desk.", "Demand {rose} after the price cut."],
    "hope": ["I {hope} the delivery arrives on time.", "{Hope} this helps with the planning.", "We {hope} to finish the review this week.", "There is little {hope} of meeting that date."],
    "frank": ["Let me be {frank} about the budget.", "We had a {frank} discussion about delays.", "{Frank} feedback helps the team improve.", "Thanks for the {frank} assessment."],
    "grace": ["The contract allows a ten day {grace} period.", "She handled the complaint with {grace}.", "{Grace} periods apply to late invoices.", "We can offer a short {grace} period."],
    "dean": ["The {dean} of the faculty approved the course.", "Ask the {dean} for a signed letter.", "A new {dean} starts in September.", "The {dean} chaired the committee."],
    "joy": ["It was a {joy} to work on this launch.", "The team shared the {joy} of finishing early.", "{Joy} is not a word I use for audits.", "Customers wrote about their {joy} with the service."],
    "faith": ["We acted in good {faith} during the talks.", "Both parties negotiate in good {faith}.", "{Faith} in the forecast dropped after March.", "I have {faith} in this approach."],
    "chase": ["Please {chase} the supplier for an update.", "{Chase} the overdue invoices before Friday.", "We should not {chase} every small lead.", "I will {chase} legal for the signature."],
    "drew": ["The webinar {drew} a large audience.", "She {drew} a diagram of the workflow.", "We {drew} up a new rota.", "The proposal {drew} several complaints."],
    "art": ["The lobby needs new {art} on the walls.", "{Art} supplies are in the second cabinet.", "Pricing is more {art} than science.", "The {art} team sent the final poster."],
    "price": ["The unit {price} changed last month.", "{Price} changes take effect in May.", "Please confirm the {price} before ordering.", "We agreed on a lower {price} for bulk orders."],
    "baker": ["The {baker} on the corner supplies our lunches.", "We hired a {baker} for the event.", "Ask the {baker} about gluten free options.", "A local {baker} delivers every Friday."],
    "cook": ["The {cook} prepared lunch for the whole team.", "We need to {cook} for forty people.", "{Cook} the rice before adding the sauce.", "Our {cook} is on leave this week."],
    "stone": ["The patio is made of natural {stone}.", "Nothing is set in {stone} yet.", "{Stone} tiles arrive next week.", "A loose {stone} damaged the mower."],
    "green": ["The status light turned {green} after the fix.", "{Green} cells in the sheet are approved.", "We chose a dark {green} for the logo.", "Mark the row {green} when it is done."],
    "white": ["Use a {white} background for the slides.", "{White} labels are easier to read.", "The walls will be painted {white}.", "Print it on plain {white} paper."],
    "young": ["The product appeals to {young} customers.", "{Young} teams often move faster.", "We hired several {young} engineers.", "The market is still {young}."],
    "king": ["Cash is {king} during a downturn.", "The {king} size beds are out of stock.", "In this market, content is {king}.", "He played the {king} in the school play."],
    "page": ["See the table on {page} four.", "{Page} numbers are missing from the report.", "Update the landing {page} before launch.", "Please sign the last {page}."],
    "ward": ["The patient moved to another {ward} on Monday.", "Each {ward} has its own nurse station.", "The hospital opened a new {ward}.", "Visitors must leave the {ward} by eight."],
    "hill": ["The office is at the top of the {hill}.", "Our truck stalled on a steep {hill}.", "{Hill} roads close when it snows.", "Walk up the {hill} to reach the depot."],
    "bell": ["Ring the {bell} at the front desk.", "The {bell} rings at nine each morning.", "That name does not ring a {bell}.", "{Bell} curves are common in this data."],
    "fox": ["A {fox} crossed the car park last night.", "The {fox} got into the storage shed.", "{Fox} sightings are common near the depot.", "We saw a {fox} near the loading bay."],
    "rice": ["Order two bags of {rice} for the canteen.", "{Rice} prices went up this spring.", "The menu includes {rice} and vegetables.", "We ship {rice} in sealed sacks."],
}
ATTACHED = "Ask Contact Then Thanks Yesterday Tell Call Email Meanwhile Remind".split()

# [F:A] first name, [L:A] last name, [N:A] full name, [C:X] company, [S:X] company short name, [O:A] ordinary sentence with
# the name-like word of A, [K] a capitalized word that is not a name, [R:D] an undeclared relative with D's surname,
# [X:D] the surname inside a code token. A has a trap first name, B a trap surname, D a plain name.
TEMPLATES = {
    "rewrite-1": "Rewrite this email so it sounds friendlier and keep all names unchanged.\n\nHi [F:A],\n[O:A] Also, [L:B] asked whether [C:X] can confirm the order by Friday.\nThanks,\n[N:D]",
    "rewrite-2": "Can you shorten this message? Do not change any names.\n\n[F:A] spoke with [N:B] yesterday. [O:B] [S:X] still needs the signed copy from [L:D].",
    "rewrite-3": "Please fix the grammar below. Names must stay exactly as written.\n\n[K] [L:B] about the renewal. [O:A] I told [F:D] that [S:X] wants an answer soon.",
    "rewrite-4": "Make this more formal for a client:\n\nhey [F:A], [L:D] says the [S:X] files are ready. [O:B] let me know if [F:B] needs anything else",
    "rewrite-5": "Turn these notes into a polite reply to [N:A].\n\n- [O:A]\n- [L:B] will handle the [C:X] account\n- [O:B]\n- copy [F:D] on the thread",
    "summary-1": "Summarize the thread below in two sentences.\n\nFrom: [N:A]\nTo: [N:B]\n[O:A] [F:B], can you check with [S:X] today?\n\nFrom: [N:B]\nTo: [N:A]\nSure, [F:A]. [O:B]",
    "summary-2": "Give me the three key points from this update.\n\n[C:X] signed the deal on Monday. [L:A] led the talks and [L:B] reviewed the terms. [O:B] [F:D] will brief the board.",
    "summary-3": "What are the action items here?\n\n[F:A] owns the budget. [O:A] [F:B] follows up with [S:X]. [K] [L:D] for the numbers.",
    "summary-4": "tl;dr this for me please\n\n[N:D] wrote that [S:X] is late again. [O:B] [L:A] thinks we should escalate to [F:B].",
    "summary-5": "Summarize this complaint for the support lead. All names below are fictional.\n\n[N:B] contacted us about order 4471. [O:A] [F:D] from [C:X] promised a refund, and [F:B] is still waiting.",
    "notes-1": "Clean up these meeting notes.\n\nAttendees: [N:A], [N:B], [N:D]\n[O:A]\n[F:B] to send the [S:X] forecast\n[O:B]\nNext meeting: [F:D] to schedule",
    "notes-2": "Turn this into minutes.\n\n[L:A] opened the meeting. [L:B] presented the [C:X] results. [O:B] [K] [L:D] for the appendix.",
    "notes-3": "Make a task list from this standup:\n\n[F:A]: finished the migration. [O:A]\n[F:B]: blocked on [S:X].\n[F:D]: on leave until Thursday.",
    "notes-4": "Rewrite as bullet points, keep the names.\n\nDuring the review [N:D] said that [F:A] should take over. [O:B] [R:D] will join from the [S:X] office.",
    "notes-5": "Draft a recap for people who missed the call.\n\n[N:A] and [N:D] agreed on scope. [O:A] [L:B] raised a risk about [C:X].",
    "contract-1": "Explain this clause in plain English.\n\nThis Agreement is between [C:X] (the \"Supplier\") and [N:A] (the \"Client\"). [O:B] The Client shall notify [L:B] of any change.",
    "contract-2": "Is anything risky in this paragraph?\n\n[N:B], acting for [C:X], confirms the terms. [O:A] Any dispute goes to [N:D] as mediator.",
    "contract-3": "Simplify this notice.\n\nDear [L:A], your agreement with [S:X] ends on 30 June. [O:B] Please contact [F:D] to renew.",
    "contract-4": "Check this letter for tone.\n\nDear Ms. [L:B],\n[O:B] We confirm that [C:X] accepts the offer made by [N:A].\nYours sincerely,\n[N:D]",
    "contract-5": "In this document, \"Company\" means [C:X] and \"Manager\" means [N:D]. Summarize the duties.\n\nThe Manager reports to [N:A]. [O:A] [L:D] shall inform [F:B] each quarter.",
    "table-1": "Sort this table by date.\n\n| Owner | Client | Date |\n|---|---|---|\n| [N:A] | [C:X] | 2026-03-02 |\n| [L:B] | [S:X] | 2026-02-11 |\n| [F:D] | [S:X] | 2026-01-20 |\n\n[O:B]",
    "table-2": "Convert to JSON:\n\nname,company,role\n[N:A],[C:X],lead\n[N:B],[C:X],analyst\n[N:D],[C:X],intern\n\n[O:A]",
    "table-3": "Which person has the most tickets?\n\n[F:A] - 14\n[F:B] - 9\n[F:D] - 21\n\n[O:A] [O:B]",
    "table-4": "Add a total column.\n\nOwner: [L:A], Units: 12\nOwner: [L:B], Units: 7\nOwner: [L:D], Units: 30\n\n[O:B]",
    "table-5": "Format as a list and keep the order.\n\n1. [N:D] ([S:X])\n2. [N:B] ([S:X])\n3. [N:A] ([C:X])\n\n[O:A]",
    "code-1": "Why does this fail?\n\ndef load_user():\n    # owner: [N:A]\n    return db.get(\"[X:D]\")\n\n[F:B] says it broke after the [S:X] release. [O:B]",
    "code-2": "Explain this log.\n\n2026-03-02 ERROR job failed for customer=[X:D]\n2026-03-02 INFO retry requested by [N:A]\n\n[O:A] [L:B] is on call.",
    "code-3": "Review this commit message: \"fix export for [C:X], reported by [F:A]\". [O:A] [L:D] approved it.",
    "code-4": "Write a unit test for this.\n\n# maintained by [N:B]\nconfig = {\"owner_id\": \"[X:D]\", \"team\": \"[S:X]\"}\n\n[O:B]",
    "code-5": "What does this SQL do? [F:A] wrote it.\n\nSELECT * FROM orders WHERE client = '[C:X]' AND rep = '[L:B]';\n\n[O:A]",
    "chat-1": "can you help me write a text to [F:A]? [O:A] tell [F:B] i'll be late and that [S:X] called",
    "chat-2": "ok so [L:B] said no. [O:B] what should i tell [F:D]",
    "chat-3": "need a short reply for [N:A] about the [S:X] thing. [O:A]",
    "chat-4": "i talked to [L:D] and [F:A] today. [O:B] does that sound ok for [C:X]?",
    "chat-5": "[F:B] keeps asking about the invoice from [S:X]. [O:A] what do i say",
    "ask-1": "[K] [L:B] whether the [S:X] report is ready. [O:B] Draft that message for me.",
    "ask-2": "Write a short note: [K] [L:D] before noon. [O:A] [R:D] is covering the desk.",
    "ask-3": "I need advice. [F:A] from [C:X] disagrees with [L:B]. [O:B] How do I handle it?",
    "ask-4": "Prepare talking points for my call with [N:B]. [O:B] [F:D] wants [S:X] to move first.",
    "ask-5": "Translate to simple English, but do not translate names: [N:D] told [F:A] that [S:X] will reply. [O:A]",
}
LOWERCASE_FAMILIES = {"chat-1", "chat-2", "chat-3", "chat-4", "chat-5"}
RENDERS = 22


def prompt_case(family, index):
    rng = random.Random(f"{SEED}/{family}/{index}")
    a = (rng.choice(TRAP_FIRST), rng.choice(PLAIN_LAST))
    b = (rng.choice(PLAIN_FIRST), rng.choice(TRAP_LAST))
    d = (rng.choice([f for f in PLAIN_FIRST if f != b[0]]), rng.choice([l for l in PLAIN_LAST if l != a[1]]))
    people = {"A": a, "B": b, "D": d}
    company = rng.choice(COMPANIES)
    vocabulary = [{"id": k.lower(), "class": "PERSON", "terms": [f"{v[0]} {v[1]}"]} for k, v in people.items()]
    vocabulary.append({"id": "x", "class": "COMPANY", "terms": [company]})
    if digest("shared", family, index) % 4 == 0:  # another declared person with the same first name as A
        vocabulary.append({"id": "e", "class": "PERSON", "terms": [f"{a[0]} {rng.choice([l for l in PLAIN_LAST if l not in (a[1], d[1])])}"]})
    out, checks = "", []

    def put(value, **check):
        nonlocal out
        start = len(out)
        out += value
        if check:
            checks.append({"start": start, "end": len(out), "word": value, **check})

    def ordinary(word):
        nonlocal out
        sentence = rng.choice(ORDINARY[word.lower()])
        m = re.search(r"\{(\w+)\}", sentence)
        put(sentence[:m.start()])
        put(m.group(1), masked=False, role="ordinary", route="ordinary")
        put(sentence[m.end():])

    template = TEMPLATES[family]
    at = 0
    for m in re.finditer(r"\[(F|L|N|C|S|O|R|X):?([ABDX]?)\]|\[K\]", template):
        put(template[at:m.start()])
        at = m.end()
        kind, who = m.group(1), m.group(2)
        if m.group(0) == "[K]":
            put(rng.choice(ATTACHED), masked=False, role="attached-word", route="ordinary")
        elif kind == "F":
            put(people[who][0], masked=True, role="first", route="one")
        elif kind == "L":
            put(people[who][1], masked=True, role="last", route="one")
        elif kind == "N":
            put(f"{people[who][0]} {people[who][1]}", masked=True, role="full", route="full")
        elif kind == "C":
            put(company, masked=True, role="company", route="full")
        elif kind == "S":
            put(company.split()[0], masked=True, role="company", route="one")
        elif kind == "O":
            ordinary(people[who][0] if who == "A" else people[who][1])
        elif kind == "R":
            put(rng.choice(KIN_FIRST), masked=True, role="attached-name", route="attached")
            put(" ")
            put(people[who][1], masked=True, role="last", route="one")
        elif kind == "X":
            put(people[who][1].lower(), masked=True, role="code", route="code")
            put("_id")
    put(template[at:])
    variant = "as-written"
    if family in LOWERCASE_FAMILIES:
        out, variant = out.lower(), "lowercase-chat"
        checks = [{**c, "word": out[c["start"]:c["end"]]} for c in checks]
    return {"id": f"p-{family}-{index}", "source": "prompts", "family": family, "format": "prompt", "variant": variant,
            "languages": ["en"], "vocabulary": vocabulary, "text": out, "checks": checks}


def build_prompts():
    families = sorted(TEMPLATES, key=lambda f: digest("family", f))
    # Every category is spread over the parts; a family belongs to one part only.
    by_category = defaultdict(list)
    for f in families:
        by_category[f.split("-")[0]].append(f)
    split_for = {}
    for members in by_category.values():
        for i, f in enumerate(members):
            split_for[f] = ("calibration", "final", "final", "calibration", "final")[i]
    reserve = sorted(TEMPLATES, key=lambda f: digest("reserve", f))
    for f in [x for x in reserve if split_for[x] == "final"][:4]:
        split_for[f] = "reserve"
    result = {split: [] for split in SPLITS}
    for family in sorted(TEMPLATES):
        result[split_for[family]] += [prompt_case(family, i) for i in range(RENDERS)]
    return result


def summarize(cases):
    checks = [c for case in cases for c in case["checks"]]
    return {
        "messages": len(cases),
        "bySource": dict(Counter(c["source"] for c in cases)),
        "lowercaseChatMessages": sum(c["variant"] == "lowercase-chat" for c in cases),
        "checks": len(checks),
        "namesOneWord": sum(c["masked"] and c["route"] == "one" for c in checks),
        "namesOneWordCapitalized": sum(c["masked"] and c["route"] == "one" and c["word"][:1].isupper() for c in checks),
        "namesAlsoOrdinaryWords": sum(is_hard(c) for c in checks),
        "namesOther": sum(c["masked"] and c["route"] != "one" for c in checks),
        "ordinary": sum(not c["masked"] for c in checks),
        "ordinaryCapitalized": sum(not c["masked"] and c["word"][:1].isupper() for c in checks),
        "distinctOrdinaryWords": len({c["word"].lower() for c in checks if not c["masked"]}),
        "domains": len({c["family"] for c in cases}),
    }


def main():
    OUT.mkdir(parents=True, exist_ok=True)
    nemotron, prompts = build_nemotron(), build_prompts()
    manifest = {"version": 1, "seed": SEED, "builderSha256": hashlib.sha256(Path(__file__).read_bytes()).hexdigest(), "parts": {}}
    ids = set()
    for split in SPLITS:
        cases = nemotron[split] + prompts[split]
        cases.sort(key=lambda c: digest("shuffle", c["id"]))
        assert not ids & {c["id"] for c in cases}, "a case is in two parts"
        ids |= {c["id"] for c in cases}
        for case in cases:
            for c in case["checks"]:
                assert case["text"][c["start"]:c["end"]] == c["word"], case["id"]
        path = OUT / f"{split}.jsonl"
        body = "".join(json.dumps(c, ensure_ascii=False, sort_keys=True) + "\n" for c in cases)
        path.write_text(body, encoding="utf-8", newline="\n")
        manifest["parts"][split] = {"file": f"sai-model-bench/data/frozen-en/{split}.jsonl", "sha256": hashlib.sha256(body.encode("utf-8")).hexdigest(), **summarize(cases)}
        print(split, json.dumps(manifest["parts"][split], ensure_ascii=False))
    (HERE / "manifest.json").write_text(json.dumps(manifest, ensure_ascii=False, indent=1) + "\n", encoding="utf-8", newline="\n")


if __name__ == "__main__":
    main()
