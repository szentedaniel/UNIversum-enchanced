/**
 * Room passwords: scrypt with the `node:crypto` defaults and a salt per Room.
 * The hash lives on the Room instance and in its stored snapshot (as base64,
 * so a restored password Room still asks for it); it never goes into the Lobby
 * listing, a message or a log.
 */
import { randomBytes, scrypt, timingSafeEqual, type BinaryLike } from "node:crypto";
import type { StoredPassword } from "#store/room-store.ts";

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

/** The hash as the store keeps it (JSON-safe). */
export const encodePassword = ({ salt, hash }: PasswordHash): StoredPassword => ({
  salt: salt.toString("base64"),
  hash: hash.toString("base64"),
});

export const decodePassword = ({ salt, hash }: StoredPassword): PasswordHash => ({
  salt: Buffer.from(salt, "base64"),
  hash: Buffer.from(hash, "base64"),
});
