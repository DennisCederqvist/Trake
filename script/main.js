import { Game } from "./Game.js";
import { UiManager } from "./UiManager.js";
import { MultiplayerController } from "./MultiplayerController.js";

const MPAPI_SERVER_URL = "wss://mpapi.se/net";
const MPAPI_IDENTIFIER = "0a8abcce-a4e7-4b30-a2f6-e57253a895b5"; // MUST be string

window.addEventListener("load", () => {
  const canvas = document.getElementById("gameCanvas");
  const scoreElement = document.getElementById("score");

  const game = new Game(canvas, scoreElement);
  const ui = new UiManager(game);

  const mp = new MultiplayerController({
    canvas,
    scoreElement,
    ui,
    serverUrl: MPAPI_SERVER_URL,
    identifier: MPAPI_IDENTIFIER,
    singleGame: game,
  });

  window.addEventListener("keydown", (event) => {
    const arrowKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];
    if (!arrowKeys.includes(event.key)) return;

    event.preventDefault();

    if (mp.isInMultiplayerSession()) {
      mp.handleKeyDown(event.key);
    } else {
      game.handleKeyDown(event.key);
    }
  });
});
