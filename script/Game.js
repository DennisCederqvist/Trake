// Game.js – singleplayer + powerups (multiplayer-säkert state)

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

export class Game {
	constructor(canvas, scoreElement) {
		this.canvas = canvas;
		this.scoreElement = scoreElement;

		this.cols = GRID_COLS;
		this.rows = GRID_ROWS;
		this.cellSize = CELL_SIZE;

		this.renderer = new Renderer(this.canvas, this.cols, this.rows, this.cellSize);

		this.snake = null;
		this.foods = [];
		this.score = 0;

		this.baseMoveDuration = 120;
		this.moveDuration = this.baseMoveDuration;
		this.isRunning = false;

		this.lastSegments = null;
		this.moveProgress = 0;
		this.lastTime = null;
		this.now = 0;

		this.foodSpawnToken = 0;
		this.powerSpawnToken = 0;

		this.onPlayerDeath = null;

		this.powerUps = new PowerUpManager({
			cols: this.cols,
			rows: this.rows,
			maxCount: POWERUP_COUNT,
			respawnMinMs: POWERUP_RESPAWN_MIN_MS,
			respawnMaxMs: POWERUP_RESPAWN_MAX_MS,
		});

		// === PATCH: multiplayer kan tillfälligt stänga av singleplayer-render ===
		this.renderEnabled = true;

		this.reset();
		this.startLoop();

		this.onFrame = [];
	}

	// === PATCH ===
	setRenderEnabled(enabled) {
		this.renderEnabled = !!enabled;
	}

	startGame() {
		// Om multiplayer har stängt av render: slå på igen när du startar singleplayer
		this.setRenderEnabled(true);

		this.reset();
		this.isRunning = true;
	}

	setOnPlayerDeath(callback) {
		this.onPlayerDeath = callback;
	}

	reset() {
		this.foodSpawnToken++;
		this.powerSpawnToken++;

		const dirs = [
			{ x: 1, y: 0 },
			{ x: -1, y: 0 },
			{ x: 0, y: -1 },
			{ x: 0, y: 1 },
		];
		const startDir = dirs[Math.floor(Math.random() * dirs.length)];

		const startX = Math.floor(this.cols / 2);
		const startY = Math.floor(this.rows / 2);

		this.snake = new Snake(startX, startY, {
			startDirection: startDir,
			colorHead: "#d783ff",
			colorHeadStroke: "#b300ff",

			// OBS: Renderern kör cyan i singleplayer ändå (och multiplayer styr via mpColor).
			// Vi låter snake färger vara som de är för att inte röra din gameplay-logik.
			colorBody: "#4dff4d",
			tailScale: 0.6,
		});

		this.score = 0;
		this.updateScore();

		this.foods = [];
		this.spawnInitialFood();

		this.powerUps.reset();
		this.powerUps.initSpawn((x, y) => this.isCellBlocked(x, y));

		this.lastSegments = this.snake.segments.map((seg) => ({ ...seg }));
		this.moveProgress = 0;

		this.moveDuration = this.baseMoveDuration;
	}

	startLoop() {
		this.lastTime = performance.now();
		requestAnimationFrame(this.loop.bind(this));
	}

	updateScore() {
		if (this.scoreElement) this.scoreElement.textContent = String(this.score);
	}

	spawnInitialFood() {
		for (let i = 0; i < FOOD_COUNT; i++) this.spawnFood();
	}

	spawnFood() {
		if (this.foods.length >= FOOD_COUNT) return;

		for (let safety = 0; safety < 1000; safety++) {
			const x = Math.floor(Math.random() * this.cols);
			const y = Math.floor(Math.random() * this.rows);

			const onSnake = this.snake.segments.some((seg) => seg.x === x && seg.y === y);
			const onFood = this.foods.some((f) => f.x === x && f.y === y);
			const onPower = this.powerUps.powerUps.some((p) => p.x === x && p.y === y);

			if (!onSnake && !onFood && !onPower) {
				this.foods.push({ x, y });
				return;
			}
		}
	}

	scheduleFoodRespawn() {
		const tokenAtSchedule = this.foodSpawnToken;
		const delay = 500 + Math.random() * 2500;

		setTimeout(() => {
			if (tokenAtSchedule !== this.foodSpawnToken) return;
			if (this.foods.length >= FOOD_COUNT) return;
			this.spawnFood();
		}, delay);
	}

	schedulePowerRespawn() {
		const tokenAtSchedule = this.powerSpawnToken;
		const delay =
			POWERUP_RESPAWN_MIN_MS + Math.random() * (POWERUP_RESPAWN_MAX_MS - POWERUP_RESPAWN_MIN_MS);

		setTimeout(() => {
			if (tokenAtSchedule !== this.powerSpawnToken) return;
			this.powerUps.ensureSpawn((x, y) => this.isCellBlocked(x, y));
		}, delay);
	}

	isCellBlocked(x, y) {
		const onSnake = this.snake.segments.some((s) => s.x === x && s.y === y);
		const onFood = this.foods.some((f) => f.x === x && f.y === y);
		const onPower = this.powerUps.powerUps.some((p) => p.x === x && p.y === y);
		return onSnake || onFood || onPower;
	}

	getSpeedMultiplier(now) {
		let mult = 1.0;
		if (this.powerUps.isActive(PowerUpType.SPEED)) mult *= EFFECT.SPEED_MULT;
		if (this.powerUps.isActive(PowerUpType.SLOW)) mult *= EFFECT.SLOW_MULT;
		return Math.max(0.35, Math.min(3.0, mult));
	}

	loop(timestamp) {
		if (this.lastTime == null) this.lastTime = timestamp;

		const delta = timestamp - this.lastTime;
		this.lastTime = timestamp;
		this.now = timestamp;

		// paus: rita bara om vi får
		if (!this.isRunning) {
			if (this.renderEnabled) this.render(this.moveProgress);
			requestAnimationFrame(this.loop.bind(this));
			return;
		}

		this.powerUps.update(timestamp);

		const mult = this.getSpeedMultiplier(timestamp);
		this.moveDuration = this.baseMoveDuration / mult;

		this.moveProgress += delta / this.moveDuration;

		while (this.moveProgress >= 1) {
			this.moveProgress -= 1;
			this.tick();
		}

		this.onFrame.forEach((cb) => cb(delta));

		if (this.renderEnabled) this.render(this.moveProgress);
		requestAnimationFrame(this.loop.bind(this));
	}

	tick() {
		this.lastSegments = this.snake.segments.map((seg) => ({ ...seg }));

		this.snake.step();
		const head = this.snake.segments[0];

		if (head.x < 0 || head.x >= this.cols || head.y < 0 || head.y >= this.rows) {
			this.handleDeath();
			return;
		}

		const isGhost = this.powerUps.isActive(PowerUpType.GHOST);
		if (!isGhost) {
			for (let i = 1; i < this.snake.segments.length; i++) {
				const seg = this.snake.segments[i];
				if (seg.x === head.x && seg.y === head.y) {
					this.handleDeath();
					return;
				}
			}
		}

		const picked = this.powerUps.collectAt(head.x, head.y);
		if (picked) {
			switch (picked.type) {
				case PowerUpType.SPEED:
					this.powerUps.activate(PowerUpType.SPEED, this.now, EFFECT.SPEED_MS);
					break;
				case PowerUpType.SLOW:
					this.powerUps.activate(PowerUpType.SLOW, this.now, EFFECT.SLOW_MS);
					break;
				case PowerUpType.GHOST:
					this.powerUps.activate(PowerUpType.GHOST, this.now, EFFECT.GHOST_MS);
					break;
				case PowerUpType.SHRINK:
					this.snake.shrink(EFFECT.SHRINK_AMOUNT, EFFECT.MIN_SNAKE_LEN);
					break;
			}
			this.schedulePowerRespawn();
		}

		const eatenIndex = this.foods.findIndex((f) => f.x === head.x && f.y === head.y);
		if (eatenIndex !== -1) {
			this.snake.grow();
			this.score += 10;
			this.updateScore();

			this.foods.splice(eatenIndex, 1);
			this.scheduleFoodRespawn();
		}
	}

	handleDeath() {
		this.isRunning = false;
		if (this.onPlayerDeath) this.onPlayerDeath({ score: this.score });
	}

	render(progress = 1) {
		const segmentsToDraw = this.snake.segments.map((seg, index) => {
			if (!this.lastSegments || !this.lastSegments[index]) return { x: seg.x, y: seg.y };
			const prev = this.lastSegments[index];
			return {
				x: prev.x + (seg.x - prev.x) * progress,
				y: prev.y + (seg.y - prev.y) * progress,
			};
		});

		const state = {
			foods: this.foods,
			powerUps: this.powerUps.powerUps,
			activeEffects: this.powerUps.activeEffects,
			snakes: [
				{
					segments: segmentsToDraw,
					// Renderern i singleplayer kör cyan ändå – dessa lämnas för kompat.
					colorHead: this.snake.colorHead,
					colorHeadStroke: this.snake.colorHeadStroke,
					colorBody: this.snake.colorBody,
					tailScale: this.snake.tailScale,
				},
			],
		};

		this.renderer.render(state);
	}

	handleKeyDown(key) {
		switch (key) {
			case "ArrowUp":
				this.snake.setDirection(0, -1);
				break;
			case "ArrowDown":
				this.snake.setDirection(0, 1);
				break;
			case "ArrowLeft":
				this.snake.setDirection(-1, 0);
				break;
			case "ArrowRight":
				this.snake.setDirection(1, 0);
				break;
		}
	}
}
