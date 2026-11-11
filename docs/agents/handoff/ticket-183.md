# Ticket #183 (Room invite link and QR): extension points and gotchas

Branch `agent/issue-183-invite-link-and-qr-code-for-a-room`.

- `apps/web/src/invite.ts` has `inviteLink(origin, code)`: the Room's own address,
  `${origin trailing slashes removed}/room/${encodeURIComponent(code)}`. It carries the Room code
  only, never a password or Guest token, so a passworded Room still prompts on arrival. The
  origin is `window.location.origin`; the code comes from `lobby.code`, not `useParams()`.
  `apps/web/test/invite.test.ts` pins the trailing-slash and URL-safe-segment cases.
- `apps/web/src/components/InviteQr.tsx` is the presentational QR: `InviteQr({ link, className })`
  calls `uqr`'s `encode(link, { ecc: "M", border: 4 })` and draws one `<path>` of 1×1 modules on a
  white `<rect>`, so it has the standard quiet zone and scans in the dark tabletop theme. No
  canvas, image fetch or external service: the link never leaves the browser. `uqr@0.1.3` is the
  catalog entry (zero dependencies); `apps/web/package.json` references it as `catalog:`.
- `apps/web/src/screens/Lobby.tsx` renders `InviteCard` under the Room-code sticker: `InviteQr` plus
  a copy button (`data-testid="invite-link"`). `useCopy()` is the shared clipboard feedback hook
  (`COPIED_MS`, swallow-the-rejection) behind both the sticker (`room-code`) and the invite button.
  Messages: `lobby_copy_link`, `lobby_invite_qr` in all three files, with `lobby_copied` reused.
  The invite is shown only in `Lobby`, not `Game`; no server, protocol or rules change was needed.

Read for: any Lobby share/invite surface, QR rendering, or another UI use of `uqr`.
