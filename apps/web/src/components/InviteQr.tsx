import { useMemo } from "react";
import { encode } from "uqr";
import { cn } from "#lib/utils.ts";
import { m } from "#text.ts";

/**
 * The invite link as a QR code: black modules on a white plate with the standard four-module
 * quiet zone, so it scans against the dark tabletop theme. It is encoded in the browser, so the
 * link never leaves it.
 */
export function InviteQr({ link, className }: { link: string; className?: string }) {
  const { path, size } = useMemo(() => {
    const { data, size: dimension } = encode(link, { ecc: "M", border: 4 });
    const modules: string[] = [];
    data.forEach((row, y) => {
      row.forEach((black, x) => {
        if (black) modules.push(`M${x},${y}h1v1h-1z`);
      });
    });
    return { path: modules.join(""), size: dimension };
  }, [link]);

  return (
    <svg
      viewBox={`0 0 ${size} ${size}`}
      aria-label={m.lobby_invite_qr()}
      shapeRendering="crispEdges"
      className={cn("block", className)}
    >
      <rect width={size} height={size} fill="#fff" />
      <path d={path} fill="#000" />
    </svg>
  );
}
