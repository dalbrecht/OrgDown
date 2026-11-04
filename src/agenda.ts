// SPDX-License-Identifier: MIT
/** Agenda views and Agenda MD files: spec/06-agenda.md. */
import { addDays, toDays, weekdayOf } from "./dates.js";
import { AgendaError, isClosed, type Appointment, type Doc, type Task } from "./model.js";
import { blockEndOfFence, stripCarriageReturn } from "./parse.js";
import { globToRegExp, parseQuery, resolveDate } from "./query.js";
import { parseAuto } from "./tasks-md.js";

export const VIEWS = ["day", "week", "list", "next", "waiting", "stuck", "logbook", "clock", "habits"] as const;
export type ViewName = (typeof VIEWS)[number];
export type Attrs = Record<string, string>;

const ATTRIBUTES = ["title", "match", "sort", "start", "days", "from", "to"];
const SORT_KEYS = ["due", "defer", "priority", "title", "file"];
const WEEKDAY_NAMES = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
const HIGH_PRIORITY_CAP = 5;
const DEFAULT_WARN_DAYS = 1;

/** A task with the document it came from. */
interface Item {
  task: Task;
  doc: Doc;
}

const itemsOf = (docs: readonly Doc[]): Item[] => docs.flatMap((doc) => doc.tasks.map((task) => ({ task, doc })));

const row = ({ task, doc }: Item, annotations: readonly string[] = [], prefix = ""): string => {
  const suffix = annotations.length === 0 ? "" : ` — ${annotations.join(" · ")}`;
  const location = `[${doc.path}:${task.line}](${doc.path.replaceAll(" ", "%20")})`;
  return `- ${prefix}${task.title}${suffix} (${location})`;
};

const dueNote = (task: Task): string[] => (task.due === null ? [] : [`due ${task.due}`]);

const byDue = (a: Item, b: Item): number => {
  if (a.task.due === b.task.due) return 0;
  if (a.task.due === null) return 1;
  if (b.task.due === null) return -1;
  return a.task.due < b.task.due ? -1 : 1;
};

const dayOf = (stamp: string): string => stamp.slice(0, 10);

const coversDay = (at: Appointment, day: string): boolean => dayOf(at.start) <= day && day <= dayOf(at.end ?? at.start);

/** The time label of an appointment on `day`, or null if it's all-day there. */
const timeLabel = (at: Appointment, day: string): string | null => {
  if (at.start.length === 10 || dayOf(at.start) !== day) return null;
  const start = at.start.slice(11);
  return at.end !== undefined && dayOf(at.end) === day ? `${start}–${at.end.slice(11)}` : start;
};

const scheduleRows = (items: readonly Item[], day: string): { rows: string[]; used: Set<Task> } => {
  const entries = items.flatMap((item) => {
    const at = item.task.at;
    if (at === null || isClosed(item.task.state) || !coversDay(at, day)) return [];
    return [{ item, label: timeLabel(at, day) }];
  });
  const sorted = [...entries].sort((a, b) => {
    if (a.label === null || b.label === null) return (a.label === null ? 0 : 1) - (b.label === null ? 0 : 1);
    return a.label.slice(0, 5) < b.label.slice(0, 5) ? -1 : a.label.slice(0, 5) > b.label.slice(0, 5) ? 1 : 0;
  });
  return {
    rows: sorted.map(({ item, label }) => row(item, [], label === null ? "" : `${label} `)),
    used: new Set(sorted.map(({ item }) => item.task)),
  };
};

const isInWarning = (task: Task, today: string): boolean => {
  if (task.due === null) return false;
  return toDays(task.due) - (task.warnDays ?? DEFAULT_WARN_DAYS) <= toDays(today);
};

const isOnDay = (task: Task, today: string): boolean =>
  !isClosed(task.state) &&
  (isInWarning(task, today) ||
    (task.defer !== null && task.defer <= today) ||
    task.today === today ||
    task.priority !== null);

type Groups = [string, string[]][];

const dayGroups = (items: readonly Item[], today: string): Groups => {
  const { rows: schedule, used } = scheduleRows(items, today);
  const onDay = items.filter(({ task }) => !used.has(task) && isOnDay(task, today));
  const ranked = onDay
    .filter(({ task }) => task.priority !== null)
    .sort((a, b) => (a.task.priority as number) - (b.task.priority as number));
  const top = new Set(ranked.slice(0, HIGH_PRIORITY_CAP).map(({ task }) => task));
  const highPriority = ranked
    .slice(0, HIGH_PRIORITY_CAP)
    .map((item) => row(item, [`#${item.task.priority}`, ...dueNote(item.task)]));
  const rest = onDay.filter(({ task }) => !top.has(task));
  const overdue = rest.filter(({ task }) => task.due !== null && task.due < today).sort(byDue);
  const upcoming = rest
    .filter(({ task }) => task.due !== null && task.due >= today && isInWarning(task, today))
    .sort(byDue);
  const placed = new Set([...overdue, ...upcoming].map(({ task }) => task));
  const dueLabel = ({ task }: Item): string[] => [
    task.due === today ? "due today" : `due ${task.due}`,
    ...(task.dueTime === null ? [] : [task.dueTime]),
  ];
  return [
    ["Schedule", schedule],
    ["High priority", highPriority],
    [
      "Overdue",
      overdue.map((item) =>
        row(item, [`due ${item.task.due}`, `${toDays(today) - toDays(item.task.due as string)}d late`]),
      ),
    ],
    ["Due", upcoming.map((item) => row(item, dueLabel(item)))],
    ["Today", rest.filter(({ task }) => !placed.has(task)).map((item) => row(item))],
  ];
};

const weekGroups = (items: readonly Item[], start: string, days: number): Groups => {
  const live = items.filter(({ task }) => !isClosed(task.state));
  const groups: Groups = [];
  for (let offset = 0; offset < days; offset += 1) {
    const day = addDays(start, offset);
    const due = live
      .filter(({ task }) => task.due === day)
      .map((item) => row(item, ["due", ...(item.task.dueTime === null ? [] : [item.task.dueTime])]));
    const arriving = live.filter(({ task }) => task.defer === day).map((item) => row(item, ["arrives"]));
    const heading = `${day} ${WEEKDAY_NAMES[weekdayOf(toDays(day))]}`;
    groups.push([heading, [...scheduleRows(live, day).rows, ...due, ...arriving]]);
  }
  return groups;
};

const nextGroups = (items: readonly Item[]): Groups => {
  const byContext = new Map<string, { name: string; rows: string[] }>();
  const none: string[] = [];
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
  const groups: Groups = [...byContext.entries()]
    .sort(([a], [b]) => (a < b ? -1 : 1))
    .map(([, group]) => [group.name, group.rows]);
  groups.push(["No context", none]);
  return groups;
};

const descendantsOf = (doc: Doc, task: Task): Task[] => {
  const found = new Set<number>([task.index]);
  return doc.tasks.filter((other) => {
    if (other.parent === null || !found.has(other.parent)) return false;
    found.add(other.index);
    return true;
  });
};

const isStuck = ({ task, doc }: Item): boolean =>
  task.nodeKind === "project" &&
  !isClosed(task.state) &&
  !descendantsOf(doc, task).some((other) => other.state === "next" || other.state === "in-progress");

const formatMinutes = (minutes: number): string =>
  `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}m`;

const clockRows = (items: readonly Item[], from: string, to: string): string[] => {
  let total = 0;
  const rows = items.flatMap((item) => {
    let minutes = 0;
    for (const entry of item.task.log) {
      if (entry.type === "clock" && entry.minutes !== null && dayOf(entry.start) >= from && dayOf(entry.start) <= to)
        minutes += entry.minutes;
    }
    total += minutes;
    return minutes === 0 ? [] : [row(item, [formatMinutes(minutes)])];
  });
  return rows.length === 0 ? [] : [...rows, "", `**Total: ${formatMinutes(total)}**`];
};

const HABIT_WINDOW_DAYS = 14;

/** The history row of an open habit: spec/06-agenda.md §4. */
const habitRow = (item: Item, today: string): string[] => {
  const { task, doc } = item;
  if (!task.habit || isClosed(task.state)) return [];
  const days = new Set(
    doc.tasks.flatMap((other) =>
      other.habit && other.title === task.title && isClosed(other.state) && other.completed !== null
        ? [other.completed]
        : [],
    ),
  );
  const graph = Array.from({ length: HABIT_WINDOW_DAYS }, (_, i) =>
    days.has(addDays(today, i - HABIT_WINDOW_DAYS + 1)) ? "x" : ".",
  ).join("");
  let day = days.has(today) ? today : addDays(today, -1);
  let streak = 0;
  while (days.has(day)) {
    streak += 1;
    day = addDays(day, -1);
  }
  return [row(item, [graph, `streak ${streak}`])];
};

const sortItems = (items: readonly Item[], sort: string | undefined): Item[] => {
  if (sort === undefined) return [...items];
  const keys = sort.split(",");
  const valueOf = (item: Item, key: string): string | number | null => {
    if (key === "file") return item.doc.path;
    return item.task[key as "due" | "defer" | "priority" | "title"];
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

const DEFAULT_TITLES: Record<ViewName, (today: string, start: string) => string> = {
  day: (today) => `Today (${today})`,
  week: (_today, start) => `Week of ${start}`,
  list: () => "Tasks",
  next: () => "Next actions",
  waiting: () => "Waiting",
  stuck: () => "Stuck projects",
  logbook: () => "Logbook",
  clock: () => "Clock",
  habits: () => "Habits",
};

const present = (title: string, groups: Groups, flat: readonly string[]): string => {
  const parts = [`## ${title}`];
  if (flat.length > 0) parts.push(flat.join("\n"));
  for (const [heading, rows] of groups) if (rows.length > 0) parts.push(`### ${heading}`, rows.join("\n"));
  if (parts.length === 1) parts.push("Nothing here.");
  return parts.join("\n\n");
};

/** Checks a view name and attributes, and every query and date in them. Throws `AgendaError`. */
export const checkView = (view: string, attrs: Attrs, today: string, line = 1): void => {
  if (!(VIEWS as readonly string[]).includes(view)) throw new AgendaError(`"${view}" is not a view`, "OD401", line);
  for (const name of Object.keys(attrs)) {
    const isBanned = name === "match" && (view === "day" || view === "clock");
    if (!ATTRIBUTES.includes(name) || isBanned)
      throw new AgendaError(`"${name}" is not an attribute of ${view}`, "OD401", line);
  }
  const badSort = attrs["sort"]?.split(",").find((key) => !SORT_KEYS.includes(key));
  if (badSort !== undefined) throw new AgendaError(`"${badSort}" is not a sort key`, "OD401", line);
  if (attrs["days"] !== undefined && !/^[1-9]\d*$/.test(attrs["days"]))
    throw new AgendaError("days must be a positive number", "OD401", line);
  try {
    parseQuery(attrs["match"] ?? "", today);
    for (const name of ["start", "from", "to"]) if (attrs[name] !== undefined) resolveDate(attrs[name], today);
  } catch (error) {
    throw new AgendaError((error as Error).message, "OD402", line);
  }
};

/** Renders a view over documents, in the order given. */
export const renderView = (view: ViewName, attrs: Attrs, docs: readonly Doc[], today: string): string => {
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
      waiting.map((item) => row(item, [item.task.waitingReason as string, ...dueNote(item.task)])),
    );
  }
  if (view === "stuck") {
    return present(
      title,
      [],
      sortItems(
        matched.filter((item) => isStuck(item) && open(item.task, item.doc)),
        attrs["sort"],
      ).map((item) => row(item, dueNote(item.task))),
    );
  }
  if (view === "logbook") {
    const closed = matched.filter(
      ({ task }) => isClosed(task.state) && task.completed !== null && task.completed >= from && task.completed <= to,
    );
    const newestFirst = [...closed].sort((a, b) =>
      (a.task.completed as string) < (b.task.completed as string) ? 1 : a.task.completed === b.task.completed ? 0 : -1,
    );
    return present(
      title,
      [],
      newestFirst.map((item) => row(item, [item.task.completed as string])),
    );
  }
  if (view === "clock") return present(title, [], clockRows(items, from, to));
  if (view === "habits")
    return present(
      title,
      [],
      matched.flatMap((item) => habitRow(item, today)),
    );
  return present(
    title,
    [],
    sortItems(matched, attrs["sort"]).map((item) => row(item, dueNote(item.task))),
  );
};

const REGION_OPEN = /^\s*<!--\s*orgdown:view\b/;
const REGION_CLOSE = /^\s*<!--\s*\/orgdown:view\s*-->/;
const REGION_HEAD = /^\s*<!--\s*orgdown:view\s+(\S+)((?:\s+[a-z]+=(?:"[^"]*"|'[^']*'))*)\s*-->\s*$/;

/** One view region: its markers' 0-based lines, plus what it asks for. */
export interface Region {
  open: number;
  close: number;
  view: string;
  attrs: Attrs;
}

/** Finds the view regions in a document. Throws `AgendaError` if one is malformed or unclosed. */
export const findRegions = (text: string): Region[] => {
  const lines = text.split("\n");
  const regions: Region[] = [];
  for (let i = 0; i < lines.length; i += 1) {
    const fenceEnd = blockEndOfFence(lines, i);
    if (fenceEnd !== null) {
      i = fenceEnd;
      continue;
    }
    const line = stripCarriageReturn(lines[i] as string);
    if (!REGION_OPEN.test(line)) continue;
    const head = REGION_HEAD.exec(line);
    if (head === null) throw new AgendaError("a view region opening is malformed", "OD401", i + 1);
    const close = lines.findIndex((other, j) => j > i && REGION_CLOSE.test(other));
    if (close === -1) throw new AgendaError("a view region is not closed", "OD403", i + 1);
    const attrs: Attrs = {};
    for (const match of (head[2] as string).matchAll(/([a-z]+)=(?:"([^"]*)"|'([^']*)')/g)) {
      attrs[match[1] as string] = match[2] ?? (match[3] as string);
    }
    regions.push({ open: i, close, view: head[1] as string, attrs });
    i = close;
  }
  return regions;
};

/** Reads the `agenda.sources` list out of front matter. The default is every Markdown file. */
const readSources = (text: string): string[] => {
  const lines = text.split("\n");
  if (stripCarriageReturn(lines[0] as string) !== "---") return ["**/*.md"];
  const close = lines.findIndex((line, i) => i > 0 && stripCarriageReturn(line) === "---");
  const start = lines.findIndex((line, i) => i < close && /^\s+sources:\s*$/.test(line));
  if (close === -1 || start === -1) return ["**/*.md"];
  const sources: string[] = [];
  for (const line of lines.slice(start + 1, close)) {
    const item = /^\s+-\s+(?:"([^"]*)"|'([^']*)'|(.+?))\s*$/.exec(line);
    if (item === null) break;
    sources.push((item[1] ?? item[2] ?? item[3]) as string);
  }
  return sources.length === 0 ? ["**/*.md"] : sources;
};

export interface SourceFile {
  path: string;
  text: string;
}

/** Orders source files by the file's globs, each file once, without the Agenda MD file itself. */
export const selectSources = (text: string, path: string, files: readonly SourceFile[]): SourceFile[] => {
  const picked = new Map<string, SourceFile>();
  for (const glob of readSources(text)) {
    const pattern = globToRegExp(glob);
    const matching = files.filter((file) => pattern.test(file.path) && file.path !== path);
    for (const file of [...matching].sort((a, b) => (a.path < b.path ? -1 : 1)))
      picked.set(file.path, picked.get(file.path) ?? file);
  }
  return [...picked.values()];
};

/** Regenerates every view region. Outside the regions, the file keeps every byte. */
export const regenerate = (text: string, path: string, files: readonly SourceFile[], today: string): string => {
  const regions = findRegions(text);
  for (const region of regions) checkView(region.view, region.attrs, today, region.open + 1);
  const docs = selectSources(text, path, files).map((file) => parseAuto(file.text, file.path));
  const lines = text.split("\n");
  for (const region of [...regions].reverse()) {
    const output = renderView(region.view as ViewName, region.attrs, docs, today);
    lines.splice(region.open + 1, region.close - region.open - 1, "", ...output.split("\n"), "");
  }
  return lines.join("\n");
};
