// SPDX-License-Identifier: MIT
/** Calendar arithmetic on `YYYY-MM-DD` days. There are no time zones anywhere in OrgDown. */

const DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Days from 1970-01-01 to a civil date (Hinnant's algorithm, proleptic Gregorian). */
const daysFromCivil = (year: number, month: number, day: number): number => {
  const y = month <= 2 ? year - 1 : year;
  const era = Math.floor(y / 400);
  const yearOfEra = y - era * 400;
  const dayOfYear = Math.floor((153 * (month > 2 ? month - 3 : month + 9) + 2) / 5) + day - 1;
  const dayOfEra = yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146097 + dayOfEra - 719468;
};

const civilFromDays = (days: number): [number, number, number] => {
  const z = days + 719468;
  const era = Math.floor(z / 146097);
  const dayOfEra = z - era * 146097;
  const yearOfEra = Math.floor(
    (dayOfEra - Math.floor(dayOfEra / 1460) + Math.floor(dayOfEra / 36524) - Math.floor(dayOfEra / 146096)) / 365,
  );
  const dayOfYear = dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const shifted = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * shifted + 2) / 5) + 1;
  const month = shifted < 10 ? shifted + 3 : shifted - 9;
  return [month <= 2 ? yearOfEra + era * 400 + 1 : yearOfEra + era * 400, month, day];
};

const lastDayOfMonth = (year: number, month: number): number => {
  if (month === 2) return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0 ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
};

/** True when `text` is a real `YYYY-MM-DD` calendar day. */
export const isDate = (text: string): boolean => {
  const match = DATE.exec(text);
  if (match === null) return false;
  const [year, month, day] = [Number(match[1]), Number(match[2]), Number(match[3])];
  return month >= 1 && month <= 12 && day >= 1 && day <= lastDayOfMonth(year, month);
};

/** Days since 1970-01-01 for a valid date. */
export const toDays = (date: string): number =>
  daysFromCivil(Number(date.slice(0, 4)), Number(date.slice(5, 7)), Number(date.slice(8, 10)));

/** The `YYYY-MM-DD` form of a day number. */
export const fromDays = (days: number): string => {
  const [year, month, day] = civilFromDays(days);
  return `${String(year).padStart(4, "0")}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
};

/** `date` moved by a number of days. */
export const addDays = (date: string, days: number): string => fromDays(toDays(date) + days);

/** `date` moved by whole months, clamped to the end of the target month. */
export const addMonths = (date: string, months: number): string => {
  const [year, month, day] = civilFromDays(toDays(date));
  const zeroBased = month - 1 + months;
  const targetYear = year + Math.floor(zeroBased / 12);
  const targetMonth = zeroBased - Math.floor(zeroBased / 12) * 12 + 1;
  return fromDays(daysFromCivil(targetYear, targetMonth, Math.min(day, lastDayOfMonth(targetYear, targetMonth))));
};

/** The weekday of a day number: 0 is Sunday. 1970-01-01 was a Thursday. */
export const weekdayOf = (days: number): number => (((days + 4) % 7) + 7) % 7;

/** The index of a day's Sunday-start week. */
export const weekIndexOf = (days: number): number => Math.floor((days + 4) / 7);

/** True when `text` is `HH:MM` on a 24-hour clock. */
export const isTime = (text: string): boolean => /^([01]\d|2[0-3]):[0-5]\d$/.test(text);

/** True when `text` is `YYYY-MM-DDTHH:MM`. */
export const isDateTime = (text: string): boolean => {
  const [date, time, ...rest] = text.split("T");
  return rest.length === 0 && date !== undefined && time !== undefined && isDate(date) && isTime(time);
};

/** Minutes since 1970-01-01T00:00 for a valid datetime. */
export const toMinutes = (dateTime: string): number =>
  toDays(dateTime.slice(0, 10)) * 1440 + Number(dateTime.slice(11, 13)) * 60 + Number(dateTime.slice(14, 16));
