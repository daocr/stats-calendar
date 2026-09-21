import { buildCalendar, parseSchedule } from "../src/calendar.ts";
import { fetchOfficialSource, SOURCE_URL } from "../src/source.ts";

const response = await fetchOfficialSource();

if (!response.ok) {
  throw new Error(`Source returned HTTP ${response.status}`);
}

const now = new Date();
const currentYear = Number(
  new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).format(now),
);
const events = parseSchedule(await response.text(), currentYear, SOURCE_URL);
const calendar = buildCalendar(events, now);
const eventCount = calendar.match(/BEGIN:VEVENT\r\n/g)?.length ?? 0;

if (eventCount !== events.length || !calendar.endsWith("END:VCALENDAR\r\n")) {
  throw new Error("Generated calendar failed structural verification");
}

console.log(
  JSON.stringify({
    eventCount,
    firstDate: events[0]?.date,
    lastDate: events.at(-1)?.date,
    calendarBytes: new TextEncoder().encode(calendar).byteLength,
  }),
);
