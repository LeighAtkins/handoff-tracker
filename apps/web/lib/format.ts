/** Staff read times in one zone. Override with APP_TIME_ZONE. */
const timeZone = process.env.APP_TIME_ZONE ?? "Asia/Tokyo";

const dateTime = new Intl.DateTimeFormat("en-GB", {
  timeZone,
  day: "2-digit",
  month: "short",
  hour: "2-digit",
  minute: "2-digit",
});

export function formatDateTime(date: Date | null | undefined): string {
  return date ? dateTime.format(date) : "—";
}

type AgoStrings = {
  never: string;
  minutes: (n: number) => string;
  hours: (n: number) => string;
  days: (n: number) => string;
};

const AGO_EN: AgoStrings = {
  never: "never",
  minutes: (n) => `${n}m ago`,
  hours: (n) => `${n}h ago`,
  days: (n) => `${n}d ago`,
};

export function formatAgo(
  date: Date | null | undefined,
  now = new Date(),
  strings: AgoStrings = AGO_EN,
): string {
  if (!date) return strings.never;
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 60) return strings.minutes(Math.max(minutes, 0));
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return strings.hours(hours);
  return strings.days(Math.floor(hours / 24));
}

export const TIME_ZONE = timeZone;

/**
 * Converts a <input type="datetime-local"> value, read as wall-clock time in TIME_ZONE, to a Date.
 * Works out the zone's UTC offset at that moment using Intl, so it handles DST zones as well.
 */
export function parseZonedDateTime(value: string, zone = timeZone): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})$/.exec(value);
  if (!match) return null;
  const [, y, mo, d, h, mi] = match.map(Number) as [number, number, number, number, number, number];
  const asUtc = Date.UTC(y, mo - 1, d, h, mi);
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone: zone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(asUtc));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value);
  const zonedAsUtc = Date.UTC(
    get("year"),
    get("month") - 1,
    get("day"),
    get("hour"),
    get("minute"),
  );
  return new Date(asUtc - (zonedAsUtc - asUtc));
}

/** The current time as a datetime-local value in TIME_ZONE, for form defaults. */
export function nowForInput(now = new Date(), zone = timeZone): string {
  return new Intl.DateTimeFormat("sv-SE", {
    timeZone: zone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  })
    .format(now)
    .replace(" ", "T");
}

const dayMonth = new Intl.DateTimeFormat("en-GB", { timeZone, day: "numeric", month: "short" });
const weekdayDayMonth = new Intl.DateTimeFormat("en-GB", {
  timeZone,
  weekday: "short",
  day: "numeric",
  month: "short",
});

/** "14 Oct": for axes and compact lists. */
export function formatDate(date: Date | null | undefined): string {
  return date ? dayMonth.format(date) : "—";
}

/** "Wed 14 Oct": for delivery estimates, where the weekday matters to customers. */
export function formatDay(date: Date | null | undefined): string {
  return date ? weekdayDayMonth.format(date) : "—";
}

export interface DurationStrings {
  lessThanHour: string;
  hours: (n: number) => string;
  days: (n: string) => string;
}

/** Hours under two days read as hours ("30 h"); longer as days ("2.4 days"). */
export function formatDuration(hours: number, strings: DurationStrings): string {
  if (hours < 1) return strings.lessThanHour;
  if (hours < 48) return strings.hours(Math.round(hours));
  return strings.days((hours / 24).toFixed(1));
}

export function formatPercent(ratio: number): string {
  return `${Math.round(ratio * 100)}%`;
}

/**
 * Carriers' own public tracking pages. The app links to them so staff can check by hand; it never
 * reads them (ADR-0001: no scraping). Deep links are not used because they are undocumented.
 */
export const TRACKING_PAGES: Record<string, string> = {
  "4PX": "https://track.4px.com/",
  SAGAWA: "https://www.sagawa-exp.co.jp/",
};
