import { createServer, type Server } from "node:http";
import { afterEach, describe, expect, it } from "vitest";
import { parseDsn } from "#observability/dsn.ts";
import { startTestServer, type TestServer } from "./helpers.ts";

let server: TestServer | undefined;
let tracker: Server | undefined;

afterEach(async () => {
  await server?.stop();
  server = undefined;
  if (tracker) {
    const closing = tracker;
    tracker = undefined;
    closing.closeAllConnections();
    const stopped = Promise.withResolvers<void>();
    closing.close(() => stopped.resolve());
    await stopped.promise;
  }
});

/** A fake Sentry-protocol tracker: keeps every envelope body it is POSTed. */
async function fakeTracker(status = 200) {
  const envelopes: Buffer[] = [];
  const http = createServer((request, response) => {
    const chunks: Buffer[] = [];
    request.on("data", (chunk: Buffer) => chunks.push(chunk));
    request.on("end", () => {
      envelopes.push(Buffer.concat(chunks));
      response.writeHead(status);
      response.end();
    });
  });
  http.listen(0, "127.0.0.1");
  const listening = Promise.withResolvers<void>();
  http.once("listening", listening.resolve);
  await listening.promise;
  const address = http.address();
  if (address === null || typeof address === "string") throw new Error("no TCP port");
  tracker = http;
  return { envelopes, dsn: parseDsn(`http://public@127.0.0.1:${address.port}/42`)! };
}

/** A Sentry envelope with the given items, the client's DSN placeholder in its header. */
function envelope(items: { type: string; payload: unknown }[]): string {
  const lines = [
    JSON.stringify({ event_id: "abc123", dsn: "https://placeholder@client.invalid/1" }),
  ];
  for (const { type, payload } of items) {
    const body = typeof payload === "string" ? payload : JSON.stringify(payload);
    lines.push(JSON.stringify({ type, length: Buffer.byteLength(body) }), body);
  }
  return `${lines.join("\n")}\n`;
}

/** The envelope a tracker received, parsed with a deliberately independent reader. */
function readEnvelope(body: Buffer) {
  const lines = body
    .toString("utf8")
    .split("\n")
    .filter((line) => line !== "");
  const header: Record<string, unknown> = JSON.parse(lines[0] ?? "{}");
  const items: { header: Record<string, unknown>; payload: Record<string, unknown> }[] = [];
  for (let i = 1; i < lines.length; i += 2) {
    items.push({
      header: JSON.parse(lines[i] ?? "{}"),
      payload: JSON.parse(lines[i + 1] ?? "{}"),
    });
  }
  return { header, items };
}

const eventPayload = (extra: Record<string, unknown> = {}) => ({
  event_id: "abc123",
  message: "boom",
  level: "error",
  user: { id: "public-player-id", ip_address: "203.0.113.9" },
  request: {
    url: "http://localhost/game/123456",
    headers: { cookie: "session=secret", authorization: "Bearer secret" },
    cookies: { session: "secret" },
  },
  extra: {
    guestToken: "0123456789abcdef0123456789abcdef",
    reconnectionToken: "reconnection-secret",
    password: "hunter2-secret",
  },
  ...extra,
});

async function post(port: number, body: string, headers: Record<string, string> = {}) {
  return fetch(`http://127.0.0.1:${port}/errors`, {
    method: "POST",
    headers: { "content-type": "application/x-sentry-envelope", ...headers },
    body,
  });
}

describe("the error tunnel", () => {
  it("is 404 and reports nothing when SENTRY_DSN is not set", async () => {
    server = await startTestServer();

    const config = await fetch(`http://127.0.0.1:${server.port}/client-config`);
    expect(await config.json()).toEqual({ errorReporting: false });

    const response = await post(
      server.port,
      envelope([{ type: "event", payload: eventPayload() }]),
    );
    expect(response.status).toBe(404);
  });

  it("tells the client reporting is on, and forwards only events with the real DSN and no secrets", async () => {
    const { envelopes, dsn } = await fakeTracker();
    server = await startTestServer({ errorReporting: dsn });

    const config = await fetch(`http://127.0.0.1:${server.port}/client-config`);
    expect(await config.json()).toEqual({ errorReporting: true });

    const response = await post(
      server.port,
      envelope([
        { type: "session", payload: { session_id: "session-1" } },
        { type: "event", payload: eventPayload() },
        { type: "transaction", payload: { transaction: "x" } },
      ]),
    );

    expect(response.status).toBe(200);
    expect(envelopes).toHaveLength(1);
    const forwarded = readEnvelope(envelopes[0]!);
    expect(forwarded.header).toMatchObject({ dsn: dsn.dsn, event_id: "abc123" });
    expect(forwarded.items.map((item) => item.header["type"])).toEqual(["event"]);
    expect(forwarded.items[0]?.header["length"]).toBe(
      Buffer.byteLength(JSON.stringify(forwarded.items[0]?.payload)),
    );
    expect(forwarded.items[0]?.payload).toMatchObject({
      message: "boom",
      user: { id: "public-player-id" },
    });
    const text = envelopes[0]!.toString("utf8");
    for (const secret of [
      "203.0.113.9",
      "0123456789abcdef0123456789abcdef",
      "reconnection-secret",
      "hunter2-secret",
      "session=secret",
      "Bearer secret",
      "session-1",
      "transaction",
    ]) {
      expect(text).not.toContain(secret);
    }
  });

  it("forwards the browser SDK's envelope: no item length and no trailing newline", async () => {
    const { envelopes, dsn } = await fakeTracker();
    server = await startTestServer({ errorReporting: dsn });
    const header = JSON.stringify({ event_id: "abc123", dsn: "https://public@errors.invalid/1" });
    const item = JSON.stringify({ type: "event" });
    const payload = JSON.stringify(eventPayload());

    const response = await post(server.port, `${header}\n${item}\n${payload}`);

    expect(response.status).toBe(200);
    expect(envelopes).toHaveLength(1);
    const forwarded = readEnvelope(envelopes[0]!);
    expect(forwarded.items).toHaveLength(1);
    expect(forwarded.items[0]?.payload).toMatchObject({ message: "boom" });
    expect(envelopes[0]!.toString("utf8")).not.toContain("203.0.113.9");
  });

  it("filters tokens inside strings: URLs, query strings, breadcrumbs and messages", async () => {
    const { envelopes, dsn } = await fakeTracker();
    server = await startTestServer({ errorReporting: dsn });
    const reconnectionToken = "reconnection-secret-123";
    const guestToken = "abcdef0123456789abcdef0123456789";
    const messageToken = "0123456789abcdef0123456789abcdef";
    const payload = eventPayload({
      message: `engine exploded with ${messageToken}`,
      exception: { values: [{ type: "Error", value: `bad token ${messageToken}` }] },
      breadcrumbs: [
        {
          category: "fetch",
          data: {
            url: `http://localhost/colyseus/matchmake/joinById/123456?reconnectionToken=${reconnectionToken}&other=keep`,
          },
        },
      ],
      request: {
        url: `http://localhost/game/123456?guestToken=${guestToken}&lang=en`,
        query_string: `guestToken=${guestToken}&lang=en`,
      },
    });

    const response = await post(server.port, envelope([{ type: "event", payload }]));

    expect(response.status).toBe(200);
    const text = envelopes[0]!.toString("utf8");
    for (const secret of [reconnectionToken, guestToken, messageToken]) {
      expect(text).not.toContain(secret);
    }
    expect(text).toContain("reconnectionToken=[Filtered]&other=keep");
    expect(text).toContain("guestToken=[Filtered]&lang=en");
    expect(text).toContain("engine exploded with [Filtered]");
    expect(text).toContain("bad token [Filtered]");
  });

  it("leaves Sentry's own 32-hex ids alone while filtering a bare Guest token in a message", async () => {
    const { envelopes, dsn } = await fakeTracker();
    server = await startTestServer({ errorReporting: dsn });
    const eventId = "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
    const traceId = "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb";
    const sessionId = "dddddddddddddddddddddddddddddddd";
    const guestToken = "cccccccccccccccccccccccccccccccc";
    const payload = eventPayload({
      event_id: eventId,
      contexts: { trace: { trace_id: traceId, span_id: "eeeeeeeeeeeeeeee" } },
      sid: sessionId,
      message: `guest ${guestToken} failed`,
    });

    const response = await post(server.port, envelope([{ type: "event", payload }]));

    expect(response.status).toBe(200);
    const text = envelopes[0]!.toString("utf8");
    expect(text).toContain(`"event_id":"${eventId}"`);
    expect(text).toContain(`"trace_id":"${traceId}"`);
    expect(text).toContain(`"sid":"${sessionId}"`);
    expect(text).not.toContain(guestToken);
    expect(text).toContain("guest [Filtered] failed");
  });

  it("drops an envelope without events, and refuses a malformed one", async () => {
    const { envelopes, dsn } = await fakeTracker();
    server = await startTestServer({ errorReporting: dsn });

    const noEvent = await post(
      server.port,
      envelope([{ type: "session", payload: { session_id: "session-1" } }]),
    );
    expect(noEvent.status).toBe(200);
    expect(envelopes).toHaveLength(0);

    const malformed = await post(server.port, "not an envelope");
    expect(malformed.status).toBe(400);
  });

  it("allows 10 envelopes a minute per IP, then answers RATE_LIMITED", async () => {
    const { envelopes, dsn } = await fakeTracker();
    server = await startTestServer({ errorReporting: dsn });
    const body = envelope([{ type: "event", payload: eventPayload() }]);

    for (let i = 0; i < 10; i++) {
      // oxlint-disable-next-line no-await-in-loop -- one envelope after another
      expect((await post(server.port, body)).status).toBe(200);
    }
    const refused = await post(server.port, body);

    expect(refused.status).toBe(429);
    expect(Number(refused.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(envelopes).toHaveLength(10);
    const scrape = await server.metrics.scrape();
    expect(scrape).toContain('limiter_refusals_total{limit="error_events"} 1');
  });

  it("refuses a body over the size cap with an empty reply", async () => {
    const { dsn } = await fakeTracker();
    server = await startTestServer({ errorReporting: dsn, limits: { errorReportBytes: 64 } });

    const response = await post(
      server.port,
      envelope([{ type: "event", payload: eventPayload() }]),
    );

    expect(response.status).toBe(413);
    expect(response.headers.get("retry-after")).toBeNull();
    expect(await response.text()).toBe("");
  });

  it("refuses a chunked body that grows over the size cap", async () => {
    const { dsn } = await fakeTracker();
    server = await startTestServer({ errorReporting: dsn, limits: { errorReportBytes: 64 } });
    const chunk = new TextEncoder().encode(" ".repeat(32));
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (let i = 0; i < 3; i++) controller.enqueue(chunk);
        controller.close();
      },
    });

    const response = await fetch(`http://127.0.0.1:${server.port}/errors`, {
      method: "POST",
      headers: { "content-type": "application/x-sentry-envelope" },
      body,
      duplex: "half",
    });

    expect(response.status).toBe(413);
    expect(await response.text()).toBe("");
  });

  it("only accepts POST on the tunnel, and only GET on the client config", async () => {
    const { dsn } = await fakeTracker();
    server = await startTestServer({ errorReporting: dsn });

    expect((await fetch(`http://127.0.0.1:${server.port}/errors`)).status).toBe(405);
    expect(
      (
        await fetch(`http://127.0.0.1:${server.port}/client-config`, {
          method: "POST",
          body: "{}",
        })
      ).status,
    ).toBe(405);
  });

  it("answers 502 when the tracker refuses the envelope", async () => {
    const { dsn } = await fakeTracker(500);
    server = await startTestServer({ errorReporting: dsn });

    const response = await post(
      server.port,
      envelope([{ type: "event", payload: eventPayload() }]),
    );

    expect(response.status).toBe(502);
  });
});
