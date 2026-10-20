/** A Sentry-protocol DSN, `https://<public key>@<host>[/<path>]/<project id>`, taken apart. */
export type Dsn = {
  /** The DSN as given. */
  dsn: string;
  publicKey: string;
  /** Where the tracker accepts envelopes (its key in the query, as the SDKs send it). */
  envelopeUrl: string;
};

/** The DSN in `raw`, or `null` when it isn't one. */
export function parseDsn(raw: string): Dsn | null {
  let url: URL;
  try {
    url = new URL(raw);
  } catch {
    return null;
  }
  const match = /^(.*)\/(\d+)\/?$/.exec(url.pathname);
  if ((url.protocol !== "https:" && url.protocol !== "http:") || url.username === "" || !match) {
    return null;
  }
  const [, path = "", projectId = ""] = match;
  const publicKey = decodeURIComponent(url.username);
  const query = new URLSearchParams({ sentry_key: publicKey, sentry_version: "7" });
  return {
    dsn: raw,
    publicKey,
    envelopeUrl: `${url.protocol}//${url.host}${path}/api/${projectId}/envelope/?${query.toString()}`,
  };
}
