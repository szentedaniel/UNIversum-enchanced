/**
 * The Prometheus HTTP API, just enough of it for the verdict: instant and
 * range queries, parsed into the numbers or number series the criteria need.
 * PromQL responses are strings ("0.047", "NaN"), and an empty vector means
 * "no data" rather than zero.
 */
export type FetchLike = (
  url: string,
) => Promise<{ ok: boolean; status: number; json(): Promise<unknown> }>;

type PromSample = {
  metric?: Record<string, string>;
  value?: [number, string];
  values?: [number, string][];
};
type PromData = {
  resultType?: string;
  result?: PromSample[] | [number, string];
};

function dataOf(json: unknown): PromData {
  if (typeof json !== "object" || json === null) {
    throw new Error("Prometheus answered a non-object");
  }
  if ("status" in json && json.status === "error") {
    const error = "error" in json && typeof json.error === "string" ? json.error : "unknown error";
    throw new Error(`Prometheus query failed: ${error}`);
  }
  if (!("data" in json) || typeof json.data !== "object" || json.data === null) {
    throw new Error("Prometheus answered without data");
  }
  return json.data as PromData;
}

/** The sample as a finite number, or `null` for NaN, ±Infinity and no data. */
function numberOf(raw: string): number | null {
  const value = Number(raw);
  return Number.isFinite(value) ? value : null;
}

/** One instant query's first sample, or `null` when the query matched nothing. */
export function parseInstant(json: unknown): number | null {
  const data = dataOf(json);
  if (data.resultType === "scalar") {
    const scalar = data.result as [number, string] | undefined;
    return Array.isArray(scalar) && scalar.length === 2 ? numberOf(String(scalar[1])) : null;
  }
  const result = (data.result ?? []) as PromSample[];
  const value = result[0]?.value;
  return value === undefined ? null : numberOf(value[1]);
}

/** A range query's samples, one number array per series (empty series dropped). */
export function parseRange(json: unknown): number[][] {
  const data = dataOf(json);
  const result = (data.result ?? []) as PromSample[];
  return result
    .map((series) => (series.values ?? []).map(([, raw]) => numberOf(raw)))
    .map((values) => values.filter((value): value is number => value !== null))
    .filter((values) => values.length > 0);
}

/** How many distinct values a counter's samples held (e.g. process start times). */
export function distinctValues(values: number[]): number {
  return new Set(values).size;
}

export class PrometheusClient {
  readonly #baseUrl: string;
  readonly #fetch: FetchLike;

  constructor(baseUrl: string, fetchImpl: FetchLike = fetch) {
    this.#baseUrl = baseUrl.replace(/\/$/, "");
    this.#fetch = fetchImpl;
  }

  async instant(query: string, atMs: number): Promise<number | null> {
    const url = new URL("/api/v1/query", `${this.#baseUrl}/`);
    url.searchParams.set("query", query);
    url.searchParams.set("time", (atMs / 1_000).toFixed(3));
    return parseInstant(await this.#get(url));
  }

  async range(query: string, startMs: number, endMs: number, stepMs: number): Promise<number[][]> {
    const url = new URL("/api/v1/query_range", `${this.#baseUrl}/`);
    url.searchParams.set("query", query);
    url.searchParams.set("start", String(startMs / 1_000));
    url.searchParams.set("end", String(endMs / 1_000));
    url.searchParams.set("step", String(stepMs / 1_000));
    return parseRange(await this.#get(url));
  }

  async #get(url: URL): Promise<unknown> {
    const response = await this.#fetch(url.toString());
    if (!response.ok) {
      throw new Error(`Prometheus answered ${response.status} for ${url.pathname}`);
    }
    return response.json();
  }
}
