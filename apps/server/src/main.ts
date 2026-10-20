import { mkdirSync } from "node:fs";
import { loadConfig } from "#config.ts";
import { startInternalServer } from "#internal-server.ts";
import { createGameServer, restoreRooms } from "#server.ts";
import { openSqliteRoomStore } from "#store/sqlite-room-store.ts";

const config = loadConfig();
mkdirSync(config.dataDir, { recursive: true });
const store = openSqliteRoomStore(config.databasePath);
const internal = await startInternalServer({ port: config.internalPort, host: config.host });

const server = createGameServer({ store });
// Every Room has stopped (on SIGTERM/SIGINT) before the store closes.
server.onShutdown(async () => {
  store.close();
  await internal.close();
});

await server.listen(config.port, config.host);
console.log(`UNIversum server listening on http://${config.host}:${config.port}`);

const restored = await restoreRooms({
  store,
  onError: (code, error) =>
    console.error(`Room ${code} was not restored (it stays stored):`, error),
});
internal.ready();
console.log(`Restored ${restored} Room(s); ready on internal port ${internal.port}`);
