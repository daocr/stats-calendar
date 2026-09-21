import { buildCalendar, parseSchedule } from "../src/calendar.ts";

const sourceUrl = "https://www.stats.gov.cn/sj/fbrc/index_fbrc.html";
const response = await fetch(sourceUrl, {
  headers: {
    accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
    "accept-language": "zh-CN,zh;q=0.9",
    "user-agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36",
  },
  redirect: "error",
  signal: AbortSignal.timeout(10_000),
});

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
const events = parseSchedule(await response.text(), currentYear, sourceUrl);
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
