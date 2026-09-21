import { buildCalendar, parseSchedule } from "./calendar.ts";

const SOURCE_URL = "https://www.stats.gov.cn/sj/fbrc/index_fbrc.html";
const MAX_SOURCE_BYTES = 2 * 1024 * 1024;
const CACHE_CONTROL = "public, max-age=3600, s-maxage=21600";

export interface CalendarCache {
  match(request: Request): Promise<Response | undefined>;
  put(request: Request, response: Response): Promise<void>;
}

export interface ExecutionContextLike {
  waitUntil(promise: Promise<unknown>): void;
}

interface WorkerDependencies {
  cache: CalendarCache;
  fetchSource: () => Promise<Response>;
  now: () => Date;
}

export async function handleRequest(
  request: Request,
  context: ExecutionContextLike,
  dependencies: WorkerDependencies,
): Promise<Response> {
  const url = new URL(request.url);

  if (url.pathname === "/") {
    if (request.method !== "GET" && request.method !== "HEAD") {
      return methodNotAllowed();
    }
    return redirectResponse(new URL("/calendar.ics", url).href);
  }

  if (url.pathname !== "/calendar.ics") {
    return errorResponse(404, "NOT_FOUND", "Resource not found");
  }
  if (request.method !== "GET" && request.method !== "HEAD") {
    return methodNotAllowed();
  }

  const cacheKey = new Request(new URL("/calendar.ics", url).href);
  const cached = await dependencies.cache.match(cacheKey);
  if (cached) {
    return responseForRequest(request, cached);
  }

  try {
    const sourceResponse = await dependencies.fetchSource();
    if (!sourceResponse.ok) {
      throw new Error(`Source returned HTTP ${sourceResponse.status}`);
    }

    const declaredLength = Number(sourceResponse.headers.get("content-length"));
    if (declaredLength > MAX_SOURCE_BYTES) {
      throw new Error("Source response exceeds size limit");
    }

    const raw = await sourceResponse.text();
    if (new TextEncoder().encode(raw).byteLength > MAX_SOURCE_BYTES) {
      throw new Error("Source response exceeds size limit");
    }

    const now = dependencies.now();
    const events = parseSchedule(raw, shanghaiYear(now), SOURCE_URL);
    const calendar = buildCalendar(events, now);
    const response = await calendarResponse(calendar);

    context.waitUntil(
      dependencies.cache.put(cacheKey, response.clone()).catch((error) => {
        console.error(
          JSON.stringify({
            event: "calendar_cache_write_failed",
            error: errorMessage(error),
          }),
        );
      }),
    );
    return responseForRequest(request, response);
  } catch (error) {
    console.error(
      JSON.stringify({
        event: "calendar_generation_failed",
        error: errorMessage(error),
      }),
    );
    return errorResponse(
      502,
      "UPSTREAM_UNAVAILABLE",
      "Calendar data is temporarily unavailable",
    );
  }
}

type SourceFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

export async function fetchOfficialSource(
  fetchImplementation: SourceFetch = fetch,
): Promise<Response> {
  let lastError: unknown;

  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      return await fetchImplementation(SOURCE_URL, {
        headers: {
          accept: "application/json,text/plain;q=0.9,*/*;q=0.8",
          "accept-language": "zh-CN,zh;q=0.9",
          "user-agent":
            "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 Chrome/140.0 Safari/537.36",
        },
        redirect: "manual",
        signal: AbortSignal.timeout(10_000),
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Source request failed");
}

async function calendarResponse(calendar: string): Promise<Response> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    new TextEncoder().encode(calendar),
  );
  const etag = `"${Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("")}"`;

  return new Response(calendar, {
    headers: withSecurityHeaders({
      "cache-control": CACHE_CONTROL,
      "content-disposition": 'inline; filename="stats-calendar.ics"',
      "content-type": "text/calendar; charset=utf-8",
      etag,
    }),
  });
}

function responseForRequest(request: Request, response: Response): Response {
  const etag = response.headers.get("etag");
  if (etag && etagMatches(request.headers.get("if-none-match"), etag)) {
    return new Response(null, {
      status: 304,
      headers: response.headers,
    });
  }
  if (request.method === "HEAD") {
    return new Response(null, {
      status: response.status,
      headers: response.headers,
    });
  }
  return response;
}

function etagMatches(requestValue: string | null, etag: string): boolean {
  if (!requestValue) {
    return false;
  }
  return requestValue
    .split(",")
    .map((value) => value.trim())
    .some((value) => value === "*" || value === etag);
}

function shanghaiYear(date: Date): number {
  const year = new Intl.DateTimeFormat("en", {
    timeZone: "Asia/Shanghai",
    year: "numeric",
  }).format(date);
  return Number(year);
}

function redirectResponse(location: string): Response {
  return new Response(null, {
    status: 302,
    headers: withSecurityHeaders({ location }),
  });
}

function methodNotAllowed(): Response {
  const response = errorResponse(
    405,
    "METHOD_NOT_ALLOWED",
    "Method not allowed",
  );
  response.headers.set("allow", "GET, HEAD");
  return response;
}

function errorResponse(status: number, code: string, message: string): Response {
  return Response.json(
    { error: { code, message } },
    {
      status,
      headers: withSecurityHeaders({
        "cache-control": "no-store",
      }),
    },
  );
}

function withSecurityHeaders(initial: HeadersInit): Headers {
  const headers = new Headers(initial);
  headers.set("content-security-policy", "default-src 'none'");
  headers.set("referrer-policy", "no-referrer");
  headers.set("x-content-type-options", "nosniff");
  return headers;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}

export default {
  fetch(request: Request, _environment: unknown, context: ExecutionContext) {
    return handleRequest(request, context, {
      cache: caches.default,
      fetchSource: fetchOfficialSource,
      now: () => new Date(),
    });
  },
} satisfies ExportedHandler;
