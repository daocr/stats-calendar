import { describe, expect, it, vi } from "vitest";

import {
  fetchOfficialSource,
  handleRequest,
  type CalendarCache,
  type ExecutionContextLike,
} from "../src/index.ts";

const sourceBody = `[
  {
    "SUB_TITLE": "20261231",
    "TITLE": "采购经理指数月度报告",
    "URL": "./202412/t20241230_1958101.html"
  },
]`;

class MemoryCache implements CalendarCache {
  private readonly entries = new Map<string, Response>();

  async match(request: Request): Promise<Response | undefined> {
    return this.entries.get(request.url)?.clone();
  }

  async put(request: Request, response: Response): Promise<void> {
    this.entries.set(request.url, response.clone());
  }
}

function context(): ExecutionContextLike & { pending: Promise<unknown>[] } {
  const pending: Promise<unknown>[] = [];
  return {
    pending,
    waitUntil(promise) {
      pending.push(promise);
    },
  };
}

describe("calendar worker", () => {
  it("uses the redirect mode supported by the Cloudflare runtime", async () => {
    const fetchImplementation = vi.fn(
      async (_input: RequestInfo | URL, init?: RequestInit) => {
        expect(init?.redirect).toBe("manual");
        return new Response(sourceBody);
      },
    );

    const response = await fetchOfficialSource(fetchImplementation);

    expect(response.status).toBe(200);
    expect(fetchImplementation).toHaveBeenCalledTimes(1);
  });

  it("redirects the root and rejects unsupported routes and methods", async () => {
    const dependencies = {
      cache: new MemoryCache(),
      fetchSource: vi.fn(),
      now: () => new Date("2026-09-21T00:00:00Z"),
    };

    const root = await handleRequest(
      new Request("https://calendar.example/"),
      context(),
      dependencies,
    );
    expect(root.status).toBe(302);
    expect(root.headers.get("location")).toBe(
      "https://calendar.example/calendar.ics",
    );

    const missing = await handleRequest(
      new Request("https://calendar.example/missing"),
      context(),
      dependencies,
    );
    expect(missing.status).toBe(404);
    expect(await missing.json()).toEqual({
      error: { code: "NOT_FOUND", message: "Resource not found" },
    });

    const unsupported = await handleRequest(
      new Request("https://calendar.example/calendar.ics", {
        method: "POST",
      }),
      context(),
      dependencies,
    );
    expect(unsupported.status).toBe(405);
    expect(unsupported.headers.get("allow")).toBe("GET, HEAD");
  });

  it("generates and caches a calendar response", async () => {
    const cache = new MemoryCache();
    const fetchSource = vi.fn(async () => new Response(sourceBody));
    const firstContext = context();

    const first = await handleRequest(
      new Request("https://calendar.example/calendar.ics?ignored=true"),
      firstContext,
      {
        cache,
        fetchSource,
        now: () => new Date("2026-09-21T03:04:05Z"),
      },
    );
    await Promise.all(firstContext.pending);

    expect(first.status).toBe(200);
    expect(first.headers.get("content-type")).toBe(
      "text/calendar; charset=utf-8",
    );
    expect(first.headers.get("cache-control")).toBe(
      "public, max-age=3600, s-maxage=21600",
    );
    expect(first.headers.get("etag")).toMatch(/^"[a-f0-9]{64}"$/);
    expect(first.headers.get("x-content-type-options")).toBe("nosniff");
    expect(await first.text()).toContain("SUMMARY:采购经理指数月度报告");

    const second = await handleRequest(
      new Request("https://calendar.example/calendar.ics"),
      context(),
      {
        cache,
        fetchSource,
        now: () => new Date("2026-09-21T04:00:00Z"),
      },
    );
    expect(second.status).toBe(200);
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });

  it("supports HEAD and conditional GET using the cached ETag", async () => {
    const cache = new MemoryCache();
    const dependencies = {
      cache,
      fetchSource: vi.fn(async () => new Response(sourceBody)),
      now: () => new Date("2026-09-21T03:04:05Z"),
    };
    const firstContext = context();
    const first = await handleRequest(
      new Request("https://calendar.example/calendar.ics"),
      firstContext,
      dependencies,
    );
    await Promise.all(firstContext.pending);
    const etag = first.headers.get("etag")!;

    const head = await handleRequest(
      new Request("https://calendar.example/calendar.ics", {
        method: "HEAD",
      }),
      context(),
      dependencies,
    );
    expect(head.status).toBe(200);
    expect(await head.text()).toBe("");
    expect(head.headers.get("etag")).toBe(etag);

    const notModified = await handleRequest(
      new Request("https://calendar.example/calendar.ics", {
        headers: { "if-none-match": etag },
      }),
      context(),
      dependencies,
    );
    expect(notModified.status).toBe(304);
    expect(await notModified.text()).toBe("");
  });

  it("returns a generic uncached 502 when the source is unavailable", async () => {
    const cache = new MemoryCache();
    const fetchSource = vi.fn(async () => {
      throw new Error("upstream internals");
    });

    const response = await handleRequest(
      new Request("https://calendar.example/calendar.ics"),
      context(),
      {
        cache,
        fetchSource,
        now: () => new Date("2026-09-21T03:04:05Z"),
      },
    );

    expect(response.status).toBe(502);
    expect(await response.json()).toEqual({
      error: {
        code: "UPSTREAM_UNAVAILABLE",
        message: "Calendar data is temporarily unavailable",
      },
    });
    expect(fetchSource).toHaveBeenCalledTimes(1);
  });
});
