/**
 * The Board renderer: plain PixiJS 8 behind a small imperative interface
 * (create it, hand it each view and its events, get Field taps back, drive the
 * camera, destroy it). React never sees Pixi objects; `Board.tsx` is the only
 * bridge.
 *
 * It renders on demand: nothing draws while nothing changes. Events animate
 * in order; a newer push first skips the running animations to their end.
 * Each event type that moves something gets a case in `animationFor`.
 *
 * Camera (prototype variant E): it starts fitted to the fit area and returns
 * to fit at each Turn change unless the Player turned Follow on. Taps open the
 * nearest Field; selecting or revealing a Field pans at most, never zooms.
 */
import type { EventOf, GameEvent, PlayerId, PublicView } from "@universum/rules";
import { FIELD_COUNT, FIELDS, type FieldId } from "@universum/rules/board";
import { Application, Assets, Container, Graphics, Sprite, Text, type Spritesheet } from "pixi.js";
import { createFieldArt, type FieldArt, type Frames } from "#board/art.ts";
import {
  centreOf,
  clampCamera,
  fitCamera,
  sameCamera,
  scaleLimits,
  toScreen,
  zoomAround,
  type Camera,
  type Rect,
} from "#board/camera.ts";
import { INK, PLAYER_COLORS } from "#board/colors.ts";
import { attachGestures } from "#board/gestures.ts";
import { FIELD_WIDTH, fieldPoint, type Point } from "#board/layout.ts";

export type BoardOptions = {
  /** The Field's name in the active language. */
  fieldLabel(id: FieldId): string;
  /** Compact money shown on the Field's tile (its Rent), or `null`. */
  fieldNote?(view: PublicView, id: FieldId): string | null;
  /** A tap: the nearest Field within reach, or `null` for a tap far from every Field. */
  onFieldTap?(id: FieldId | null): void;
  /** Follow was switched off by hand (a drag, pinch or wheel). */
  onFollowChange?(on: boolean): void;
};

export type Board = {
  /** Shows a new view, animating the events that led to it. */
  update(view: PublicView, events: readonly GameEvent[]): void;
  /** Rings and lifts the Field whose card is open. Never moves the camera. */
  setSelected(id: FieldId | null): void;
  /** Pans (never zooms) only if the Field is off screen or under one of `obstacles` (viewport rects). */
  reveal(id: FieldId, obstacles: readonly DOMRect[]): void;
  /** Zooms around the fit area's centre. */
  zoomBy(factor: number): void;
  fit(): void;
  /** Follow keeps the moving pawn in the middle of the fit area. */
  setFollow(on: boolean): void;
  destroy(): void;
  /** Test hook: a Field's centre in viewport CSS pixels. */
  fieldCenter(id: FieldId): Point;
  /** Test hook: the camera (canvas CSS px per Board unit, and offset). */
  camera(): Camera;
  /** Test hook: the latest view handed to the Board. */
  readonly view: PublicView | null;
};

type Animation = { duration: number; tick(progress: number): void };

type Scene = {
  placePawn(player: PlayerId, at: Point): void;
};

const STEP_MS = 160;
const DICE_MS = 450;
const PAN_MS = 250;
const FIT_MS = 300;
/** Text is re-rasterised this long after the camera stops. */
const SETTLE_MS = 120;
/** A Field closer than this to an obstacle or the screen edge counts as hidden. */
const REVEAL_MARGIN = 24;
/** Tap reach: `max(90 px, 1.6 × Field width)` (spec: Taps). */
const TAP_REACH_PX = 90;
const TAP_REACH_FIELDS = 1.6;
const FOLLOW_ZOOM = 2.6;
const FOLLOW_EASE = 0.12;
const SELECTED_LIFT = 12;
const RING_PX = 3;
const RING_COLOR = 0xff7a1a;
const ZOOM_STEP_MS = 200;

const PAWN_WIDTH = 92;
const PAWN_OFFSETS: Point[] = [
  { x: -30, y: -8 },
  { x: 30, y: -8 },
  { x: -14, y: 14 },
  { x: 14, y: 14 },
];
/** The shape cue over each pawn, by Seat (spec: Player colours). */
const SEAT_SHAPES = ["●", "▲", "■", "★"];

const lerp = (a: number, b: number, t: number) => a + (b - a) * t;
const lerpPoint = (a: Point, b: Point, t: number): Point => ({
  x: lerp(a.x, b.x, t),
  y: lerp(a.y, b.y, t),
});
const easeOut = (t: number) => 1 - (1 - t) ** 3;

const pause = (duration: number): Animation => ({ duration, tick: () => {} });

/** The pawn walks Field by Field. */
const walk = (event: EventOf<"Moved">, scene: Scene): Animation => ({
  duration: event.steps * STEP_MS,
  tick(progress) {
    const walked = progress * event.steps;
    const step = Math.min(Math.floor(walked), event.steps - 1);
    const from = fieldPoint(event.from + step);
    const to = fieldPoint(event.from + step + 1);
    scene.placePawn(event.player, lerpPoint(from, to, walked - step));
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

// ------------------------------------------------------------ atlas

const ATLAS_BUNDLE = "board";
let atlas: Promise<Spritesheet> | null = null;

/** Loads the Board atlas once per page: half resolution on low-memory devices. */
function loadAtlas(): Promise<Spritesheet> {
  atlas ??= (async () => {
    const device = navigator as Navigator & { deviceMemory?: number };
    const low = (device.deviceMemory ?? 8) <= 2;
    await Assets.init({
      basePath: "/atlas/",
      manifest: "/atlas/manifest.json",
      texturePreference: { resolution: low ? 0.5 : 1, format: ["png"] },
    });
    const bundle: Record<string, Spritesheet> = await Assets.loadBundle(ATLAS_BUNDLE);
    const sheet = bundle[ATLAS_BUNDLE] ?? Object.values(bundle)[0];
    if (!sheet) throw new Error("The Board atlas has no spritesheet");
    return sheet;
  })();
  return atlas;
}

/**
 * Creates the Board in `host`. The camera fits the Board into `fitArea`, an
 * element over the host (the host minus the space the card or tray reserves).
 */
export async function createBoard(
  host: HTMLElement,
  fitArea: HTMLElement,
  options: BoardOptions,
): Promise<Board> {
  const sheet = await loadAtlas();
  const frames: Frames = (name) => {
    const texture = sheet.textures[name];
    if (!texture) throw new Error(`The Board atlas has no frame "${name}"`);
    return texture;
  };

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

  // ------------------------------------------------------------ Fields

  const fields: FieldArt[] = [];
  const fieldPoints: Point[] = [];
  for (const field of FIELDS) {
    const art = createFieldArt(field, options.fieldLabel(field.id), frames);
    const at = fieldPoint(field.id);
    const mirror = art.container.scale.x;
    art.container.position.set(at.x - art.centre.x * mirror, at.y - art.centre.y);
    art.container.zIndex = at.y;
    fieldLayer.addChild(art.container);
    fields.push(art);
    fieldPoints.push(at);
  }
  // Measured before any building or pawn, so the fit never changes during play.
  const local = fieldLayer.getLocalBounds();
  const bounds: Rect = { x: local.x, y: local.y, w: local.width, h: local.height };

  let selected: FieldId | null = null;

  /** The Field's top-face centre in Board units (lifted while selected). */
  const boardCentre = (id: FieldId): Point => {
    const at = fieldPoints[id] ?? { x: 0, y: 0 };
    return id === selected ? { x: at.x, y: at.y - SELECTED_LIFT } : at;
  };

  function applySelected(): void {
    fields.forEach((art, id) => {
      const at = fieldPoints[id] ?? { x: 0, y: 0 };
      const on = id === selected;
      art.container.y = at.y - art.centre.y - (on ? SELECTED_LIFT : 0);
      art.container.zIndex = on ? 1e6 : at.y;
      art.setRing(on ? { color: RING_COLOR, width: RING_PX / camera.scale } : null);
    });
    invalidate();
  }

  // ------------------------------------------------------------ pawns

  const pawns = new Map<PlayerId, Container>();
  const seats = new Map<PlayerId, number>();
  /** The pawn the camera follows: the one walking, else the current Player's. */
  let focus: PlayerId | null = null;
  const badgeTexts: Text[] = [];
  const scene: Scene = {
    placePawn(player, at) {
      const pawn = pawns.get(player);
      if (!pawn) return;
      const offset = PAWN_OFFSETS[seats.get(player) ?? 0] ?? { x: 0, y: 0 };
      pawn.position.set(at.x + offset.x, at.y + offset.y);
      pawn.zIndex = pawn.y;
      focus = player;
    },
  };

  function createPawn(seat: number): Container {
    const pawn = new Container();
    const figure = new Sprite({ texture: frames(`alien_p${seat}`), anchor: { x: 0.5, y: 0.9 } });
    figure.scale.set(PAWN_WIDTH / figure.texture.width);
    const shadow = new Graphics().ellipse(0, 0, 30, 12).fill({ color: INK, alpha: 0.25 });
    const badge = new Container({ y: -figure.height - 14 });
    badge.addChild(
      new Graphics()
        .circle(0, 0, 20)
        .fill({ color: PLAYER_COLORS[seat] ?? 0xffffff })
        .stroke({ width: 4, color: INK }),
    );
    const shape = new Text({
      text: SEAT_SHAPES[seat] ?? "",
      anchor: 0.5,
      style: { fontFamily: "Arial, sans-serif", fontWeight: "bold", fontSize: 22, fill: INK },
    });
    badgeTexts.push(shape);
    badge.addChild(shape);
    pawn.addChild(shadow, figure, badge);
    return pawn;
  }

  function syncPawns(view: PublicView): void {
    for (const player of view.players) {
      seats.set(player.id, player.seat);
      if (!pawns.has(player.id)) {
        const pawn = createPawn(player.seat);
        pawns.set(player.id, pawn);
        pawnLayer.addChild(pawn);
      }
      pawns.get(player.id)!.visible = !player.bankrupt;
    }
  }

  function placeAll(view: PublicView): void {
    for (const player of view.players) scene.placePawn(player.id, fieldPoint(player.position));
    focus = view.currentPlayer;
  }

  function syncFields(view: PublicView): void {
    const seatOf = new Map(view.players.map((p) => [p.id, p.seat]));
    fields.forEach((art, id) => {
      const state = view.fields[id];
      art.setLook({
        ownerSeat: state?.owner ? (seatOf.get(state.owner) ?? null) : null,
        level: state?.level ?? 0,
        hasDoubler: view.doubler?.field === id,
        note: options.fieldNote?.(view, id) ?? null,
      });
    });
    settleText();
  }

  // ------------------------------------------------------------ camera

  let camera: Camera = { scale: 1, x: 0, y: 0 };
  let fitted: Camera = camera;
  let area: Rect = { x: 0, y: 0, w: 1, h: 1 };
  /** True while the camera shows the fit (so a resize re-fits instead of clamping). */
  let atFit = true;
  let follow = false;
  let tween: { from: Camera; to: Camera; startedAt: number; duration: number } | null = null;
  let settleTimer = 0;

  function measure(): void {
    const hostRect = host.getBoundingClientRect();
    const fitRect = fitArea.getBoundingClientRect();
    area =
      fitRect.width > 0 && fitRect.height > 0
        ? {
            x: fitRect.left - hostRect.left,
            y: fitRect.top - hostRect.top,
            w: fitRect.width,
            h: fitRect.height,
          }
        : { x: 0, y: 0, w: hostRect.width, h: hostRect.height };
    fitted = fitCamera(bounds, area);
  }

  function setCamera(next: Camera): void {
    const clamped = clampCamera(next, fitted, bounds, area);
    if (sameCamera(clamped, camera)) return;
    const zoomed = clamped.scale !== camera.scale;
    camera = clamped;
    world.scale.set(camera.scale);
    world.position.set(camera.x, camera.y);
    if (zoomed && selected !== null) applySelected();
    if (zoomed) settleText();
    invalidate();
  }

  function animateTo(to: Camera, duration: number): void {
    tween = { from: camera, to, startedAt: performance.now(), duration };
    invalidate();
  }

  /** Re-rasterises every canvas text at the zoom level once the camera settles. */
  function settleText(): void {
    clearTimeout(settleTimer);
    settleTimer = window.setTimeout(() => {
      const resolution = Math.min(4, Math.max(0.5, app.renderer.resolution * camera.scale * 1.2));
      for (const art of fields) for (const text of art.texts) text.resolution = resolution;
      for (const text of badgeTexts) text.resolution = resolution;
      invalidate();
    }, SETTLE_MS);
  }

  function fitNow(animate: boolean): void {
    atFit = true;
    if (animate) animateTo(fitted, FIT_MS);
    else {
      tween = null;
      setCamera(fitted);
    }
  }

  function setFollow(on: boolean, byHand = false): void {
    if (on === follow) return;
    follow = on;
    if (on) {
      atFit = false;
      tween = null;
      if (camera.scale < fitted.scale * 2) {
        setCamera(zoomAround(camera, centreOf(area), fitted.scale * FOLLOW_ZOOM));
      }
      invalidate();
    }
    if (byHand) options.onFollowChange?.(on);
  }

  function resize(): void {
    const width = host.clientWidth;
    const height = host.clientHeight;
    if (width === 0 || height === 0) return;
    app.renderer.resize(width, height);
    measure();
    if (atFit) fitNow(false);
    else setCamera(camera);
    invalidate();
  }

  const detachGestures = attachGestures(app.canvas, {
    camera: () => camera,
    move: (next) => {
      tween = null;
      setCamera(next);
    },
    scaleLimits: () => scaleLimits(fitted),
    moved() {
      atFit = false;
      tween = null;
      setFollow(false, true);
    },
    tap(at) {
      let nearest: FieldId | null = null;
      let distance = Infinity;
      for (let id = 0; id < FIELD_COUNT; id++) {
        const centre = toScreen(camera, boardCentre(id));
        const d = Math.hypot(centre.x - at.x, centre.y - at.y);
        if (d < distance) {
          distance = d;
          nearest = id;
        }
      }
      const reach = Math.max(TAP_REACH_PX, TAP_REACH_FIELDS * FIELD_WIDTH * camera.scale);
      options.onFieldTap?.(distance <= reach ? nearest : null);
    },
  });

  // ------------------------------------------------------------ render loop

  let frameId = 0;
  let running: { animation: Animation; startedAt: number } | null = null;
  const queue: Animation[] = [];

  function frame(now: number): void {
    frameId = 0;
    let busy = false;
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
      busy = true;
    }
    if (tween) {
      const t = Math.min(1, Math.max(0, (now - tween.startedAt) / tween.duration));
      const k = easeOut(t);
      const { from, to } = tween;
      setCamera({
        scale: lerp(from.scale, to.scale, k),
        x: lerp(from.x, to.x, k),
        y: lerp(from.y, to.y, k),
      });
      if (t >= 1) {
        setCamera(to);
        tween = null;
      }
      busy = true;
    }
    if (follow && focus) {
      const pawn = pawns.get(focus);
      if (pawn) {
        const at = toScreen(camera, pawn.position);
        const target = centreOf(area);
        const dx = target.x - at.x;
        const dy = target.y - at.y;
        if (Math.abs(dx) + Math.abs(dy) > 0.5) {
          setCamera({ ...camera, x: camera.x + dx * FOLLOW_EASE, y: camera.y + dy * FOLLOW_EASE });
          busy = true;
        }
      }
    }
    app.render();
    if (busy || queue.length > 0) invalidate();
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

  const resizeObserver = new ResizeObserver(resize);
  resizeObserver.observe(host);
  resizeObserver.observe(fitArea);
  measure();
  fitNow(false);
  settleText();

  // ------------------------------------------------------------ interface

  let shown: PublicView | null = null;

  return {
    update(view, events) {
      skipToEnd();
      if (shown) placeAll(shown);
      const turnChanged = shown !== null && view.turn !== shown.turn;
      shown = view;
      syncPawns(view);
      syncFields(view);
      if (events.length === 0) placeAll(view);
      for (const event of events) {
        const animation = animationFor(event, scene);
        if (animation) queue.push(animation);
      }
      queue.push({ duration: 0, tick: () => placeAll(view) });
      if (turnChanged && !follow) fitNow(true);
      invalidate();
    },
    setSelected(id) {
      if (id === selected) return;
      selected = id;
      applySelected();
    },
    reveal(id, obstacles) {
      const canvasRect = app.canvas.getBoundingClientRect();
      // Where the Field will be once any running pan ends.
      const end = tween?.to ?? camera;
      const at = toScreen(end, boardCentre(id));
      const x = canvasRect.left + at.x;
      const y = canvasRect.top + at.y;
      const m = REVEAL_MARGIN;
      const covered = obstacles.some(
        (r) => x > r.left - m && x < r.right + m && y > r.top - m && y < r.bottom + m,
      );
      const offScreen =
        at.x < m || at.y < m || at.x > canvasRect.width - m || at.y > canvasRect.height - m;
      if (!covered && !offScreen) return;
      const target = centreOf(area);
      atFit = false;
      animateTo(
        { scale: end.scale, x: end.x + target.x - at.x, y: end.y + target.y - at.y },
        PAN_MS,
      );
    },
    zoomBy(factor) {
      atFit = false;
      setFollow(false, true);
      const { min, max } = scaleLimits(fitted);
      const base = tween?.to ?? camera;
      const scale = Math.min(max, Math.max(min, base.scale * factor));
      animateTo(
        clampCamera(zoomAround(base, centreOf(area), scale), fitted, bounds, area),
        ZOOM_STEP_MS,
      );
    },
    fit() {
      setFollow(false, true);
      fitNow(true);
    },
    setFollow(on) {
      setFollow(on);
    },
    destroy() {
      resizeObserver.disconnect();
      detachGestures();
      clearTimeout(settleTimer);
      if (frameId) cancelAnimationFrame(frameId);
      app.destroy({ removeView: true }, { children: true });
    },
    fieldCenter(id) {
      const at = toScreen(camera, boardCentre(id));
      const rect = app.canvas.getBoundingClientRect();
      return { x: rect.left + at.x, y: rect.top + at.y };
    },
    camera: () => ({ ...camera }),
    get view() {
      return shown;
    },
  };
}
