#!/usr/bin/env node

// src/cli.ts
import { existsSync as existsSync2, readFileSync as readFileSync2, statSync as statSync2 } from "node:fs";
import { basename, dirname as dirname2, relative as relative2, resolve, sep as sep2 } from "node:path";
import { parseArgs } from "node:util";

// src/dates.ts
var DATE = /^(\d{4})-(\d{2})-(\d{2})$/;
var daysFromCivil = (year, month, day) => {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
};
var civilFromDays = (days) => {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shifted = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shifted + 2) / 5) + 1;
  const month = shifted < 10 ? shifted + 3 : shifted - 9;
  return [month <= 2 ? yearOfEra + era * 400 + 1 : yearOfEra + era * 400, month, day];
};
var lastDayOfMonth = (year, month) => {
  if (month === 2) return year % 4 === 0 && year % 100 !== 0 || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};
var isDate = (text) => {
  const match = DATE.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return month >= 1 && month <= 12 && day >= 1 && day <= lastDayOfMonth(year, month);
};
var toDays = (date) => daysFromCivil(Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10)));
var fromDays = (days) => {
  const [year, month, day] = civilFromDays(days);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};
var addDays = (date, days) => fromDays(toDays(date) + days);
var addMonths = (date, months) => {
  const [year, month, day] = civilFromDays(toDays(date));
  const zeroBased = month - 1 + months;
  const targetYear = year + Math.floor(zeroBased / 12);
  const targetMonth = zeroBased - Math.floor(zeroBased / 12) * 12 + 1;
  return fromDays(daysFromCivil(targetYear, targetMonth, Math.min(day, lastDayOfMonth(targetYear, targetMonth))));
};
var weekdayOf = (days) => ((days + 4) % 7 + 7) % 7;
var weekIndexOf = (days) => Math.floor((days + 4) / 7);
var isTime = (text) => /^([01]\d|2[0-3]):[0-5]\d$/.test(text);
var isDateTime = (text) => {
  const [date, time, ...rest] = text.split("T");
  return rest.length === 0 && date !== void 0 && time !== void 0 && isDate(date) && isTime(time);
};
var toMinutes = (dateTime) => toDays(dateTime.slice(0, 10)) * 1440 + Number(dateTime.slice(11, 13)) * 60 + Number(dateTime.slice(14, 16));

// src/model.ts
var STATES = ["inbox", "next", "in-progress", "blocked", "waiting", "someday", "done", "trash"];
var CLOSED_STATES = ["done", "trash"];
var isClosed = (state) => CLOSED_STATES.includes(state);
var RefusedError = class extends Error {
};
var AgendaError = class extends Error {
  constructor(message, code, line = 1) {
    super(message);
    this.code = code;
    this.line = line;
  }
};

// src/parse.ts
var TASK = /^(\s*)([-*+])(\s+)\[([ xX])\]\s+(.*)$/;
var SECTION = /^#{2,6}\s+\S/;
var TRAILER = /\s*<!--\s*(.*?)\s*-->\s*$/;
var OPENS_TOKEN = /^@?[a-z][a-z-]*:/i;
var TAG = /^#\p{L}[\p{L}\p{N}_/-]*$/u;
var FENCE = /^\s*(`{3,}|~{3,})/;
var REGION_OPEN = /^\s*<!--\s*orgdown:view\b/;
var REGION_CLOSE = /^\s*<!--\s*\/orgdown:view\s*-->/;
var POSITIVE = /^[1-9]\d*$/;
var WEEKDAYS = ["sun", "mon", "tue", "wed", "thu", "fri", "sat"];
var INTERVAL = /^([1-9]\d{0,3})([dwm])$/;
var UNITS = { d: "day", w: "week", m: "month" };
var stripCarriageReturn = (text) => text.endsWith("\r") ? text.slice(0, -1) : text;
var opaqueLines = (texts) => {
  const opaque = new Array(texts.length).fill(false);
  let i = 0;
  if (texts[0] !== void 0 && stripCarriageReturn(texts[0]) === "---") {
    const close2 = texts.findIndex((text, index) => index > 0 && stripCarriageReturn(text) === "---");
    if (close2 !== -1) {
      opaque.fill(true, 0, close2 + 1);
      i = close2 + 1;
    }
  }
  while (i < texts.length) {
    const text = stripCarriageReturn(texts[i]);
    const end = blockEnd(texts, i, text);
    if (end === null) {
      i += 1;
      continue;
    }
    opaque.fill(true, i, end + 1);
    i = end + 1;
  }
  return opaque;
};
var blockEnd = (texts, start, text) => {
  const last = texts.length - 1;
  const findFrom = (test) => {
    for (let j = start + 1; j <= last; j += 1) if (test(stripCarriageReturn(texts[j]))) return j;
    return last;
  };
  const fence = FENCE.exec(text);
  if (fence !== null) {
    const run = fence[1];
    const closing = new RegExp(`^\\s*\\${run.charAt(0)}{${run.length},}\\s*$`);
    return findFrom((line) => closing.test(line));
  }
  if (REGION_OPEN.test(text)) return findFrom((line) => REGION_CLOSE.test(line));
  if (/^\s*<!--/.test(text) && !text.includes("-->")) return findFrom((line) => line.includes("-->"));
  return null;
};
var depthOf = (indent) => {
  let columns = 0;
  for (const char of indent) columns += char === "	" ? 2 : 1;
  return Math.floor(columns / 2);
};
var wordsIn = (text, offset) => [...text.matchAll(/\S+/g)].map((match) => ({
  text: match[0],
  start: offset + match.index,
  end: offset + match.index + match[0].length
}));
var isBalancedQuoted = (token) => {
  const value = token.slice(token.indexOf(":") + 1);
  return value.length >= 2 && value.startsWith('"') && value.endsWith('"');
};
var splitTokenRun = (words) => {
  const run = [];
  let end = words.length;
  while (end > 0) {
    let start = end - 1;
    while (start > 0 && !OPENS_TOKEN.test(words[start].text)) start -= 1;
    if (!OPENS_TOKEN.test(words[start].text)) break;
    const parts = words.slice(start, end);
    const text = parts.map((word) => word.text).join(" ");
    if (parts.length > 1 && !isBalancedQuoted(text)) break;
    const colon = text.indexOf(":");
    run.unshift({
      text,
      key: text.slice(0, colon + 1),
      value: text.slice(colon + 1),
      start: parts[0].start,
      end: parts[parts.length - 1].end,
      isUsed: false
    });
    end = start;
  }
  return { titleWords: words.slice(0, end), run };
};
var unquote = (value) => value.length >= 2 && value.startsWith('"') && value.endsWith('"') ? value.slice(1, -1) : value;
var parseAppointment = (value) => {
  if (isDate(value) || isDateTime(value)) return { start: value };
  const [start, end, ...rest] = value.split("/");
  if (rest.length > 0 || start === void 0 || end === void 0 || !isDateTime(start)) return null;
  const fullEnd = isTime(end) ? `${start.slice(0, 10)}T${end}` : end;
  if (!isDateTime(fullEnd) || toMinutes(fullEnd) <= toMinutes(start)) return null;
  return { start, end: fullEnd };
};
var parseEstimate = (value) => {
  const match = /^([1-9]\d*)([mh])$/.exec(value);
  if (match === null) return null;
  return Number(match[1]) * (match[2] === "h" ? 60 : 1);
};
var parseWeekdays = (value) => {
  const days = value.split(",").map((name) => WEEKDAYS.indexOf(name));
  if (days.includes(-1)) return null;
  return [...new Set(days)].sort((a, b) => a - b);
};
var isCount = (value) => value === "0" || POSITIVE.test(value);
var dateField = (name) => (value, fields) => {
  if (!isDate(value)) return false;
  fields[name] = value;
  return true;
};
var SETTERS = {
  "@status:": (value, fields) => {
    if (!STATES.includes(value)) return false;
    fields.status = value;
    return true;
  },
  "@context:": (value, fields) => {
    fields.context = unquote(value);
    return true;
  },
  "@project:": (value, fields) => {
    fields.project = value;
    return true;
  },
  "@kind:": (value, fields) => {
    if (value !== "project" && value !== "single-action") return false;
    fields.nodeKind = value;
    return true;
  },
  "@energy:": (value, fields) => {
    if (!["low", "medium", "high"].includes(value)) return false;
    fields.energy = value;
    return true;
  },
  "@waiting:": (value, fields) => {
    const reason = unquote(value);
    if (reason.trim() === "") return false;
    fields.waitingReason = reason;
    return true;
  },
  "due:": dateField("due"),
  "defer:": dateField("defer"),
  "@today:": dateField("today"),
  "completed:": dateField("completed"),
  "@warn:": (value, fields) => {
    const match = /^(0|[1-9]\d*)d$/.exec(value);
    if (match === null) return false;
    fields.warnDays = Number(match[1]);
    return true;
  },
  "at:": (value, fields) => {
    const appointment = parseAppointment(value);
    if (appointment === null) return false;
    fields.at = appointment;
    return true;
  },
  "@remind:": (value, fields) => {
    if (!isDate(value) && !isDateTime(value)) return false;
    fields.remind = value;
    return true;
  },
  "@estimate:": (value, fields) => {
    const minutes = parseEstimate(value);
    if (minutes === null) return false;
    fields.estimateMinutes = minutes;
    return true;
  },
  "@priority:": (value, fields) => {
    if (!POSITIVE.test(value)) return false;
    fields.priority = Number(value);
    return true;
  },
  "@habit:": (value, fields) => {
    if (value !== "yes") return false;
    fields.habit = true;
    return true;
  }
};
var RULE_KEYS = ["@every:", "@after:", "@repeat-on:", "@repeat-until:", "@repeat-count:", "@repeat-catch-up:"];
var isRuleTokenValid = (token) => {
  if (token.key === "@every:" || token.key === "@after:") return INTERVAL.test(token.value);
  if (token.key === "@repeat-on:") return parseWeekdays(token.value) !== null;
  if (token.key === "@repeat-until:") return isDate(token.value);
  if (token.key === "@repeat-count:") return isCount(token.value);
  return token.value === "yes";
};
var readRule = (tokens) => {
  const valid = tokens.filter((token) => RULE_KEYS.includes(token.key) && isRuleTokenValid(token));
  const primary = valid.filter((token) => token.key === "@every:" || token.key === "@after:").at(-1);
  if (primary === void 0) return null;
  primary.isUsed = true;
  const match = INTERVAL.exec(primary.value);
  const rule = {
    mode: primary.key === "@every:" ? "due" : "completion",
    every: Number(match[1]),
    unit: UNITS[match[2]]
  };
  for (const token of valid) {
    if (token.key === "@every:" || token.key === "@after:") {
      token.isUsed = true;
    } else if (token.key === "@repeat-on:") {
      if (rule.unit === "week") {
        rule.weekdays = parseWeekdays(token.value);
        token.isUsed = true;
      }
    } else if (token.key === "@repeat-until:") {
      rule.until = token.value;
      token.isUsed = true;
    } else if (token.key === "@repeat-count:") {
      rule.count = Number(token.value);
      token.isUsed = true;
    } else if (rule.mode === "due") {
      rule.catchUp = true;
      token.isUsed = true;
    }
  }
  return rule;
};
var parseLogEntry = (text) => {
  const clock = /^- clock:(\S+?)\/(\S*)$/.exec(text);
  if (clock !== null) {
    const [, start, rawEnd] = clock;
    if (!isDateTime(start)) return null;
    if (rawEnd === "") return { type: "clock", start, end: null, minutes: null };
    const end = isTime(rawEnd) ? `${start.slice(0, 10)}T${rawEnd}` : rawEnd;
    if (!isDateTime(end) || toMinutes(end) <= toMinutes(start)) return null;
    return { type: "clock", start, end, minutes: toMinutes(end) - toMinutes(start) };
  }
  const state = /^- state:(\S+) from:(\S+) on:(\S+)$/.exec(text);
  if (state === null) return null;
  const [, to, from, on] = state;
  if (!STATES.includes(to) || !STATES.includes(from) || !isDateTime(on)) return null;
  return { type: "state", to, from, on };
};
var indentColumns = (text) => {
  let columns = 0;
  for (const char of text) {
    if (char === " ") columns += 1;
    else if (char === "	") columns += 2;
    else break;
  }
  return columns;
};
var stripColumns = (text, columns) => {
  let used = 0;
  let i = 0;
  for (; i < text.length; i += 1) {
    const width = text[i] === "	" ? 2 : text[i] === " " ? 1 : Infinity;
    if (used + width > columns) break;
    used += width;
  }
  return text.slice(i);
};
var readBodies = (lines, tasks) => {
  for (const task of tasks) {
    const own = indentColumns(task.indent);
    const strip = own + 2;
    const body = [];
    let i = task.line;
    let lastContent = task.line;
    for (; i < lines.length; i += 1) {
      const line = lines[i];
      const text = stripCarriageReturn(line.text);
      if (text.trim() === "") {
        if (line.kind !== "passthrough") break;
        body.push("");
        continue;
      }
      if (line.kind !== "passthrough" || indentColumns(text) <= own) break;
      body.push(stripColumns(text, strip));
      lastContent = i + 1;
    }
    task.body = body.slice(0, lastContent - task.line);
    task.bodyEnd = lastContent;
    task.log = task.body.flatMap((text) => {
      const entry2 = parseLogEntry(text);
      return entry2 === null ? [] : [entry2];
    });
  }
};
var readProgress = (tasks) => {
  for (const task of tasks) task.progress = null;
  for (const task of tasks) {
    if (task.parent === null) continue;
    const parent = tasks[task.parent - 1];
    const progress = parent.progress ??= { done: 0, total: 0 };
    progress.total += 1;
    if (isClosed(task.state)) progress.done += 1;
  }
};
var parseTask = (raw, match, lineNumber, index) => {
  const [, indent, marker, , box] = match;
  const text = stripCarriageReturn(raw);
  const bodyStart = text.length - stripCarriageReturn(match[5]).length;
  let content = text.slice(bodyStart);
  const trailerMatch = TRAILER.exec(content);
  let id = null;
  let rev = null;
  if (trailerMatch !== null) {
    content = content.slice(0, trailerMatch.index);
    for (const word of trailerMatch[1].split(/\s+/)) {
      if (word.startsWith("id:")) id = word.slice(3);
      else if (word.startsWith("rev:")) rev = word.slice(4);
    }
  }
  const { titleWords, run } = splitTokenRun(wordsIn(content, bodyStart));
  const fields = {
    status: null,
    context: null,
    project: null,
    nodeKind: null,
    energy: null,
    waitingReason: null,
    due: null,
    defer: null,
    warnDays: null,
    at: null,
    remind: null,
    estimateMinutes: null,
    priority: null,
    today: null,
    completed: null,
    habit: false
  };
  for (const token of run) {
    const setter = SETTERS[token.key];
    if (setter !== void 0) token.isUsed = setter(token.value, fields);
  }
  const recurrence = readRule(run);
  let dueTime = null;
  for (const token of run) {
    if (token.key === "@due-time:" && fields.due !== null && isTime(token.value)) {
      dueTime = token.value;
      token.isUsed = true;
    }
  }
  const checked = box !== " ";
  const fallback = checked ? "done" : "inbox";
  let state = fields.status ?? fallback;
  const extraTokens = run.filter((token) => !token.isUsed).map((token) => token.text);
  if (state === "waiting" && fields.waitingReason === null) {
    state = fallback;
    extraTokens.push("@status:waiting");
  }
  const title = titleWords.map((word) => word.text).join(" ");
  return {
    line: lineNumber,
    index,
    title,
    rawTitle: title,
    state,
    checked,
    checkChar: box,
    marker,
    indent,
    depth: depthOf(indent),
    parent: null,
    tags: readTags(title),
    extraTokens,
    tokens: run,
    context: fields.context,
    project: fields.project,
    nodeKind: fields.nodeKind,
    energy: fields.energy,
    waitingReason: fields.waitingReason,
    due: fields.due,
    defer: fields.defer,
    dueTime,
    warnDays: fields.warnDays,
    at: fields.at,
    remind: fields.remind,
    estimateMinutes: fields.estimateMinutes,
    priority: fields.priority,
    today: fields.today,
    completed: fields.completed,
    habit: fields.habit,
    progress: null,
    recurrence,
    id,
    rev,
    body: [],
    log: [],
    bodyEnd: lineNumber,
    note: "",
    section: null,
    contentEnd: bodyStart + content.length
  };
};
var readTags = (title) => {
  const words = title.replace(/`[^`]*`/g, " ").split(/\s+/);
  return [...new Set(words.filter((word) => TAG.test(word)).map((word) => word.slice(1)))];
};
var parseCore = (text, path = "", profile = "core") => {
  const texts = text.split("\n");
  const opaque = opaqueLines(texts);
  const tasks = [];
  const stack = [];
  const lines = texts.map((raw, i) => {
    if (opaque[i] === true) return { kind: "opaque", text: raw };
    const clean = stripCarriageReturn(raw);
    const match = TASK.exec(clean);
    if (match !== null) {
      const task = parseTask(raw, match, i + 1, tasks.length + 1);
      while ((stack.at(-1)?.depth ?? -1) >= task.depth) stack.pop();
      task.parent = stack.at(-1)?.index ?? null;
      stack.push(task);
      tasks.push(task);
      return { kind: "task", text: raw, task };
    }
    if (SECTION.test(clean)) {
      stack.length = 0;
      return { kind: "section", text: raw };
    }
    const kind = "passthrough";
    return { kind, text: raw };
  });
  readBodies(lines, tasks);
  readProgress(tasks);
  return { lines, tasks, profile, path };
};
var blockEndOfFence = (texts, start) => {
  const text = stripCarriageReturn(texts[start]);
  return REGION_OPEN.test(text) ? null : blockEnd(texts, start, text);
};
var opensToken = (word) => OPENS_TOKEN.test(word);

// src/query.ts
var queryError = (message) => new AgendaError(message, "OD402");
var resolveDate = (text, today) => {
  if (text === "today") return today;
  const relative3 = /^today([+-])(\d+)d$/.exec(text);
  if (relative3 !== null) return addDays(today, (relative3[1] === "+" ? 1 : -1) * Number(relative3[2]));
  if (isDate(text)) return text;
  throw queryError(`"${text}" is not a date`);
};
var splitTerms = (query) => {
  const terms = [];
  let term = "";
  let isQuoted = false;
  for (const char of query) {
    if (char === '"') isQuoted = !isQuoted;
    else if (!isQuoted && /\s/.test(char)) {
      if (term !== "") terms.push(term);
      term = "";
    } else term += char;
  }
  if (isQuoted) throw queryError("a quote is not closed");
  if (term !== "") terms.push(term);
  return terms;
};
var globToRegExp = (glob) => {
  let source = "";
  for (let i = 0; i < glob.length; i += 1) {
    const char = glob.charAt(i);
    if (char === "*" && glob[i + 1] === "*") {
      i += 1;
      if (glob[i + 1] === "/") {
        i += 1;
        source += "(?:.*/)?";
      } else source += ".*";
    } else if (char === "*") source += "[^/]*";
    else if (char === "?") source += "[^/]";
    else source += char.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${source}$`);
};
var compareDate = (field, operator, date) => {
  return (task) => {
    const value = task[field];
    if (value === null) return false;
    if (operator === "<=") return value <= date;
    if (operator === ">=") return value >= date;
    return value === date;
  };
};
var FLAGS = {
  open: () => (task) => !isClosed(task.state),
  closed: () => (task) => isClosed(task.state),
  deferred: (today) => (task) => task.defer !== null && task.defer > today,
  repeats: () => (task) => task.recurrence !== null,
  due: () => (task) => task.due !== null,
  priority: () => (task) => task.priority !== null
};
var KEYED = {
  status: (value) => {
    const states = value.split(",");
    const unknown = states.find((state) => !STATES.includes(state));
    if (unknown !== void 0) throw queryError(`"${unknown}" is not a state`);
    return (task) => states.includes(task.state);
  },
  tag: (value) => (task) => task.tags.some((tag) => tag === value || tag.startsWith(`${value}/`)),
  context: (value) => (task) => task.context?.toLowerCase() === value.toLowerCase(),
  energy: (value) => {
    if (!["low", "medium", "high"].includes(value)) throw queryError(`"${value}" is not an energy level`);
    return (task) => task.energy === value;
  },
  kind: (value) => {
    if (!["project", "single-action", "none"].includes(value)) throw queryError(`"${value}" is not a kind`);
    return (task) => value === "none" ? task.nodeKind === null : task.nodeKind === value;
  },
  title: (value) => (task) => task.title.toLowerCase().includes(value.toLowerCase()),
  file: (value) => {
    const pattern = globToRegExp(value);
    return (_task, doc) => pattern.test(doc.path);
  }
};
var parseTerm = (term, today) => {
  const flag = FLAGS[term];
  if (flag !== void 0) return flag(today);
  const priority = /^priority<=(\d+)$/.exec(term);
  if (priority !== null) {
    const limit = Number(priority[1]);
    return (task) => task.priority !== null && task.priority <= limit;
  }
  const dated = /^(due|defer|completed)(<=|>=|=)(.+)$/.exec(term);
  if (dated !== null) {
    const [, field, operator, value] = dated;
    return compareDate(field, operator, resolveDate(value, today));
  }
  const colon = term.indexOf(":");
  const keyed = colon === -1 ? void 0 : KEYED[term.slice(0, colon)];
  if (keyed === void 0) throw queryError(`"${term}" is not a query term`);
  return keyed(term.slice(colon + 1));
};
var parseQuery = (query, today) => {
  const predicates = splitTerms(query).map((term) => {
    if (!term.startsWith("-")) return parseTerm(term, today);
    const inner = parseTerm(term.slice(1), today);
    return (task, doc) => !inner(task, doc);
  });
  return (task, doc) => predicates.every((predicate) => predicate(task, doc));
};

// src/recurrence.ts
var step = (rule, anchor, base) => {
  const weekdays = rule.weekdays;
  if (weekdays !== void 0 && weekdays.length > 0) {
    const baseDay = toDays(base);
    const anchorWeek = weekIndexOf(toDays(anchor));
    for (let day = baseDay + 1; day <= baseDay + 7 * (rule.every + 1); day += 1) {
      if (!weekdays.includes(weekdayOf(day))) continue;
      if (rule.mode === "due" && (weekIndexOf(day) - anchorWeek) % rule.every !== 0) continue;
      return fromDays(day);
    }
    return null;
  }
  if (rule.unit === "day") return addDays(base, rule.every);
  if (rule.unit === "week") return addDays(base, rule.every * 7);
  return addMonths(base, rule.every);
};
var nextOccurrence = (rule, anchor, completed, today) => {
  const base = rule.mode === "due" ? anchor : completed ?? today;
  let candidate = step(rule, anchor, base);
  while (rule.catchUp === true && candidate !== null && candidate <= today) {
    candidate = step(rule, candidate, candidate);
  }
  if (candidate === null) return null;
  return rule.until !== void 0 && candidate > rule.until ? null : candidate;
};

// src/operations.ts
var CANONICAL_ORDER = [
  "@status:",
  "@context:",
  "@energy:",
  "@waiting:",
  "due:",
  "defer:",
  "@due-time:",
  "@warn:",
  "at:",
  "@remind:",
  "@estimate:",
  "@priority:",
  "@today:",
  "@every:",
  "@after:",
  "@repeat-on:",
  "@repeat-until:",
  "@repeat-count:",
  "@repeat-catch-up:",
  "@habit:",
  "completed:"
];
var keyOf = (token) => token.slice(0, token.indexOf(":") + 1);
var canonicalTokens = (tokens) => {
  const rank = (token) => {
    const key = keyOf(token);
    if (key === "@kind:") return CANONICAL_ORDER.length + 1;
    const index = CANONICAL_ORDER.indexOf(key);
    return index === -1 ? CANONICAL_ORDER.length : index;
  };
  return tokens.map((token, i) => ({ token, i })).sort((a, b) => rank(a.token) - rank(b.token) || a.i - b.i).map(({ token }) => token);
};
var applyEdits = (raw, edits) => [...edits].sort((a, b) => b.start - a.start).reduce((line, { start, end, text }) => line.slice(0, start) + text + line.slice(end), raw);
var lastUsed = (task, key) => task.tokens.filter((token) => token.key === key && token.isUsed).at(-1);
var removal = (raw, token) => {
  const before = raw[token.start - 1];
  return { start: before === " " || before === "	" ? token.start - 1 : token.start, end: token.end, text: "" };
};
var setOrAppend = (task, key, value, appended) => {
  const token = lastUsed(task, key);
  if (token !== void 0) return [{ start: token.start, end: token.end, text: key + value }];
  appended.push(key + value);
  return [];
};
var taskAt = (doc, line) => {
  const task = doc.lines[line - 1]?.task;
  if (task === void 0) throw new RefusedError(`line ${line} is not a task`);
  return task;
};
var appendEdit = (raw, task, appended) => {
  if (appended.length === 0) return [];
  const isTrailerNext = raw.slice(task.contentEnd).startsWith("<!--");
  const text = appended.map((token) => ` ${token}`).join("") + (isTrailerNext ? " " : "");
  return [{ start: task.contentEnd, end: task.contentEnd, text }];
};
var boxEdit = (raw, task, char) => {
  const open = raw.indexOf("[", task.indent.length + task.marker.length);
  return { start: open + 1, end: open + 2, text: char };
};
var lineWithEnding = (raw, newText) => raw.endsWith("\r") && !newText.endsWith("\r") ? `${newText}\r` : newText;
var subtreeEnd = (doc, task) => {
  let end = task.bodyEnd;
  for (const other of doc.tasks) {
    if (other.index <= task.index) continue;
    if (other.depth <= task.depth) break;
    const between = doc.lines.slice(task.line, other.line - 1);
    if (between.some((line) => line.kind === "section")) break;
    end = other.bodyEnd;
  }
  return end;
};
var shiftStamp = (value, days) => value.split("/").map(
  (part) => part.length >= 10 && isDate(part.slice(0, 10)) ? addDays(part.slice(0, 10), days) + part.slice(10) : part
).join("/");
var nextDue = (task, completed, today) => {
  const rule = task.recurrence;
  if (rule === null || rule.count === 0) return null;
  return nextOccurrence(rule, task.due ?? today, completed, today);
};
var occurrenceEdits = (task, next, appended) => {
  const edits = setOrAppend(task, "due:", next, appended);
  const delta = task.due === null ? null : toDays(next) - toDays(task.due);
  for (const key of ["defer:", "at:", "@remind:"]) {
    const token = lastUsed(task, key);
    if (token === void 0) continue;
    if (delta === null) continue;
    edits.push({ start: token.start, end: token.end, text: key + shiftStamp(token.value, delta) });
  }
  const count = lastUsed(task, "@repeat-count:");
  if (count !== void 0)
    edits.push({ start: count.start, end: count.end, text: `@repeat-count:${Number(count.value) - 1}` });
  return edits;
};
var nextOccurrenceLine = (raw, task, next) => {
  const appended = [];
  const edits = occurrenceEdits(task, next, appended);
  const edited = new Set(edits.map((edit2) => edit2.start));
  for (const token of task.tokens) {
    if (!token.isUsed) continue;
    if (["@priority:", "@today:", "@waiting:", "completed:"].includes(token.key)) edits.push(removal(raw, token));
    if (task.due === null && ["defer:", "at:", "@remind:"].includes(token.key) && !edited.has(token.start))
      edits.push(removal(raw, token));
  }
  const status = lastUsed(task, "@status:");
  if (task.state === "inbox") {
    for (const token of task.tokens) if (token.key === "@status:" && token.isUsed) edits.push(removal(raw, token));
  }
  if (status !== void 0 && task.state !== "inbox")
    edits.push({ start: status.start, end: status.end, text: "@status:next" });
  if (status === void 0 && task.state !== "inbox") appended.push("@status:next");
  edits.push(boxEdit(raw, task, " "));
  edits.push(...appendEdit(raw, task, appended));
  return lineWithEnding(raw, applyEdits(raw.slice(0, task.contentEnd), edits).trimEnd());
};
var complete = (doc, line, today) => {
  const task = taskAt(doc, line);
  const raw = doc.lines[line - 1]?.text;
  const next = nextDue(task, today, today);
  const appended = [];
  const status = lastUsed(task, "@status:");
  const edits = [];
  if (!task.checked) edits.push(boxEdit(raw, task, "x"));
  if (status !== void 0) edits.push({ start: status.start, end: status.end, text: "@status:done" });
  edits.push(...setOrAppend(task, "completed:", today, appended));
  for (const token of task.tokens) {
    const isDropped = token.key === "@priority:" || token.key === "@waiting:";
    const isRule = RULE_KEYS.includes(token.key) && token.isUsed;
    if (isDropped && token.isUsed || isRule) edits.push(removal(raw, token));
  }
  edits.push(...appendEdit(raw, task, appended));
  const lines = doc.lines.map((entry2) => entry2.text);
  lines[line - 1] = applyEdits(raw, edits);
  if (next !== null) lines.splice(subtreeEnd(doc, task), 0, nextOccurrenceLine(raw, task, next));
  return lines.join("\n");
};
var trash = (doc, line, today) => {
  const task = taskAt(doc, line);
  const raw = doc.lines[line - 1]?.text;
  const appended = [];
  const edits = [
    ...setOrAppend(task, "@status:", "trash", appended),
    ...setOrAppend(task, "completed:", today, appended)
  ];
  if (!task.checked) edits.push(boxEdit(raw, task, "x"));
  for (const token of task.tokens) {
    if ((token.key === "@priority:" || token.key === "@waiting:") && token.isUsed) edits.push(removal(raw, token));
  }
  edits.push(...appendEdit(raw, task, appended));
  return replaceLine(doc, line, applyEdits(raw, edits));
};
var replaceLine = (doc, line, text) => doc.lines.map((entry2, i) => i === line - 1 ? text : entry2.text).join("\n");
var reopen = (doc, line) => {
  const task = taskAt(doc, line);
  const raw = doc.lines[line - 1]?.text;
  const edits = [boxEdit(raw, task, " ")];
  for (const token of task.tokens) {
    if (token.key === "completed:") edits.push(removal(raw, token));
    if (token.key === "@status:" && token.isUsed && isClosed(token.value))
      edits.push(removal(raw, token));
  }
  return replaceLine(doc, line, applyEdits(raw, edits));
};
var skip = (doc, line, today) => {
  const task = taskAt(doc, line);
  if (task.recurrence === null) throw new RefusedError(`line ${line} doesn't repeat`);
  const next = nextDue(task, today, today);
  if (next === null) throw new RefusedError(`the series on line ${line} has ended`);
  const raw = doc.lines[line - 1]?.text;
  const appended = [];
  const edits = occurrenceEdits(task, next, appended);
  edits.push(...appendEdit(raw, task, appended));
  return replaceLine(doc, line, applyEdits(raw, edits));
};
var refuseBadTokens = (tokens) => {
  const task = parseCore(["- [ ] t", ...tokens].join(" ")).tasks[0];
  const bad = task?.extraTokens.find((token) => !token.startsWith("@x-")) ?? tokens.find((token) => !opensToken(token));
  if (bad !== void 0) throw new RefusedError(`"${bad}" is not a valid token`);
};
var add = (doc, title, tokens, section) => {
  if (title.includes("\n")) throw new RefusedError("a title cannot contain a newline");
  const lastWord = title.trim().split(/\s+/).at(-1) ?? "";
  if (opensToken(lastWord)) throw new RefusedError(`the title ends in "${lastWord}", which would be read as a token`);
  refuseBadTokens(tokens);
  if (tokens.includes("@status:done") || tokens.includes("@status:trash")) {
    throw new RefusedError("a new task cannot be closed");
  }
  return insertLine(doc, [`- [ ] ${title}`, ...canonicalTokens(tokens)].join(" "), section);
};
var insertLine = (doc, text, section) => {
  const texts = doc.lines.map((line) => line.text);
  if (texts.length === 1 && texts[0] === "") return text;
  const sectionText = (line) => stripCarriageReturn(line).replace(/^#+\s+/, "").trim();
  const start = section === void 0 ? -1 : doc.lines.findIndex((line) => line.kind === "section" && sectionText(line.text) === section);
  let end = texts.length;
  if (start !== -1) {
    const after = doc.lines.findIndex((line, i) => i > start && line.kind === "section");
    if (after !== -1) end = after;
  }
  let insertAt = end;
  while (insertAt > 0 && texts[insertAt - 1].trim() === "") insertAt -= 1;
  texts.splice(insertAt, 0, text);
  return texts.join("\n");
};
var archive = (doc, line) => {
  const task = taskAt(doc, line);
  if (!isClosed(task.state)) throw new RefusedError(`line ${line} is still open`);
  if (task.depth > 0) throw new RefusedError(`line ${line} is nested, so archive its top-level task`);
  const end = subtreeEnd(doc, task);
  const lines = doc.lines.map((entry2) => entry2.text);
  const removed = lines.splice(line - 1, end - line + 1).join("\n");
  return { text: lines.join("\n"), removed };
};
var clockLine = (task, text) => `${task.indent}  ${text}`;
var clockIn = (doc, line, now) => {
  const task = taskAt(doc, line);
  if (doc.tasks.some((other) => other.log.some((entry2) => entry2.type === "clock" && entry2.end === null))) {
    throw new RefusedError("a clock is already running");
  }
  const texts = doc.lines.map((entry2) => entry2.text);
  texts.splice(line, 0, clockLine(task, `- clock:${now}/`));
  return texts.join("\n");
};
var clockOut = (doc, line, now) => {
  const task = taskAt(doc, line);
  const offset = task.body.findIndex(
    (text) => /^- clock:\S+\/$/.test(text) && task.log.some((entry2) => entry2.type === "clock" && entry2.end === null && text === `- clock:${entry2.start}/`)
  );
  if (offset === -1) throw new RefusedError(`line ${line} has no running clock`);
  const start = task.body[offset].slice("- clock:".length, -1);
  if (toMinutes(now) <= toMinutes(start)) throw new RefusedError("the end of a clock must be after its start");
  const end = now.slice(0, 10) === start.slice(0, 10) ? now.slice(11) : now;
  const texts = doc.lines.map((entry2) => entry2.text);
  texts[line + offset] = clockLine(task, `- clock:${start}/${end}`);
  return texts.join("\n");
};

// src/tasks-md.ts
var SECTION_RULES = {
  active: { state: "next", allowed: ["inbox", "next", "in-progress", "blocked"] },
  "waiting on": { state: "waiting", allowed: ["waiting"] },
  someday: { state: "someday", allowed: ["someday"] },
  done: { state: "done", allowed: ["done", "trash"] }
};
var SECTION_ORDER = ["Active", "Waiting On", "Someday", "Done"];
var BOLD = /^\*\*(.+?)\*\*(.*)$/;
var STRUCK = /^~~(.+?)~~(?:\s*\((\d{4}-\d{2}-\d{2})\))?$/;
var HEADING = /^## \*{0,2}(.+?)\*{0,2}\s*$/;
var profileFor = (path) => {
  const name = path.split("/").at(-1);
  if (name === "TASKS.md") return "tasks-md";
  if (name === "tasks.v2.md") return "tasks-v2";
  return "core";
};
var headingOf = (text) => HEADING.exec(stripCarriageReturn(text))?.[1]?.trim() ?? null;
var titleParts = (title) => {
  const bold = BOLD.exec(title);
  const text = bold === null ? title : bold[1];
  const note = bold === null ? "" : bold[2].replace(/^\s*-\s*/, "").trim();
  const struck = STRUCK.exec(text);
  const date = struck?.[2] ?? null;
  return {
    inner: struck === null ? text : struck[1],
    note,
    isBold: bold !== null,
    isStruck: struck !== null,
    date: date !== null && isDate(date) ? date : null
  };
};
var explicitStatus = (task, rule) => {
  const value = task.tokens.filter((token) => token.key === "@status:" && token.isUsed).at(-1)?.value;
  return value === "waiting" && task.waitingReason === null && rule.state !== "waiting" ? void 0 : value;
};
var applyProfile = (task, section) => {
  task.section = section;
  const parts = titleParts(task.rawTitle);
  task.title = parts.inner;
  task.note = parts.note;
  task.tags = [.../* @__PURE__ */ new Set([...readTags(parts.inner), ...readTags(parts.note)])];
  if (parts.date !== null && task.completed === null) task.completed = parts.date;
  const rule = section === null ? void 0 : SECTION_RULES[section.toLowerCase()];
  if (rule === void 0) return;
  const explicit = explicitStatus(task, rule);
  task.extraTokens = task.extraTokens.filter(
    (token, i, all) => !(token === "@status:waiting" && i === all.length - 1 && rule.state === "waiting")
  );
  if (task.depth > 0) task.state = explicit ?? (task.checked ? "done" : rule.state === "done" ? "next" : rule.state);
  else if (task.checked) task.state = explicit === "trash" && rule.allowed.includes("trash") ? "trash" : "done";
  else task.state = explicit !== void 0 && rule.allowed.includes(explicit) ? explicit : rule.state;
  if (task.state === "waiting")
    task.waitingReason = task.waitingReason ?? (task.note !== "" ? task.note : "unspecified");
};
var parseTasksMd = (text, path = "TASKS.md") => {
  const doc = parseCore(text, path, "tasks-md");
  let section = null;
  for (const line of doc.lines) {
    if (line.kind === "section") section = headingOf(line.text) ?? section;
    if (line.task !== void 0) applyProfile(line.task, section);
  }
  readProgress(doc.tasks);
  return doc;
};
var parseAuto = (text, path) => profileFor(path) === "tasks-md" ? parseTasksMd(text, path) : parseCore(text, path, profileFor(path));
var tokensText = (task) => task.tokens.map((token) => token.text).join(" ");
var render = (checkChar, inner, note, tokens, trailer = "") => {
  const tail = [note, tokens].filter((part) => part !== "").join(" ");
  return `- [${checkChar}] **${inner}**${tail === "" ? "" : ` - ${tail}`}${trailer}`;
};
var rawInner = (rawTitle) => {
  const bold = BOLD.exec(rawTitle);
  return (bold === null ? rawTitle : bold[1]).replace(/\s*\(\d{4}-\d{2}-\d{2}\)$/, "");
};
var fixedLine = (task, extraNote, line) => {
  if (task.rawTitle === "") {
    const trailer2 = stripCarriageReturn(line).slice(task.contentEnd);
    const tail = [tokensText(task), trailer2.trim()].filter((part) => part !== "").join(" ");
    return `- [${task.checked ? "x" : " "}] ${tail}`;
  }
  const parts = titleParts(task.rawTitle);
  const note = [parts.note, ...extraNote].filter((part) => part !== "").join("; ");
  const hasCompleted = task.tokens.some((token) => token.key === "completed:");
  const completed = parts.date !== null && !hasCompleted ? `completed:${parts.date}` : "";
  const tokens = [tokensText(task), completed].filter((part) => part !== "").join(" ");
  const trailer = stripCarriageReturn(line).slice(task.contentEnd).trim();
  return render(task.checked ? "x" : " ", rawInner(task.rawTitle), note, tokens, trailer === "" ? "" : ` ${trailer}`);
};
var normalizedTask = (line) => line.replace(TASK, (_all, indent, _marker, _gap, box, rest) => `${indent}- [${box === "X" ? "x" : box}] ${rest}`);
var isNoteBullet = (line) => Math.floor(indentColumns(line) / 2) === 1 && line.trimStart().startsWith("- ");
var fix = (text) => {
  const doc = parseCore(text, "TASKS.md");
  const output = [];
  doc.lines.forEach((line, i) => {
    const task = line.task;
    if (task === void 0) {
      const owner = [...doc.tasks].reverse().find((other) => other.line <= i && i < other.bodyEnd);
      if (owner?.depth !== 0 || owner.rawTitle === "" || !isNoteBullet(line.text)) output.push(line.text);
      return;
    }
    if (task.depth > 0) {
      output.push(normalizedTask(line.text));
      return;
    }
    const noteLines = doc.lines.slice(task.line, task.bodyEnd).map((entry2) => entry2.text);
    const notes = noteLines.filter(isNoteBullet).map((text2) => text2.trim().slice(2).trim());
    output.push(fixedLine(task, notes, line.text));
  });
  return output.join("\n");
};
var lastNonBlank = (lines, from, to) => {
  let at = to;
  while (at > from && lines[at - 1].trim() === "") at -= 1;
  return at;
};
var sectionRange = (lines, name) => {
  const parsed = parseCore(lines.join("\n")).lines;
  const isHeading = (index) => parsed[index]?.kind === "section" && /^## /.test(lines[index]);
  const start = lines.findIndex((line, i) => isHeading(i) && headingOf(line)?.toLowerCase() === name);
  if (start === -1) return null;
  const next = lines.findIndex((_, i) => i > start && isHeading(i));
  return [start + 1, next === -1 ? lines.length : next];
};
var moveToSection = (lines, from, count, name) => {
  const moved = lines.slice(from, from + count);
  const without = [...lines.slice(0, from), ...lines.slice(from + count)];
  const range = sectionRange(without, name);
  if (range === null) return lines;
  without.splice(lastNonBlank(without, range[0], range[1]), 0, ...moved);
  return without;
};
var tidyLine = (line) => {
  const single = line.replace(/^(\s*-\s+\[.\])\s+(?=\S)/, "$1 ");
  const separated = single.replace(/^(\s*-\s+\[.\]\s+\*\*.+?\*\*)\s+(@?[a-z][a-z-]*:.*)$/i, "$1 - $2");
  return separated.replace(/(\*\*)\s+-\s*$/, "$1");
};
var strike = (line) => line.replace(/^(\s*-\s+\[.\]\s+\*\*)(?!~~)(.+?)(\*\*.*)$/, "$1~~$2~~$3");
var unstrike = (line) => line.replace(/^(\s*-\s+\[.\]\s+\*\*)~~(.+?)~~(\*\*.*)$/, "$1$2$3");
var close = (text, line, today, operation) => {
  const fixedLines = text.split("\n");
  const before = parseCore(text, "TASKS.md").lines[line - 1]?.task;
  if (before?.depth === 0) fixedLines[line - 1] = fixedLine(before, [], fixedLines[line - 1]);
  const doc = parseCore(fixedLines.join("\n"), "TASKS.md");
  const task = doc.lines[line - 1]?.task;
  const count = task === void 0 ? 0 : subtreeEnd(doc, task) - task.line + 1;
  const lines = operation(doc, line, today).split("\n");
  lines[line - 1] = strike(tidyLine(lines[line - 1]));
  if (lines[line - 1 + count] !== void 0) lines[line - 1 + count] = tidyLine(lines[line - 1 + count]);
  return (task?.depth === 0 ? moveToSection(lines, line - 1, count, "done") : lines).join("\n");
};
var completeTasksMd = (text, line, today) => close(text, line, today, complete);
var trashTasksMd = (text, line, today) => close(text, line, today, trash);
var reopenTasksMd = (text, line) => {
  const doc = parseCore(text, "TASKS.md");
  const task = doc.lines[line - 1]?.task;
  const count = task === void 0 ? 0 : subtreeEnd(doc, task) - task.line + 1;
  const lines = reopen(doc, line).split("\n");
  lines[line - 1] = tidyLine(unstrike(lines[line - 1]));
  return (task?.depth === 0 ? moveToSection(lines, line - 1, count, "active") : lines).join("\n");
};
var addTasksMd = (text, title, tokens, section = "Active", note = "") => {
  if (title.includes("\n") || note.includes("\n")) throw new RefusedError("a title cannot contain a newline");
  refuseBadTokens(tokens);
  const lastWord = note.trim().split(/\s+/).at(-1) ?? "";
  if (tokens.length === 0 && opensToken(lastWord)) {
    throw new RefusedError(`the note ends in "${lastWord}", which would be read as a token`);
  }
  const row2 = render(" ", title, note, canonicalTokens(tokens).join(" "));
  const doc = parseCore(text, "TASKS.md");
  if (doc.lines.some((line) => line.kind === "section" && headingOf(line.text) === section)) {
    return insertLine(doc, row2, section);
  }
  return `${text.trimEnd()}${text.trim() === "" ? "" : "\n\n"}## ${section}
${row2}
`;
};
var carriedTokens = (task) => task.tokens.filter((token) => token.key !== "@status:").map((token) => token.text);
var toCore = (text) => {
  const doc = parseTasksMd(text);
  return doc.lines.map((line) => {
    const task = line.task;
    if (task === void 0) return line.text;
    const tokens = carriedTokens(task).filter((token) => !token.startsWith("@waiting:"));
    if (task.completed !== null && !tokens.some((token) => token.startsWith("completed:")))
      tokens.push(`completed:${task.completed}`);
    const isDefault = task.state === (isClosed(task.state) ? "done" : "inbox");
    if (!isDefault) tokens.push(`@status:${task.state}`);
    if (task.waitingReason !== null) tokens.push(`@waiting:"${task.waitingReason}"`);
    const title = task.note === "" ? task.title : `${task.title} - ${task.note}`;
    return [`${task.indent}- [${isClosed(task.state) ? "x" : " "}] ${title}`, ...canonicalTokens(tokens)].join(" ");
  }).join("\n");
};
var sectionFor = (state) => {
  if (state === "waiting") return "Waiting On";
  if (state === "someday") return "Someday";
  return isClosed(state) ? "Done" : "Active";
};
var rootStatus = (state) => {
  const isImplied = state === "next" || state === "waiting" || state === "someday" || state === "done";
  return isImplied ? [] : [`@status:${state}`];
};
var subLine = (task) => {
  const status = ["inbox", "next", "done"].includes(task.state) ? [] : [`@status:${task.state}`];
  const tokens = canonicalTokens([...carriedTokens(task), ...status]);
  return [`  - [${isClosed(task.state) ? "x" : " "}] ${task.rawTitle}`, ...tokens].join(" ");
};
var fromCore = (text) => {
  const doc = parseCore(text, "tasks.md");
  const warnings = [];
  const sections = new Map(SECTION_ORDER.map((name) => [name, []]));
  const bodyLines = new Set(doc.tasks.flatMap((task) => task.body.map((_, i) => task.line + i)));
  let root = null;
  let warnedRoot = null;
  for (const task of doc.tasks) {
    if (task.body.length > 0) warnings.push(`line ${task.line}: the notes under "${task.title}" were dropped`);
    if (task.parent === null) {
      root = task;
      const tokens = canonicalTokens([...carriedTokens(task), ...rootStatus(task.state)]).join(" ");
      const inner = isClosed(task.state) ? `~~${task.title}~~` : task.title;
      sections.get(sectionFor(task.state))?.push(render(isClosed(task.state) ? "x" : " ", inner, "", tokens));
      continue;
    }
    if (task.depth > 1 && warnedRoot !== root) {
      warnedRoot = root;
      warnings.push(`line ${task.line}: subtasks under "${root?.title}" were flattened to one level`);
    }
    sections.get(sectionFor(root.state))?.push(subLine(task));
  }
  doc.lines.forEach((line, i) => {
    const isTemplate = line.text === "# Tasks" || SECTION_ORDER.includes(headingOf(line.text) ?? "");
    if (line.kind !== "task" && line.text.trim() !== "" && !bodyLines.has(i) && !isTemplate)
      warnings.push(`line ${i + 1}: "${line.text.trim()}" was dropped`);
  });
  const body = SECTION_ORDER.map((name) => {
    const rows = sections.get(name);
    return rows.length === 0 ? `## ${name}` : `## ${name}

${rows.join("\n")}`;
  });
  return { text: `# Tasks

${body.join("\n\n")}
`, warnings };
};

// src/agenda.ts
var VIEWS = ["day", "week", "list", "next", "waiting", "stuck", "logbook", "clock", "habits"];
var ATTRIBUTES = ["title", "match", "sort", "start", "days", "from", "to"];
var SORT_KEYS = ["due", "defer", "priority", "title", "file"];
var WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
var HIGH_PRIORITY_CAP = 5;
var DEFAULT_WARN_DAYS = 1;
var itemsOf = (docs) => docs.flatMap((doc) => doc.tasks.map((task) => ({ task, doc })));
var row = ({ task, doc }, annotations = [], prefix = "") => {
  const suffix = annotations.length === 0 ? "" : ` \u2014 ${annotations.join(" \xB7 ")}`;
  const location = `[${doc.path}:${task.line}](${doc.path.replaceAll(" ", "%20")})`;
  const title = prefix === "" ? task.title.replace(/^(\[[ xX]\])(?=\s|$)/, "\\$1") : task.title;
  return `- ${prefix}${title}${suffix} (${location})`;
};
var dueNote = (task) => task.due === null ? [] : [`due ${task.due}`];
var byDue = (a, b) => {
  if (a.task.due === b.task.due) return 0;
  if (a.task.due === null) return 1;
  if (b.task.due === null) return -1;
  return a.task.due < b.task.due ? -1 : 1;
};
var dayOf = (stamp) => stamp.slice(0, 10);
var coversDay = (at, day) => dayOf(at.start) <= day && day <= dayOf(at.end ?? at.start);
var timeLabel = (at, day) => {
  if (at.start.length === 10 || dayOf(at.start) !== day) return null;
  const start = at.start.slice(11);
  return at.end !== void 0 && dayOf(at.end) === day ? `${start}\u2013${at.end.slice(11)}` : start;
};
var scheduleRows = (items, day) => {
  const entries = items.flatMap((item) => {
    const at = item.task.at;
    if (at === null || isClosed(item.task.state) || !coversDay(at, day)) return [];
    return [{ item, label: timeLabel(at, day) }];
  });
  const sorted2 = [...entries].sort((a, b) => {
    if (a.label === null || b.label === null) return (a.label === null ? 0 : 1) - (b.label === null ? 0 : 1);
    return a.label.slice(0, 5) < b.label.slice(0, 5) ? -1 : a.label.slice(0, 5) > b.label.slice(0, 5) ? 1 : 0;
  });
  return {
    rows: sorted2.map(({ item, label }) => row(item, [], label === null ? "" : `${label} `)),
    used: new Set(sorted2.map(({ item }) => item.task))
  };
};
var isInWarning = (task, today) => {
  if (task.due === null) return false;
  return toDays(task.due) - (task.warnDays ?? DEFAULT_WARN_DAYS) <= toDays(today);
};
var isOnDay = (task, today) => !isClosed(task.state) && (isInWarning(task, today) || task.defer !== null && task.defer <= today || task.today === today || task.priority !== null);
var dayGroups = (items, today) => {
  const { rows: schedule, used } = scheduleRows(items, today);
  const onDay = items.filter(({ task }) => !used.has(task) && isOnDay(task, today));
  const ranked = onDay.filter(({ task }) => task.priority !== null).sort((a, b) => a.task.priority - b.task.priority);
  const top = new Set(ranked.slice(0, HIGH_PRIORITY_CAP).map(({ task }) => task));
  const highPriority = ranked.slice(0, HIGH_PRIORITY_CAP).map((item) => row(item, [`#${item.task.priority}`, ...dueNote(item.task)]));
  const rest = onDay.filter(({ task }) => !top.has(task));
  const overdue = rest.filter(({ task }) => task.due !== null && task.due < today).sort(byDue);
  const upcoming = rest.filter(({ task }) => task.due !== null && task.due >= today && isInWarning(task, today)).sort(byDue);
  const placed = new Set([...overdue, ...upcoming].map(({ task }) => task));
  const dueLabel = ({ task }) => [
    task.due === today ? "due today" : `due ${task.due}`,
    ...task.dueTime === null ? [] : [task.dueTime]
  ];
  return [
    ["Schedule", schedule],
    ["High priority", highPriority],
    [
      "Overdue",
      overdue.map(
        (item) => row(item, [`due ${item.task.due}`, `${toDays(today) - toDays(item.task.due)}d late`])
      )
    ],
    ["Due", upcoming.map((item) => row(item, dueLabel(item)))],
    ["Today", rest.filter(({ task }) => !placed.has(task)).map((item) => row(item))]
  ];
};
var weekGroups = (items, start, days) => {
  const live = items.filter(({ task }) => !isClosed(task.state));
  const groups = [];
  for (let offset = 0; offset < days; offset += 1) {
    const day = addDays(start, offset);
    const due = live.filter(({ task }) => task.due === day).map((item) => row(item, ["due", ...item.task.dueTime === null ? [] : [item.task.dueTime]]));
    const arriving = live.filter(({ task }) => task.defer === day).map((item) => row(item, ["arrives"]));
    const heading = `${day} ${WEEKDAY_NAMES[weekdayOf(toDays(day))]}`;
    groups.push([heading, [...scheduleRows(live, day).rows, ...due, ...arriving]]);
  }
  return groups;
};
var nextGroups = (items) => {
  const byContext = /* @__PURE__ */ new Map();
  const none = [];
  for (const item of items) {
    const context = item.task.context;
    if (context === null) {
      none.push(row(item, dueNote(item.task)));
      continue;
    }
    const key = context.toLowerCase();
    const group = byContext.get(key) ?? { name: context, rows: [] };
    group.rows.push(row(item, dueNote(item.task)));
    byContext.set(key, group);
  }
  const groups = [...byContext.entries()].sort(([a], [b]) => a < b ? -1 : 1).map(([, group]) => [group.name, group.rows]);
  groups.push(["No context", none]);
  return groups;
};
var descendantsOf = (doc, task) => {
  const found = /* @__PURE__ */ new Set([task.index]);
  return doc.tasks.filter((other) => {
    if (other.parent === null || !found.has(other.parent)) return false;
    found.add(other.index);
    return true;
  });
};
var isStuck = ({ task, doc }) => task.nodeKind === "project" && !isClosed(task.state) && !descendantsOf(doc, task).some((other) => other.state === "next" || other.state === "in-progress");
var formatMinutes = (minutes) => `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;
var clockRows = (items, from, to) => {
  let total = 0;
  const rows = items.flatMap((item) => {
    let minutes = 0;
    for (const entry2 of item.task.log) {
      if (entry2.type === "clock" && entry2.minutes !== null && dayOf(entry2.start) >= from && dayOf(entry2.start) <= to)
        minutes += entry2.minutes;
    }
    total += minutes;
    return minutes === 0 ? [] : [row(item, [formatMinutes(minutes)])];
  });
  return rows.length === 0 ? [] : [...rows, "", `**Total: ${formatMinutes(total)}**`];
};
var HABIT_WINDOW_DAYS = 14;
var MAX_WEEK_DAYS = 366;
var habitRow = (item, today) => {
  const { task, doc } = item;
  if (!task.habit || isClosed(task.state)) return [];
  const days = new Set(
    doc.tasks.flatMap(
      (other) => other.habit && other.title === task.title && isClosed(other.state) && other.completed !== null ? [other.completed] : []
    )
  );
  const graph = Array.from(
    { length: HABIT_WINDOW_DAYS },
    (_, i) => days.has(addDays(today, i - HABIT_WINDOW_DAYS + 1)) ? "x" : "."
  ).join("");
  let day = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day = addDays(day, -1);
  }
  return [row(item, [graph, `streak ${streak}`])];
};
var sortItems = (items, sort) => {
  if (sort === void 0) return [...items];
  const keys = sort.split(",");
  const valueOf = (item, key) => {
    if (key === "file") return item.doc.path;
    return item.task[key];
  };
  return [...items].sort((a, b) => {
    for (const key of keys) {
      const [left, right] = [valueOf(a, key), valueOf(b, key)];
      if (left === right) continue;
      if (left === null) return 1;
      if (right === null) return -1;
      return left < right ? -1 : 1;
    }
    return 0;
  });
};
var DEFAULT_TITLES = {
  day: (today) => `Today (${today})`,
  week: (_today, start) => `Week of ${start}`,
  list: () => "Tasks",
  next: () => "Next actions",
  waiting: () => "Waiting",
  stuck: () => "Stuck projects",
  logbook: () => "Logbook",
  clock: () => "Clock",
  habits: () => "Habits"
};
var present = (title, groups, flat) => {
  const parts = [`## ${title}`];
  if (flat.length > 0) parts.push(flat.join("\n"));
  for (const [heading, rows] of groups) if (rows.length > 0) parts.push(`### ${heading}`, rows.join("\n"));
  if (parts.length === 1) parts.push("Nothing here.");
  return parts.join("\n\n");
};
var checkView = (view, attrs, today, line = 1) => {
  if (!VIEWS.includes(view)) throw new AgendaError(`"${view}" is not a view`, "OD401", line);
  for (const name of Object.keys(attrs)) {
    const isBanned = name === "match" && (view === "day" || view === "clock");
    if (!ATTRIBUTES.includes(name) || isBanned)
      throw new AgendaError(`"${name}" is not an attribute of ${view}`, "OD401", line);
  }
  const badSort = attrs["sort"]?.split(",").find((key) => !SORT_KEYS.includes(key));
  if (badSort !== void 0) throw new AgendaError(`"${badSort}" is not a sort key`, "OD401", line);
  const days = attrs["days"];
  if (days !== void 0 && (!/^[1-9]\d{0,2}$/.test(days) || Number(days) > MAX_WEEK_DAYS))
    throw new AgendaError(`days must be 1 to ${MAX_WEEK_DAYS}`, "OD401", line);
  try {
    parseQuery(attrs["match"] ?? "", today);
    for (const name of ["start", "from", "to"]) if (attrs[name] !== void 0) resolveDate(attrs[name], today);
  } catch (error) {
    throw new AgendaError(error.message, "OD402", line);
  }
};
var renderView = (view, attrs, docs, today) => {
  checkView(view, attrs, today);
  const matches = parseQuery(attrs["match"] ?? "", today);
  const items = itemsOf(docs);
  const matched = items.filter(({ task, doc }) => matches(task, doc));
  const open = parseQuery("open", today);
  const start = resolveDate(attrs["start"] ?? "today", today);
  const title = attrs["title"] ?? DEFAULT_TITLES[view](today, start);
  const from = resolveDate(attrs["from"] ?? "today-7d", today);
  const to = resolveDate(attrs["to"] ?? "today", today);
  if (view === "day") return present(title, dayGroups(items, today), []);
  if (view === "week") return present(title, weekGroups(matched, start, Number(attrs["days"] ?? 7)), []);
  if (view === "next") {
    const actionable = parseQuery("status:next -deferred", today);
    return present(title, nextGroups(matched.filter(({ task, doc }) => actionable(task, doc))), []);
  }
  if (view === "waiting") {
    const waiting = matched.filter(({ task }) => task.state === "waiting").sort(byDue);
    return present(
      title,
      [],
      waiting.map((item) => row(item, [item.task.waitingReason, ...dueNote(item.task)]))
    );
  }
  if (view === "stuck") {
    return present(
      title,
      [],
      sortItems(
        matched.filter((item) => isStuck(item) && open(item.task, item.doc)),
        attrs["sort"]
      ).map((item) => row(item, dueNote(item.task)))
    );
  }
  if (view === "logbook") {
    const closed = matched.filter(
      ({ task }) => isClosed(task.state) && task.completed !== null && task.completed >= from && task.completed <= to
    );
    const newestFirst = [...closed].sort(
      (a, b) => a.task.completed < b.task.completed ? 1 : a.task.completed === b.task.completed ? 0 : -1
    );
    return present(
      title,
      [],
      newestFirst.map((item) => row(item, [item.task.completed]))
    );
  }
  if (view === "clock") return present(title, [], clockRows(items, from, to));
  if (view === "habits")
    return present(
      title,
      [],
      matched.flatMap((item) => habitRow(item, today))
    );
  return present(
    title,
    [],
    sortItems(matched, attrs["sort"]).map((item) => row(item, dueNote(item.task)))
  );
};
var REGION_OPEN2 = /^\s*<!--\s*orgdown:view\b/;
var REGION_CLOSE2 = /^\s*<!--\s*\/orgdown:view\s*-->/;
var REGION_HEAD = /^\s*<!--\s*orgdown:view\s+(\S+)((?:\s+[a-z]+=(?:"[^"]*"|'[^']*'))*)\s*-->\s*$/;
var findRegions = (text) => {
  const lines = text.split("\n");
  const regions = [];
  for (let i = 0; i < lines.length; i += 1) {
    const fenceEnd = blockEndOfFence(lines, i);
    if (fenceEnd !== null) {
      i = fenceEnd;
      continue;
    }
    const line = stripCarriageReturn(lines[i]);
    if (!REGION_OPEN2.test(line)) continue;
    const head = REGION_HEAD.exec(line);
    if (head === null) throw new AgendaError("a view region opening is malformed", "OD401", i + 1);
    const close2 = lines.findIndex((other, j) => j > i && REGION_CLOSE2.test(other));
    if (close2 === -1) throw new AgendaError("a view region is not closed", "OD403", i + 1);
    const attrs = {};
    for (const match of head[2].matchAll(/([a-z]+)=(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[match[1]] = match[2] ?? match[3];
    }
    regions.push({ open: i, close: close2, view: head[1], attrs });
    i = close2;
  }
  return regions;
};
var readSources = (text) => {
  const lines = text.split("\n").map(stripCarriageReturn);
  const close2 = lines.findIndex((line, i) => i > 0 && line === "---");
  if (lines[0] !== "---" || close2 === -1) return ["**/*.md"];
  const agenda = lines.findIndex((line, i) => i < close2 && /^agenda:\s*$/.test(line));
  if (agenda === -1) return ["**/*.md"];
  const blockEnd2 = lines.findIndex((line, i) => i > agenda && (i === close2 || /^\S/.test(line)));
  const start = lines.findIndex((line, i) => i > agenda && i < blockEnd2 && /^\s+sources:\s*$/.test(line));
  if (start === -1) return ["**/*.md"];
  const sources = [];
  for (const line of lines.slice(start + 1, blockEnd2)) {
    const item = /^\s+-\s+(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/.exec(line);
    if (item === null) break;
    sources.push(item[1] ?? item[2] ?? item[3]);
  }
  return sources.length === 0 ? ["**/*.md"] : sources;
};
var selectSources = (text, path, files) => {
  const picked = /* @__PURE__ */ new Map();
  for (const glob of readSources(text)) {
    const pattern = globToRegExp(glob);
    const matching = files.filter((file) => pattern.test(file.path) && file.path !== path);
    for (const file of [...matching].sort((a, b) => a.path < b.path ? -1 : 1))
      picked.set(file.path, picked.get(file.path) ?? file);
  }
  return [...picked.values()];
};
var regenerate = (text, path, files, today) => {
  const regions = findRegions(text);
  for (const region of regions) checkView(region.view, region.attrs, today, region.open + 1);
  const docs = selectSources(text, path, files).map((file) => parseAuto(file.text, file.path));
  const lines = text.split("\n");
  for (const region of [...regions].reverse()) {
    const output = renderView(region.view, region.attrs, docs, today);
    lines.splice(region.open + 1, region.close - region.open - 1, "", ...output.split("\n"), "");
  }
  return lines.join("\n");
};

// src/diagnostics.ts
var CORE_KEYS = ["@status:", "@context:", "@project:", "@kind:", "@energy:", "@waiting:", "due:", "defer:"];
var PLANNING_KEYS = [
  "@habit:",
  "@due-time:",
  "@warn:",
  "at:",
  "@remind:",
  "@estimate:",
  "@priority:",
  "@today:",
  "completed:"
];
var KNOWN_KEYS = [...CORE_KEYS, ...PLANNING_KEYS, ...RULE_KEYS];
var PROSE_DATE = /\b(?:due|by)\s+(?:today|tomorrow|next\s+\w+|mon(?:day)?|tue(?:s(?:day)?)?|wed(?:nesday)?|thu(?:rs(?:day)?)?|fri(?:day)?|sat(?:urday)?|sun(?:day)?|jan\w*|feb\w*|mar\w*|apr\w*|may|jun\w*|jul\w*|aug\w*|sep\w*|oct\w*|nov\w*|dec\w*)\b/i;
var SEVERITIES = {
  OD101: "error",
  OD102: "error",
  OD103: "warning",
  OD104: "warning",
  OD105: "warning",
  OD106: "error",
  OD107: "error",
  OD108: "warning",
  OD109: "warning",
  OD111: "warning",
  OD112: "warning",
  OD113: "warning",
  OD114: "warning",
  OD201: "error",
  OD202: "error",
  OD203: "error",
  OD204: "warning",
  OD205: "warning",
  OD206: "warning",
  OD301: "error",
  OD302: "warning",
  OD401: "error",
  OD402: "error",
  OD403: "error",
  OD501: "warning",
  OD502: "error",
  OD503: "error",
  OD504: "warning",
  OD601: "error",
  OD602: "error",
  OD603: "warning",
  OD604: "warning",
  OD605: "warning",
  OD606: "warning",
  OD607: "warning"
};
var diagnostic = (code, line, message) => ({
  code,
  severity: SEVERITIES[code],
  line,
  message
});
var isPrimaryRuleKey = (key) => key === "@every:" || key === "@after:";
var isShadowed = (task, token) => {
  const sameKey = (other) => other.isUsed && (other.key === token.key || isPrimaryRuleKey(other.key) && isPrimaryRuleKey(token.key));
  return task.tokens.filter(sameKey).at(-1) !== token;
};
var extraDiagnostic = (task, token) => {
  const isRepeat = token.key.startsWith("@repeat-");
  if (token.key === "@due-time:") {
    if (isTime(token.value) && task.due === null) {
      const isLast = task.tokens.filter(({ key, value }) => key === token.key && isTime(value)).at(-1) === token;
      return isLast ? ["OD107", `"${token.text}" needs a valid due:`] : null;
    }
    return ["OD101", `"${token.text}" is not a valid value`];
  }
  if (RULE_KEYS.includes(token.key) && !isRuleTokenValid(token)) {
    return ["OD101", `"${token.text}" is not a valid value`];
  }
  if (isRepeat && task.recurrence === null) return ["OD201", `${token.key} needs a valid @every: or @after:`];
  if (token.key === "@repeat-on:") return ["OD202", "@repeat-on: only works with a unit of w"];
  if (token.key === "@repeat-catch-up:") return ["OD203", "@repeat-catch-up: only works with @every:"];
  if (KNOWN_KEYS.includes(token.key)) return ["OD101", `"${token.text}" is not a valid value`];
  if (token.key.startsWith("@x-")) return null;
  if (token.key.startsWith("@")) return ["OD104", `"${token.text}" is an unknown token`];
  return ["OD105", `"${token.text}" was read as a token, not title text. Wrap it in <> or code`];
};
var tokenDiagnostics = (task) => task.tokens.flatMap((token) => {
  if (!token.isUsed) {
    const reason = extraDiagnostic(task, token);
    return reason === null ? [] : [diagnostic(reason[0], task.line, reason[1])];
  }
  const found = [];
  if (isShadowed(task, token)) {
    found.push(diagnostic("OD103", task.line, `a later token replaces "${token.text}"`));
  }
  if (token.key === "@project:" && !isShadowed(task, token)) {
    found.push(diagnostic("OD114", task.line, "nest under an @kind:project task instead of @project:"));
  }
  return found;
});
var taskDiagnostics = (task) => {
  const found = tokenDiagnostics(task);
  const add2 = (code, message) => void found.push(diagnostic(code, task.line, message));
  const titleWords = task.rawTitle.split(/\s+/);
  if (titleWords.some((word) => opensToken(word) && KNOWN_KEYS.includes(word.slice(0, word.indexOf(":") + 1)))) {
    add2("OD102", "text after a token ended the token run, so the tokens before it are title text");
  }
  if (task.extraTokens.at(-1) === "@status:waiting" && !task.tokens.some((token) => !token.isUsed && token.text === "@status:waiting")) {
    add2("OD106", "@status:waiting needs a reason in @waiting:");
  }
  if (isClosed(task.state) !== task.checked) add2("OD108", "the checkbox disagrees with @status:");
  if (task.completed !== null && !isClosed(task.state)) add2("OD109", "completed: has no effect on an open line");
  if (task.priority !== null && isClosed(task.state)) add2("OD111", "@priority: has no effect on a closed line");
  if (task.defer !== null && task.due !== null && task.defer > task.due) add2("OD112", "defer: is after due:");
  if (indentColumns(task.indent) % 2 !== 0) add2("OD113", "indentation is not a multiple of 2 columns");
  if (task.recurrence !== null && task.due === null)
    add2("OD204", "a repeating task with no due: anchors on the completion day");
  if (task.recurrence?.count !== void 0 && task.recurrence.until !== void 0)
    add2("OD205", "whichever of @repeat-count: and @repeat-until: ends first wins");
  if (task.habit && task.recurrence === null) add2("OD206", "a habit needs a recurrence rule");
  return found;
};
var logDiagnostics = (doc) => {
  const found = [];
  let runningClocks = 0;
  for (const task of doc.tasks) {
    task.body.forEach((text, i) => {
      const clock = /^- clock:(\S+?)\/(\S+)$/.exec(text);
      if (clock === null || !isDateTime(clock[1])) return;
      const start = clock[1];
      const end = isTime(clock[2]) ? `${start.slice(0, 10)}T${clock[2]}` : clock[2];
      if (isDateTime(end) && toMinutes(end) <= toMinutes(start))
        found.push(diagnostic("OD301", task.line + i + 1, "a clock's end must be after its start"));
    });
    task.log.forEach((entry2) => {
      if (entry2.type !== "clock" || entry2.end !== null) return;
      runningClocks += 1;
      if (runningClocks > 1)
        found.push(
          diagnostic(
            "OD302",
            task.line + task.body.findIndex((text) => text === `- clock:${entry2.start}/`) + 1,
            "more than one clock is running"
          )
        );
    });
  }
  return found;
};
var regionDiagnostics = (text) => {
  try {
    const found = [];
    for (const region of findRegions(text)) {
      try {
        checkView(region.view, region.attrs, "2000-01-01", region.open + 1);
      } catch (error) {
        const failure = error;
        found.push(diagnostic(failure.code, failure.line, failure.message));
      }
    }
    return found;
  } catch (error) {
    const failure = error;
    return [diagnostic(failure.code, failure.line, failure.message)];
  }
};
var tasksV2Diagnostics = (doc) => {
  const found = [];
  const seen = /* @__PURE__ */ new Set();
  doc.lines.forEach((line, i) => {
    const task = line.task;
    if (line.kind === "opaque" && TASK.test(stripCarriageReturn(line.text)))
      found.push(diagnostic("OD504", i + 1, "the current codec reads this as a task"));
    if (task === void 0) return;
    for (const token of task.tokens) {
      const isValidRuleToken = RULE_KEYS.includes(token.key) && isRuleTokenValid(token);
      const isValidDueTime = token.key === "@due-time:" && isTime(token.value);
      if ((token.isUsed || isValidRuleToken || isValidDueTime) && !CORE_KEYS.includes(token.key))
        found.push(diagnostic("OD501", i + 1, `${token.key} is inert until the codec reads it`));
      if (token.key === "@context:" && /\s/.test(token.value))
        found.push(diagnostic("OD502", i + 1, "the current codec can't read back a context with a space"));
    }
    if (task.id !== null && seen.has(task.id)) found.push(diagnostic("OD503", i + 1, `id ${task.id} appears twice`));
    if (task.id !== null) seen.add(task.id);
  });
  return found;
};
var tasksMdTaskDiagnostics = (task, firstHeading) => {
  const found = [];
  const add2 = (code, message) => void found.push(diagnostic(code, task.line, message));
  if (task.marker !== "-" || task.checkChar === "X" || task.depth > 1) {
    add2("OD603", "the dashboard rewrites this marker, or flattens this subtask");
  }
  if (task.line < firstHeading) add2("OD602", "the dashboard drops a task before the first ## section");
  if (task.depth > 0) return found;
  if (!titleParts(task.rawTitle).isBold && task.tokens.length > 0)
    add2("OD601", "without a bold title, the dashboard pulls tokens into the title");
  const rule = SECTION_RULES[task.section?.toLowerCase() ?? ""];
  const explicit = rule === void 0 ? void 0 : explicitStatus(task, rule);
  if (explicit !== void 0 && explicit !== task.state)
    add2("OD604", "this @status: does not fit the section, so the section wins");
  if (rule?.state === "done" && !task.checked) add2("OD605", "an unchecked task in Done");
  if (task.due === null && PROSE_DATE.test(`${task.title} ${task.note}`))
    add2("OD606", "this date is prose. Use a due: token");
  const hasReason = task.tokens.some((token) => token.key === "@waiting:" && token.isUsed);
  if (rule?.state === "waiting" && task.note === "" && !hasReason) add2("OD607", "say who or what this is waiting on");
  return found;
};
var tasksMdDiagnostics = (doc) => {
  const heading = doc.lines.findIndex((line) => headingOf(line.text) !== null);
  const firstHeading = heading === -1 ? Infinity : heading + 1;
  const found = doc.tasks.flatMap((task) => tasksMdTaskDiagnostics(task, firstHeading));
  doc.lines.forEach((line, i) => {
    const text = stripCarriageReturn(line.text);
    if (line.task !== void 0 || text.trim() === "" || text === "# Tasks" || headingOf(text) !== null) return;
    if (i + 1 > firstHeading && TASK.test(text)) return;
    found.push(diagnostic("OD602", i + 1, "the dashboard drops this line on save"));
  });
  return found;
};
var sorted = (found) => found.sort((a, b) => a.line - b.line || (a.code < b.code ? -1 : a.code > b.code ? 1 : 0));
var validate = (text, path, profile = profileFor(path)) => {
  const doc = profile === "tasks-md" ? parseTasksMd(text, path) : parseCore(text, path, profile);
  const found = [...doc.tasks.flatMap(taskDiagnostics), ...logDiagnostics(doc), ...regionDiagnostics(text)];
  if (profile === "tasks-v2") found.push(...tasksV2Diagnostics(doc));
  if (profile === "tasks-md") found.push(...tasksMdDiagnostics(doc));
  return sorted(profile === "tasks-md" ? found.filter(({ code }) => code !== "OD108") : found);
};

// src/files.ts
import { randomBytes } from "node:crypto";
import {
  existsSync,
  lstatSync,
  readFileSync,
  readdirSync,
  realpathSync,
  renameSync,
  statSync,
  writeFileSync
} from "node:fs";
import { dirname, join, relative, sep } from "node:path";
var SKIPPED_FOLDERS = /* @__PURE__ */ new Set(["node_modules", ".git", "dist", "build", "coverage"]);
var writeIfUnchanged = (path, original, text) => {
  if (readFileSync(path, "utf8") !== original) throw new RefusedError(`${path} changed while it was being edited`);
  const real = realpathSync(path);
  replaceFile(real, text, statSync(real).mode);
};
var replaceFile = (path, text, mode) => {
  const temporary = join(dirname(path), `.${randomBytes(6).toString("hex")}.orgdown`);
  writeFileSync(temporary, text, { mode, flag: "wx" });
  renameSync(temporary, path);
};
var appendToArchive = (target, source, text) => {
  if (!existsSync(target)) {
    replaceFile(target, text, 420);
    return;
  }
  if (lstatSync(target).isSymbolicLink()) throw new RefusedError(`${target} is a symbolic link`);
  if (realpathSync(target) === realpathSync(source)) throw new RefusedError("a file can't be its own archive");
  const existing = readFileSync(target, "utf8");
  const separator = existing === "" || existing.endsWith("\n") ? "" : "\n";
  writeIfUnchanged(target, existing, `${existing}${separator}${text}`);
};
var walk = (root, folder, found) => {
  for (const entry2 of readdirSync(folder, { withFileTypes: true })) {
    const path = join(folder, entry2.name);
    if (entry2.isDirectory()) {
      if (!SKIPPED_FOLDERS.has(entry2.name) && !entry2.name.startsWith(".")) walk(root, path, found);
    } else if (entry2.isFile() && entry2.name.endsWith(".md")) {
      found.push({ path: relative(root, path).split(sep).join("/"), text: readFileSync(path, "utf8") });
    }
  }
};
var markdownFiles = (root) => {
  const found = [];
  walk(root, root, found);
  return found;
};

// src/cli.ts
var HELP = `orgdown: Org mode's task and agenda model in plain Markdown

Read
  orgdown validate [--profile core|tasks-md|tasks-v2] [--json] <file>...
  orgdown parse <file>
  orgdown agenda <view> [--match q] [--sort s] [--title t] [--start d] [--days n]
                 [--from d] [--to d] [--today d] <file or folder>...
    views: ${VIEWS.join(" ")}

Write (each keeps every other byte, and refuses if the file changed)
  orgdown complete|trash|reopen|skip <file> <line> [--expect text] [--today d]
  orgdown add <file> <title> [--section name] [--note text] [--token tok]...
  orgdown archive <file> <line> [--into Archive.md] [--expect text]
  orgdown clock-in|clock-out <file> <line> [--expect text] [--now YYYY-MM-DDTHH:MM]
  orgdown regenerate <agenda.md> [--check] [--today d]

TASKS.md
  orgdown fix <TASKS.md>
  orgdown convert <file> --to core|tasks-md

--expect refuses the edit unless the line contains that text, in case lines have moved.
--today defaults to the local date. Exit status is 0 on success, 1 on errors found or a refused
edit, and 2 on bad usage.
`;
var UsageError = class extends Error {
};
var localDate = (now) => {
  const pad = (value) => String(value).padStart(2, "0");
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`;
};
var localDateTime = (now) => `${localDate(now)}T${String(now.getHours()).padStart(2, "0")}:${String(now.getMinutes()).padStart(2, "0")}`;
var readArgument = (args, index, name) => {
  const value = args[index];
  if (value === void 0) throw new UsageError(`missing ${name}`);
  return value;
};
var printDiagnostic = (path, { code, severity, line, message }) => {
  process.stdout.write(`${path}:${line}: ${severity} ${code}: ${message}
`);
};
var runValidate = (paths, options) => {
  if (paths.length === 0) throw new UsageError("missing <file>");
  const reports = paths.map((path) => ({
    path,
    diagnostics: validate(
      readFileSync2(path, "utf8"),
      path,
      options.profile ?? profileFor(path)
    )
  }));
  if (options.json === true) process.stdout.write(`${JSON.stringify(reports, null, 2)}
`);
  else for (const { path, diagnostics } of reports) for (const one of diagnostics) printDiagnostic(path, one);
  return reports.some(({ diagnostics }) => diagnostics.some((one) => one.severity === "error")) ? 1 : 0;
};
var toJson = ({ lines: _lines, tasks, path, profile }) => ({
  path,
  profile,
  tasks: tasks.map(({ tokens: _tokens, rawTitle: _rawTitle, contentEnd: _end, bodyEnd: _bodyEnd, ...task }) => task)
});
var docsAt = (targets) => (targets.length === 0 ? ["."] : targets).flatMap((target) => {
  if (!statSync2(target).isDirectory()) return [parseAuto(readFileSync2(target, "utf8"), target)];
  const files = [...markdownFiles(target)].sort((a, b) => a.path < b.path ? -1 : 1);
  return files.map((file) => parseAuto(file.text, target === "." ? file.path : `${target}/${file.path}`));
});
var attrsFrom = (options) => {
  const attrs = {};
  for (const name of ["match", "sort", "title", "start", "days", "from", "to"]) {
    const value = options[name];
    if (value !== void 0) attrs[name] = value;
  }
  return attrs;
};
var edit = (path, change, options, line) => {
  const text = readFileSync2(path, "utf8");
  if (line !== void 0 && options.expect !== void 0 && !text.split("\n")[line - 1]?.includes(options.expect)) {
    throw new RefusedError(`line ${line} of ${path} doesn't contain "${options.expect}"`);
  }
  const changed = change(text);
  if (changed !== text) writeIfUnchanged(path, text, changed);
  return 0;
};
var runHook = (input) => {
  let path;
  try {
    path = JSON.parse(input).tool_input?.file_path;
  } catch {
    return 0;
  }
  if (typeof path !== "string" || profileFor(path) === "core" || !existsSync2(path)) return 0;
  const problems = validate(readFileSync2(path, "utf8"), path).filter((one) => one.severity === "error");
  if (problems.length === 0) return 0;
  const lines = problems.map(({ code, line }) => `line ${line}: ${code}`);
  const name = basename(path);
  process.stderr.write(
    `${name} has OrgDown problems. Run orgdown validate on it and fix them, or tools may lose data:
${lines.join("\n")}
`
  );
  return 2;
};
var asLine = (text) => {
  if (!/^[1-9]\d*$/.test(text)) throw new UsageError(`"${text}" is not a line number`);
  return Number(text);
};
var lineCommands = (today, now) => {
  const isBoard = (path) => profileFor(path) === "tasks-md";
  const core = (text, path) => parseCore(text, path);
  return {
    complete: (text, path, line) => isBoard(path) ? completeTasksMd(text, line, today) : complete(core(text, path), line, today),
    trash: (text, path, line) => isBoard(path) ? trashTasksMd(text, line, today) : trash(core(text, path), line, today),
    reopen: (text, path, line) => isBoard(path) ? reopenTasksMd(text, line) : reopen(core(text, path), line),
    skip: (text, path, line) => skip(core(text, path), line, today),
    "clock-in": (text, path, line) => clockIn(core(text, path), line, now),
    "clock-out": (text, path, line) => clockOut(core(text, path), line, now)
  };
};
var runArchive = (path, line, options) => {
  const target = options.into ?? `${dirname2(path)}/Archive.md`;
  const text = readFileSync2(path, "utf8");
  if (options.expect !== void 0 && !text.split("\n")[line - 1]?.includes(options.expect)) {
    throw new RefusedError(`line ${line} of ${path} doesn't contain "${options.expect}"`);
  }
  const { text: kept, removed } = archive(parseCore(text, path), line);
  if (readFileSync2(path, "utf8") !== text) throw new RefusedError(`${path} changed while it was being edited`);
  appendToArchive(target, path, `${removed}
`);
  writeIfUnchanged(path, text, kept);
  return 0;
};
var runRegenerate = (path, options, today) => {
  const absolute = resolve(path);
  const root = dirname2(absolute);
  const text = readFileSync2(absolute, "utf8");
  const name = relative2(root, absolute).split(sep2).join("/");
  const output = regenerate(text, name, markdownFiles(root), today);
  if (options.check === true) {
    if (output !== text) process.stdout.write(`${path} is out of date
`);
    return output === text ? 0 : 1;
  }
  if (output !== text) writeIfUnchanged(absolute, text, output);
  return 0;
};
var runConvert = (path, target) => {
  const text = readFileSync2(path, "utf8");
  if (target === "core") {
    process.stdout.write(toCore(text));
    return 0;
  }
  if (target !== "tasks-md") throw new UsageError("--to must be core or tasks-md");
  const { text: output, warnings } = fromCore(text);
  process.stdout.write(output);
  for (const warning of warnings) process.stderr.write(`warning: ${warning}
`);
  return 0;
};
var main = (argv, clock = /* @__PURE__ */ new Date(), stdin = () => readFileSync2(0, "utf8")) => {
  const { values, positionals } = parseArgs({
    args: [...argv],
    allowPositionals: true,
    options: {
      profile: { type: "string" },
      json: { type: "boolean" },
      match: { type: "string" },
      sort: { type: "string" },
      title: { type: "string" },
      start: { type: "string" },
      days: { type: "string" },
      from: { type: "string" },
      to: { type: "string" },
      today: { type: "string" },
      now: { type: "string" },
      expect: { type: "string" },
      section: { type: "string" },
      note: { type: "string" },
      into: { type: "string" },
      token: { type: "string", multiple: true },
      check: { type: "boolean" },
      help: { type: "boolean", short: "h" }
    }
  });
  const options = values;
  const [command, ...args] = positionals;
  if (command === void 0 || options.help === true) {
    process.stdout.write(HELP);
    return 0;
  }
  const today = options.today ?? localDate(clock);
  const lineCommand = lineCommands(today, options.now ?? localDateTime(clock))[command];
  if (lineCommand !== void 0) {
    const path = readArgument(args, 0, "<file>");
    const line = asLine(readArgument(args, 1, "<line>"));
    return edit(path, (text) => lineCommand(text, path, line), options, line);
  }
  switch (command) {
    case "validate":
      return runValidate(args, options);
    case "parse": {
      const path = readArgument(args, 0, "<file>");
      process.stdout.write(
        `${JSON.stringify(toJson(parseAuto(readFileSync2(path, "utf8"), basename(path))), null, 2)}
`
      );
      return 0;
    }
    case "agenda": {
      const view = readArgument(args, 0, "<view>");
      if (!VIEWS.includes(view)) throw new UsageError(`"${view}" is not a view`);
      process.stdout.write(`${renderView(view, attrsFrom(options), docsAt(args.slice(1)), today)}
`);
      return 0;
    }
    case "add": {
      const path = readArgument(args, 0, "<file>");
      const title = readArgument(args, 1, "<title>");
      const tokens = options.token ?? [];
      return edit(
        path,
        (text) => profileFor(path) === "tasks-md" ? addTasksMd(text, title, tokens, options.section, options.note) : add(parseCore(text, path), title, tokens, options.section),
        options
      );
    }
    case "archive":
      return runArchive(readArgument(args, 0, "<file>"), asLine(readArgument(args, 1, "<line>")), options);
    case "hook":
      return runHook(stdin());
    case "regenerate":
      return runRegenerate(readArgument(args, 0, "<agenda.md>"), options, today);
    case "fix":
      return edit(readArgument(args, 0, "<file>"), fix, options);
    case "convert":
      return runConvert(readArgument(args, 0, "<file>"), options.to);
    default:
      throw new UsageError(`"${command}" is not a command`);
  }
};
var entry = process.argv[1];
if (entry !== void 0 && existsSync2(entry) && /orgdown(\.mjs)?$/.test(entry)) {
  try {
    process.exitCode = main(process.argv.slice(2));
  } catch (error) {
    const isUsage = error instanceof UsageError || error.code?.startsWith("ERR_PARSE_ARGS") === true;
    const isExpected = error instanceof RefusedError || error instanceof AgendaError || error.code === "ENOENT";
    if (!isUsage && !isExpected) throw error;
    process.stderr.write(`orgdown: ${error.message}
`);
    process.exitCode = isUsage ? 2 : 1;
  }
}
export {
  main
};
