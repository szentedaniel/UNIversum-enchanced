/**
 * The Board renderer: plain PixiJS 8 behind a small imperative interface
 * (create it, hand it each view and its events, get Field taps back, destroy
 * it). React never sees Pixi objects; `Board.tsx` is the only bridge.
 *
 * It renders on demand: nothing draws while nothing changes. Events animate
 * in order; a newer push first skips the running animations to their end.
 * Each event type that moves something gets a case in `animationFor`.
 */
import type { EventOf, GameEvent, PlayerId, PublicView } from "@universum/rules";
import { FIELDS, type FieldId } from "@universum/rules/board";
import { Application, Container, Graphics, Text } from "pixi.js";
import { GROUP_COLORS, INK, KIND_COLORS, PLAYER_COLORS } from "#board/colors.ts";
import { diamond, fieldPoint, TILE_H, TILE_W, type Point } from "#board/layout.ts";

export type BoardOptions = {
  /** The Field's name in the active language. */
  fieldLabel(id: FieldId): string;
  onFieldTap?(id: FieldId): void;
};

export type Board = {
  /** Shows a new view, animating the events that led to it. */
  update(view: PublicView, events: readonly GameEvent[]): void;
  destroy(): void;
  /** Test hook: a Field's centre in viewport CSS pixels. */
  fieldCenter(id: FieldId): Point;
  /** Test hook: the latest view handed to the Board. */
  readonly view: PublicView | null;
};

type Animation = { duration: number; tick(progress: number): void };

type Scene = {
  pawnOf(player: PlayerId): Container | undefined;
  placePawn(player: PlayerId, at: Point): void;
};

const STEP_MS = 160;
const DICE_MS = 450;
const PAWN_OFFSETS: Point[] = [
  { x: -12, y: -4 },
  { x: 12, y: -4 },
  { x: -12, y: 6 },
  { x: 12, y: 6 },
];

const lerp = (a: Point, b: Point, t: number): Point => ({
  x: a.x + (b.x - a.x) * t,
  y: a.y + (b.y - a.y) * t,
});

const pause = (duration: number): Animation => ({ duration, tick: () => {} });

/** The pawn walks Field by Field. */
const walk = (event: EventOf<"Moved">, scene: Scene): Animation => ({
  duration: event.steps * STEP_MS,
  tick(progress) {
    const walked = progress * event.steps;
    const step = Math.min(Math.floor(walked), event.steps - 1);
    const from = fieldPoint(event.from + step);
    const to = fieldPoint(event.from + step + 1);
    scene.placePawn(event.player, lerp(from, to, walked - step));
  },
});

/** How each event animates; events without a case show only in the DOM. */
function animationFor(event: GameEvent, scene: Scene): Animation | undefined {
  switch (event.type) {
    case "DiceRolled":
      return pause(DICE_MS); // while the DOM shows the dice
    case "Moved":
      return walk(event, scene);
    default:
      return undefined;
  }
}

export async function createBoard(host: HTMLElement, options: BoardOptions): Promise<Board> {
  const app = new Application();
  await app.init({
    width: Math.max(1, host.clientWidth),
    height: Math.max(1, host.clientHeight),
    backgroundAlpha: 0,
    antialias: true,
    autoDensity: true,
    resolution: Math.min(window.devicePixelRatio || 1, 2),
    autoStart: false,
    preference: "webgl",
  });
  app.ticker.stop();
  host.appendChild(app.canvas);

  const world = new Container();
  const fieldLayer = new Container({ sortableChildren: true });
  const pawnLayer = new Container({ sortableChildren: true });
  world.addChild(fieldLayer, pawnLayer);
  app.stage.addChild(world);

  for (const field of FIELDS) {
    const center = fieldPoint(field.id);
    const tile = new Graphics()
      .poly(diamond(center, 3))
      .fill({ color: field.group ? GROUP_COLORS[field.group] : KIND_COLORS[field.kind] })
      .stroke({ width: 2, color: INK });
    tile.zIndex = center.y;
    tile.eventMode = "static";
    tile.cursor = "pointer";
    tile.on("pointertap", () => options.onFieldTap?.(field.id));
    const label = new Text({
      text: options.fieldLabel(field.id),
      anchor: 0.5,
      style: {
        fontFamily: "system-ui, sans-serif",
        fontSize: 11,
        fontWeight: "700",
        fill: INK,
        align: "center",
        wordWrap: true,
        wordWrapWidth: TILE_W * 0.6,
      },
    });
    label.position.set(center.x, center.y);
    label.zIndex = center.y + 0.5;
    label.eventMode = "none";
    fieldLayer.addChild(tile, label);
  }

  const pawns = new Map<PlayerId, Container>();
  const seats = new Map<PlayerId, number>();
  const scene: Scene = {
    pawnOf: (player) => pawns.get(player),
    placePawn(player, at) {
      const pawn = pawns.get(player);
      const offset = PAWN_OFFSETS[seats.get(player) ?? 0] ?? { x: 0, y: 0 };
      if (!pawn) return;
      pawn.position.set(at.x + offset.x, at.y + offset.y);
      pawn.zIndex = pawn.y;
    },
  };

  function syncPawns(view: PublicView): void {
    for (const player of view.players) {
      seats.set(player.id, player.seat);
      if (!pawns.has(player.id)) {
        const color = PLAYER_COLORS[player.seat] ?? INK;
        const pawn = new Container();
        pawn.addChild(
          new Graphics().ellipse(0, 0, 9, 4).fill({ color: INK, alpha: 0.25 }),
          new Graphics().circle(0, -12, 9).fill({ color }).stroke({ width: 2, color: INK }),
        );
        pawn.eventMode = "none";
        pawns.set(player.id, pawn);
        pawnLayer.addChild(pawn);
      }
      pawns.get(player.id)!.visible = !player.bankrupt;
    }
  }

  function placeAll(view: PublicView): void {
    for (const player of view.players) scene.placePawn(player.id, fieldPoint(player.position));
  }

  // ------------------------------------------------------------ render loop

  let frameId = 0;
  let running: { animation: Animation; startedAt: number } | null = null;
  const queue: Animation[] = [];

  function frame(now: number): void {
    frameId = 0;
    if (!running) {
      const next = queue.shift();
      if (next) running = { animation: next, startedAt: now };
    }
    if (running) {
      const { animation, startedAt } = running;
      const progress =
        animation.duration > 0 ? Math.min(1, (now - startedAt) / animation.duration) : 1;
      animation.tick(progress);
      if (progress >= 1) running = null;
    }
    app.render();
    if (running || queue.length > 0) invalidate();
  }

  function invalidate(): void {
    if (!frameId) frameId = requestAnimationFrame(frame);
  }

  /** Jumps every running and queued animation to its end. */
  function skipToEnd(): void {
    running?.animation.tick(1);
    running = null;
    for (const animation of queue.splice(0)) animation.tick(1);
  }

  // ------------------------------------------------------------ camera

  function fit(): void {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width === 0 || height === 0) return;
    app.renderer.resize(width, height);
    const bounds = {
      x: -4.5 * TILE_W,
      y: -TILE_H,
      w: 9 * TILE_W,
      h: 9 * TILE_H + TILE_H,
    };
    const pad = 8;
    const scale = Math.min((width - 2 * pad) / bounds.w, (height - 2 * pad) / bounds.h);
    world.scale.set(scale);
    world.position.set(
      width / 2 - (bounds.x + bounds.w / 2) * scale,
      height / 2 - (bounds.y + bounds.h / 2) * scale,
    );
    invalidate();
  }
  const resizeObserver = new ResizeObserver(fit);
  resizeObserver.observe(host);
  fit();

  // ------------------------------------------------------------ interface

  let shown: PublicView | null = null;

  return {
    update(view, events) {
      skipToEnd();
      if (shown) placeAll(shown);
      shown = view;
      syncPawns(view);
      if (events.length === 0) placeAll(view);
      for (const event of events) {
        const animation = animationFor(event, scene);
        if (animation) queue.push(animation);
      }
      queue.push({ duration: 0, tick: () => placeAll(view) });
      invalidate();
    },
    destroy() {
      resizeObserver.disconnect();
      if (frameId) cancelAnimationFrame(frameId);
      app.destroy({ removeView: true }, { children: true });
    },
    fieldCenter(id) {
      const local = world.toGlobal(fieldPoint(id));
      const rect = app.canvas.getBoundingClientRect();
      return { x: rect.left + local.x, y: rect.top + local.y };
    },
    get view() {
      return shown;
    },
  };
}
