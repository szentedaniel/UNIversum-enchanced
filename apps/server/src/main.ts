import { Server } from "@colyseus/core";
import { WebSocketTransport } from "@colyseus/ws-transport";
import { loadConfig } from "#config.ts";

const config = loadConfig();

const server = new Server({
  transport: new WebSocketTransport(),
  greet: false,
});

await server.listen(config.port, config.host);
console.log(`UNIversum server listening on http://${config.host}:${config.port}`);
