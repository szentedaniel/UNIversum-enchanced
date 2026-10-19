/**
 * The Zod-free part of the protocol: message names and types. This subpath
 * (`@universum/protocol/messages`) is the only one the web app may import.
 */

/** The one message a client sends to a game Room. */
export const INTENT_MESSAGE = "intent";
export type IntentMessage = typeof INTENT_MESSAGE;
