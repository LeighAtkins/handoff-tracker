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

export function formatAgo(date: Date | null | undefined, now = new Date()): string {
  if (!date) return "never";
  const minutes = Math.floor((now.getTime() - date.getTime()) / 60_000);
  if (minutes < 60) return `${Math.max(minutes, 0)}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 48) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

export const TIME_ZONE = timeZone;
