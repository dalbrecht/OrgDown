// SPDX-License-Identifier: MIT
/** Next-occurrence math: spec/03-recurrence.md §3. */
import { addDays, addMonths, fromDays, toDays, weekIndexOf, weekdayOf } from "./dates.js";
import type { Recurrence } from "./model.js";

const step = (rule: Recurrence, anchor: string, base: string): string | null => {
  const weekdays = rule.weekdays;
  if (weekdays !== undefined && weekdays.length > 0) {
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

/**
 * The day after `anchor` that the rule lands on, or null when the series has ended.
 * `count` isn't consulted: operations check it first.
 */
export const nextOccurrence = (
  rule: Recurrence,
  anchor: string,
  completed: string | null,
  today: string,
): string | null => {
  const base = rule.mode === "due" ? anchor : (completed ?? today);
  let candidate = step(rule, anchor, base);
  while (rule.catchUp === true && candidate !== null && candidate <= today) {
    candidate = step(rule, candidate, candidate);
  }
  if (candidate === null) return null;
  return rule.until !== undefined && candidate > rule.until ? null : candidate;
};
