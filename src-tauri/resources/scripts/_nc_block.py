"""What the word scripts share: Scale feed rates, Scale spindle speeds and the Tool list.

Wave Y (T209, T090). The three scripts read the same thing — the words of a block and what
the codes of that block make of them — and each carried its own copy of how to read it:
``power_on_state`` three times, ``block_entries`` twice, the parameter and number helpers
twice, so a fix landed in one copy only. They live here once.

**A block, not a line** (T090). A block may run over several lines: Klartext continues one
with a trailing ``~``, Okuma with a ``$`` at the start of the next line
(``syntax.continuationStart``). A code on any line of a block counts for the whole block:
``G01 X30 Z-20 F2`` followed by ``$ G33`` is one thread block, and its ``F2`` is the lead,
although the line that writes it comes first. :class:`BlockReader` hands a script the lines
of one block together, and :class:`BlockFlags` is what the whole block says about its
words, so a script decides about a word only once the block is over. A one-line block —
nearly every block of every program — reads exactly as it did line by line.

Like ``_nc_run``, this module sits **above** ``gedit_nc`` and is not re-exported by it: the
bundled scripts import it by name (``import _nc_block``); a script of your own that imports
it may break when it changes.
"""

from __future__ import annotations

from decimal import Decimal, InvalidOperation
from typing import Any, Dict, Iterator, List, Optional, Sequence, Tuple

import gedit_nc

#: At most this many findings by default; the rest are counted in the message. A 100k-line
#: program would otherwise hand the results panel tens of thousands of rows.
MAX_FINDINGS = 200


# -- parameters and numbers ----------------------------------------------------


def as_dict(value: Any) -> Dict[str, Any]:
    """``value`` when it is a dictionary, else an empty one — the context arrives as JSON."""
    return value if isinstance(value, dict) else {}


def decimal_text(value: Any) -> Optional[str]:
    """A parameter value as an exact decimal string, or ``None`` when it is not a number.

    Form values arrive as JSON, so a percentage can be an int, a float or text. A float is
    read through its ``repr``, which is the shortest string that reads back as the same
    double, and is written without an exponent so that it parses as an NC number.
    """
    if value is None or isinstance(value, bool):
        return None
    if isinstance(value, int):
        return str(value)
    if isinstance(value, float):
        try:
            number = Decimal(repr(value))
        except InvalidOperation:
            return None
        if not number.is_finite():
            return None
        return format(number, "f")
    if isinstance(value, str):
        text = value.strip()
        return text if gedit_nc.parse_number(text) is not None else None
    return None


def decimal_param(values: Dict[str, Any], key: str, label: str, default: Optional[str] = None) -> Optional[str]:
    """One numeric parameter as a decimal string. An unusable value is an error, not a guess."""
    value = values.get(key)
    if value is None or value == "":
        return default
    text = decimal_text(value)
    if text is None:
        raise ValueError("%s: %r is not a number." % (label, value))
    return text


def decimals_param(value: Any, default: Any = "keep") -> Any:
    """``'keep'`` or a decimal count; ``default`` when the field is empty. Anything else is an error."""
    if value is None or value == "":
        return default
    if value == "keep":
        return "keep"
    if isinstance(value, bool):
        raise ValueError("Decimal places: %r is not a number of decimals." % (value,))
    if isinstance(value, int):
        count = value
    elif isinstance(value, str) and value.strip().isdigit():
        count = int(value.strip(), 10)
    else:
        raise ValueError("Decimal places: %r is not a number of decimals." % (value,))
    if count < 0 or count > 10:
        raise ValueError("Decimal places: %d is outside 0 to 10." % count)
    return count


def choice_param(value: Any, default: str = "auto") -> str:
    """An ``auto`` / ``yes`` / ``no`` option, from the form or from an older context.

    Phase 1 declared these options as a ``bool``; the form engine turns a remembered
    ``false`` into the field's default when a field becomes a ``choice`` (plan F33), so the
    app never sends one. A context written by hand or by an older build still can, and a run
    that says ``true`` or ``false`` meant it — so both are honoured rather than quietly turned
    into ``auto``.
    """
    if value is True:
        return "yes"
    if value is False:
        return "no"
    return value if value in ("auto", "yes", "no") else default


def trim(value: Decimal) -> str:
    """A decimal as short text, never in exponent form: ``Decimal('90.0')`` is ``'90'``."""
    return format(value.normalize(), "f")


def count_text(count: int, singular: str, plural: Optional[str] = None) -> str:
    """``1 feed rate`` / ``4 feed rates``."""
    return "%s %s" % ("{:,}".format(count), singular if count == 1 else (plural or singular + "s"))


def exact_value(number: Any) -> Decimal:
    """The exact value of a token's literal or of a written number (`gedit_nc.decimal_of`).

    Not ``Decimal(literal.raw)``: a Klartext decimal comma stays in ``raw`` (`F500,5`) so
    that the rewrite writes it back, and ``Decimal("500,5")`` raises. Only ever called with
    a number the tokenizer or ``format_number`` produced, so ``None`` cannot come back.
    """
    value = gedit_nc.decimal_of(number)
    if value is None:  # pragma: no cover - the tokenizer and format_number write numbers
        raise ValueError("not a number: %r" % (number,))
    return value


def decimals_text(count: int) -> str:
    """``no decimals`` / ``1 decimal`` / ``3 decimals``."""
    if count <= 0:
        return "no decimals"
    return "1 decimal" if count == 1 else "%d decimals" % count


def written_precision(token: gedit_nc.Token) -> str:
    """How this value was written, for a finding: ``no decimals``, ``1 decimal`` ..."""
    if token.value is None or not token.value.has_point:
        return "no decimals"
    return decimals_text(len(token.value.frac_part or ""))


class NumberFormat:
    """The number format a scale run writes with, and the one rule that protects a value.

    Where the profile says the decimal point is **significant** (`F100` is not `F100.`), a
    value written without a point is never given one: asking for two decimals would turn
    `F100` into `F90.00`, which a control in the standard increment system reads as ninety
    times the value. Such a value is written whole (:meth:`format_for`).
    """

    def __init__(self, profile: Dict[str, Any], decimals: Any) -> None:
        self.fmt = gedit_nc.number_format_of(profile)
        self.decimals = decimals
        if self.decimals != "keep":
            self.fmt["decimals"] = self.decimals
        syntax = as_dict(profile.get("syntax"))
        self.decimal_point_significant = syntax.get("decimalPointSignificant") is True
        self.whole_fmt = dict(self.fmt)
        self.whole_fmt["decimals"] = 0

    def format_for(self, token: gedit_nc.Token) -> Tuple[Dict[str, Any], bool]:
        """The number format for this value, and whether it had to be kept whole."""
        if (
            self.decimal_point_significant
            and self.decimals != "keep"
            and self.decimals > 0
            and token.value is not None
            and not token.value.has_point
        ):
            return self.whole_fmt, True
        return self.fmt, False

    def write(self, value: str, token: gedit_nc.Token) -> Tuple[str, bool]:
        """A decimal string written the way the profile and the original literal ask for.

        The second half of the answer says whether a fixed decimal count had to be dropped
        to keep a point-less value point-less.
        """
        fmt, whole = self.format_for(token)
        return gedit_nc.format_number(value, token.value, fmt, self.decimal_point_significant), whole

    def result_precision(self, token: gedit_nc.Token) -> str:
        """How the **result** was written, which is what a finding has to name.

        With ``decimals = "keep"`` that is the precision the value already had; otherwise it
        is the run's count, unless the count had to be dropped to keep a point-less value
        point-less. Naming the wrong one turns an honest warning into a wrong explanation of
        a right number.
        """
        _, whole = self.format_for(token)
        if whole:
            return "no decimals"
        if self.decimals == "keep":
            return written_precision(token)
        return decimals_text(self.decimals)


# -- findings and edits ----------------------------------------------------------


class Findings:
    """The findings of a run, capped so that a huge program cannot flood the panel."""

    def __init__(self, limit: int = MAX_FINDINGS) -> None:
        self.items: List[Dict[str, Any]] = []
        self.dropped = 0
        self.limit = limit

    def add(self, line: int, severity: str, message: str) -> None:
        if len(self.items) >= self.limit:
            self.dropped += 1
            return
        self.items.append({"line": line, "severity": severity, "message": message})

    def in_line_order(self) -> List[Dict[str, Any]]:
        """The findings, by line. Python's sort is stable, so one line keeps its order."""
        return sorted(self.items, key=lambda finding: finding["line"])


def apply_edits(line: str, edits: Sequence[Tuple[int, int, str]]) -> str:
    """Replaces the given spans of ``line``. The spans come from tokens, so they never overlap."""
    out: List[str] = []
    at = 0
    for start, end, text in sorted(edits):
        out.append(line[at:start])
        out.append(text)
        at = end
    out.append(line[at:])
    return "".join(out)


# -- the words and the codes of a block ------------------------------------------


def assignment_word(token: gedit_nc.Token) -> bool:
    """True for an address written with `=` (plan §7.5): `F=R1`, `SB=1200`, `M3=3`.

    The address is exactly what stands in front of the `=`, so such a word is a value and
    never a code; `F=R1` is the feed word with a value that is not a number, and `S3` is not
    `S`. An indexed one (`M[2]=3`, `FA[X]=100`, `syntax.assignmentIndex`) is one too, though
    its text in front of the `=` carries the bracket (M9 review F1).
    """
    if token.kind != "word" or not token.address:
        return False
    if token.index is not None:
        return True
    head, sep, _ = token.text.partition("=")
    return sep == "=" and head.strip().upper() == token.address.upper()


def block_entries(
    tokens: Sequence[gedit_nc.Token], tracker: gedit_nc.FeedModeTracker
) -> List[Dict[str, Any]]:
    """The code-database entries of the codes these tokens write, in written order.

    An ISO dialect writes a code as an address word (`G21` is `G` + `21`); Klartext writes
    it as a keyword whose number may stand in the next token (`CYCL DEF` + `247`). Both
    spellings reach the same entry, through `FeedModeTracker.entry`, which follows aliases.
    An address written with `=` is a value and never a code (`M3=3` is not `M33`), and a
    cycle written as a call is the code of its identifier (`CYCLE84(…)`).
    """
    out: List[Dict[str, Any]] = []
    count = len(tokens)
    for i, token in enumerate(tokens):
        if token.kind == "word":
            address = token.address or ""
            written = (
                address + (token.value_text or "")
                if address != "" and not assignment_word(token)
                else ""
            )
        elif token.kind == "call":
            written = token.address or ""
        elif token.kind == "keyword":
            name = token.address or token.text
            number = token.value_text
            if number is None:
                for j in range(i + 1, count):
                    if tokens[j].kind == "whitespace":
                        continue
                    nxt = tokens[j]
                    if nxt.address is None and nxt.value_text is not None:
                        number = nxt.value_text
                    break
            written = "%s %s" % (name, number) if number is not None else name
            if tracker.entry(written) is None:
                written = name
        else:
            continue
        entry = tracker.entry(written) if written else None
        if entry is not None:
            out.append(entry)
    return out


def power_on_state(
    tracker: gedit_nc.FeedModeTracker, cp: gedit_nc.CompiledProfile
) -> List[Dict[str, Any]]:
    """Puts the tracker into the state the control powers on in (plan AD-19 rule 8, AD-31).

    Answers the database entries of the power-on codes, so a finding can name the one that
    put a unit in force.

    `FeedModeTracker` is Phase 1's API: it is built from a code database alone, so it starts
    every run in feed per minute and in rpm — which is what a milling control powers on in.
    A turning control does not: a Fanuc lathe in G-code system A powers on in `G99`, feed
    **per revolution**, in system B in `G95`, and the document's machine may say something
    else again (plan §7.15). The **effective** profile carries that state in
    `modal.initial`, so the run walks those codes through the tracker as the block before
    the first one. A code in the program then overrides it exactly as it overrides a code
    on an earlier line, and a dialect that declares no power-on state (Klartext) is
    untouched.
    """
    initial = as_dict(as_dict(cp.profile.get("modal")).get("initial"))
    codes = [value for value in initial.values() if isinstance(value, str) and value != ""]
    if not codes:
        return []
    tokens, _ = gedit_nc.tokenize_line(" ".join(codes), cp, None)
    tracker.update(tokens)
    return block_entries(tokens, tracker)


def plain_owner_of(address: str, entries: Sequence[Dict[str, Any]]) -> Optional[str]:
    """The code of the block that declares ``address`` as a parameter of its own, or ``None``.

    Only a code that is no thread anywhere counts — neither ``pitchFeed`` nor
    ``pitchFeedAmbiguous`` — so the answer says what the word is in every reading: the `F`
    of an Okuma LAP roughing cycle (`G85 … F0.3`) is its roughing feed, whatever another
    code of the block (the LAP condition change `G84`, a tapping cycle on a machining
    centre) would make of an `F` of its own. A code that is a thread somewhere never settles
    anything: Fanuc `G76` declares its `F` a boring feed on the mill and is still a thread
    cycle on a lathe.
    """
    wanted = address.upper()
    for entry in entries:
        if entry.get("pitchFeed") is True or entry.get("pitchFeedAmbiguous") is True:
            continue
        for param in entry.get("params") or []:
            if isinstance(param, dict) and str(param.get("address") or "").upper() == wanted:
                code = entry.get("code")
                return code if isinstance(code, str) and code != "" else None
    return None


def feed_mode_of(token: gedit_nc.Token, mode: str, words: Sequence[str] = ("FU", "FZ")) -> str:
    """The mode a feed word is written in: its own address (Klartext `FU`, `FZ`) wins over ``mode``."""
    if token.address in words:
        return token.address or ""
    return mode


def call_arguments(text: Optional[str]) -> List[str]:
    """The arguments of a call as written, split at the commas between them.

    `5,0,2,-30,,-8` is `['5', '0', '2', '-30', '', '-8']`: an empty argument keeps its place,
    because a cycle reads its arguments by position. A comma inside a string, a bracket or a
    nested call (`AC(10)`) does not split.
    """
    if text is None:
        return []
    out: List[str] = []
    current: List[str] = []
    depth = 0
    quoted = False
    for char in text:
        if quoted:
            quoted = char != '"'
        elif char == '"':
            quoted = True
        elif char in "([":
            depth += 1
        elif char in ")]":
            depth -= 1
        elif char == "," and depth == 0:
            out.append("".join(current).strip())
            current = []
            continue
        current.append(char)
    out.append("".join(current).strip())
    return out


def lower_first(label: str) -> str:
    """``Feed on the way in`` → ``feed on the way in``, for the middle of a sentence."""
    return label[:1].lower() + label[1:] if label[1:2].islower() else label


# -- a block, not a line (T090) --------------------------------------------------


class BlockLine:
    """One line of a block: where it stands, its tokens, and what the tracker said after it.

    ``owners`` maps ``id(token)`` of a word a function of the block owns to that function's
    code (`ownWords`, `FeedModeTracker.own_word_of`). The tracker answers that question for
    the line it applied last only, so it is asked while the line is read.
    """

    __slots__ = ("index", "text", "tokens", "entries", "written", "owners", "head")

    def __init__(self, index: int, text: str, tokens: List[gedit_nc.Token], head: bool) -> None:
        self.index = index
        self.text = text
        self.tokens = tokens
        #: The line starts with a marker that continues the block above (Okuma `$`).
        self.head = head
        self.entries: List[Dict[str, Any]] = []
        self.written: List[Tuple[Dict[str, Any], str]] = []
        self.owners: Dict[int, str] = {}


class BlockReader:
    """Reads lines and hands them back one **block** at a time (:meth:`blocks`).

    A line continues the block above it when that one ended in a trailing marker (Klartext
    `~`, ``LineState.continuation``) or when it starts with one itself (Okuma `$`,
    :func:`gedit_nc.continues_block`). Each line is tokenized once; ``state`` is the
    tokenizer state after the last line read, for a caller that primes the next walk.
    """

    def __init__(self, cp: gedit_nc.CompiledProfile, state: Optional[gedit_nc.LineState] = None) -> None:
        self.cp = cp
        self.state = state

    def blocks(self, lines: Sequence[str], start: int = 0) -> Iterator[List[BlockLine]]:
        """The lines grouped into blocks; ``index`` counts from ``start``."""
        block: List[BlockLine] = []
        trailing = self.state.continuation if self.state is not None else False
        for offset, text in enumerate(lines):
            head = gedit_nc.continues_block(text, self.cp)
            if block and not (trailing or head):
                yield block
                block = []
            tokens, self.state = gedit_nc.tokenize_line(text, self.cp, self.state)
            trailing = self.state.continuation if self.state is not None else False
            block.append(BlockLine(start + offset, text, tokens, head))
        if block:
            yield block


def read_line(tracker: gedit_nc.FeedModeTracker, line: BlockLine, owners: bool = True) -> None:
    """Applies one line of a block to ``tracker`` and keeps what only that moment can answer.

    ``owners`` asks for the words a function of the block owns (:attr:`BlockLine.owners`),
    which only the scripts that read feeds need.
    """
    tracker.update(line.tokens, continued=line.head)
    line.entries = block_entries(line.tokens, tracker)
    line.written = list(tracker.written)
    if owners:
        for token in line.tokens:
            if token.kind == "word":
                owner = tracker.own_word_of(token)
                if owner is not None:
                    line.owners[id(token)] = owner


class BlockFlags:
    """What a whole block says about its words: a code on any of its lines counts for all.

    The attributes are those of `gedit_nc.FeedModeTracker` that decide what a feed or a
    speed word **is**, so a script hands this object wherever it handed the tracker. Call
    :meth:`add` after the tracker has read each line of the block (:func:`read_line`). The
    protective flags — a thread lead, a code that is a thread somewhere else, a dwell, a
    tap, a data block — are raised for the whole block when any line raises them; the modes
    (the feed mode, constant surface speed) and the cycle and mode in force are the block's
    at its end, which is where a control has read all of it. For a block of one line this is
    exactly the tracker after that line.
    """

    def __init__(self, tracker: gedit_nc.FeedModeTracker) -> None:
        self._tracker = tracker
        self.feed_mode = tracker.feed_mode
        self.css = tracker.css
        self.active_cycle: Optional[str] = None
        self.pitch_feed = False
        self.pitch_mode: Optional[str] = None
        self.pitch_feed_ambiguous = False
        self.ambiguous_code: Optional[str] = None
        self.f_not_feed = False
        self.f_not_feed_code: Optional[str] = None
        self.tapping = False
        self.tapping_code: Optional[str] = None
        self.data_code: Optional[str] = None
        #: ``(entry, token kind)`` of every code the block writes, in written order.
        self.written: List[Tuple[Dict[str, Any], str]] = []
        #: The database entries of the codes the block writes (:func:`block_entries`).
        self.entries: List[Dict[str, Any]] = []
        #: Every token of the block, its lines in order.
        self.tokens: List[gedit_nc.Token] = []
        self._owners: Dict[int, str] = {}

    def add(self, line: BlockLine) -> None:
        """Takes what the tracker says after ``line``, one line of this block."""
        tracker = self._tracker
        self.feed_mode = tracker.feed_mode
        self.css = tracker.css
        self.active_cycle = tracker.active_cycle or self.active_cycle
        self.pitch_mode = tracker.pitch_mode or self.pitch_mode
        self.pitch_feed = self.pitch_feed or tracker.pitch_feed
        if self.ambiguous_code is None and tracker.pitch_feed_ambiguous:
            self.ambiguous_code = tracker.ambiguous_code
        self.pitch_feed_ambiguous = self.pitch_feed_ambiguous or tracker.pitch_feed_ambiguous
        if not self.f_not_feed and tracker.f_not_feed:
            self.f_not_feed, self.f_not_feed_code = True, tracker.f_not_feed_code
        if not self.tapping and tracker.tapping:
            self.tapping, self.tapping_code = True, tracker.tapping_code
        self.data_code = self.data_code or tracker.data_code
        self.written.extend(line.written)
        self.entries.extend(line.entries)
        self.tokens.extend(line.tokens)
        self._owners.update(line.owners)

    def entry(self, code: str) -> Optional[Dict[str, Any]]:
        """The database entry for a written code, following aliases, or ``None``."""
        return self._tracker.entry(code)

    def own_word_of(self, token: gedit_nc.Token) -> Optional[str]:
        """The code of the block that owns this word (`ownWords`), as read with its line."""
        return self._owners.get(id(token))


def read_block(tracker: gedit_nc.FeedModeTracker, block: Sequence[BlockLine], owners: bool = True) -> BlockFlags:
    """Applies every line of ``block`` to ``tracker`` and answers what the block says."""
    flags = BlockFlags(tracker)
    for line in block:
        read_line(tracker, line, owners)
        flags.add(line)
    return flags
