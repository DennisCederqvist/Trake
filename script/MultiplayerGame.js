import { Snake } from "./Snake.js";
import {
  GRID_COLS,
  GRID_ROWS,
  CELL_SIZE,
  FOOD_COUNT,
  POWERUP_COUNT,
  POWERUP_RESPAWN_MIN_MS,
  POWERUP_RESPAWN_MAX_MS,
  EFFECT,
} from "./Config.js";
import { Renderer } from "./Renderer.js";
import { PowerUpManager, PowerUpType } from "./PowerUps.js";

export class MultiplayerGame {
  constructor({ mode, canvas, scoreElement, players, hostClientId, onBroadcastState, onEnd }) {
    this.mode = mode;
    this.canvas = canvas;
    this.scoreElement = scoreElement;

    this.cols = GRID_COLS;
    this.rows = GRID_ROWS;
    this.cellSize = CELL_SIZE;

    this.renderer = new Renderer(this.canvas, this.cols, this.rows, this.cellSize);

    this.players = players; // Map clientId -> {name, ready, slot}
    this.hostClientId = hostClientId;

    this.onBroadcastState = onBroadcastState;
    this.onEnd = onEnd;

    this.isRunning = false;
    this.lastTime = null;

    // vi håller en gemensam “render frame”, men rörelse per orm kan bli snabbare/långsammare
    this.baseMoveDuration = 120;
    this.moveDuration = this.baseMoveDuration;
    this.moveProgress = 0;

    this.foods = [];
    this.powerUps = new PowerUpManager({
      cols: this.cols,
      rows: this.rows,
      maxCount: POWERUP_COUNT,
      respawnMinMs: POWERUP_RESPAWN_MIN_MS,
      respawnMaxMs: POWERUP_RESPAWN_MAX_MS,
    });

    // host only
    this.snakes = new Map(); // clientId -> { snake, score, alive, effects, lastSegments }
    this.pendingKeys = new Map();
    this.tickId = 0;

    // client smoothing (tick->tick)
    this.prevTickState = null;
    this.currTickState = null;
    this.tickReceivedAt = 0;
  }

  start() {
    this.isRunning = true;
    this.lastTime = performance.now();
    this.moveProgress = 0;

    if (this.mode === "host") {
      this.resetHostWorld();
    }

    requestAnimationFrame(this.loop.bind(this));
  }

  stop() {
    this.isRunning = false;
  }

  applyRemoteInput(clientId, key) {
    if (this.mode !== "host") return;
    this.pendingKeys.set(clientId, key);
  }

  applyRemoteState(state) {
    if (this.mode !== "client") return;
    if (!state || typeof state !== "object") return;
    if (typeof state.tickId !== "number") return;

    if (this.currTickState && state.tickId <= this.currTickState.tickId) return;

    this.prevTickState = this.currTickState;
    this.currTickState = state;
    this.tickReceivedAt = performance.now();
  }

  loop(t) {
    if (!this.isRunning) return;

    const delta = t - (this.lastTime ?? t);
    this.lastTime = t;

    if (this.mode === "host") {
      this.moveProgress += delta / this.moveDuration;

      while (this.moveProgress >= 1) {
        this.moveProgress -= 1;
        this.tickHost(t);
      }

      const renderState = this.buildHostInterpolatedRenderState(this.moveProgress);
      this.renderer.render(renderState);
    } else {
      const renderState = this.buildClientInterpolatedState();
      this.renderer.render(renderState);
    }

    requestAnimationFrame(this.loop.bind(this));
  }

  // ================= HOST =================

  resetHostWorld() {
    this.foods = [];
    this.snakes.clear();
    this.pendingKeys.clear();
    this.tickId = 0;

    const ids = Array.from(this.players.keys()).sort();
    const spawns = this.makeSpawnPoints(ids.length);

    for (let i = 0; i < ids.length; i++) {
      const cid = ids[i];
      const spawn = spawns[i];

      const dirs = [
        { x: 1, y: 0 },
        { x: -1, y: 0 },
        { x: 0, y: 1 },
        { x: 0, y: -1 },
      ];

      const snake = new Snake(spawn.x, spawn.y, { startDirection: dirs[i % dirs.length] });

      this.snakes.set(cid, {
        snake,
        score: 0,
        alive: true,
        effects: new PowerUpManager({ cols: this.cols, rows: this.rows, maxCount: 0, respawnMinMs: 0, respawnMaxMs: 0 }),
        lastSegments: snake.segments.map((s) => ({ ...s })),
      });
    }

    for (let i = 0; i < FOOD_COUNT; i++) this.spawnFoodHost();

    this.powerUps.reset();
    this.powerUps.initSpawn((x, y) => this.isCellBlockedHost(x, y));

    this.broadcastTickState(performance.now());
  }

  makeSpawnPoints(n) {
    const m = 4;
    const pts = [
      { x: m, y: m },
      { x: this.cols - 1 - m, y: m },
      { x: m, y: this.rows - 1 - m },
      { x: this.cols - 1 - m, y: this.rows - 1 - m },
    ];
    return Array.from({ length: n }, (_, i) => pts[i] ?? pts[0]);
  }

  tickHost(now) {
    this.tickId += 1;

    // uppdatera globala powerups + alla effekter per orm
    this.powerUps.update(now);
    for (const e of this.snakes.values()) e.effects.update(now);

    // apply inputs (queued)
    for (const [cid, key] of this.pendingKeys.entries()) {
      const entry = this.snakes.get(cid);
      if (!entry?.alive) continue;

      const s = entry.snake;
      if (key === "ArrowUp") s.setDirection(0, -1);
      else if (key === "ArrowDown") s.setDirection(0, 1);
      else if (key === "ArrowLeft") s.setDirection(-1, 0);
      else if (key === "ArrowRight") s.setDirection(1, 0);
    }
    this.pendingKeys.clear();

    // snapshot innan rörelse (för host interpolation)
    for (const entry of this.snakes.values()) {
      if (!entry.alive) continue;
      entry.lastSegments = entry.snake.segments.map((s) => ({ ...s }));
    }

    // === Rörelse per orm, med speed/slow som i singleplayer ===
    for (const [cid, entry] of this.snakes.entries()) {
      if (!entry.alive) continue;

      const mult = this.getSnakeSpeedMultiplier(entry);
      const stepsThisTick = this.computeStepsThisTick(mult);

      for (let step = 0; step < stepsThisTick; step++) {
        if (!entry.alive) break;

        entry.snake.step();

        // efter varje step: collisions + pickups
        this.resolveAfterStep(cid, entry, now);
      }
    }

    // hålla powerups på banan
    this.powerUps.ensureSpawn((x, y) => this.isCellBlockedHost(x, y));

    // sänd state EN gång per tick (minskar stutter)
    this.broadcastTickState(now);

    const aliveCount = Array.from(this.snakes.values()).filter((e) => e.alive).length;
    if (aliveCount <= 1) this.endGameHost();
  }

  getSnakeSpeedMultiplier(entry) {
    let mult = 1;

    if (entry.effects.isActive(PowerUpType.SPEED)) mult *= EFFECT.SPEED_MULT;
    if (entry.effects.isActive(PowerUpType.SLOW)) mult *= EFFECT.SLOW_MULT;

    return mult;
  }

  computeStepsThisTick(mult) {
    // baseline: 1 cell per tick
    // speed: ibland 2 steg (snitt = mult)
    // slow: ibland 0 steg (snitt = mult)
    if (mult >= 1) {
      const extra = mult - 1;
      return 1 + (Math.random() < extra ? 1 : 0);
    } else {
      return Math.random() < mult ? 1 : 0;
    }
  }

  resolveAfterStep(cid, entry, now) {
    const head = entry.snake.segments[0];

    // walls (alltid dödliga)
    if (head.x < 0 || head.x >= this.cols || head.y < 0 || head.y >= this.rows) {
      entry.alive = false;
      return;
    }

    // self collision (ghost ignorerar self-collision – exakt som Config.js säger)
    const ghost = entry.effects.isActive(PowerUpType.GHOST);
    if (!ghost) {
      for (let i = 1; i < entry.snake.segments.length; i++) {
        const seg = entry.snake.segments[i];
        if (seg.x === head.x && seg.y === head.y) {
          entry.alive = false;
          return;
        }
      }
    }

    // collision with others (alltid dödligt i multiplayer)
    for (const [oid, other] of this.snakes.entries()) {
      if (!other.alive) continue;

      const segs = other.snake.segments;
      const start = oid === cid ? 1 : 0;

      for (let i = start; i < segs.length; i++) {
        const seg = segs[i];
        if (seg.x === head.x && seg.y === head.y) {
          entry.alive = false;
          return;
        }
      }
    }

    // pickup powerup
    const picked = this.powerUps.collectAt(head.x, head.y);
    if (picked) {
      if (picked.type === PowerUpType.SPEED) entry.effects.activate(PowerUpType.SPEED, now, EFFECT.SPEED_MS);
      else if (picked.type === PowerUpType.SLOW) entry.effects.activate(PowerUpType.SLOW, now, EFFECT.SLOW_MS);
      else if (picked.type === PowerUpType.GHOST) entry.effects.activate(PowerUpType.GHOST, now, EFFECT.GHOST_MS);
      else if (picked.type === PowerUpType.SHRINK) entry.snake.shrink(EFFECT.SHRINK_AMOUNT, EFFECT.MIN_SNAKE_LEN);
    }

    // eat food
    const idx = this.foods.findIndex((f) => f.x === head.x && f.y === head.y);
    if (idx !== -1) {
      entry.snake.grow();
      entry.score += 10;
      this.foods.splice(idx, 1);
      this.spawnFoodHost();
    }
  }

  broadcastTickState(now) {
    const tickState = this.buildTickState(now);
    this.onBroadcastState?.(tickState);
  }

  buildTickState(now) {
    const snakes = [];
    for (const [cid, entry] of this.snakes.entries()) {
      if (!entry.alive) continue;

      const slot = this.players.get(cid)?.slot ?? 1;
      const c = colorsForSlot(slot);

      snakes.push({
        clientId: cid,
        segments: entry.snake.segments.map((s) => ({ x: s.x, y: s.y })),
        mpColorBody: c.body,
        mpColorGlow: c.glow,
      });
    }

    const scores = Array.from(this.snakes.entries()).map(([cid, e]) => ({
      clientId: cid,
      name: this.players.get(cid)?.name ?? cid,
      score: e.score ?? 0,
      alive: !!e.alive,
      slot: this.players.get(cid)?.slot ?? 1,
    }));

    return {
      tickId: this.tickId,
      moveDuration: this.baseMoveDuration, // clients använder detta för interpolationstempo
      snakes,
      foods: this.foods,
      powerUps: this.powerUps.powerUps,
      scores,
      serverNow: now,
    };
  }

  buildHostInterpolatedRenderState(progress) {
    const snakes = [];

    for (const [cid, entry] of this.snakes.entries()) {
      if (!entry.alive) continue;

      const slot = this.players.get(cid)?.slot ?? 1;
      const c = colorsForSlot(slot);

      const cur = entry.snake.segments;
      const last = entry.lastSegments ?? cur;

      const segs = cur.map((seg, i) => {
        const prev = last[i];
        if (!prev) return { x: seg.x, y: seg.y };
        return {
          x: prev.x + (seg.x - prev.x) * progress,
          y: prev.y + (seg.y - prev.y) * progress,
        };
      });

      snakes.push({
        clientId: cid,
        segments: segs,
        mpColorBody: c.body,
        mpColorGlow: c.glow,
      });
    }

    return {
      snakes,
      foods: this.foods,
      powerUps: this.powerUps.powerUps,
      scores: Array.from(this.snakes.entries()).map(([cid, e]) => ({
        clientId: cid,
        name: this.players.get(cid)?.name ?? cid,
        score: e.score ?? 0,
        alive: !!e.alive,
        slot: this.players.get(cid)?.slot ?? 1,
      })),
    };
  }

  spawnFoodHost() {
    for (let safety = 0; safety < 2000; safety++) {
      const x = Math.floor(Math.random() * this.cols);
      const y = Math.floor(Math.random() * this.rows);
      if (this.isCellBlockedHost(x, y)) continue;
      if (this.foods.some((f) => f.x === x && f.y === y)) continue;
      this.foods.push({ x, y });
      return;
    }
  }

  isCellBlockedHost(x, y) {
    for (const e of this.snakes.values()) {
      if (!e.alive) continue;
      if (e.snake.segments.some((s) => s.x === x && s.y === y)) return true;
    }
    if (this.foods.some((f) => f.x === x && f.y === y)) return true;
    if (this.powerUps.powerUps.some((p) => p.x === x && p.y === y)) return true;
    return false;
  }

  endGameHost() {
    this.isRunning = false;

    const scores = Array.from(this.snakes.entries()).map(([cid, e]) => ({
      clientId: cid,
      name: this.players.get(cid)?.name ?? cid,
      score: e.score ?? 0,
    }));

    scores.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
    const winner = scores[0];

    this.onEnd?.({ winnerName: winner?.name ?? "Winner", scores });
  }

  // ================= CLIENT =================

  buildClientInterpolatedState() {
    if (!this.currTickState) return { snakes: [], foods: [], powerUps: [], scores: [] };
    if (!this.prevTickState) return this.currTickState;

    const now = performance.now();
    const dt = now - this.tickReceivedAt;
    const duration = Math.max(40, Number(this.currTickState.moveDuration ?? 120));
    const alpha = Math.max(0, Math.min(1, dt / duration));

    const prevSnakes = new Map((this.prevTickState.snakes ?? []).map((s) => [s.clientId, s]));
    const currSnakes = new Map((this.currTickState.snakes ?? []).map((s) => [s.clientId, s]));

    const snakes = [];
    for (const [cid, cur] of currSnakes.entries()) {
      const prev = prevSnakes.get(cid);
      if (!prev) {
        snakes.push(cur);
        continue;
      }

      const segs = (cur.segments ?? []).map((seg, i) => {
        const p = prev.segments?.[i];
        if (!p) return { x: seg.x, y: seg.y };
        return {
          x: p.x + (seg.x - p.x) * alpha,
          y: p.y + (seg.y - p.y) * alpha,
        };
      });

      snakes.push({ ...cur, segments: segs });
    }

    return {
      snakes,
      foods: this.currTickState.foods ?? [],
      powerUps: this.currTickState.powerUps ?? [],
      scores: this.currTickState.scores ?? [],
    };
  }
}

function colorsForSlot(slot) {
  // 1 = cyan (host/p1)
  if (slot === 2) return { body: "rgba(255, 220, 60, 0.95)", glow: "rgba(255, 220, 60, 0.85)" };
  if (slot === 3) return { body: "rgba(80, 255, 80, 0.95)", glow: "rgba(80, 255, 80, 0.85)" };
  if (slot === 4) return { body: "rgba(255, 90, 90, 0.95)", glow: "rgba(255, 90, 90, 0.85)" };
  return { body: "rgba(200, 255, 255, 0.95)", glow: "rgba(0, 255, 255, 0.85)" };
}
