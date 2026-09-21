export interface CalendarEvent {
  date: string;
  title: string;
  url: string;
}

interface SourceItem extends Record<string, unknown> {
  SUB_TITLE: string;
  TITLE: string;
  URL: string;
}

const CALENDAR_NAME = "国家统计局数据发布日历";
const EVENT_URL_PATTERN = /\/t\d+_\d+\.html$/;
const SUMMARY_PATTERN = /^\d{4}年国家统计局主要统计信息发布日程表$/;
const encoder = new TextEncoder();

export function parseSchedule(
  raw: string,
  currentYear: number,
  sourceUrl: string,
): CalendarEvent[] {
  const normalized = raw.trim().replace(/,\s*]$/, "]");
  let value: unknown;

  try {
    value = JSON.parse(normalized);
  } catch {
    throw new Error("Invalid schedule JSON");
  }

  if (!Array.isArray(value)) {
    throw new Error("Invalid schedule payload");
  }

  const source = new URL(sourceUrl);
  if (source.protocol !== "https:" || source.hostname !== "www.stats.gov.cn") {
    throw new Error("Invalid source URL");
  }

  const events: CalendarEvent[] = [];
  const seenUrls = new Set<string>();

  for (const candidate of value) {
    if (!isRecord(candidate) || typeof candidate.SUB_TITLE !== "string") {
      continue;
    }

    const date = candidate.SUB_TITLE;
    if (!/^\d{8}$/.test(date)) {
      continue;
    }

    const year = Number(date.slice(0, 4));
    if (year !== currentYear && year !== currentYear + 1) {
      continue;
    }

    if (!isSourceItem(candidate)) {
      throw new Error("Invalid schedule item");
    }
    if (!isCalendarDate(date)) {
      throw new Error(`Invalid schedule date: ${date}`);
    }

    const title = cleanTitle(candidate.TITLE);
    if (SUMMARY_PATTERN.test(title)) {
      continue;
    }

    const url = new URL(candidate.URL, source).href;
    const parsedUrl = new URL(url);
    if (
      parsedUrl.protocol !== "https:" ||
      parsedUrl.hostname !== "www.stats.gov.cn" ||
      !parsedUrl.pathname.startsWith("/sj/fbrc/") ||
      !EVENT_URL_PATTERN.test(parsedUrl.pathname)
    ) {
      throw new Error(`Invalid event URL: ${candidate.URL}`);
    }
    if (seenUrls.has(url)) {
      throw new Error(`Duplicate event URL: ${url}`);
    }

    seenUrls.add(url);
    events.push({ date, title, url });
  }

  if (events.length === 0) {
    throw new Error("No calendar events for the current or next year");
  }

  return events.sort(
    (left, right) =>
      left.date.localeCompare(right.date) ||
      left.title.localeCompare(right.title, "zh-CN") ||
      left.url.localeCompare(right.url),
  );
}

export function buildCalendar(
  events: CalendarEvent[],
  generatedAt: Date,
): string {
  if (Number.isNaN(generatedAt.getTime())) {
    throw new Error("Invalid generation timestamp");
  }

  const timestamp = formatUtcTimestamp(generatedAt);
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//daocr//Stats Calendar//ZH-CN",
    "CALSCALE:GREGORIAN",
    "METHOD:PUBLISH",
    `X-WR-CALNAME:${escapeText(CALENDAR_NAME)}`,
    "X-WR-TIMEZONE:Asia/Shanghai",
    "REFRESH-INTERVAL;VALUE=DURATION:PT6H",
    "X-PUBLISHED-TTL:PT6H",
  ];

  for (const event of [...events].sort(compareEvents)) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${eventUid(event.url)}`,
      `DTSTAMP:${timestamp}`,
      `DTSTART;VALUE=DATE:${event.date}`,
      `DTEND;VALUE=DATE:${nextDate(event.date)}`,
      `SUMMARY:${escapeText(event.title)}`,
      `DESCRIPTION:${escapeText("来源：国家统计局\n发布日期以官网最新信息为准")}`,
      `URL:${event.url}`,
      "TRANSP:TRANSPARENT",
      "SEQUENCE:0",
      "END:VEVENT",
    );
  }

  lines.push("END:VCALENDAR");
  return `${lines.map(foldLine).join("\r\n")}\r\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isSourceItem(value: Record<string, unknown>): value is SourceItem {
  return (
    typeof value.SUB_TITLE === "string" &&
    typeof value.TITLE === "string" &&
    typeof value.URL === "string"
  );
}

function cleanTitle(value: string): string {
  const title = value.trim();
  if (title.length === 0 || title.length > 200) {
    throw new Error("Invalid event title");
  }
  return title;
}

function isCalendarDate(value: string): boolean {
  const year = Number(value.slice(0, 4));
  const month = Number(value.slice(4, 6));
  const day = Number(value.slice(6, 8));
  const date = new Date(Date.UTC(year, month - 1, day));

  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

function nextDate(value: string): string {
  if (!isCalendarDate(value)) {
    throw new Error(`Invalid event date: ${value}`);
  }

  const date = new Date(
    Date.UTC(
      Number(value.slice(0, 4)),
      Number(value.slice(4, 6)) - 1,
      Number(value.slice(6, 8)) + 1,
    ),
  );
  return [
    date.getUTCFullYear().toString().padStart(4, "0"),
    (date.getUTCMonth() + 1).toString().padStart(2, "0"),
    date.getUTCDate().toString().padStart(2, "0"),
  ].join("");
}

function eventUid(url: string): string {
  const match = new URL(url).pathname.match(/\/([^/]+)\.html$/);
  if (!match) {
    throw new Error(`Cannot derive event UID: ${url}`);
  }
  return `${match[1]}@stats-calendar.daocr.github.io`;
}

function formatUtcTimestamp(value: Date): string {
  return value
    .toISOString()
    .replace(/[-:]/g, "")
    .replace(/\.\d{3}Z$/, "Z");
}

function escapeText(value: string): string {
  return value
    .replace(/\r\n|\r|\n/g, "\n")
    .replace(/[\u0000-\u0008\u000B\u000C\u000E-\u001F\u007F]/g, "")
    .replace(/\\/g, "\\\\")
    .replace(/\n/g, "\\n")
    .replace(/,/g, "\\,")
    .replace(/;/g, "\\;");
}

function foldLine(line: string): string {
  const physicalLines: string[] = [];
  let current = "";
  let currentBytes = 0;

  for (const character of line) {
    const characterBytes = encoder.encode(character).byteLength;
    if (currentBytes + characterBytes > 75) {
      physicalLines.push(current);
      current = ` ${character}`;
      currentBytes = 1 + characterBytes;
    } else {
      current += character;
      currentBytes += characterBytes;
    }
  }

  physicalLines.push(current);
  return physicalLines.join("\r\n");
}

function compareEvents(left: CalendarEvent, right: CalendarEvent): number {
  return (
    left.date.localeCompare(right.date) ||
    left.title.localeCompare(right.title, "zh-CN") ||
    left.url.localeCompare(right.url)
  );
}
