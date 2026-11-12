/**
 * The invite link: the Room's own address, `/room/<Room code>`, which the Lobby opens and joins
 * in one click. It carries the Room code only — never the password or a Guest token, so a
 * passworded Room still asks for its password on arrival and a link never leaks a Seat.
 */
export function inviteLink(origin: string, code: string): string {
  return `${origin.replace(/\/+$/, "")}/room/${encodeURIComponent(code)}`;
}
