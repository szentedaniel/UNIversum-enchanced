/**
 * The server's clock, estimated from this client's. Every push carries
 * `clockOffset` (the server's `now` minus this client's at arrival), and every
 * countdown compares a server timestamp with this estimate. One function, so
 * the ring, the Minute pill, the Board and the Lobby can't disagree.
 */
export function serverNow(clockOffset: number, clientNow = Date.now()): number {
  return clientNow + clockOffset;
}
