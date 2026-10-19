/**
 * Room passwords: scrypt with the `node:crypto` defaults and a salt per Room.
 * The hash stays in the Room instance's memory (the SQLite store keeps it
 * from #34); it never goes into the Lobby listing, a message or a log.
 */
import { randomBytes, scrypt, timingSafeEqual, type BinaryLike } from "node:crypto";

const SALT_BYTES = 16;
const KEY_BYTES = 64;

export type PasswordHash = { salt: Buffer; hash: Buffer };

const derive = (password: string, salt: BinaryLike): Promise<Buffer> =>
  new Promise((resolve, reject) => {
    scrypt(password, salt, KEY_BYTES, (error, key) => (error ? reject(error) : resolve(key)));
  });

export async function hashPassword(password: string): Promise<PasswordHash> {
  const salt = randomBytes(SALT_BYTES);
  return { salt, hash: await derive(password, salt) };
}

export async function passwordMatches(stored: PasswordHash, password: string): Promise<boolean> {
  return timingSafeEqual(stored.hash, await derive(password, stored.salt));
}
