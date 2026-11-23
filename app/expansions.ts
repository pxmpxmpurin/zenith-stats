// English release dates, in chronological order.
export const expansions = [
  { name: "Origins", release: "2025-10-31" },
  { name: "Spiritforged", release: "2026-02-13" },
  { name: "Unleashed", release: "2026-05-08" },
  { name: "Vendetta", release: "2026-07-31" },
  { name: "Radiance", release: "2026-10-23" },
];

const dateFormat = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeStyle: "short" });
const dayFormat = new Intl.DateTimeFormat("es", { dateStyle: "medium", timeZone: "UTC" });

export function matchDay(timestamp: string = new Date().toISOString()) {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function matchExpansion(timestamp: string, override?: string | null) {
  return override || expansions.findLast((item) => Date.parse(timestamp) >= Date.parse(item.release))?.name;
}

export function formatMatchDate(timestamp: string) {
  const date = new Date(timestamp);
  const dateOnly = date.getTime() % 86_400_000 === 0;
  return (dateOnly ? dayFormat : dateFormat).format(date);
}
