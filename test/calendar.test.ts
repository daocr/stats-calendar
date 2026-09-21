import { describe, expect, it } from "vitest";

import {
  buildCalendar,
  parseSchedule,
  type CalendarEvent,
} from "../src/calendar.ts";

const sourceUrl = "https://www.stats.gov.cn/sj/fbrc/index_fbrc.html";

function source(items: unknown[]): string {
  return `${JSON.stringify(items).slice(0, -1)},]`;
}

describe("parseSchedule", () => {
  it("accepts the official trailing comma and keeps current and next-year details", () => {
    const raw = source([
      {
        SUB_TITLE: "20261231",
        TITLE: "采购经理指数月度报告",
        URL: "./202412/t20241230_1958101.html",
      },
      {
        SUB_TITLE: "20270109",
        TITLE: "居民消费价格指数月度报告",
        URL: "./202612/t20261230_2000001.html",
      },
      {
        SUB_TITLE: "20251231",
        TITLE: "旧记录",
        URL: "./202412/t20241230_1900001.html",
      },
      {
        SUB_TITLE: "20261220",
        TITLE: "2027年国家统计局主要统计信息发布日程表",
        URL: "./202612/t20261220_2000002.html",
      },
    ]);

    expect(parseSchedule(raw, 2026, sourceUrl)).toEqual([
      {
        date: "20261231",
        title: "采购经理指数月度报告",
        url: "https://www.stats.gov.cn/sj/fbrc/202412/t20241230_1958101.html",
      },
      {
        date: "20270109",
        title: "居民消费价格指数月度报告",
        url: "https://www.stats.gov.cn/sj/fbrc/202612/t20261230_2000001.html",
      },
    ]);
  });

  it("rejects invalid target-year dates and off-domain links", () => {
    expect(() =>
      parseSchedule(
        source([
          {
            SUB_TITLE: "20260230",
            TITLE: "无效日期",
            URL: "./202412/t20241230_1958101.html",
          },
        ]),
        2026,
        sourceUrl,
      ),
    ).toThrow("Invalid schedule date");

    expect(() =>
      parseSchedule(
        source([
          {
            SUB_TITLE: "20261231",
            TITLE: "恶意链接",
            URL: "https://example.com/event.html",
          },
        ]),
        2026,
        sourceUrl,
      ),
    ).toThrow("Invalid event URL");
  });

  it("rejects malformed current-year values and disguised source links", () => {
    expect(() =>
      parseSchedule(
        source([
          {
            SUB_TITLE: "2026-bad",
            TITLE: "无效日期格式",
            URL: "./202412/t20241230_1958101.html",
          },
        ]),
        2026,
        sourceUrl,
      ),
    ).toThrow("Invalid schedule date");

    expect(() =>
      parseSchedule(
        source([
          {
            SUB_TITLE: "20261231",
            TITLE: "伪装链接",
            URL: "https://user:pass@www.stats.gov.cn:444/sj/fbrc/202412/t20241230_1958101.html",
          },
        ]),
        2026,
        sourceUrl,
      ),
    ).toThrow("Invalid event URL");
  });

  it("rejects empty feeds instead of publishing an empty calendar", () => {
    expect(() => parseSchedule(source([]), 2026, sourceUrl)).toThrow(
      "No calendar events",
    );
  });
});

describe("buildCalendar", () => {
  it("builds stable all-day events with escaped source text", () => {
    const events: CalendarEvent[] = [
      {
        date: "20261231",
        title: "标题,分号;反斜线\\换行\n注入",
        url: "https://www.stats.gov.cn/sj/fbrc/202412/t20241230_1958101.html",
      },
    ];

    const calendar = buildCalendar(events, new Date("2026-09-21T03:04:05Z"));

    expect(calendar).toContain("DTSTART;VALUE=DATE:20261231\r\n");
    expect(calendar).toContain("DTEND;VALUE=DATE:20270101\r\n");
    expect(calendar).toContain(
      "UID:t20241230_1958101@stats-calendar.daocr.github.io\r\n",
    );
    expect(calendar).toContain("SUMMARY:标题\\,分号\\;反斜线\\\\换行\\n注入");
    expect(calendar).toContain("DTSTAMP:20260921T030405Z\r\n");
    expect(calendar.endsWith("END:VCALENDAR\r\n")).toBe(true);
  });

  it("folds every physical line to at most 75 UTF-8 octets", () => {
    const calendar = buildCalendar(
      [
        {
          date: "20261001",
          title: "超长中文标题".repeat(30),
          url: "https://www.stats.gov.cn/sj/fbrc/202412/t20241230_1958102.html",
        },
      ],
      new Date("2026-09-21T00:00:00Z"),
    );

    for (const line of calendar.split("\r\n").filter(Boolean)) {
      expect(new TextEncoder().encode(line).byteLength).toBeLessThanOrEqual(75);
    }
    expect(calendar).toContain("\r\n ");
    expect(calendar).not.toContain("�");
  });
});
