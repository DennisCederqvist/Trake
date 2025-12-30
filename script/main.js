import { Game } from "./Game.js";
import { UiManager } from "./UiManager.js";
import { MultiplayerController } from "./MultiplayerController.js";

const MPAPI_SERVER_URL = "wss://mpapi.se/net";
const MPAPI_IDENTIFIER = "0a8abcce-a4e7-4b30-a2f6-e57253a895b5";

function isTypingTarget(el) {
	if (!el) return false;
	const tag = (el.tagName || "").toLowerCase();
	if (tag === "input" || tag === "textarea" || tag === "select") return true;
	if (el.isContentEditable) return true;
	return false;
}

// === AUDIO (BGM toggle + SFX always-on) ===
function setupAudio() {
	const SOUND_KEY = "trake_sound_enabled"; // bara för BGM
	const bgm = document.getElementById("bgm");
	const soundBtn = document.getElementById("soundToggle");

	const sfx = {
		boob: document.getElementById("sfxBoob"),
		crash: document.getElementById("sfxCrash"),
		yum: document.getElementById("sfxYum"),
		zoom: document.getElementById("sfxZoom"),
	};

	// Om du saknar audio-taggar -> varna, men krascha inte
	for (const [k, el] of Object.entries(sfx)) {
		if (!el) console.warn(`[SFX] Missing audio element: ${k}`);
	}
	if (!bgm) console.warn("[BGM] Missing audio element: bgm");
	if (!soundBtn) console.warn("[BGM] Missing button: soundToggle");

	// SFX-volymer (justera här)
	if (sfx.boob) sfx.boob.volume = 0.55;
	if (sfx.crash) sfx.crash.volume = 0.80;
	if (sfx.yum) sfx.yum.volume = 0.70;
	if (sfx.zoom) sfx.zoom.volume = 0.80;

	// BGM-volym (justera här)
	if (bgm) bgm.volume = 0.14;

	const setButton = (enabled) => {
		if (!soundBtn) return;
		soundBtn.textContent = enabled ? "🔊" : "🔇";
	};

	// SFX ska INTE kopplas till mute: alltid spela om det går
	let sfxPrimed = false;
	const primeSfx = async () => {
		if (sfxPrimed) return;
		sfxPrimed = true;

		const audios = Object.values(sfx).filter(Boolean);
		for (const a of audios) {
			try {
				// “unlock” utan att höras
				const prevMuted = a.muted;
				a.muted = true;
				a.currentTime = 0;
				await a.play();
				a.pause();
				a.currentTime = 0;
				a.muted = prevMuted;
			} catch {
				// om det failar nu, försöker vi igen på nästa gesture
				sfxPrimed = false;
				return;
			}
		}
	};

	// Exponera globalt API
	let lastBoobAt = 0;
	window.__trakeSfx = {
		play(name) {
			const a = sfx[name];
			if (!a) return;

			// throttle boob så det inte blir maskingevar
			if (name === "boob") {
				const now = performance.now();
				if (now - lastBoobAt < 90) return;
				lastBoobAt = now;
			}

			try {
				a.currentTime = 0;
				a.play().catch(() => {});
			} catch {}
		},
		prime: primeSfx,
	};

	// Prime SFX på första riktiga interaktion (click/keydown)
	const primeOnGesture = () => {
		void primeSfx();
	};
	window.addEventListener("pointerdown", primeOnGesture, { capture: true });
	window.addEventListener("keydown", primeOnGesture, { capture: true });

	// === BGM toggle ===
	if (bgm && soundBtn) {
		const wantsBgm = () => localStorage.getItem(SOUND_KEY) === "1";

		const tryStartBgm = async () => {
			try {
				bgm.muted = false;
				await bgm.play();
				return true;
			} catch {
				return false;
			}
		};

		// Init state
		if (wantsBgm()) {
			setButton(true);
			bgm.muted = false;
			void tryStartBgm(); // kan blockas tills gesture
		} else {
			setButton(false);
			bgm.muted = true;
			bgm.pause();
		}

		// Toggle button: påverkar bara BGM
		soundBtn.addEventListener("click", async () => {
			if (!wantsBgm()) {
				localStorage.setItem(SOUND_KEY, "1");
				setButton(true);
				bgm.muted = false;
				await tryStartBgm();
			} else {
				localStorage.setItem(SOUND_KEY, "0");
				bgm.pause();
				bgm.muted = true;
				setButton(false);
			}
		});
	}
}

function initiate() {
	const canvas = document.getElementById("gameCanvas");
	const scoreElement = document.getElementById("score");

	const game = new Game(canvas, scoreElement);
	const ui = new UiManager(game);

	const mp = new MultiplayerController(game, ui, {
		serverUrl: MPAPI_SERVER_URL,
		identifier: MPAPI_IDENTIFIER,
	});

	const dirKeys = new Set([
		"ArrowUp",
		"ArrowDown",
		"ArrowLeft",
		"ArrowRight",
		"w",
		"a",
		"s",
		"d",
		"W",
		"A",
		"S",
		"D",
	]);

	window.addEventListener("keydown", (event) => {
		if (isTypingTarget(event.target) || isTypingTarget(document.activeElement)) return;

		const k = event.key;

		if (!dirKeys.has(k)) return;

		// Förhindra scroll på piltangenter
		if (k.startsWith("Arrow")) event.preventDefault();

		// ✅ boob på styr-input (SFX är alltid på)
		window.__trakeSfx?.play("boob");

		if (mp.isMultiplayerActive()) mp.handleKeyDown(k);
		else game.handleKeyDown(k);
	});
}

window.addEventListener("load", () => {
	setupAudio();
	initiate();
});
