export const SOURCE_URL =
  "https://www.stats.gov.cn/sj/fbrc/index_fbrc.html";

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
        signal: AbortSignal.timeout(20_000),
      });
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError instanceof Error
    ? lastError
    : new Error("Source request failed");
}
