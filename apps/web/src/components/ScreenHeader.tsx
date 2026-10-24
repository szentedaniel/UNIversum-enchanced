/** The header of the inner screens: a back link pill and the small Logo. */
import { ArrowLeft } from "lucide-react";
import { Link } from "react-router";
import { Logo } from "#components/Logo.tsx";
import { buttonVariants } from "#components/ui/button.tsx";

export function ScreenHeader({ back, label }: { back: string; label: string }) {
  return (
    <header className="mx-auto flex max-w-5xl items-center justify-between gap-2 px-4 pt-5">
      <Link
        to={back}
        className={buttonVariants({ variant: "plain", size: "sm", className: "rounded-full" })}
      >
        <ArrowLeft size={18} strokeWidth={3} aria-hidden />
        {label}
      </Link>
      <Logo small />
    </header>
  );
}
