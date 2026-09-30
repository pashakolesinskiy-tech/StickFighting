import Phaser from 'phaser';
import { FightEngine } from './engine';
import { WORLD_HEIGHT, WORLD_WIDTH, type Settings, type Snapshot } from './types';

class ArenaScene extends Phaser.Scene {
  private engine: FightEngine;
  private texture: Phaser.Textures.CanvasTexture | null = null;
  private accumulator = 0;

  constructor(engine: FightEngine) { super('Arena'); this.engine = engine; }

  create() {
    this.texture = this.textures.createCanvas('pixel-world', 480, 270);
    if (!this.texture) return;
    this.texture.context.imageSmoothingEnabled = false;
    this.add.image(0, 0, 'pixel-world').setOrigin(0).setDisplaySize(WORLD_WIDTH, WORLD_HEIGHT);
    this.engine.draw(this.texture.context);
    this.engine.emit();
  }

  update(_time: number, delta: number) {
    // Fixed simulation ticks preserve the attack's frame data on fast and slow displays.
    this.accumulator += Math.min(delta / 1000, 0.067);
    while (this.accumulator >= 1 / 60) {
      this.engine.step(1 / 60);
      this.accumulator -= 1 / 60;
    }
    if (this.texture) this.engine.draw(this.texture.context);
  }
}

export function createGame(parent: HTMLElement, settings: Settings, onSnapshot: (snapshot: Snapshot) => void) {
  const engine = new FightEngine(settings, onSnapshot);
  const game = new Phaser.Game({
    type: Phaser.CANVAS,
    parent,
    width: WORLD_WIDTH,
    height: WORLD_HEIGHT,
    backgroundColor: '#171b24',
    pixelArt: true,
    roundPixels: true,
    antialias: false,
    audio: { noAudio: true },
    input: { keyboard: false, mouse: false, touch: false },
    fps: { target: 60, smoothStep: false },
    scale: { mode: Phaser.Scale.NONE },
    scene: [new ArenaScene(engine)],
    banner: false,
  });
  return {
    engine,
    destroy: () => { engine.destroy(); game.destroy(true); },
  };
}