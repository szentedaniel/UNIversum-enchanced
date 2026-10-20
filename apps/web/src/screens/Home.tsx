import { useEffect } from "react";
import { List, Plus } from "lucide-react";
import { Link } from "react-router";
import { LanguagePicker } from "#components/LanguagePicker.tsx";
import { Logo } from "#components/Logo.tsx";
import { buttonVariants } from "#components/ui/button.tsx";
import { leaveRoom } from "#connection.ts";
import { JoinByCode } from "#screens/join.tsx";
import { m } from "#text.ts";

export function Home() {
  // Coming home leaves any Room (its Lobby Seat is freed).
  useEffect(() => {
    void leaveRoom();
  }, []);

  return (
    <main className="mx-auto flex min-h-dvh max-w-2xl flex-col items-center gap-6 px-4 pt-10 pb-8 text-center md:pt-16">
      <Logo />
      <nav className="flex w-full max-w-md flex-col gap-3">
        <Link to="/create" className={buttonVariants({ size: "lg", className: "w-full" })}>
          <Plus size={26} strokeWidth={3} aria-hidden />
          {m.home_create()}
        </Link>
        <Link to="/rooms" className={buttonVariants({ variant: "plain", className: "w-full" })}>
          <List size={22} strokeWidth={3} aria-hidden />
          {m.home_lobby_list()}
        </Link>
      </nav>
      <p className="m-0 font-bold text-muted-foreground">{m.home_or_join()}</p>
      <JoinByCode />
      <LanguagePicker className="mt-2" />
    </main>
  );
}
