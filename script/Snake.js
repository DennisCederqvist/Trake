// Snake.js – håller all logik och färginställning för en orm

export class Snake {
  constructor(startX, startY, options = {}) {
    const dir = options.startDirection ?? { x: 1, y: 0 };

    // Starta med två segment
    this.segments = [
      { x: startX, y: startY },
      { x: startX - dir.x, y: startY - dir.y },
    ];

    this.direction = { ...dir };
    this.nextDirection = { ...dir };

    this.colorHead = options.colorHead ?? "#d783ff";
    this.colorHeadStroke = options.colorHeadStroke ?? "#b300ff";
    this.colorBody = options.colorBody ?? "#4dff4d";
    this.tailScale = options.tailScale ?? 0.6;
  }

  setDirection(dx, dy) {
    if (dx === -this.direction.x && dy === -this.direction.y) return;
    this.nextDirection = { x: dx, y: dy };
  }

  step() {
    this.direction = this.nextDirection;

    const head = this.segments[0];
    const newHead = {
      x: head.x + this.direction.x,
      y: head.y + this.direction.y,
    };

    this.segments.unshift(newHead);
    this.segments.pop();
  }

  grow() {
    const tail = this.segments[this.segments.length - 1];
    this.segments.push({ x: tail.x, y: tail.y });
  }

  shrink(amount, minLen = 2) {
    const target = Math.max(minLen, this.segments.length - amount);
    this.segments.length = target;
  }
}
