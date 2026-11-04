// SPDX-License-Identifier: MIT
/** The agenda query language: spec/06-agenda.md §2. */
import { addDays, isDate } from "./dates.js";
import { AgendaError, STATES, isClosed, type Doc, type State, type Task } from "./model.js";

export type Predicate = (task: Task, doc: Doc) => boolean;

const queryError = (message: string): AgendaError => new AgendaError(message, "OD402");

/** Resolves `YYYY-MM-DD`, `today`, `today+Nd` or `today-Nd`. */
export const resolveDate = (text: string, today: string): string => {
  if (text === "today") return today;
  const relative = /^today([+-])(\d+)d$/.exec(text);
  if (relative !== null) return addDays(today, (relative[1] === "+" ? 1 : -1) * Number(relative[2]));
  if (isDate(text)) return text;
  throw queryError(`"${text}" is not a date`);
};

const splitTerms = (query: string): string[] => {
  const terms: string[] = [];
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

/** Turns a glob into a regular expression: `**` crosses folders, `*` and `?` don't. */
export const globToRegExp = (glob: string): RegExp => {
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

const compareDate = (field: "due" | "defer" | "completed", operator: string, date: string): Predicate => {
  return (task) => {
    const value = task[field];
    if (value === null) return false;
    if (operator === "<=") return value <= date;
    if (operator === ">=") return value >= date;
    return value === date;
  };
};

const FLAGS: Record<string, (today: string) => Predicate> = {
  open: () => (task) => !isClosed(task.state),
  closed: () => (task) => isClosed(task.state),
  deferred: (today) => (task) => task.defer !== null && task.defer > today,
  repeats: () => (task) => task.recurrence !== null,
  due: () => (task) => task.due !== null,
  priority: () => (task) => task.priority !== null,
};

const KEYED: Record<string, (value: string) => Predicate> = {
  status: (value) => {
    const states = value.split(",");
    const unknown = states.find((state) => !(STATES as readonly string[]).includes(state));
    if (unknown !== undefined) throw queryError(`"${unknown}" is not a state`);
    return (task) => states.includes(task.state as State);
  },
  tag: (value) => (task) => task.tags.some((tag) => tag === value || tag.startsWith(`${value}/`)),
  context: (value) => (task) => task.context?.toLowerCase() === value.toLowerCase(),
  energy: (value) => {
    if (!["low", "medium", "high"].includes(value)) throw queryError(`"${value}" is not an energy level`);
    return (task) => task.energy === value;
  },
  kind: (value) => {
    if (!["project", "single-action", "none"].includes(value)) throw queryError(`"${value}" is not a kind`);
    return (task) => (value === "none" ? task.nodeKind === null : task.nodeKind === value);
  },
  title: (value) => (task) => task.title.toLowerCase().includes(value.toLowerCase()),
  file: (value) => {
    const pattern = globToRegExp(value);
    return (_task, doc) => pattern.test(doc.path);
  },
};

const parseTerm = (term: string, today: string): Predicate => {
  const flag = FLAGS[term];
  if (flag !== undefined) return flag(today);
  const priority = /^priority<=(\d+)$/.exec(term);
  if (priority !== null) {
    const limit = Number(priority[1]);
    return (task) => task.priority !== null && task.priority <= limit;
  }
  const dated = /^(due|defer|completed)(<=|>=|=)(.+)$/.exec(term);
  if (dated !== null) {
    const [, field, operator, value] = dated as unknown as ["", "due" | "defer" | "completed", string, string];
    return compareDate(field, operator, resolveDate(value, today));
  }
  const colon = term.indexOf(":");
  const keyed = colon === -1 ? undefined : KEYED[term.slice(0, colon)];
  if (keyed === undefined) throw queryError(`"${term}" is not a query term`);
  return keyed(term.slice(colon + 1));
};

/** Compiles a query, throwing an `AgendaError` if it doesn't parse. */
export const parseQuery = (query: string, today: string): Predicate => {
  const predicates = splitTerms(query).map((term) => {
    if (!term.startsWith("-")) return parseTerm(term, today);
    const inner = parseTerm(term.slice(1), today);
    return ((task, doc) => !inner(task, doc)) as Predicate;
  });
  return (task, doc) => predicates.every((predicate) => predicate(task, doc));
};
