// main.js – bootstrap: kopplar ihop DOM, input, Game och UI

import { Game } from "./Game.js";
import { UiManager } from "./UiManager.js";

window.addEventListener("load", () => {
  const canvas = document.getElementById("gameCanvas");
  const scoreElement = document.getElementById("score");

  const game = new Game(canvas, scoreElement);
  new UiManager(game);

  // Tangentbordsstyrning – utan att scrolla sidan
  window.addEventListener("keydown", (event) => {
    const arrowKeys = ["ArrowUp", "ArrowDown", "ArrowLeft", "ArrowRight"];

    if (arrowKeys.includes(event.key)) {
      event.preventDefault();
      game.handleKeyDown(event.key);
    }
  });
});
