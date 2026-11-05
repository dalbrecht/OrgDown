// SPDX-License-Identifier: MIT
/** The parsed shape of an OrgDown document. Field names match the spec and the vectors. */

export const STATES = ["inbox", "next", "in-progress", "blocked", "waiting", "someday", "done", "trash"] as const;
export type State = (typeof STATES)[number];

export const CLOSED_STATES: readonly State[] = ["done", "trash"];

/** True when a state is `done` or `trash`. */
export const isClosed = (state: State): boolean => CLOSED_STATES.includes(state);

export type Profile = "core" | "tasks-md" | "tasks-v2";

export type Unit = "day" | "week" | "month";

export interface Recurrence {
  mode: "due" | "completion";
  every: number;
  unit: Unit;
  weekdays?: number[];
  until?: string;
  count?: number;
  catchUp?: boolean;
}

export interface Appointment {
  start: string;
  end?: string;
}

export type LogEntry =
  | { type: "clock"; start: string; end: string | null; minutes: number | null }
  | { type: "state"; to: State; from: State; on: string };

/** A token as it appears on a line, with how the reader classified it. */
export interface Token {
  text: string;
  key: string;
  value: string;
  /** Character range of the token within the raw line. */
  start: number;
  end: number;
  /** False when the token landed in `extraTokens`. */
  isUsed: boolean;
}

export interface Task {
  /** 1-based line number. */
  line: number;
  /** 1-based index in the document's task list. */
  index: number;
  title: string;
  /** The text the checkbox governs, as written: title words in the file. */
  rawTitle: string;
  state: State;
  checked: boolean;
  checkChar: string;
  marker: string;
  indent: string;
  depth: number;
  parent: number | null;
  tags: string[];
  extraTokens: string[];
  tokens: Token[];
  context: string | null;
  project: string | null;
  nodeKind: string | null;
  energy: string | null;
  waitingReason: string | null;
  due: string | null;
  defer: string | null;
  dueTime: string | null;
  warnDays: number | null;
  at: Appointment | null;
  remind: string | null;
  estimateMinutes: number | null;
  priority: number | null;
  today: string | null;
  completed: string | null;
  recurrence: Recurrence | null;
  habit: boolean;
  progress: { done: number; total: number } | null;
  id: string | null;
  rev: string | null;
  body: string[];
  log: LogEntry[];
  /** The first line after the task's own body. */
  bodyEnd: number;
  /** `TASKS.md` only: the text after the bold title. */
  note: string;
  /** `TASKS.md` only: the section heading text. */
  section: string | null;
  /** End of the token-bearing text on the raw line, before any trailer. */
  contentEnd: number;
}

export type LineKind = "task" | "section" | "passthrough" | "opaque";

export interface Line {
  kind: LineKind;
  text: string;
  task?: Task;
}

export interface Doc {
  lines: Line[];
  tasks: Task[];
  profile: Profile;
  path: string;
}

/** An operation that can't be performed. The document is left unchanged. */
export class RefusedError extends Error {}

/** A query or Agenda MD definition that can't be understood. */
export class AgendaError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly line: number = 1,
  ) {
    super(message);
  }
}
