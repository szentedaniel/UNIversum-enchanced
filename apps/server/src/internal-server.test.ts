import { afterEach, describe, expect, it } from "vitest";
import { startInternalServer, type InternalServer } from "#internal-server.ts";

let server: InternalServer | undefined;

afterEach(async () => {
  await server?.close();
  server = undefined;
});

describe("the internal port", () => {
  it("/healthz answers as soon as the process is up; /readyz only once restore has finished", async () => {
    server = await startInternalServer({ port: 0, host: "127.0.0.1" });
    const get = (path: string) => fetch(`http://127.0.0.1:${server?.port}${path}`);

    expect((await get("/healthz")).status).toBe(200);
    expect((await get("/readyz")).status).toBe(503);

    server.ready();

    expect((await get("/readyz")).status).toBe(200);
    expect((await get("/healthz")).status).toBe(200);
  });

  it("serves nothing else", async () => {
    server = await startInternalServer({ port: 0, host: "127.0.0.1" });

    const response = await fetch(`http://127.0.0.1:${server.port}/matchmake/create/game`);

    expect(response.status).toBe(404);
  });
});
