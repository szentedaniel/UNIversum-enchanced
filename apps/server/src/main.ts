import { loadConfig } from "#config.ts";
import { createGameServer } from "#server.ts";

const config = loadConfig();
const server = createGameServer();

await server.listen(config.port, config.host);
console.log(`UNIversum server listening on http://${config.host}:${config.port}`);
