import { Game } from "./Game.js";
import { UiManager } from "./UiManager.js";

const MPAPI_SERVER_URL = "wss://mpapi.se/net";
const MPAPI_IDENTIFIER = "0a8abcce-a4e7-4b30-a2f6-e57253a895b5";

function initiate() {
	const canvas = document.getElementById("gameCanvas");
	const scoreElement = document.getElementById("score");

	const game = new Game(canvas, scoreElement);
	const ui = new UiManager(game);

	window.addEventListener("keydown", (event) => {
		const arrowKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
		if (!arrowKeys.includes(event.key)) return;

		event.preventDefault();

		game.handleKeyDown(event.key);
	});
}

window.addEventListener("load", () => {
	initiate();
});

// const bgm = document.getElementById("bgm");
// const soundBtn = document.getElementById("soundToggle");

// let soundEnabled = false;

// soundBtn.addEventListener("click", async () => {
// 	try {
// 		if (!soundEnabled) {
// 			bgm.volume = 0.25;
// 			bgm.muted = false;
// 			await bgm.play();   // unlocks + starts
// 			soundBtn.textContent = "🔊";
// 			soundEnabled = true;
// 		} else {
// 			bgm.muted = true;
// 			soundBtn.textContent = "🔇";
// 			soundEnabled = false;
// 		}
// 	} catch (e) {
// 		console.error("Sound toggle failed:", e);
// 	}
// });