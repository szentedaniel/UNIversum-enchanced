/**
 * Covers the Lobby or game while the connection is down (spec: Client →
 * State), so the screen is never just dead. While reconnecting it offers
 * "back to home" after 30 s; once the connection is lost, at once.
 */
import { WifiOff } from "lucide-react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router";
import { useStore } from "zustand";
import { Button } from "#components/ui/button.tsx";
import { Card } from "#components/ui/card.tsx";
import { leaveRoom } from "#connection.ts";
import { roomStore } from "#stores/room-store.ts";
import { m } from "#text.ts";

/** How long the overlay waits before it offers "back to home" while reconnecting. */
export const BACK_HOME_AFTER_MS = 30_000;

export function ReconnectOverlay() {
  const status = useStore(roomStore, (s) => s.status);
  const takenElsewhere = useStore(roomStore, (s) => s.takenElsewhere);
  if (status === "reconnecting") return <Overlay key="reconnecting" reconnecting />;
  if (status === "lost") {
    return (
      <Overlay
        key="lost"
        reconnecting={false}
        text={takenElsewhere ? m.seat_taken_elsewhere() : m.connection_lost()}
      />
    );
  }
  return null;
}

function Overlay({ reconnecting, text }: { reconnecting: boolean; text?: string }) {
  const navigate = useNavigate();
  // Mounted afresh for each reconnect (its `key`), so the 30 s start over.
  const [late, setLate] = useState(false);

  useEffect(() => {
    if (!reconnecting) return undefined;
    const timer = setTimeout(() => setLate(true), BACK_HOME_AFTER_MS);
    return () => clearTimeout(timer);
  }, [reconnecting]);

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-ink/50 p-safe-4"
      data-testid="reconnect-overlay"
    >
      <Card
        role="alertdialog"
        aria-modal
        aria-labelledby="reconnect-title"
        className="w-full max-w-sm items-center gap-3 p-5"
      >
        <WifiOff
          size={36}
          strokeWidth={2.5}
          aria-hidden
          className={reconnecting ? "animate-pulse" : undefined}
        />
        <p id="reconnect-title" className="m-0 text-center text-xl font-black">
          {text ?? m.reconnecting()}
        </p>
        {reconnecting && (
          <p className="m-0 text-center font-bold text-ink/70">{m.reconnecting_hint()}</p>
        )}
        {(!reconnecting || late) && (
          <Button
            className="w-full"
            onClick={() => {
              void leaveRoom();
              void navigate("/");
            }}
          >
            {m.back_home()}
          </Button>
        )}
      </Card>
    </div>
  );
}
