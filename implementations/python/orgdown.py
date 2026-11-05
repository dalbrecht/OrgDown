# SPDX-License-Identifier: MIT
"""A clean-room OrgDown implementation written from the specification alone.

Modules covered: core, planning, recurrence, operations, logbook, agenda,
diagnostics and the TASKS.md profile (parse, complete, reopen, fix, to_core,
from_core).  No third-party dependencies.
"""

import datetime
import re

STATES = ("inbox", "next", "in-progress", "blocked", "waiting", "someday", "done", "trash")
CLOSED_STATES = ("done", "trash")
DAY_NAMES = ("sun", "mon", "tue", "wed", "thu", "fri", "sat")
VIEWS = ("day", "week", "list", "next", "waiting", "stuck", "logbook", "clock", "habits")
VIEW_ATTRIBUTES = ("title", "match", "sort", "start", "days", "from", "to")


class OrgDownError(Exception):
    """Base class for all errors raised by this module."""


class QueryError(OrgDownError):
    """A query did not parse."""


class AgendaError(OrgDownError):
    """An Agenda MD file or view definition is invalid."""


class RefusedError(OrgDownError):
    """An operation was refused; the document is unchanged."""


# --------------------------------------------------------------------------
# Date and time helpers
# --------------------------------------------------------------------------

_BAD = object()


def _to_date(text):
    match = re.fullmatch(r"(\d{4})-(\d{2})-(\d{2})", text)
    if not match:
        return None
    try:
        return datetime.date(int(match.group(1)), int(match.group(2)), int(match.group(3)))
    except ValueError:
        return None


def is_date(text):
    return _to_date(text) is not None


def is_time(text):
    return re.fullmatch(r"([01]\d|2[0-3]):[0-5]\d", text) is not None


def is_datetime(text):
    match = re.fullmatch(r"(\d{4}-\d{2}-\d{2})T(\d{2}:\d{2})", text)
    return bool(match) and is_date(match.group(1)) and is_time(match.group(2))


def _to_datetime(text):
    return datetime.datetime(
        int(text[0:4]), int(text[5:7]), int(text[8:10]), int(text[11:13]), int(text[14:16])
    )


def add_days(text, count):
    return (_to_date(text) + datetime.timedelta(days=count)).isoformat()


def add_months(text, count):
    current = _to_date(text)
    index = current.year * 12 + (current.month - 1) + count
    year, month = divmod(index, 12)
    month += 1
    first_of_next = datetime.date(year + (month == 12), month % 12 + 1, 1)
    last_day = (first_of_next - datetime.timedelta(days=1)).day
    return datetime.date(year, month, min(current.day, last_day)).isoformat()


def days_between(earlier, later):
    return (_to_date(later) - _to_date(earlier)).days


def _columns(whitespace):
    return sum(2 if character == "\t" else 1 for character in whitespace)


def _strip_columns(text, wanted):
    consumed = 0
    index = 0
    while index < len(text) and text[index] in " \t":
        width = 2 if text[index] == "\t" else 1
        if consumed + width > wanted:
            break
        consumed += width
        index += 1
    return text[index:]


# --------------------------------------------------------------------------
# Token value grammars
# --------------------------------------------------------------------------


def _unquote(value):
    if len(value) >= 2 and value.startswith('"') and value.endswith('"'):
        return value[1:-1]
    return value


def _v_state(value):
    return value if value in STATES else _BAD


def _v_name(value):
    return _unquote(value)


def _v_project(value):
    # The legacy @project: value is kept verbatim, quotes included.
    return value


def _v_reason(value):
    inner = _unquote(value)
    return inner if inner.strip() != "" else _BAD


def _v_kind(value):
    return value if value in ("project", "single-action") else _BAD


def _v_energy(value):
    return value if value in ("low", "medium", "high") else _BAD


def _v_date(value):
    return value if is_date(value) else _BAD


def _v_time(value):
    return value if is_time(value) else _BAD


def _v_warn(value):
    match = re.fullmatch(r"(0|[1-9][0-9]*)d", value)
    return int(match.group(1)) if match else _BAD


def _v_remind(value):
    return value if is_date(value) or is_datetime(value) else _BAD


def _v_estimate(value):
    match = re.fullmatch(r"([1-9][0-9]*)([mh])", value)
    if not match:
        return _BAD
    return int(match.group(1)) * (60 if match.group(2) == "h" else 1)


def _v_priority(value):
    return int(value) if re.fullmatch(r"[1-9][0-9]*", value) else _BAD


def _v_count(value):
    return int(value) if re.fullmatch(r"0|[1-9][0-9]*", value) else _BAD


def _v_interval(value):
    match = re.fullmatch(r"([1-9][0-9]*)([dwm])", value)
    if not match or int(match.group(1)) > 9999:
        return _BAD
    unit = {"d": "day", "w": "week", "m": "month"}[match.group(2)]
    return (int(match.group(1)), unit)


def _v_weekdays(value):
    numbers = set()
    for part in value.split(","):
        if part not in DAY_NAMES:
            return _BAD
        numbers.add(DAY_NAMES.index(part))
    return sorted(numbers)


def _v_catch_up(value):
    return True if value == "yes" else _BAD


def _v_habit(value):
    return True if value == "yes" else _BAD


def _v_at(value):
    match = re.fullmatch(
        r"(\d{4}-\d{2}-\d{2})(?:T(\d{2}:\d{2}))?(?:/(\d{2}:\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2}))?",
        value,
    )
    if not match:
        return _BAD
    day, clock, end = match.groups()
    if not is_date(day):
        return _BAD
    if clock is None:
        return {"start": day} if end is None else _BAD
    if not is_time(clock):
        return _BAD
    start = day + "T" + clock
    if end is None:
        return {"start": start}
    if len(end) == 5:
        if not is_time(end):
            return _BAD
        end = day + "T" + end
    elif not is_datetime(end):
        return _BAD
    if end <= start:
        return _BAD
    return {"start": start, "end": end}


VALIDATORS = {
    "@status:": _v_state,
    "@context:": _v_name,
    "@project:": _v_project,
    "@kind:": _v_kind,
    "@energy:": _v_energy,
    "@waiting:": _v_reason,
    "due:": _v_date,
    "defer:": _v_date,
    "@due-time:": _v_time,
    "@warn:": _v_warn,
    "at:": _v_at,
    "@remind:": _v_remind,
    "@estimate:": _v_estimate,
    "@priority:": _v_priority,
    "@today:": _v_date,
    "completed:": _v_date,
    "@every:": _v_interval,
    "@after:": _v_interval,
    "@repeat-on:": _v_weekdays,
    "@repeat-until:": _v_date,
    "@repeat-count:": _v_count,
    "@repeat-catch-up:": _v_catch_up,
    "@habit:": _v_habit,
}
PRIMARY_KEYS = ("@every:", "@after:")
REPEAT_KEYS = ("@repeat-on:", "@repeat-until:", "@repeat-count:", "@repeat-catch-up:")
RECURRENCE_KEYS = PRIMARY_KEYS + REPEAT_KEYS

CANONICAL_ORDER = (
    "@status:", "@context:", "@energy:", "@waiting:", "due:", "defer:", "@due-time:", "@warn:",
    "at:", "@remind:", "@estimate:", "@priority:", "@today:", "@every:", "@after:",
    "@repeat-on:", "@repeat-until:", "@repeat-count:", "@repeat-catch-up:", "@habit:", "completed:",
    "*extras*", "@kind:",
)

# --------------------------------------------------------------------------
# Line classification
# --------------------------------------------------------------------------

TASK_RE = re.compile(r"^(\s*)([-*+])\s+\[([ xX])\]\s+(.*)$")
SECTION_RE = re.compile(r"^#{2,6}\s+\S")
FENCE_RE = re.compile(r"^\s*(`{3,}|~{3,})")
VIEW_OPEN_RE = re.compile(r"^\s*<!--\s*orgdown:view(?=\s|-->|$)")
VIEW_CLOSE_RE = re.compile(r"^\s*<!--\s*/orgdown:view\s*-->")
TRAILER_RE = re.compile(r"\s*<!--\s*(.*?)\s*-->\s*$")
OPEN_RE = re.compile(r"(?i)^@?[a-z][a-z-]*:")
TAG_RE = re.compile(r"^#[^\W\d_][\w/-]*$")


class Line:
    def __init__(self, raw):
        self.has_cr = raw.endswith("\r")
        self.s = raw[:-1] if self.has_cr else raw
        self.kind = "passthrough"
        self.region = None

    @property
    def raw(self):
        return self.s + ("\r" if self.has_cr else "")


def _classify_lines(lines):
    count = len(lines)
    index = 0
    if count and lines[0].s == "---":
        for close in range(1, count):
            if lines[close].s == "---":
                for position in range(0, close + 1):
                    lines[position].kind = "opaque"
                    lines[position].region = "front"
                index = close + 1
                break
    while index < count:
        line = lines[index]
        text = line.s
        fence = FENCE_RE.match(text)
        if fence:
            marker = fence.group(1)
            closer = re.compile(r"^\s*" + re.escape(marker[0]) + "{%d,}\\s*$" % len(marker))
            end = count - 1
            for probe in range(index + 1, count):
                if closer.match(lines[probe].s):
                    end = probe
                    break
            for position in range(index, end + 1):
                lines[position].kind = "opaque"
                lines[position].region = "fence"
            index = end + 1
            continue
        if VIEW_OPEN_RE.match(text):
            end = count - 1
            for probe in range(index + 1, count):
                if VIEW_CLOSE_RE.match(lines[probe].s):
                    end = probe
                    break
            for position in range(index, end + 1):
                lines[position].kind = "opaque"
                lines[position].region = "generated"
            index = end + 1
            continue
        if text.lstrip().startswith("<!--") and "-->" not in text:
            end = count - 1
            for probe in range(index + 1, count):
                if "-->" in lines[probe].s:
                    end = probe
                    break
            for position in range(index, end + 1):
                lines[position].kind = "opaque"
                lines[position].region = "comment"
            index = end + 1
            continue
        if TASK_RE.match(text):
            line.kind = "task"
        elif SECTION_RE.match(text):
            line.kind = "section"
        index += 1


# --------------------------------------------------------------------------
# Task parsing
# --------------------------------------------------------------------------


class Token:
    """One token in a task's token run, with its position in the line."""

    def __init__(self, text, start, end):
        self.text = text
        self.start = start
        self.end = end
        colon = text.index(":")
        self.key = text[: colon + 1]
        self.value = text[colon + 1 :]
        self.known = self.key in VALIDATORS
        self.valid = False  # value satisfies its grammar
        self.parsed = None
        self.role = "extra"  # field, shadowed or extra
        self.reason = "unknown"  # unknown, invalid, no-due, orphan, weekdays-unit, catchup-after
        if self.known:
            parsed = VALIDATORS[self.key](self.value)
            if parsed is _BAD:
                self.reason = "invalid"
            else:
                self.valid = True
                self.parsed = parsed
                self.reason = None
                self.role = "field"


class Task:
    """A parsed task line.  Attribute names follow the specification."""

    def get(self, name):
        return getattr(self, name)


def _code_spans(text):
    return [(m.start(), m.end()) for m in re.finditer(r"(`+).+?\1", text)]


def _extract_tags(text):
    spans = _code_spans(text)
    tags = []
    for match in re.finditer(r"\S+", text):
        if any(a <= match.start() < b for a, b in spans):
            continue
        word = match.group()
        if TAG_RE.match(word) and word[1:] not in tags:
            tags.append(word[1:])
    return tags


def _group_key(token):
    return "primary" if token.key in PRIMARY_KEYS else token.key


def parse_task_line(s, line_number):
    match = TASK_RE.match(s)
    task = Task()
    task.line = line_number
    task.indent = match.group(1)
    task.marker = match.group(2)
    task.box_char = match.group(3)
    task.box_pos = match.start(3)
    task.checked = task.box_char in "xX"
    task.depth = _columns(task.indent) // 2
    text = match.group(4)
    text_start = match.start(4)
    trailer = TRAILER_RE.search(text)
    task.id = None
    task.rev = None
    task.trailer_start = None
    run_text = text
    if trailer:
        run_text = text[: trailer.start()]
        task.trailer_start = text_start + trailer.start()
        for word in trailer.group(1).split():
            if word.startswith("id:") and len(word) > 3:
                task.id = word[3:]
            elif word.startswith("rev:") and len(word) > 4:
                task.rev = word[4:]
    words = [(m.group(), text_start + m.start(), text_start + m.end()) for m in re.finditer(r"\S+", run_text)]
    spans = []
    end = len(words) - 1
    while end >= 0:
        start = end
        while start >= 0 and not OPEN_RE.match(words[start][0]):
            start -= 1
        if start < 0:
            break
        joined = " ".join(w[0] for w in words[start : end + 1])
        after = joined.split(":", 1)[1]
        if start == end or (len(after) >= 2 and after.startswith('"') and after.endswith('"')):
            spans.insert(0, (start, end))
            end = start - 1
        else:
            break
    task.tokens = []
    for start, end in spans:
        joined = " ".join(w[0] for w in words[start : end + 1])
        task.tokens.append(Token(joined, words[start][1], words[end][2]))
    first_token_word = spans[0][0] if spans else len(words)
    title_words = words[:first_token_word]
    task.title = " ".join(w[0] for w in title_words)
    task.title_end = title_words[-1][2] if title_words else text_start
    task.insert_at = task.tokens[-1].end if task.tokens else task.title_end
    task.title_words = [w[0] for w in title_words]
    task.tags = _extract_tags(task.title)
    _interpret(task)
    task.core_title = task.title
    task.note = None
    task.section = None
    task.body = []
    task.log = []
    task.body_start = 0
    task.body_end = 0
    task.parent = None
    task.od604 = False
    return task


def _interpret(task):
    tokens = task.tokens
    groups = {}
    for token in tokens:
        if token.valid:
            groups.setdefault(_group_key(token), []).append(token)

    def effective(group):
        valid = groups.get(group, [])
        return valid[-1] if valid else None

    # A due-time needs a valid due on the line; otherwise it is an extra.
    has_due = effective("due:") is not None
    if not has_due:
        for token in groups.pop("@due-time:", []):
            token.role = "extra"
            token.reason = "no-due"
    for group, valid in groups.items():
        for token in valid[:-1]:
            token.role = "shadowed"
        valid[-1].role = "field" if valid[-1].role != "extra" else "extra"

    primary = effective("primary")
    if primary is None:
        for key in REPEAT_KEYS:
            for token in groups.get(key, []):
                token.role = "extra"
                token.reason = "orphan"
    else:
        if primary.parsed[1] != "week":
            for token in groups.get("@repeat-on:", []):
                token.role = "extra"
                token.reason = "weekdays-unit"
        if primary.key == "@after:":
            for token in groups.get("@repeat-catch-up:", []):
                token.role = "extra"
                token.reason = "catchup-after"

    def value(key):
        token = effective(key)
        if token is not None and token.role == "field":
            return token.parsed
        return None

    task.context = value("@context:")
    task.project = value("@project:")
    task.nodeKind = value("@kind:")
    task.energy = value("@energy:")
    task.waitingReason = value("@waiting:")
    task.due = value("due:")
    task.defer = value("defer:")
    task.dueTime = value("@due-time:")
    task.warnDays = value("@warn:")
    task.at = value("at:")
    task.remind = value("@remind:")
    task.estimateMinutes = value("@estimate:")
    task.priority = value("@priority:")
    task.today = value("@today:")
    task.completed = value("completed:")
    task.habit = value("@habit:") is True
    task.recurrence = None
    if primary is not None:
        every, unit = primary.parsed
        rule = {"mode": "due" if primary.key == "@every:" else "completion", "every": every, "unit": unit}
        if value("@repeat-on:") is not None:
            rule["weekdays"] = value("@repeat-on:")
        if value("@repeat-until:") is not None:
            rule["until"] = value("@repeat-until:")
        if value("@repeat-count:") is not None:
            rule["count"] = value("@repeat-count:")
        if value("@repeat-catch-up:") is not None:
            rule["catchUp"] = True
        task.recurrence = rule

    status_token = effective("@status:")
    task.explicit_status = status_token.parsed if status_token else None
    default_state = "done" if task.checked else "inbox"
    state = task.explicit_status or default_state
    task.waiting_fallback = False
    if state == "waiting" and task.waitingReason is None:
        state = default_state
        task.waiting_fallback = True
    task.state = state
    task.core_state = state
    task.extraTokens = [t.text for t in tokens if t.role == "extra"]
    if task.waiting_fallback:
        task.extraTokens.append(status_token.text)


def parse_document(text, profile="core"):
    document = Document(text, profile)
    return document


class Document:
    def __init__(self, text, profile="core"):
        self.profile = profile
        self.lines = [Line(raw) for raw in text.split("\n")]
        _classify_lines(self.lines)
        self.tasks = []
        stack = []
        for index, line in enumerate(self.lines):
            if line.kind == "section":
                stack = []
            elif line.kind == "task":
                task = parse_task_line(line.s, index + 1)
                while stack and self.tasks[stack[-1]].depth >= task.depth:
                    stack.pop()
                task.parent = stack[-1] + 1 if stack else None
                task.parent_index = stack[-1] if stack else None
                stack.append(len(self.tasks))
                task.index = len(self.tasks)
                self.tasks.append(task)
        self._compute_bodies()
        if profile == "tasks-md":
            _apply_tasks_md(self)
        for task in self.tasks:
            children = [t for t in self.tasks if t.parent_index == task.index]
            task.progress = (
                {"done": sum(1 for c in children if c.state in CLOSED_STATES), "total": len(children)}
                if children
                else None
            )

    def _compute_bodies(self):
        count = len(self.lines)
        for task in self.tasks:
            first = task.line  # zero based index of the line after the task
            task_columns = _columns(task.indent)
            probe = first
            while probe < count:
                line = self.lines[probe]
                if line.kind != "passthrough":
                    break
                if line.s.strip() != "":
                    leading = line.s[: len(line.s) - len(line.s.lstrip())]
                    if _columns(leading) <= task_columns:
                        break
                probe += 1
            end = probe
            while end > first and self.lines[end - 1].s.strip() == "":
                end -= 1
            task.body_start = first
            task.body_end = end
            task.body = [
                _strip_columns(self.lines[k].s, task_columns + 2) if self.lines[k].s.strip() else ""
                for k in range(first, end)
            ]
            task.log = []
            task.log_lines = []
            for offset, body_line in enumerate(task.body):
                entry = _parse_log_entry(body_line)
                if entry is not None:
                    task.log.append(entry)
                    task.log_lines.append(first + offset)  # zero based

    def subtree_end(self, task):
        """Zero based exclusive line index after the task, its descendants and their bodies."""
        last = task
        members = {task.index}
        for other in self.tasks[task.index + 1 :]:
            if other.parent_index in members:
                members.add(other.index)
                last = other
            else:
                break
        return last.body_end

    def descendants(self, task):
        members = {task.index}
        found = []
        for other in self.tasks[task.index + 1 :]:
            if other.parent_index in members:
                members.add(other.index)
                found.append(other)
            else:
                break
        return found

    def text(self):
        return "\n".join(line.raw for line in self.lines)


def _parse_log_entry(body_line):
    if not body_line.startswith("- "):
        return None
    content = body_line[2:].rstrip()
    clock = re.fullmatch(r"clock:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/(\d{2}:\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2})?", content)
    if clock:
        start, end = clock.group(1), clock.group(2)
        if not is_datetime(start):
            return None
        if end is None:
            return {"type": "clock", "start": start, "end": None, "minutes": None}
        if len(end) == 5:
            if not is_time(end):
                return None
            end = start[:10] + "T" + end
        elif not is_datetime(end):
            return None
        if end <= start:
            return None
        minutes = int((_to_datetime(end) - _to_datetime(start)).total_seconds() // 60)
        return {"type": "clock", "start": start, "end": end, "minutes": minutes}
    state = re.fullmatch(r"state:(\S+) from:(\S+) on:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})", content)
    if state and state.group(1) in STATES and state.group(2) in STATES and is_datetime(state.group(3)):
        return {"type": "state", "to": state.group(1), "from": state.group(2), "on": state.group(3)}
    return None


# --------------------------------------------------------------------------
# TASKS.md profile: reading
# --------------------------------------------------------------------------

SECTION_STATES = {
    "active": ("next", ("inbox", "next", "in-progress", "blocked")),
    "waiting on": ("waiting", ("waiting",)),
    "someday": ("someday", ("someday",)),
    "done": ("done", ("done", "trash")),
}
PLUGIN_DONE_RE = re.compile(r"^~~(.+?)~~\s*\((\d{4}-\d{2}-\d{2})\)$")


def _section_name(line_text):
    heading = re.sub(r"^#{2,6}\s+", "", line_text).strip()
    heading = heading.replace("**", "").strip()
    return heading.lower()


def split_profile_title(task):
    """Return (inner, rest, plugin_date) for the task's core title."""
    title = task.core_title
    bold = re.match(r"^\*\*(.+?)\*\*(.*)$", title)
    if bold:
        inner, rest = bold.group(1), bold.group(2)
        is_bold = True
    else:
        inner, rest, is_bold = title, "", False
    plugin_date = None
    done = PLUGIN_DONE_RE.match(inner)
    if done and is_date(done.group(2)):
        inner = "~~" + done.group(1) + "~~"
        plugin_date = done.group(2)
    rest = rest.strip()
    if rest.startswith("-"):
        rest = rest[1:].lstrip()
    return inner, rest, plugin_date, is_bold


def _apply_tasks_md(document):
    current = None
    current_line_of_section = {}
    for index, line in enumerate(document.lines):
        if line.kind == "section" and re.match(r"^##(?!#)", line.s):
            current = _section_name(line.s)
        current_line_of_section[index] = current
    for task in document.tasks:
        section = current_line_of_section[task.line - 1]
        task.section = section
        inner, rest, plugin_date, _ = split_profile_title(task)
        task.profile_inner = inner
        task.plugin_date = plugin_date
        stripped = re.match(r"^~~(.*)~~$", inner)
        task.title = stripped.group(1) if stripped else inner
        task.note = rest
        if plugin_date and task.completed is None:
            task.completed = plugin_date
        task.tags = _extract_tags(task.title + " " + rest)
        if section in SECTION_STATES:
            default_state, allowed = SECTION_STATES[section]
            explicit = task.explicit_status
            reason_known = task.waitingReason is not None
            if explicit == "waiting" and not reason_known and section != "waiting on":
                explicit = None
            if task.depth == 0:
                if task.checked:
                    state = "trash" if (explicit == "trash" and "trash" in allowed) else "done"
                elif explicit in allowed:
                    state = explicit
                else:
                    state = default_state
            else:
                if explicit is not None:
                    state = explicit
                elif task.checked:
                    state = "done"
                else:
                    state = "next" if section == "done" else default_state
            task.state = state
            task.od604 = explicit is not None and explicit != state
            if state == "waiting" and section == "waiting on":
                if not reason_known:
                    task.waitingReason = rest if rest else "unspecified"
            if section == "waiting on" and task.waiting_fallback:
                task.waiting_fallback = False
                task.extraTokens = [t.text for t in task.tokens if t.role == "extra"]


# --------------------------------------------------------------------------
# Recurrence math
# --------------------------------------------------------------------------


def next_occurrence(rule, anchor, completed, today):
    mode = rule["mode"]
    every = rule["every"]
    unit = rule["unit"]
    weekdays = rule.get("weekdays")
    base = anchor if mode == "due" else (completed or today)
    anchor_date = _to_date(anchor)

    def week_start(day):
        return day - datetime.timedelta(days=(day.weekday() + 1) % 7)

    def step(from_text):
        if weekdays:
            origin = _to_date(from_text)
            for offset in range(1, 7 * (every + 1) + 1):
                day = origin + datetime.timedelta(days=offset)
                if (day.weekday() + 1) % 7 not in weekdays:
                    continue
                if mode == "due":
                    weeks = (week_start(day) - week_start(anchor_date)).days // 7
                    if weeks % every != 0:
                        continue
                return day.isoformat()
            return None
        if unit == "day":
            return add_days(from_text, every)
        if unit == "week":
            return add_days(from_text, every * 7)
        return add_months(from_text, every)

    candidate = step(base)
    if rule.get("catchUp"):
        guard = 0
        while candidate is not None and candidate <= today and guard < 100000:
            candidate = step(candidate)
            guard += 1
    if candidate is None:
        return None
    if rule.get("until") is not None and candidate > rule["until"]:
        return None
    return candidate


# --------------------------------------------------------------------------
# Operations (preserving mode)
# --------------------------------------------------------------------------


def _require_task(document, line_number):
    if not isinstance(line_number, int) or line_number < 1 or line_number > len(document.lines):
        raise RefusedError("no such line")
    line = document.lines[line_number - 1]
    if line.kind != "task":
        raise RefusedError("not a task line")
    return next(t for t in document.tasks if t.line == line_number)


def _valid_tokens(task, key):
    return [t for t in task.tokens if t.key == key and t.valid]


def _apply_edits(text, edits):
    for start, end, replacement in sorted(edits, key=lambda e: (e[0], e[1]), reverse=True):
        text = text[:start] + replacement + text[end:]
    return text


class _Editor:
    """Collects in-place edits to a single task line."""

    def __init__(self, task):
        self.task = task
        self.edits = []
        self.appends = []

    def set(self, key, value):
        valid = _valid_tokens(self.task, key)
        if valid:
            self.edits.append((valid[-1].start, valid[-1].end, key + value))
        else:
            self.appends.append(key + value)

    def remove_token(self, token):
        self.edits.append((token.start - 1, token.end, ""))

    def remove_all(self, key):
        for token in _valid_tokens(self.task, key):
            self.remove_token(token)

    def render(self, line_text):
        edits = list(self.edits)
        if self.appends:
            at = self.task.insert_at
            addition = " " + " ".join(self.appends)
            if not self.task.tokens and not self.task.title and self.task.trailer_start == at:
                addition += " "
            edits.append((at, at, addition))
        return _apply_edits(line_text, edits)


def _shift_dates(value, delta):
    return re.sub(r"\d{4}-\d{2}-\d{2}", lambda m: add_days(m.group(), delta), value)


def _build_next_line(task, next_due, source_state):
    """Copy the source line's bytes, applying the next-occurrence token changes."""
    source = task.source
    delta = days_between(task.due, next_due) if task.due else None
    edits = []
    appends = []
    if task.box_char != " ":
        edits.append((task.box_pos, task.box_pos + 1, " "))
    if task.trailer_start is not None:
        edits.append((task.trailer_start, len(source), ""))
    last_valid = {}
    for token in task.tokens:
        if token.valid:
            last_valid[_group_key(token)] = token
    for token in task.tokens:
        if not token.valid:
            continue
        key = token.key
        if key in ("@priority:", "@today:", "@waiting:", "completed:"):
            edits.append((token.start - 1, token.end, ""))
        elif key == "due:" and last_valid[key] is token:
            edits.append((token.start, token.end, "due:" + next_due))
        elif key in ("defer:", "at:", "@remind:"):
            if delta is None:
                edits.append((token.start - 1, token.end, ""))
            elif last_valid[key] is token:
                edits.append((token.start, token.end, key + _shift_dates(token.value, delta)))
        elif key == "@status:":
            if source_state == "inbox":
                edits.append((token.start - 1, token.end, ""))
            elif last_valid[key] is token:
                edits.append((token.start, token.end, "@status:next"))
        elif key == "@repeat-count:" and last_valid[key] is token:
            edits.append((token.start, token.end, "@repeat-count:%d" % (token.parsed - 1)))
    if "due:" not in last_valid:
        appends.append("due:" + next_due)
    if "@status:" not in last_valid and source_state != "inbox":
        appends.append("@status:next")
    if appends:
        edits.append((task.insert_at, task.insert_at, " " + " ".join(appends)))
    return _apply_edits(source, edits).rstrip(" \t")


def _complete_parts(task, today, trash=False):
    """Return (completed_line_text, next_line_text_or_None) for a task."""
    task.source = task.source_text
    editor = _Editor(task)
    if task.box_char not in "xX":
        editor.edits.append((task.box_pos, task.box_pos + 1, "x"))
    if trash:
        editor.set("@status:", "trash")
    elif _valid_tokens(task, "@status:"):
        editor.set("@status:", "done")
    editor.set("completed:", today)
    editor.remove_all("@priority:")
    editor.remove_all("@waiting:")
    next_line = None
    rule = task.recurrence
    if rule is not None and not trash:
        ended = rule.get("count") == 0
        next_due = None
        if not ended:
            next_due = next_occurrence(rule, task.due or today, today, today)
            ended = next_due is None
        for token in task.tokens:
            if token.key in RECURRENCE_KEYS and token.valid and token.role in ("field", "shadowed"):
                editor.remove_token(token)
        if not ended:
            next_line = _build_next_line(task, next_due, task.core_state)
    return editor.render(task.source_text), next_line


def _finish(document, replacements=None, inserts=None):
    """Re-join a document applying line replacements and (index, text) insertions."""
    out = []
    replacements = replacements or {}
    inserts = inserts or []
    for index, line in enumerate(document.lines):
        for at, new in inserts:
            if at == index:
                out.append(new)
        out.append(replacements.get(index, line.raw))
    for at, new in inserts:
        if at >= len(document.lines):
            out.append(new)
    return "\n".join(out)


def _with_source(document, task):
    task.source_text = document.lines[task.line - 1].s
    task.source = task.source_text
    return task


def complete(text, line_number, today, profile="core", _trash=False):
    document = Document(text, "core")
    task = _with_source(document, _require_task(document, line_number))
    carriage = "\r" if document.lines[task.line - 1].has_cr else ""
    done_text, next_text = _complete_parts(task, today, trash=_trash)
    replacements = {task.line - 1: done_text + carriage}
    inserts = []
    if next_text is not None:
        inserts.append((document.subtree_end(task), next_text + carriage))
    return _finish(document, replacements, inserts)


def trash(text, line_number, today):
    return complete(text, line_number, today, _trash=True)


def reopen(text, line_number):
    document = Document(text, "core")
    task = _with_source(document, _require_task(document, line_number))
    editor = _Editor(task)
    if task.checked:
        editor.edits.append((task.box_pos, task.box_pos + 1, " "))
    for token in task.tokens:
        if (token.key == "@status:" and token.valid and token.parsed in CLOSED_STATES) or token.key == "completed:":
            editor.remove_token(token)
    carriage = "\r" if document.lines[task.line - 1].has_cr else ""
    # A checkbox always keeps one space after it, even when removed tokens left nothing behind.
    reopened = re.sub(r"^(\s*[-*+]\s+\[[ xX]\])(?!\s)", r"\1 ", editor.render(task.source_text))
    return _finish(document, {task.line - 1: reopened + carriage})


def skip(text, line_number, today):
    document = Document(text, "core")
    task = _with_source(document, _require_task(document, line_number))
    rule = task.recurrence
    if rule is None or rule.get("count") == 0:
        raise RefusedError("nothing to skip")
    next_due = next_occurrence(rule, task.due or today, today, today)
    if next_due is None:
        raise RefusedError("series has ended")
    editor = _Editor(task)
    delta = days_between(task.due, next_due) if task.due else None
    editor.set("due:", next_due)
    for key in ("defer:", "at:", "@remind:"):
        for token in _valid_tokens(task, key)[-1:]:
            if delta is not None:
                editor.edits.append((token.start, token.end, key + _shift_dates(token.value, delta)))
    if "count" in rule:
        editor.set("@repeat-count:", str(rule["count"] - 1))
    carriage = "\r" if document.lines[task.line - 1].has_cr else ""
    return _finish(document, {task.line - 1: editor.render(task.source_text) + carriage})


def _opens_token(word):
    return OPEN_RE.match(word) is not None


def _refuse_bad_tokens(tokens):
    """Refuse any token a reader would keep as an extra, other than an @x- extension."""
    for token in tokens:
        if re.search(r"[\r\n]", token):
            raise RefusedError("token contains a newline")
        if token.startswith("@project:"):
            raise RefusedError("@project: is legacy and cannot be added")
    probe = parse_task_line(canonical_task_line("x", list(tokens)), 1)
    if len(probe.tokens) != len(tokens) or probe.waiting_fallback:
        raise RefusedError("malformed token")
    for token in probe.tokens:
        if token.role == "extra" and not token.key.startswith("@x-"):
            raise RefusedError("token would be read as an extra: " + token.text)


def _refuse_closed_status(tokens):
    _refuse_bad_tokens(tokens)
    for token in tokens:
        if token.startswith("@status:") and token[len("@status:") :] in CLOSED_STATES:
            raise RefusedError("a new task is always open")


def _refuse_unless_reads_back(line_text, title, tokens):
    """Refuse when a reader would not see exactly the given title and tokens."""
    probe = parse_task_line(line_text, 1)
    if probe.title != " ".join(title.split()) or sorted(t.text for t in probe.tokens) != sorted(tokens):
        raise RefusedError("the new line would not read back as given")


def canonical_task_line(title, tokens):
    ordered = []
    for token in tokens:
        match = re.match(r"^(@?[a-z][a-z-]*:)", token)
        key = match.group(1) if match and match.group(1) in CANONICAL_ORDER else "*extras*"
        ordered.append((CANONICAL_ORDER.index(key), token))
    ordered.sort(key=lambda pair: pair[0])
    box = " "
    kept = [token for _, token in ordered]
    pieces = ([title] if title else []) + kept
    return "- [" + box + "] " + " ".join(pieces)


def add(text, section, title, tokens):
    if "\n" in title:
        raise RefusedError("title contains a newline")
    words = title.split()
    if words and _opens_token(words[-1]):
        raise RefusedError("title ends in a token-shaped word")
    _refuse_closed_status(tokens)
    new_line = canonical_task_line(title, list(tokens))
    _refuse_unless_reads_back(new_line, title, tokens)
    document = Document(text, "core")
    lines = document.lines
    non_blank = [i for i, line in enumerate(lines) if line.s.strip() != ""]
    if not non_blank:
        return new_line
    insert_at = non_blank[-1] + 1
    if section is not None:
        for index, line in enumerate(lines):
            if line.kind == "section" and re.sub(r"^#{2,6}\s+", "", line.s).strip() == section:
                end = len(lines)
                for probe in range(index + 1, len(lines)):
                    if lines[probe].kind == "section":
                        end = probe
                        break
                filled = [i for i in range(index + 1, end) if lines[i].s.strip() != ""]
                insert_at = (filled[-1] + 1) if filled else index + 1
                break
    result = _finish(document, None, [(insert_at, new_line)])
    inserted = Document(result, "core").lines[insert_at]
    if inserted.kind != "task":
        raise RefusedError("the insertion point is not a task context")
    return result


def archive(text, line_number):
    document = Document(text, "core")
    task = _require_task(document, line_number)
    if task.state not in CLOSED_STATES or task.depth != 0:
        raise RefusedError("only closed top-level tasks can be archived")
    start = task.line - 1
    end = document.subtree_end(task)
    removed = "\n".join(document.lines[i].raw for i in range(start, end))
    remaining = "\n".join(document.lines[i].raw for i in range(len(document.lines)) if not start <= i < end)
    return {"text": remaining, "removed": removed}


# --------------------------------------------------------------------------
# Logbook operations
# --------------------------------------------------------------------------


def _has_running_clock(document):
    return any(entry["type"] == "clock" and entry["end"] is None for t in document.tasks for entry in t.log)


def clock_in(text, line_number, now):
    document = Document(text, "core")
    task = _require_task(document, line_number)
    if not is_datetime(now) or _has_running_clock(document):
        raise RefusedError("clock cannot start")
    carriage = "\r" if document.lines[task.line - 1].has_cr else ""
    entry = task.indent + "  - clock:" + now + "/" + carriage
    return _finish(document, None, [(task.line, entry)])


def clock_out(text, line_number, now):
    document = Document(text, "core")
    task = _require_task(document, line_number)
    if not is_datetime(now):
        raise RefusedError("bad time")
    running = [
        (e, n) for e, n in zip(task.log, task.log_lines) if e["type"] == "clock" and e["end"] is None
    ]
    if not running:
        raise RefusedError("no running clock")
    entry, entry_line = running[0]
    if not now > entry["start"]:
        raise RefusedError("clock cannot stop before it started")
    end_text = now[11:16] if now[:10] == entry["start"][:10] else now
    line = document.lines[entry_line]
    updated = re.sub(r"(clock:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/)(\s*)$", lambda m: m.group(1) + end_text + m.group(2), line.s)
    return _finish(document, {entry_line: updated + ("\r" if line.has_cr else "")})


# --------------------------------------------------------------------------
# Query language
# --------------------------------------------------------------------------


def glob_to_regex(pattern):
    out = []
    index = 0
    while index < len(pattern):
        character = pattern[index]
        if pattern.startswith("**/", index):
            out.append("(?:.*/)?")
            index += 3
            continue
        if pattern.startswith("**", index):
            out.append(".*")
            index += 2
            continue
        if character == "*":
            out.append("[^/]*")
        elif character == "?":
            out.append("[^/]")
        else:
            out.append(re.escape(character))
        index += 1
    return re.compile("".join(out) + r"\Z")


def _split_terms(query):
    terms = []
    current = []
    in_quote = False
    for character in query:
        if character == '"':
            in_quote = not in_quote
            current.append(character)
        elif character.isspace() and not in_quote:
            if current:
                terms.append("".join(current))
                current = []
        else:
            current.append(character)
    if in_quote:
        raise QueryError("unclosed quote")
    if current:
        terms.append("".join(current))
    return terms


def parse_date_expression(text, today):
    if is_date(text):
        return text
    if text == "today":
        return today
    match = re.fullmatch(r"today([+-])(\d+)d", text)
    if match:
        count = int(match.group(2))
        return add_days(today, count if match.group(1) == "+" else -count)
    raise QueryError("bad date: " + text)


def _query_value(raw):
    if raw.startswith('"'):
        if len(raw) < 2 or not raw.endswith('"') or '"' in raw[1:-1]:
            raise QueryError("bad quoting")
        return raw[1:-1]
    if '"' in raw:
        raise QueryError("bad quoting")
    return raw


def _is_open(task):
    return task.state not in CLOSED_STATES


def parse_query(query):
    """Parse a query into a list of predicates taking (task, path, today)."""
    predicates = []
    for term in _split_terms(query):
        negate = term.startswith("-")
        if negate:
            term = term[1:]
        if term == "":
            raise QueryError("empty term")
        predicate = _parse_term(term)
        predicates.append((negate, predicate))

    def matches(task, path, today):
        for negate, predicate in predicates:
            if predicate(task, path, today) == negate:
                return False
        return True

    return matches


def _parse_term(term):
    simple = {
        "open": lambda t, p, today: _is_open(t),
        "closed": lambda t, p, today: not _is_open(t),
        "deferred": lambda t, p, today: t.defer is not None and t.defer > today,
        "repeats": lambda t, p, today: t.recurrence is not None,
        "priority": lambda t, p, today: t.priority is not None,
        "due": lambda t, p, today: t.due is not None,
    }
    if term in simple:
        return simple[term]
    keyed = re.match(r"^([a-z]+):(.*)$", term, re.S)
    if keyed and keyed.group(1) in ("status", "tag", "context", "energy", "kind", "title", "file"):
        name = keyed.group(1)
        value = _query_value(keyed.group(2))
        if name == "status":
            wanted = value.split(",")
            if any(w not in STATES for w in wanted):
                raise QueryError("unknown status")
            return lambda t, p, today: t.state in wanted
        if name == "tag":
            wanted = value.lstrip("#")
            if wanted == "":
                raise QueryError("empty tag")
            return lambda t, p, today: any(g == wanted or g.startswith(wanted + "/") for g in t.tags)
        if name == "context":
            return lambda t, p, today: t.context is not None and t.context.lower() == value.lower()
        if name == "energy":
            if value not in ("low", "medium", "high"):
                raise QueryError("unknown energy")
            return lambda t, p, today: t.energy == value
        if name == "kind":
            if value not in ("project", "single-action", "none"):
                raise QueryError("unknown kind")
            return lambda t, p, today: (t.nodeKind is None) if value == "none" else t.nodeKind == value
        if name == "title":
            return lambda t, p, today: value.lower() in t.title.lower()
        pattern = glob_to_regex(value)
        return lambda t, p, today: pattern.match(p or "") is not None
    compare = re.match(r"^(priority|due|defer|completed)(<=|>=|=)(.+)$", term)
    if compare:
        field, operator, raw = compare.groups()
        if field == "priority":
            if operator != "<=" or not re.fullmatch(r"[0-9]+", raw):
                raise QueryError("bad priority comparison")
            limit = int(raw)
            return lambda t, p, today: t.priority is not None and t.priority <= limit
        attribute = {"due": "due", "defer": "defer", "completed": "completed"}[field]

        def date_term(t, p, today, attribute=attribute, operator=operator, raw=raw):
            value = getattr(t, attribute)
            target = parse_date_expression(raw, today)
            if value is None:
                return False
            if operator == "<=":
                return value <= target
            if operator == ">=":
                return value >= target
            return value == target

        # Validate the date form eagerly so a bad query is always an error.
        parse_date_expression(raw, "2000-01-01")
        return date_term
    raise QueryError("unknown term: " + term)


class Item:
    def __init__(self, task, path):
        self.task = task
        self.path = path


def profile_for_path(path):
    base = (path or "").split("/")[-1]
    if base == "TASKS.md":
        return "tasks-md"
    if base == "tasks.v2.md":
        return "tasks-v2"
    return "core"


def query(text, path, query_text, today):
    matcher = parse_query(query_text)
    document = Document(text, profile_for_path(path))
    return [t.title for t in document.tasks if matcher(t, path, today)]


# --------------------------------------------------------------------------
# Views
# --------------------------------------------------------------------------


def _encode_path(path):
    return path.replace(" ", "%20")


def _row(item, prefix_time=None, annotations=None):
    label = item.task.title
    if prefix_time:
        label = prefix_time + " " + label
    if annotations:
        label += " — " + " · ".join(annotations)
    if prefix_time is None and re.match(r"^\[[ xX]\](\s|$)", label):
        label = "\\" + label
    return "- %s ([%s:%d](%s))" % (label, item.path, item.task.line, _encode_path(item.path))


def _due_note(task):
    return ["due " + task.due] if task.due else []


def _render(title, groups, footer=None):
    groups = [(heading, rows) for heading, rows in groups if rows]
    if not groups:
        return "## %s\n\nNothing here." % title
    lines = ["## " + title, ""]
    for position, (heading, rows) in enumerate(groups):
        if heading is not None:
            lines += ["### " + heading, ""]
        lines += rows
        if position < len(groups) - 1:
            lines.append("")
    if footer:
        lines += ["", footer]
    return "\n".join(lines)


def _covers(task, day):
    if task.at is None:
        return False
    start = task.at["start"][:10]
    end = task.at.get("end", task.at["start"])[:10]
    return start <= day <= end


def _schedule_rows(items, day):
    entries = []
    for item in items:
        task = item.task
        if not _is_open(task) or not _covers(task, day):
            continue
        start = task.at["start"]
        timed = "T" in start and start[:10] == day
        label = None
        if timed:
            label = start[11:16]
            end = task.at.get("end")
            if end is not None and end[:10] == day:
                label += "–" + end[11:16]
        entries.append((0 if label is None else 1, start[11:16] if timed else "", len(entries), item, label))
    entries.sort(key=lambda e: (e[0], e[1], e[2]))
    return [_row(entry[3], prefix_time=entry[4]) for entry in entries]


def _time_note(task):
    return [task.dueTime] if task.dueTime else []


def _view_day(items, today):
    schedule = _schedule_rows(items, today)
    scheduled_ids = {id(i) for i in items if _is_open(i.task) and _covers(i.task, today)}
    pool = []
    for item in items:
        task = item.task
        if not _is_open(task) or id(item) in scheduled_ids:
            continue
        warn = 1 if task.warnDays is None else task.warnDays
        on_day = (
            (task.due is not None and add_days(task.due, -warn) <= today)
            or (task.defer is not None and task.defer <= today)
            or task.today == today
            or task.priority is not None
        )
        if on_day:
            pool.append(item)
    ranked = sorted(
        [(i.task.priority, n, i) for n, i in enumerate(pool) if i.task.priority is not None],
        key=lambda e: (e[0], e[1]),
    )[:5]
    high = [e[2] for e in ranked]
    high_ids = {id(i) for i in high}
    overdue, due, rest = [], [], []
    for item in pool:
        if id(item) in high_ids:
            continue
        task = item.task
        warn = 1 if task.warnDays is None else task.warnDays
        if task.due is not None and task.due < today:
            overdue.append(item)
        elif task.due is not None and add_days(task.due, -warn) <= today:
            due.append(item)
        else:
            rest.append(item)
    overdue.sort(key=lambda i: i.task.due)
    due.sort(key=lambda i: i.task.due)
    high_rows = [_row(i, annotations=["#%d" % i.task.priority] + _due_note(i.task)) for i in high]
    overdue_rows = [
        _row(i, annotations=["due " + i.task.due, "%dd late" % days_between(i.task.due, today)]) for i in overdue
    ]
    due_rows = [
        _row(i, annotations=[("due today" if i.task.due == today else "due " + i.task.due)] + _time_note(i.task))
        for i in due
    ]
    today_rows = [_row(i, annotations=_due_note(i.task)) for i in rest]
    return [
        ("Schedule", schedule),
        ("High priority", high_rows),
        ("Overdue", overdue_rows),
        ("Due", due_rows),
        ("Today", today_rows),
    ]


def _view_week(items, start, days):
    groups = []
    names = ("Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun")
    for offset in range(days):
        day = add_days(start, offset)
        rows = _schedule_rows(items, day)
        for item in items:
            if _is_open(item.task) and item.task.due == day:
                rows.append(_row(item, annotations=["due"] + _time_note(item.task)))
        for item in items:
            if _is_open(item.task) and item.task.defer == day:
                rows.append(_row(item, annotations=["arrives"]))
        groups.append(("%s %s" % (day, names[_to_date(day).weekday()]), rows))
    return groups


def _sort_items(items, keys):
    ordered = list(items)
    for key in reversed(keys):
        def sort_key(item, key=key):
            task = item.task
            if key == "title":
                value = task.title.lower()
            elif key == "file":
                value = item.path
            else:
                value = getattr(task, key)
            return (value is None, value if value is not None else 0)

        ordered.sort(key=sort_key)
    return ordered


def render_view(view, attrs, docs, today):
    attrs = attrs or {}
    for name in attrs:
        if name not in VIEW_ATTRIBUTES:
            raise AgendaError("unknown attribute " + name)
    if view not in VIEWS:
        raise AgendaError("unknown view " + str(view))
    if view in ("day", "clock") and "match" in attrs:
        raise AgendaError("match is not allowed on this view")
    if "days" in attrs and not (re.fullmatch(r"[0-9]+", attrs["days"]) and 1 <= int(attrs["days"]) <= 366):
        raise AgendaError("days must be 1 to 366")
    matcher = parse_query(attrs.get("match", ""))
    items = []
    for doc in docs:
        document = Document(doc["text"], profile_for_path(doc["path"]))
        for task in document.tasks:
            items.append(Item(task, doc["path"]))
    def narrowed(candidates):
        return [i for i in candidates if matcher(i.task, i.path, today)]

    def date_attr(name, default):
        if name in attrs:
            return parse_date_expression(attrs[name], today)
        return default

    def title(default):
        return attrs.get("title", default)

    if view == "day":
        return _render(title("Today (%s)" % today), _view_day(items, today))
    if view == "week":
        start = date_attr("start", today)
        days = int(attrs.get("days", "7"))
        return _render(title("Week of " + start), _view_week(narrowed(items), start, days))
    if view == "list":
        keys = [k.strip() for k in attrs["sort"].split(",")] if attrs.get("sort") else []
        if any(k not in ("due", "defer", "priority", "title", "file") for k in keys):
            raise AgendaError("bad sort key")
        chosen = _sort_items(narrowed(items), keys)
        return _render(title("Tasks"), [(None, [_row(i, annotations=_due_note(i.task)) for i in chosen])])
    if view == "next":
        chosen = [i for i in narrowed(items) if i.task.state == "next" and not (i.task.defer and i.task.defer > today)]
        buckets = {}
        names = {}
        for item in chosen:
            key = item.task.context.lower() if item.task.context else None
            buckets.setdefault(key, []).append(item)
            names.setdefault(key, item.task.context)
        groups = []
        for key in sorted(k for k in buckets if k is not None):
            groups.append((names[key], [_row(i, annotations=_due_note(i.task)) for i in buckets[key]]))
        if None in buckets:
            groups.append(("No context", [_row(i, annotations=_due_note(i.task)) for i in buckets[None]]))
        return _render(title("Next actions"), groups)
    if view == "waiting":
        chosen = [i for i in narrowed(items) if i.task.state == "waiting"]
        chosen.sort(key=lambda i: (i.task.due is None, i.task.due or ""))
        rows = [_row(i, annotations=[i.task.waitingReason] + _due_note(i.task)) for i in chosen]
        return _render(title("Waiting"), [(None, rows)])
    if view == "stuck":
        chosen = []
        for item in narrowed(items):
            task = item.task
            if task.nodeKind != "project" or not _is_open(task):
                continue
            chosen.append(item)
        stuck = []
        for item in chosen:
            document_items = [i for i in items if i.path == item.path]
            tasks = [i.task for i in document_items]
            members = {item.task.index}
            has_move = False
            for other in tasks[item.task.index + 1 :]:
                if other.parent_index in members:
                    members.add(other.index)
                    if other.state in ("next", "in-progress"):
                        has_move = True
                else:
                    break
            if not has_move:
                stuck.append(item)
        return _render(title("Stuck projects"), [(None, [_row(i, annotations=_due_note(i.task)) for i in stuck])])
    if view == "habits":
        rows = []
        for item in narrowed(items):
            task = item.task
            if not task.habit or not _is_open(task):
                continue
            done = set()
            for other in items:
                if (
                    other.path == item.path
                    and other.task.habit
                    and other.task.state in CLOSED_STATES
                    and other.task.title == task.title
                    and other.task.completed
                ):
                    done.add(other.task.completed)
            graph = "".join("x" if add_days(today, -back) in done else "." for back in range(13, -1, -1))
            cursor = today if today in done else add_days(today, -1)
            streak = 0
            while cursor in done:
                streak += 1
                cursor = add_days(cursor, -1)
            rows.append(_row(item, annotations=[graph, "streak %d" % streak]))
        return _render(title("Habits"), [(None, rows)])
    start = date_attr("from", add_days(today, -7))
    end = date_attr("to", today)
    if view == "logbook":
        chosen = [
            (n, i)
            for n, i in enumerate(narrowed(items))
            if not _is_open(i.task) and i.task.completed is not None and start <= i.task.completed <= end
        ]
        chosen.sort(key=lambda e: (_negate_date(e[1].task.completed), e[0]))
        rows = [_row(i, annotations=[i.task.completed]) for _, i in chosen]
        return _render(title("Logbook"), [(None, rows)])
    rows = []
    total = 0
    for item in items:
        minutes = sum(
            e["minutes"]
            for e in item.task.log
            if e["type"] == "clock" and e["end"] is not None and start <= e["start"][:10] <= end
        )
        counted = any(
            e["type"] == "clock" and e["end"] is not None and start <= e["start"][:10] <= end
            for e in item.task.log
        )
        if counted:
            total += minutes
            rows.append(_row(item, annotations=[_hours(minutes)]))
    return _render(title("Clock"), [(None, rows)], footer="**Total: %s**" % _hours(total))


def _negate_date(text):
    return -_to_date(text).toordinal()


def _hours(minutes):
    return "%dh %02dm" % (minutes // 60, minutes % 60)


# --------------------------------------------------------------------------
# Agenda MD files
# --------------------------------------------------------------------------

ATTRIBUTE_RE = re.compile(r"""\s*([A-Za-z][A-Za-z-]*)=("[^"]*"|'[^']*')""")


def _parse_region_open(text):
    match = re.match(r"^\s*<!--\s*orgdown:view\s*(.*?)\s*-->\s*$", text)
    if not match:
        raise AgendaError("bad view marker")
    rest = match.group(1)
    word = re.match(r"^([^\s=]+)", rest)
    if not word:
        raise AgendaError("missing view name")
    view = word.group(1)
    rest = rest[word.end() :]
    attrs = {}
    position = 0
    while position < len(rest):
        if rest[position:].strip() == "":
            break
        found = ATTRIBUTE_RE.match(rest, position)
        if not found:
            raise AgendaError("bad attribute syntax")
        attrs[found.group(1)] = found.group(2)[1:-1]
        position = found.end()
    return view, attrs


def _validate_region(view, attrs):
    if view not in VIEWS:
        raise AgendaError("unknown view " + view)
    for name in attrs:
        if name not in VIEW_ATTRIBUTES:
            raise AgendaError("unknown attribute " + name)
    if view in ("day", "clock") and "match" in attrs:
        raise AgendaError("match is not allowed on this view")


def _find_regions(document):
    regions = []
    lines = document.lines
    index = 0
    while index < len(lines):
        line = lines[index]
        if line.region == "generated" and VIEW_OPEN_RE.match(line.s):
            close = None
            for probe in range(index + 1, len(lines)):
                if lines[probe].region == "generated" and VIEW_CLOSE_RE.match(lines[probe].s):
                    close = probe
                    break
            regions.append((index, close))
            index = (close if close is not None else len(lines)) + 1
        else:
            index += 1
    return regions


def _front_matter_sources(document):
    lines = document.lines
    if not (lines and lines[0].region == "front"):
        return None
    sources = []
    in_agenda = False
    in_sources = False
    for line in lines[1:]:
        if line.region != "front" or line.s == "---":
            break
        text = line.s
        if re.match(r"^agenda:\s*$", text):
            in_agenda, in_sources = True, False
        elif in_agenda and re.match(r"^\s+sources:\s*$", text):
            in_sources = True
        elif in_sources and re.match(r"^\s+-\s+", text):
            value = re.sub(r"^\s+-\s+", "", text).strip()
            sources.append(value[1:-1] if len(value) >= 2 and value[:1] in "\"'" and value[-1:] == value[:1] else value)
        elif text.strip() and not text.startswith(" "):
            in_agenda = in_sources = False
        elif in_sources and text.strip() and not re.match(r"^\s+-", text):
            in_sources = False
    return sources or None


def regenerate_agenda_md(path, text, files, today):
    """Regenerate every view region.  Raises AgendaError for invalid files."""
    document = Document(text, "core")
    regions = _find_regions(document)
    for open_index, close_index in regions:
        if close_index is None:
            raise AgendaError("view region not closed")
    if not regions:
        return text
    directory = path.rsplit("/", 1)[0] + "/" if "/" in path else ""
    candidates = {}
    for entry in files:
        file_path = entry["path"]
        if file_path == path or not file_path.startswith(directory):
            continue
        candidates[file_path[len(directory) :]] = entry["text"]
    sources = _front_matter_sources(document) or ["**/*.md"]
    chosen = []
    for source in sources:
        pattern = glob_to_regex(source)
        for relative in sorted(candidates):
            if pattern.match(relative) and relative not in chosen:
                chosen.append(relative)
    docs = [{"path": relative, "text": candidates[relative]} for relative in chosen]
    out = []
    cursor = 0
    for open_index, close_index in regions:
        view, attrs = _parse_region_open(document.lines[open_index].s)
        _validate_region(view, attrs)
        output = render_view(view, attrs, docs, today)
        out += [line.raw for line in document.lines[cursor : open_index + 1]]
        out += ["", output, ""]
        cursor = close_index
    out += [line.raw for line in document.lines[cursor:]]
    return "\n".join(out)


def check_agenda_md(path, text, files, today):
    """True when regenerating would change the file."""
    return regenerate_agenda_md(path, text, files, today) != text


# --------------------------------------------------------------------------
# Diagnostics
# --------------------------------------------------------------------------

INERT_KEYS = (
    "@due-time:", "@warn:", "at:", "@remind:", "@estimate:", "@priority:", "@today:", "completed:",
    "@every:", "@after:", "@repeat-on:", "@repeat-until:", "@repeat-count:", "@repeat-catch-up:", "@habit:",
)
PROSE_DATE_RE = re.compile(
    r"\b(due|by)\s+(today|tomorrow|next\s+\w+|mon(day)?|tue(s(day)?)?|wed(nesday)?|thu(rs(day)?)?|fri(day)?|"
    r"sat(urday)?|sun(day)?|jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\b",
    re.IGNORECASE,
)


def _diag(code, severity, line, message, position=0):
    return {"code": code, "severity": severity, "line": line, "message": message, "_position": position}


def _task_diagnostics(task, profile):
    out = []
    line = task.line
    for token in task.tokens:
        if token.reason == "invalid":
            out.append(_diag("OD101", "error", line, "invalid value for " + token.key, token.start))
        elif token.reason == "no-due":
            if not any(d["code"] == "OD107" for d in out):
                out.append(_diag("OD107", "error", line, "@due-time: needs a valid due:", token.start))
        elif token.reason == "orphan":
            out.append(_diag("OD201", "error", line, token.key + " has no @every: or @after:", token.start))
        elif token.reason == "weekdays-unit":
            out.append(_diag("OD202", "error", line, "@repeat-on: needs a weekly unit", token.start))
        elif token.reason == "catchup-after":
            out.append(_diag("OD203", "error", line, "@repeat-catch-up: cannot go with @after:", token.start))
        elif token.reason == "unknown" and not token.key.startswith("@x-"):
            if token.key.startswith("@"):
                out.append(_diag("OD104", "warning", line, "unknown token " + token.key, token.start))
            else:
                out.append(_diag("OD105", "warning", line, "read as a token: wrap it", token.start))
        if token.role == "shadowed":
            out.append(_diag("OD103", "warning", line, "duplicate " + token.key, token.start))
    spans = _code_spans(" ".join(task.title_words))
    position = 0
    for word in task.title_words:
        inside = any(a <= position < b for a, b in spans)
        if not inside and OPEN_RE.match(word) and word[: word.index(":") + 1] in VALIDATORS:
            out.append(_diag("OD102", "error", line, "text after a token ended the token run", position))
            break
        position += len(word) + 1
    if task.waiting_fallback and not (profile == "tasks-md" and task.section == "waiting on"):
        out.append(_diag("OD106", "error", line, "@status:waiting needs a reason"))
    if task.explicit_status is not None and not task.waiting_fallback and profile != "tasks-md":
        if task.checked != (task.explicit_status in CLOSED_STATES):
            out.append(_diag("OD108", "warning", line, "checkbox disagrees with @status:"))
    if task.completed is not None and task.state not in CLOSED_STATES:
        out.append(_diag("OD109", "warning", line, "completed: on an open line"))
    if task.priority is not None and task.state in CLOSED_STATES:
        out.append(_diag("OD111", "warning", line, "@priority: on a closed line"))
    if task.due and task.defer and task.defer > task.due:
        out.append(_diag("OD112", "warning", line, "defer: is after due:"))
    if _columns(task.indent) % 2 != 0:
        out.append(_diag("OD113", "warning", line, "odd indentation"))
    if task.project is not None:
        out.append(_diag("OD114", "warning", line, "legacy @project:"))
    if task.habit and task.recurrence is None:
        out.append(_diag("OD206", "warning", line, "@habit:yes needs a recurrence rule"))
    if task.recurrence is not None:
        if task.due is None:
            out.append(_diag("OD204", "warning", line, "repeating task has no due:"))
        if "count" in task.recurrence and "until" in task.recurrence:
            out.append(_diag("OD205", "warning", line, "@repeat-count: and @repeat-until: together"))
    return out


def _logbook_diagnostics(document):
    out = []
    running = 0
    for task in document.tasks:
        for offset in range(task.body_start, task.body_end):
            body_line = _strip_columns(document.lines[offset].s, _columns(task.indent) + 2)
            if body_line.startswith("- "):
                clock = re.fullmatch(
                    r"clock:(\d{4}-\d{2}-\d{2}T\d{2}:\d{2})/(\d{2}:\d{2}|\d{4}-\d{2}-\d{2}T\d{2}:\d{2})",
                    body_line[2:].rstrip(),
                )
                if clock and is_datetime(clock.group(1)):
                    end = clock.group(2)
                    if len(end) == 5 and is_time(end):
                        end = clock.group(1)[:10] + "T" + end
                    if is_datetime(end) and end <= clock.group(1):
                        out.append(_diag("OD301", "error", offset + 1, "clock end is not after its start"))
        for entry, entry_line in zip(task.log, task.log_lines):
            if entry["type"] == "clock" and entry["end"] is None:
                running += 1
                if running > 1:
                    out.append(_diag("OD302", "warning", entry_line + 1, "more than one running clock"))
    return out


def _region_diagnostics(document):
    out = []
    for open_index, close_index in _find_regions(document):
        line_number = open_index + 1
        try:
            view, attrs = _parse_region_open(document.lines[open_index].s)
            _validate_region(view, attrs)
        except AgendaError as error:
            out.append(_diag("OD401", "error", line_number, str(error)))
            continue
        try:
            parse_query(attrs.get("match", ""))
        except QueryError as error:
            out.append(_diag("OD402", "error", line_number, str(error)))
        if close_index is None:
            out.append(_diag("OD403", "error", line_number, "view region is not closed"))
    return out


def _tasks_md_diagnostics(document):
    out = []
    current = None
    for index, line in enumerate(document.lines):
        number = index + 1
        text = line.s
        if text.strip() == "":
            continue
        if SECTION_RE.match(text):
            if re.match(r"^##(?!#)", text):
                current = _section_name(text)
                continue
            out.append(_diag("OD602", "error", number, "the dashboard would drop this heading"))
        elif text == "# Tasks":
            continue
        elif TASK_RE.match(text) and line.kind == "task":
            if current is None:
                out.append(_diag("OD602", "error", number, "task before any ## section"))
        elif not (TASK_RE.match(text) and current is not None):
            out.append(_diag("OD602", "error", number, "the dashboard would drop this line"))
    for task in document.tasks:
        number = task.line
        inner, rest, plugin_date, is_bold = split_profile_title(task)
        if task.depth == 0 and task.tokens and not is_bold:
            out.append(_diag("OD601", "error", number, "tokens without a bold title"))
        if task.marker != "-" or task.box_char == "X" or task.depth >= 2:
            out.append(_diag("OD603", "warning", number, "the dashboard would change or flatten this"))
        if task.od604:
            out.append(_diag("OD604", "warning", number, "@status: does not fit the section"))
        if task.section == "done" and task.depth == 0 and not task.checked:
            out.append(_diag("OD605", "warning", number, "unchecked task in Done"))
        if task.due is None and PROSE_DATE_RE.search(task.title + " " + (rest or "")):
            out.append(_diag("OD606", "warning", number, "a date in prose cannot be read"))
        if (
            task.section == "waiting on"
            and task.depth == 0
            and not _valid_tokens(task, "@waiting:")
            and not rest
        ):
            out.append(_diag("OD607", "warning", number, "Waiting On task has no reason"))
    return out


def _tasks_v2_diagnostics(document):
    out = []
    for task in document.tasks:
        for token in task.tokens:
            if token.valid and token.key in INERT_KEYS:
                out.append(_diag("OD501", "warning", task.line, token.key + " is kept only as an inert extra", token.start))
            if token.valid and token.key == "@context:" and re.search(r"\s", token.parsed):
                out.append(_diag("OD502", "error", task.line, "context with whitespace", token.start))
    seen = set()
    for task in document.tasks:
        if task.id is not None:
            if task.id in seen:
                out.append(_diag("OD503", "error", task.line, "duplicate id " + task.id))
            seen.add(task.id)
    for index, line in enumerate(document.lines):
        if line.kind == "opaque" and TASK_RE.match(line.s):
            out.append(_diag("OD504", "warning", index + 1, "task-shaped text in an opaque block"))
    return out


def validate(text, profile="core"):
    document = Document(text, profile)
    out = []
    for task in document.tasks:
        out += _task_diagnostics(task, profile)
    out += _logbook_diagnostics(document)
    out += _region_diagnostics(document)
    if profile == "tasks-v2":
        out += _tasks_v2_diagnostics(document)
    if profile == "tasks-md":
        out += _tasks_md_diagnostics(document)
    out.sort(key=lambda d: (d["line"], d["code"], d["_position"]))
    for d in out:
        del d["_position"]
    return out


# --------------------------------------------------------------------------
# TASKS.md profile: writing
# --------------------------------------------------------------------------


def _rebuild_top_line(line_text, strike=None, folded=None, plugin_date_to_token=True):
    """Rewrite one top-level task line into the profile's line format."""
    parsed = parse_task_line(line_text, 1)
    parsed.indent = ""
    inner, rest, plugin_date, _ = split_profile_title(parsed)
    if folded:
        rest = "; ".join([p for p in [rest] + list(folded) if p])
    struck = re.match(r"^~~(.*)~~$", inner)
    if inner == "":
        pass
    elif strike is True and not struck:
        inner = "~~" + inner + "~~"
    elif strike is False and struck:
        inner = struck.group(1)
    tokens = [t.text for t in parsed.tokens]
    if plugin_date and plugin_date_to_token and not any(t.valid and t.key == "completed:" for t in parsed.tokens):
        tokens.append("completed:" + plugin_date)
    box = "x" if parsed.checked else " "
    tail = ([rest] if rest else []) + tokens
    trailer = [line_text[parsed.trailer_start :].strip()] if parsed.trailer_start is not None else []
    if inner == "":
        return parsed.indent + "- [" + box + "] " + " ".join(tail + trailer)
    out = parsed.indent + "- [" + box + "] **" + inner + "**"
    if tail:
        out += " - " + " ".join(tail)
    if trailer:
        out += " " + trailer[0]
    return out


def _section_insert_index(document, name):
    """Index at which to append to the named ## section, or None."""
    lines = document.lines
    for index, line in enumerate(lines):
        if line.kind == "section" and re.match(r"^##(?!#)", line.s) and _section_name(line.s) == name:
            end = len(lines)
            for probe in range(index + 1, len(lines)):
                if lines[probe].kind == "section" and re.match(r"^##(?!#)", lines[probe].s):
                    end = probe
                    break
            filled = [i for i in range(index + 1, end) if lines[i].s.strip() != ""]
            return (filled[-1] + 1) if filled else index + 1
    return None


def _splice(document, remove_range, replacements, inserts):
    """Build a new line list: drop a range, replace lines, add (index, [lines]) inserts."""
    out = []
    for index, line in enumerate(document.lines):
        for at, new in inserts:
            if at == index:
                out += new
        if remove_range and remove_range[0] <= index < remove_range[1]:
            continue
        out.append(replacements.get(index, line.raw))
    for at, new in inserts:
        if at >= len(document.lines):
            out += new
    return out


def _one_space_after_checkbox(line_text):
    return re.sub(r"^(\s*[-*+]\s+\[[ xX]\])\s+", r"\1 ", line_text)


def complete_tasks_md(text, line_number, today):
    document = Document(text, "tasks-md")
    task = _require_task(document, line_number)
    if task.depth == 0:
        rewritten = document.lines[line_number - 1]
        rewritten_text = _rebuild_top_line(rewritten.s) + ("\r" if rewritten.has_cr else "")
        lines = [line.raw for line in document.lines]
        lines[line_number - 1] = rewritten_text
        document = Document("\n".join(lines), "tasks-md")
    task = _with_source(document, _require_task(document, line_number))
    carriage = "\r" if document.lines[task.line - 1].has_cr else ""
    done_text, next_text = _complete_parts(task, today)
    if task.depth > 0:
        done_text = _one_space_after_checkbox(done_text)
        next_text = _one_space_after_checkbox(next_text) if next_text else None
        inserts = [(document.subtree_end(task), [next_text + carriage])] if next_text else []
        return "\n".join(_splice(document, None, {task.line - 1: done_text + carriage}, inserts))
    done_text = _rebuild_top_line(done_text, strike=True) + carriage
    next_text = _rebuild_top_line(next_text, strike=False) + carriage if next_text else None
    start = task.line - 1
    end = document.subtree_end(task)
    stay = "\n".join(_splice(document, None, {start: done_text}, [(end, [next_text])] if next_text else []))
    block = [done_text] + [document.lines[i].raw for i in range(start + 1, end)]
    # The next occurrence takes the place of the moved block.
    replacement = {start: next_text} if next_text else {}
    remaining = "\n".join(_splice(document, (start + (1 if next_text else 0), end), replacement, []))
    redocument = Document(remaining, "tasks-md")
    done_at = _section_insert_index(redocument, "done")
    if done_at is None:
        return stay
    return "\n".join(_splice(redocument, None, {}, [(done_at, block)]))


def reopen_tasks_md(text, line_number):
    document = Document(text, "tasks-md")
    task = _with_source(document, _require_task(document, line_number))
    reopened = reopen(text, line_number)
    if task.depth > 0:
        lines = reopened.split("\n")
        lines[line_number - 1] = _one_space_after_checkbox(lines[line_number - 1])
        return "\n".join(lines)
    redocument = Document(reopened, "tasks-md")
    retask = next(t for t in redocument.tasks if t.line == line_number)
    carriage = "\r" if redocument.lines[line_number - 1].has_cr else ""
    line_text = _rebuild_top_line(redocument.lines[line_number - 1].s, strike=False, plugin_date_to_token=False) + carriage
    start = line_number - 1
    end = redocument.subtree_end(retask)
    block = [line_text] + [redocument.lines[i].raw for i in range(start + 1, end)]
    remaining = Document("\n".join(_splice(redocument, (start, end), {}, [])), "tasks-md")
    active_at = _section_insert_index(remaining, "active")
    if active_at is None:
        lines = [line.raw for line in remaining.lines]
        filled = [i for i, line in enumerate(remaining.lines) if line.s.strip()]
        position = filled[-1] + 1 if filled else 0
        heading = ["", "## Active"] if filled else ["## Active"]
        joined = "\n".join(lines[:position] + [h + carriage for h in heading] + block + lines[position:])
        return joined if joined.endswith("\n") else joined + "\n"
    return "\n".join(_splice(remaining, None, {}, [(active_at, block)]))


def add_tasks_md(text, section, title, tokens, note=None):
    if "\n" in title or (note and "\n" in note):
        raise RefusedError("newline in title or note")
    _refuse_closed_status(tokens)
    ordered = canonical_task_line("", list(tokens))[len("- [ ] ") :].strip()
    tail = " ".join(part for part in [note or "", ordered] if part)
    if not ordered and tail and _opens_token(tail.split()[-1]):
        raise RefusedError("note ends in a token-shaped word")
    if sorted(t.text for t in parse_task_line("- [ ] " + tail, 1).tokens) != sorted(tokens):
        raise RefusedError("the note and tokens would not read back as given")
    if title == "":
        new_line = "- [ ] " + tail
    else:
        new_line = "- [ ] **%s**" % title + (" - " + tail if tail else "")
    name = section if section else "Active"
    document = Document(text, "tasks-md")
    at = _section_insert_index(document, name.lower())
    if at is not None:
        result = "\n".join(_splice(document, None, {}, [(at, [new_line])]))
        if Document(result, "tasks-md").lines[at].kind != "task":
            raise RefusedError("the insertion point is not a task context")
        return result
    lines = [line.raw for line in document.lines]
    filled = [i for i, line in enumerate(document.lines) if line.s.strip()]
    addition = ["", "## " + name, new_line] if filled else ["## " + name, new_line]
    position = filled[-1] + 1 if filled else 0
    if not filled:
        return "\n".join(addition) + "\n" if text == "" else "\n".join(addition + lines)
    result = "\n".join(lines[:position] + addition + lines[position:])
    if Document(result, "tasks-md").lines[position + len(addition) - 1].kind != "task":
        raise RefusedError("the insertion point is not a task context")
    return result


def fix_tasks_md(text):
    document = Document(text, "tasks-md")
    replacements = {}
    removed = set()
    for task in document.tasks:
        index = task.line - 1
        source = document.lines[index].s
        carriage = "\r" if document.lines[index].has_cr else ""
        if task.depth > 0:
            line = source
            if task.marker != "-" or task.box_char == "X":
                line = task.indent + "-" + source[len(task.indent) + 1 :]
                line = line[: task.box_pos] + ("x" if task.box_char == "X" else task.box_char) + line[task.box_pos + 1 :]
                replacements[index] = line + carriage
            continue
        folded = []
        for offset in range(task.body_start, task.body_end if split_profile_title(task)[0] != "" else task.body_start):
            body_line = document.lines[offset].s
            leading = body_line[: len(body_line) - len(body_line.lstrip())]
            item = re.match(r"^\s*[-*+]\s+(.*)$", body_line)
            if item and _columns(leading) // 2 == task.depth + 1 and not parse_task_line("- [ ] " + item.group(1).strip(), 1).tokens:
                folded.append(item.group(1).strip())
                removed.add(offset)
        inner, rest, plugin_date, is_bold = split_profile_title(task)
        if inner == "":
            if task.marker != "-" or task.box_char == "X" or task.indent or _rebuild_top_line(source) != source:
                replacements[index] = _rebuild_top_line(source) + carriage
                continue
            if False:
                line = "-" + source[len(task.indent) + 1 :]
                position = task.box_pos - len(task.indent)
                line = line[:position] + ("x" if task.box_char == "X" else task.box_char) + line[position + 1 :]
                replacements[index] = line + carriage
            continue
        raw_rest = re.match(r"^\*\*(.+?)\*\*(.*)$", task.core_title).group(2) if is_bold else ""
        if is_bold and task.tokens:
            separator_missing = not (raw_rest.startswith(" - ") or raw_rest == " -")
        elif is_bold:
            separator_missing = raw_rest == " -"
        else:
            separator_missing = False
        needs = (
            bool(task.indent)
            or (task.trailer_start is not None and not re.match(r" <!--", source[task.trailer_start :]))
            or re.match(r"^\s*[-*+]\s+\[.\](\s*)", source).group(1) != " "
            or task.marker != "-"
            or task.box_char == "X"
            or not is_bold
            or plugin_date is not None
            or bool(folded)
            or separator_missing
        )
        if needs:
            replacements[index] = _rebuild_top_line(source, folded=folded) + carriage
    out = []
    for index, line in enumerate(document.lines):
        if index in removed:
            continue
        out.append(replacements.get(index, line.raw))
    return "\n".join(out)


def to_core(text):
    document = Document(text, "tasks-md")
    replacements = {}
    for task in document.tasks:
        index = task.line - 1
        source = document.lines[index].s
        items = []
        for token in task.tokens:
            if token.valid and token.key in ("@status:", "@waiting:"):
                continue
            slot = "*extras*" if token.role == "extra" or token.key not in CANONICAL_ORDER else token.key
            items.append((CANONICAL_ORDER.index(slot), source[token.start : token.end]))
        if task.plugin_date and not _valid_tokens(task, "completed:"):
            items.append((CANONICAL_ORDER.index("completed:"), "completed:" + task.plugin_date))
        closed = task.state in CLOSED_STATES
        if task.state == "trash" or (not closed and task.state != "inbox"):
            items.append((CANONICAL_ORDER.index("@status:"), "@status:" + task.state))
        if task.waitingReason is not None:
            items.append((CANONICAL_ORDER.index("@waiting:"), '@waiting:"%s"' % task.waitingReason))
        items.sort(key=lambda pair: pair[0])
        title = task.title + (" - " + task.note if task.note else "")
        pieces = ([title] if title else []) + [text_ for _, text_ in items]
        box = "x" if closed else " "
        replacements[index] = task.indent + "- [" + box + "] " + " ".join(pieces)
        if document.lines[index].has_cr:
            replacements[index] += "\r"
    return "\n".join(replacements.get(i, line.raw) for i, line in enumerate(document.lines))


def from_core(text):
    document = Document(text, "core")
    warnings = 0
    in_body = set()
    for task in document.tasks:
        if task.body:
            warnings += 1
        in_body.update(range(task.body_start, task.body_end))
    for index, line in enumerate(document.lines):
        if index in in_body or line.kind == "task":
            continue
        if line.s.strip() == "":
            continue
        if line.s == "# Tasks" or (
            line.kind == "section" and line.s.strip() in ("## Active", "## Waiting On", "## Someday", "## Done")
        ):
            continue
        warnings += 1

    def level(task):
        return 0 if task.parent_index is None else level(document.tasks[task.parent_index]) + 1

    sections = {"Active": [], "Waiting On": [], "Someday": [], "Done": []}
    for task in document.tasks:
        if task.parent_index is not None:
            continue
        members = document.descendants(task)
        if any(level(m) >= 2 for m in members):
            warnings += 1
        home = {"waiting": "Waiting On", "someday": "Someday", "done": "Done", "trash": "Done"}.get(task.state, "Active")
        source = document.lines[task.line - 1].s
        tokens = []
        for token in task.tokens:
            if token.valid and token.key == "@status:":
                continue
            if token.valid and token.key == "@waiting:":
                if token.role == "field":
                    tokens.append('@waiting:"%s"' % token.parsed)
                continue
            tokens.append(source[token.start : token.end])
        if (home == "Active" and task.state != "next") or (home == "Done" and task.state == "trash"):
            tokens.insert(0, "@status:" + task.state)
        closed = task.state in CLOSED_STATES
        title = "~~%s~~" % task.title if closed else task.title
        if task.title == "":
            line = "- [%s] %s" % ("x" if closed else " ", " ".join(tokens))
        else:
            line = "- [%s] **%s**" % ("x" if closed else " ", title)
            if tokens:
                line += " - " + " ".join(tokens)
        sections[home].append(line)
        for member in members:
            member_source = document.lines[member.line - 1].s
            member_tokens = []
            for token in member.tokens:
                if token.valid and token.key == "@status:":
                    continue
                member_tokens.append(member_source[token.start : token.end])
            reads_back = "done" if member.state in CLOSED_STATES else ("next" if home == "Done" else SECTION_STATES[home.lower()][0])
            if member.state != reads_back and not (home == "Active" and member.state == "inbox"):
                member_tokens.insert(0, "@status:" + member.state)
            member_closed = member.state in CLOSED_STATES
            pieces = ([member.title] if member.title else []) + member_tokens
            sections[home].append("  - [%s] %s" % ("x" if member_closed else " ", " ".join(pieces)))
    blocks = ["# Tasks"]
    for name in ("Active", "Waiting On", "Someday", "Done"):
        blocks.append("## " + name)
        if sections[name]:
            blocks.append("\n".join(sections[name]))
    return {"text": "\n\n".join(blocks) + "\n", "warnings": warnings}


# --------------------------------------------------------------------------
# Request dispatch and the line-oriented JSON server
# --------------------------------------------------------------------------

TASK_FIELDS = (
    "title", "state", "depth", "checked", "marker", "tags", "extraTokens", "context", "project",
    "nodeKind", "energy", "waitingReason", "due", "defer", "dueTime", "warnDays", "at", "remind",
    "estimateMinutes", "priority", "today", "completed", "recurrence", "habit", "progress", "id",
    "rev", "body", "log", "note", "parent",
)


def task_to_dict(task):
    return {name: getattr(task, name) for name in TASK_FIELDS}


def handle_request(request):
    """Run one vector-shaped request and return the value its `expect` would hold."""
    op = request["op"]
    profile = request.get("profile", "core")
    try:
        if op == "parse":
            document = Document(request["input"], profile)
            return {"kinds": [line.kind for line in document.lines], "tasks": [task_to_dict(t) for t in document.tasks]}
        if op == "next":
            return next_occurrence(request["rule"], request["anchor"], request.get("completed"), request["today"])
        if op in ("complete", "trash", "skip", "reopen"):
            if profile == "tasks-md" and op == "complete":
                return complete_tasks_md(request["input"], request["line"], request["today"])
            if profile == "tasks-md" and op == "reopen":
                return reopen_tasks_md(request["input"], request["line"])
            if op == "reopen":
                return reopen(request["input"], request["line"])
            return globals()[op](request["input"], request["line"], request["today"])
        if op == "add":
            if profile == "tasks-md":
                return add_tasks_md(request["input"], request.get("section"), request["title"], request["tokens"], request.get("note"))
            return add(request["input"], request.get("section"), request["title"], request["tokens"])
        if op == "archive":
            return archive(request["input"], request["line"])
        if op == "clockIn":
            return clock_in(request["input"], request["line"], request["now"])
        if op == "clockOut":
            return clock_out(request["input"], request["line"], request["now"])
        if op == "query":
            return query(request["input"], request.get("path"), request["query"], request["today"])
        if op == "view":
            return render_view(request["view"], request.get("attrs"), request["docs"], request["today"])
        if op == "agendaMd":
            return regenerate_agenda_md(request["path"], request["input"], request["files"], request["today"])
        if op == "validate":
            return validate(request["input"], profile)
        if op == "fix":
            return fix_tasks_md(request["input"])
        if op == "toCore":
            return to_core(request["input"])
        if op == "fromCore":
            return from_core(request["input"])
        return {"crash": "unknown op %r" % (op,)}
    except RefusedError:
        return {"refused": True}
    except (QueryError, AgendaError):
        return {"error": True}


def serve(stdin, stdout):
    import json

    for raw in stdin:
        if not raw.strip():
            continue
        try:
            response = handle_request(json.loads(raw))
        except Exception as error:  # the loop must never die
            response = {"crash": "%s: %s" % (type(error).__name__, error)}
        stdout.write(json.dumps(response, ensure_ascii=False) + "\n")
        stdout.flush()


if __name__ == "__main__":
    import sys

    if "--serve" in sys.argv[1:]:
        serve(sys.stdin, sys.stdout)
    else:
        sys.stderr.write("usage: python3 -I orgdown.py --serve\n")
        sys.exit(2)
