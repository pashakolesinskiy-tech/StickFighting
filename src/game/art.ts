import { FIGHTERS, GROUND, type ArenaId, type FighterVisual } from './types';

const W = 480;
const H = 270;
const cache = new Map<ArenaId, HTMLCanvasElement[]>();
let fighterBuffer: { canvas: HTMLCanvasElement; context: CanvasRenderingContext2D } | null = null;
type Point = [number, number];

function random(seed: number) {
  let state = seed;
  return () => {
    state = (state * 1664525 + 1013904223) >>> 0;
    return state / 4294967296;
  };
}

function rectangle(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, color: string) {
  ctx.fillStyle = color;
  ctx.fillRect(Math.round(x), Math.round(y), Math.max(1, Math.round(w)), Math.max(1, Math.round(h)));
}

// Scanline polygons keep every edge on the pixel grid, including mountain slopes.
function polygon(ctx: CanvasRenderingContext2D, points: Point[], color: string) {
  ctx.fillStyle = color;
  const low = Math.floor(Math.min(...points.map(p => p[1])));
  const high = Math.ceil(Math.max(...points.map(p => p[1])));
  for (let y = low; y < high; y++) {
    const xs: number[] = [];
    for (let i = 0; i < points.length; i++) {
      const a = points[i];
      const b = points[(i + 1) % points.length];
      if ((a[1] <= y && b[1] > y) || (b[1] <= y && a[1] > y)) {
        xs.push(a[0] + (y - a[1]) * (b[0] - a[0]) / (b[1] - a[1]));
      }
    }
    xs.sort((a, b) => a - b);
    for (let i = 0; i < xs.length; i += 2) {
      ctx.fillRect(Math.round(xs[i]), y, Math.max(1, Math.round(xs[i + 1] - xs[i])), 1);
    }
  }
}

function disc(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, color: string, striped = false) {
  for (let row = -radius; row <= radius; row++) {
    if (striped && row > 5 && row % 8 === 0) continue;
    const half = Math.floor(Math.sqrt(radius * radius - row * row));
    rectangle(ctx, x - half, y + row, half * 2, 1, color);
  }
}

function fir(ctx: CanvasRenderingContext2D, x: number, base: number, height: number, color: string) {
  rectangle(ctx, x - 1, base - height, 3, height, color);
  for (let n = 0; n < 5; n++) {
    const top = base - height + n * height * 0.13;
    const half = height * (0.09 + n * 0.035);
    polygon(ctx, [[x, top], [x + half, top + height * 0.33], [x - half, top + height * 0.33]], color);
  }
}

function foliage(ctx: CanvasRenderingContext2D, x: number, y: number, radius: number, colors: string[], seed: number) {
  const rand = random(seed);
  for (let i = 0; i < radius * 4; i++) {
    const angle = rand() * Math.PI * 2;
    const r = Math.sqrt(rand()) * radius;
    rectangle(ctx, x + Math.cos(angle) * r, y + Math.sin(angle) * r * 0.55, 3 + rand() * 8, 3 + rand() * 5, colors[Math.floor(rand() * colors.length)]);
  }
}

function layer(): [HTMLCanvasElement, CanvasRenderingContext2D] {
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  return [canvas, canvas.getContext('2d')!];
}

function createLayers(arena: ArenaId) {
  const layers: HTMLCanvasElement[] = [];
  const rand = random(arena === 'sunset' ? 44 : arena === 'forest' ? 92 : 141);
  const [sky, s] = layer();
  const skyColors = arena === 'sunset'
    ? ['#3e344c', '#513c54', '#684357', '#865363', '#aa6570', '#cb7d78', '#e49a83', '#ecae8c', '#efba96']
    : arena === 'forest'
      ? ['#173a43', '#20494e', '#285a59', '#346b62', '#468374', '#65a08b', '#85b49a', '#a6c9ad', '#b7d2b2']
      : ['#12192f', '#1b203c', '#262546', '#302a50', '#393058', '#433960', '#51456c', '#645376', '#72617e'];
  skyColors.forEach((color, i) => rectangle(s, 0, i * 30, W, 31, color));
  if (arena === 'sunset') {
    disc(s, 337, 80, 38, '#f6b991');
    disc(s, 337, 80, 33, '#ffdaad', true);
    for (let i = 0; i < 18; i++) {
      const x = rand() * W;
      const y = 23 + rand() * 104;
      rectangle(s, x, y, 20 + rand() * 50, 2, '#ab7380');
      rectangle(s, x + 8, y + 2, 22 + rand() * 25, 2, '#c78b8b');
    }
  } else if (arena === 'city') {
    for (let i = 0; i < 95; i++) rectangle(s, rand() * W, rand() * 130, 1, 1, i % 4 === 0 ? '#d5c9d9' : '#7d779b');
    disc(s, 363, 49, 20, '#ded3cb');
    disc(s, 371, 44, 18, '#262546');
  } else {
    disc(s, 321, 60, 27, '#cce2b9');
    for (let i = 0; i < 16; i++) rectangle(s, rand() * W, 25 + rand() * 70, 40 + rand() * 80, 2, '#89b49c');
  }
  layers.push(sky);

  const [far, f] = layer();
  if (arena !== 'city') {
    const color = arena === 'sunset' ? '#967180' : '#4d897e';
    const shade = arena === 'sunset' ? '#b58a92' : '#69a190';
    const peaks: Point[] = [[-20, 183], [29, 127], [47, 140], [107, 78], [154, 142], [197, 111], [252, 167], [286, 116], [329, 143], [395, 83], [458, 156], [491, 118], [500, 240], [-20, 240]];
    polygon(f, peaks, color);
    polygon(f, [[107, 78], [109, 102], [129, 112], [153, 144], [118, 129], [94, 105]], shade);
    polygon(f, [[395, 83], [402, 114], [432, 136], [459, 157], [416, 143], [379, 108]], shade);
    polygon(f, [[107, 78], [87, 103], [103, 98], [108, 105], [116, 99]], arena === 'sunset' ? '#d7a8a5' : '#a4c4ad');
    polygon(f, [[395, 83], [377, 106], [394, 100], [401, 105], [411, 105]], arena === 'sunset' ? '#d7a8a5' : '#a4c4ad');
    for (let i = 0; i < 65; i++) rectangle(f, rand() * W, 169 + rand() * 36, 2 + rand() * 12, 1, shade);
  } else {
    for (let i = 0; i < 22; i++) {
      const x = i * 24;
      const top = 84 + rand() * 70;
      rectangle(f, x, top, 18 + rand() * 14, 150, '#484565');
      rectangle(f, x + 3, top - 3, 12, 3, '#5b5278');
      for (let j = 0; j < 18; j++) rectangle(f, x + 4 + (j % 3) * 6, top + 10 + Math.floor(j / 3) * 10, 2, 3, rand() > 0.4 ? '#95869d' : '#5a5475');
    }
  }
  layers.push(far);

  const [middle, m] = layer();
  if (arena === 'sunset') {
    polygon(m, [[-10, 175], [44, 154], [82, 165], [143, 136], [198, 181], [249, 158], [298, 175], [361, 132], [407, 163], [460, 145], [490, 157], [490, 250], [-10, 250]], '#554758');
    polygon(m, [[143, 136], [164, 153], [173, 175], [139, 161], [127, 154]], '#67515f');
    for (let i = 0; i < 45; i++) fir(m, i * 12 - 5, 223, 29 + rand() * 52, '#393741');
    rectangle(m, 0, 211, W, 13, '#38363e');
  } else if (arena === 'forest') {
    polygon(m, [[0, 150], [78, 122], [153, 145], [229, 99], [270, 120], [324, 96], [355, 118], [398, 111], [480, 149], [480, 235], [0, 235]], '#2d645e');
    for (let i = 0; i < 25; i++) {
      const x = i * 22;
      rectangle(m, x, 85 + rand() * 40, 5, 130, '#285751');
      foliage(m, x, 90 + rand() * 30, 32, ['#2e6b5f', '#35796b', '#3e8470'], i + 34);
    }
    rectangle(m, 306, 105, 47, 120, '#326c68');
    rectangle(m, 313, 106, 34, 119, '#94cbb7');
    rectangle(m, 320, 106, 9, 119, '#c1ded0');
    rectangle(m, 337, 109, 7, 116, '#b0d8c5');
    rectangle(m, 301, 224, 59, 6, '#a0d3c0');
  } else {
    for (let i = 0; i < 12; i++) {
      const x = i * 43 - 8;
      const top = 98 + rand() * 65;
      rectangle(m, x, top, 36, 143, '#292f47');
      rectangle(m, x, top, 36, 3, '#606078');
      rectangle(m, x + 4, top - 14, 3, 15, '#3b3b57');
      for (let j = 0; j < 30; j++) rectangle(m, x + 5 + (j % 4) * 8, top + 12 + Math.floor(j / 4) * 11, 3, 4, rand() > 0.5 ? '#cf9b8b' : '#484866');
    }
    rectangle(m, 352, 127, 27, 27, '#9e5e95');
    rectangle(m, 355, 130, 21, 21, '#343451');
    rectangle(m, 360, 135, 3, 12, '#de91b7');
    rectangle(m, 368, 135, 3, 12, '#de91b7');
    rectangle(m, 360, 140, 11, 3, '#de91b7');
  }
  layers.push(middle);

  const [near, n] = layer();
  if (arena === 'sunset') {
    // An original weathered gate anchors the right side of the mountain arena.
    rectangle(n, 351, 127, 9, 99, '#342e38');
    rectangle(n, 424, 127, 9, 99, '#342e38');
    rectangle(n, 353, 128, 5, 97, '#894e46');
    rectangle(n, 426, 128, 5, 97, '#894e46');
    rectangle(n, 357, 128, 1, 97, '#b36f54');
    rectangle(n, 430, 128, 1, 97, '#b36f54');
    rectangle(n, 341, 129, 103, 6, '#3b303a');
    rectangle(n, 343, 129, 99, 3, '#a65b4a');
    polygon(n, [[331, 117], [339, 120], [447, 120], [454, 117], [450, 126], [337, 126]], '#302d35');
    rectangle(n, 338, 121, 109, 2, '#b16950');
    rectangle(n, 389, 132, 7, 12, '#332d35');
    rectangle(n, 390, 134, 5, 7, '#b17b5f');
    rectangle(n, 468, 35, 11, 192, '#2e2c34');
    polygon(n, [[472, 61], [426, 38], [429, 32], [476, 48]], '#2e2c34');
    polygon(n, [[474, 95], [449, 74], [421, 64], [417, 67], [449, 85], [474, 111]], '#2e2c34');
    foliage(n, 471, 19, 47, ['#4a333b', '#733b40', '#9c4943', '#ba5947'], 231);
    foliage(n, 440, 37, 28, ['#64383d', '#934641', '#b15947', '#cb704f'], 111);
    foliage(n, 461, 69, 22, ['#6f3d40', '#a24e42', '#bd654a'], 19);
    rectangle(n, 16, 173, 6, 53, '#2e2d35');
    foliage(n, 14, 163, 33, ['#45373e', '#72413f', '#a55745'], 90);
    rectangle(n, 294, 204, 9, 21, '#444046');
    rectangle(n, 290, 200, 17, 4, '#635252');
    rectangle(n, 294, 187, 9, 13, '#493e44');
    rectangle(n, 296, 190, 5, 7, '#df9970');
    polygon(n, [[289, 187], [298, 181], [308, 187]], '#39333c');
  } else if (arena === 'forest') {
    for (const x of [12, 52, 441, 473]) {
      rectangle(n, x, 42, 10, 186, '#1b3d3c');
      rectangle(n, x + 2, 55, 2, 169, '#31534a');
      polygon(n, [[x, 114], [x - 28, 83], [x - 29, 77], [x + 5, 96]], '#1b3d3c');
      foliage(n, x, 39, 54, ['#193f3c', '#215346', '#32654d', '#447853'], x + 110);
    }
    foliage(n, 32, 205, 35, ['#23463d', '#355a43', '#55734c'], 11);
    foliage(n, 466, 204, 35, ['#23463d', '#355a43', '#55734c'], 49);
  } else {
    rectangle(n, 0, 209, 480, 17, '#252b38');
    rectangle(n, 0, 209, 480, 3, '#626274');
    for (let x = 3; x < W; x += 40) {
      rectangle(n, x, 195, 3, 16, '#393e51');
      rectangle(n, x, 194, 32, 2, '#686075');
    }
    rectangle(n, 442, 147, 20, 65, '#242d3d');
    rectangle(n, 439, 145, 26, 4, '#535465');
    rectangle(n, 447, 130, 3, 15, '#565367');
    rectangle(n, 451, 124, 3, 25, '#656176');
    rectangle(n, 14, 185, 35, 25, '#333747');
    for (let i = 0; i < 5; i++) rectangle(n, 19, 190 + i * 3, 25, 1, '#5c5665');
  }
  layers.push(near);

  const [ground, g] = layer();
  const palette = arena === 'sunset' ? ['#66605b', '#514d4c', '#403e40', '#35353b', '#8c7b61']
    : arena === 'forest' ? ['#486352', '#354f45', '#2c403c', '#213334', '#7c9763']
      : ['#565464', '#434352', '#363947', '#2a2e3c', '#8a7984'];
  rectangle(g, 0, 225, W, 45, palette[3]);
  rectangle(g, 0, 225, W, 3, palette[4]);
  rectangle(g, 0, 228, W, 3, palette[0]);
  for (let row = 0; row < 4; row++) {
    for (let x = -20; x < W; x += 27) {
      const xx = x + (row % 2) * 14;
      const y = 232 + row * 11;
      rectangle(g, xx, y, 25, 9, palette[row < 2 ? 1 : 2]);
      rectangle(g, xx + 1, y, 23, 1, palette[row < 2 ? 0 : 1]);
      if (rand() > 0.5) rectangle(g, xx + 3 + rand() * 16, y + 3, 4 + rand() * 5, 1, palette[3]);
    }
  }
  if (arena !== 'city') {
    for (let i = 0; i < 100; i++) {
      const x = rand() * W;
      rectangle(g, x, 224 + rand() * 5, 2 + rand() * 6, 1 + rand() * 2, arena === 'forest' ? '#88a265' : '#898365');
    }
    for (let i = 0; i < 14; i++) {
      const x = rand() * W;
      rectangle(g, x, 226, 1, 6 + rand() * 10, arena === 'forest' ? '#55794e' : '#69704f');
    }
  }
  layers.push(ground);
  cache.set(arena, layers);
  return layers;
}

export function drawArena(ctx: CanvasRenderingContext2D, arena: ArenaId, time = 0, focus = 0) {
  ctx.imageSmoothingEnabled = false;
  const layers = cache.get(arena) ?? createLayers(arena);
  ctx.clearRect(0, 0, W, H);
  ctx.drawImage(layers[0], 0, 0);
  for (let i = 1; i <= 3; i++) {
    const offset = Math.round(focus * i * 2);
    ctx.drawImage(layers[i], offset, 0);
    if (offset > 0) ctx.drawImage(layers[i], offset - W, 0);
    if (offset < 0) ctx.drawImage(layers[i], offset + W, 0);
  }
  if (arena === 'forest') {
    ctx.globalAlpha = 0.45;
    for (let i = 0; i < 24; i++) {
      const y = 107 + ((i * 8 + time * 53) % 115);
      rectangle(ctx, 315 + (i % 4) * 7 + focus * 4, y, 2, 4 + i % 3, '#e4f5e4');
    }
    ctx.globalAlpha = 1;
    for (let i = 0; i < 9; i++) rectangle(ctx, 297 + i * 8, 222 + Math.sin(time * 2 + i) * 2, 5, 1, '#c1e3ce');
  } else if (arena === 'city') {
    ctx.globalAlpha = 0.35 + Math.sin(time * 2) * 0.15;
    rectangle(ctx, 352 + focus * 4, 127, 27, 1, '#f5a5d8');
    ctx.globalAlpha = 1;
    for (let i = 0; i < 5; i++) rectangle(ctx, 84 + i * 87, 93 + i % 3 * 11, 1, 1, Math.sin(time * 2 + i) > 0 ? '#f39492' : '#5b4265');
  }
  ctx.drawImage(layers[4], 0, 0);
  if (arena !== 'city') {
    for (let i = 0; i < 12; i++) {
      const x = (i * 63 + time * (9 + i % 3 * 3)) % 510 - 15;
      const y = (i * 37 + time * (4 + i % 4)) % 218;
      rectangle(ctx, x + Math.sin(time + i) * 5, y, 2 + i % 2, 1, arena === 'sunset' ? '#bd7954' : '#90b075');
    }
  } else {
    for (let i = 0; i < 17; i++) rectangle(ctx, (i * 37 + time * 13) % 490, (i * 23 + time * 49) % 223, 1, 3, '#817691');
  }
}

function pixelLine(ctx: CanvasRenderingContext2D, a: Point, b: Point, width: number, color: string) {
  const steps = Math.max(Math.abs(b[0] - a[0]), Math.abs(b[1] - a[1]), 1);
  for (let i = 0; i <= steps; i++) {
    const t = i / steps;
    rectangle(ctx, a[0] + (b[0] - a[0]) * t - width / 2, a[1] + (b[1] - a[1]) * t - width / 2, width, width, color);
  }
}

function limb(ctx: CanvasRenderingContext2D, a: Point, b: Point, c: Point, color: string, width = 6) {
  pixelLine(ctx, a, b, width + 3, '#151e2a');
  pixelLine(ctx, b, c, width + 3, '#151e2a');
  pixelLine(ctx, a, b, width, color);
  pixelLine(ctx, b, c, width, color);
}

export function drawFighter(mainCtx: CanvasRenderingContext2D, fighter: FighterVisual, time: number, scale = 1.15) {
  const def = FIGHTERS[fighter.id];
  const x = Math.round(fighter.x / 2);
  const y = Math.round(fighter.y / 2);
  const t = time;
  const shadowSize = fighter.pose === 'ko' ? 30 : 23;
  mainCtx.save();
  mainCtx.globalAlpha = 0.3;
  rectangle(mainCtx, x - shadowSize, GROUND / 2 - 2, shadowSize * 2, 4, '#101720');
  rectangle(mainCtx, x - shadowSize + 5, GROUND / 2 + 2, shadowSize * 2 - 10, 2, '#101720');
  mainCtx.globalAlpha = fighter.invulnerable && Math.floor(time * 17) % 2 === 0 ? 0.62 : 1;
  if (!fighterBuffer) {
    const canvas = document.createElement('canvas');
    canvas.width = 192; canvas.height = 144;
    fighterBuffer = { canvas, context: canvas.getContext('2d')! };
  }
  // Rasterize at native pixel size before scaling so even fractional sizes stay sharp.
  const ctx = fighterBuffer.context;
  ctx.clearRect(0, 0, 192, 144);
  ctx.save();
  ctx.translate(96, 116);
  ctx.scale(fighter.facing, 1);
  if (fighter.pose === 'ko') {
    ctx.translate(9, -7);
    ctx.rotate(-Math.PI / 2);
  }
  const flash = (fighter.hitFlash ?? 0) > 0.07;
  const color = flash ? '#fff0d6' : def.color;
  const dark = flash ? '#ffb0a0' : def.dark;
  const body = fighter.id === 'titan' ? '#253b46' : fighter.id === 'spark' ? '#302d47' : '#34313c';
  const breathe = Math.round(Math.sin(t * 3) * 1);
  let offset = breathe;
  let lean = 0;
  let frontHand: Point = [19, -34];
  let frontElbow: Point = [12, -25];
  let backHand: Point = [6, -29];
  let backElbow: Point = [-9, -29];
  let frontKnee: Point = [10, -13];
  let frontFoot: Point = [14, 0];
  let backKnee: Point = [-10, -14];
  let backFoot: Point = [-16, 0];
  if (fighter.pose === 'walk') {
    const stride = Math.sin(t * 14);
    frontFoot = [12 + stride * 10, -Math.max(0, stride) * 5];
    backFoot = [-12 - stride * 10, -Math.max(0, -stride) * 5];
    frontKnee = [8 + stride * 7, -14];
    backKnee = [-8 - stride * 7, -14];
    lean = 2;
  }
  if (fighter.pose === 'jump') {
    frontKnee = [13, -20]; frontFoot = [19, -10];
    backKnee = [-12, -19]; backFoot = [-6, -9];
    frontHand = [14, -43]; backHand = [-11, -37];
  }
  if (fighter.pose === 'crouch' || fighter.attack === 'sweep') {
    offset = 13; frontKnee = [14, -9]; backKnee = [-14, -8];
    frontFoot = [21, 0]; backFoot = [-21, 0];
  }
  if (fighter.pose === 'block') {
    frontHand = [12, -47]; frontElbow = [19, -34];
    backHand = [16, -42]; backElbow = [10, -30]; lean = -3;
  }
  if (fighter.pose === 'hurt') {
    lean = -7; backHand = [-18, -33]; frontHand = [8, -27];
    frontElbow = [10, -32]; backElbow = [-13, -28];
  }
  if (fighter.pose === 'victory') {
    frontHand = [18, -67]; frontElbow = [20, -49];
    backHand = [-19, -64]; backElbow = [-22, -47];
  }
  const e = fighter.extension ?? 0;
  if (fighter.pose === 'attack' && fighter.attack) {
    switch (fighter.attack) {
      case 'jab': frontElbow = [15 + e * 8, -35]; frontHand = [15 + e * 26, -36]; lean = e * 3; break;
      case 'heavy': frontElbow = [10 + e * 13, -40]; frontHand = [3 + e * 42, -40]; lean = e * 7; backHand = [-6, -29]; break;
      case 'kick': frontKnee = [12 + e * 8, -14 - e * 10]; frontFoot = [14 + e * 34, -e * 24]; lean = -e * 5; break;
      case 'heavyKick': frontKnee = [11 + e * 13, -14 - e * 19]; frontFoot = [14 + e * 37, -e * 41]; lean = -e * 8; backHand = [-16, -35]; break;
      case 'uppercut': frontElbow = [11 + e * 5, -24 - e * 16]; frontHand = [13 + e * 14, -27 - e * 39]; offset = 6 - e * 8; lean = e * 3; break;
      case 'sweep': frontKnee = [18 + e * 9, -5]; frontFoot = [21 + e * 33, -3]; frontHand = [18, -24]; backHand = [-15, -19]; lean = -e * 5; break;
      case 'airKick': frontKnee = [16, -17]; frontFoot = [14 + e * 39, -8 - e * 15]; backKnee = [-10, -22]; backFoot = [-5, -12]; lean = -e * 5; break;
      case 'dash': frontElbow = [19, -33]; frontHand = [19 + e * 25, -35]; backHand = [-18, -37]; lean = 8; backFoot = [-25, -4]; break;
      case 'special':
        if (fighter.id === 'titan') { offset = 12 * e; frontHand = [18 + 9 * e, -42 + 37 * e]; backHand = [7 + 13 * e, -42 + 37 * e]; frontElbow = [20, -26]; backElbow = [6, -24]; }
        else { frontHand = [21 + e * 24, -35]; backHand = [-15 - e * 6, -40]; frontElbow = [24, -32]; lean = e * 5; }
        break;
    }
  }
  const hip: Point = [lean, -22 + offset];
  const shoulder: Point = [lean, -37 + offset];
  limb(ctx, hip, backKnee, backFoot, '#24303c');
  rectangle(ctx, backFoot[0] - 5, backFoot[1] - 3, 10, 5, dark);
  limb(ctx, [shoulder[0] - 5, shoulder[1] + 1], [backElbow[0], backElbow[1] + offset], [backHand[0], backHand[1] + offset], dark, 5);
  rectangle(ctx, backHand[0] - 4, backHand[1] + offset - 4, 8, 8, dark);
  limb(ctx, hip, frontKnee, frontFoot, body);
  rectangle(ctx, frontFoot[0] - 5, frontFoot[1] - 3, 12, 5, color);
  rectangle(ctx, frontFoot[0] - 4, frontFoot[1] - 3, 7, 1, def.light);
  polygon(ctx, [[lean - 7, -39 + offset], [lean + 7, -39 + offset], [lean + 6, -21 + offset], [lean - 6, -21 + offset]], '#141d28');
  rectangle(ctx, lean - 5, -37 + offset, 11, 15, body);
  rectangle(ctx, lean - 5, -35 + offset, 3, 13, dark);
  rectangle(ctx, lean + 3, -35 + offset, 2, 10, color);
  rectangle(ctx, lean - 7, -23 + offset, 15, 4, color);
  rectangle(ctx, lean + 1, -23 + offset, 3, 4, def.light);
  rectangle(ctx, lean - 3, -44 + offset, 7, 7, dark);
  polygon(ctx, [[lean - 7, -55 + offset], [lean + 5, -56 + offset], [lean + 9, -51 + offset], [lean + 9, -43 + offset], [lean + 5, -39 + offset], [lean - 5, -40 + offset], [lean - 8, -44 + offset]], '#121d28');
  rectangle(ctx, lean - 5, -53 + offset, 11, 10, body);
  rectangle(ctx, lean - 6, -52 + offset, 13, 4, color);
  rectangle(ctx, lean - 5, -52 + offset, 10, 1, def.light);
  rectangle(ctx, lean + 2, -47 + offset, 3, 2, '#fff3d9');
  rectangle(ctx, lean + 7, -47 + offset, 2, 2, '#fff3d9');
  rectangle(ctx, lean - 2, -42 + offset, 9, 3, dark);
  const flutter = Math.round(Math.sin(t * 8) * 3);
  polygon(ctx, [[lean - 6, -42 + offset], [lean - 18, -43 + offset + flutter], [lean - 29, -47 + offset + flutter], [lean - 21, -40 + offset + flutter], [lean - 7, -38 + offset]], color);
  rectangle(ctx, lean - 15, -42 + offset + flutter, 7, 1, def.light);
  limb(ctx, [shoulder[0] + 5, shoulder[1] + 1], [frontElbow[0], frontElbow[1] + offset], [frontHand[0], frontHand[1] + offset], color, 5);
  rectangle(ctx, frontHand[0] - 4, frontHand[1] + offset - 4, 9, 8, '#15212b');
  rectangle(ctx, frontHand[0] - 3, frontHand[1] + offset - 3, 7, 6, color);
  rectangle(ctx, frontHand[0] - 2, frontHand[1] + offset - 3, 5, 1, def.light);
  if (fighter.pose === 'block' && (fighter.blockFlash ?? 0) > 0) {
    rectangle(ctx, 26, -52, 2, 32, '#d9fcff');
    rectangle(ctx, 24, -56, 2, 5, '#86e6eb');
    rectangle(ctx, 24, -21, 2, 5, '#86e6eb');
  }
  if (fighter.attack === 'special' && e > 0.5) {
    if (fighter.id === 'spark') {
      const points: Point[] = [[25, -35], [35, -41], [40, -32], [51, -42], [57, -35], [70, -42], [78, -31], [85, -40]];
      for (let i = 1; i < points.length; i++) pixelLine(ctx, points[i - 1], points[i], 2, i % 2 ? def.light : color);
    } else if (fighter.id === 'vortex') {
      for (let i = 0; i < 16; i++) {
        const angle = t * 21 + i * 0.19;
        rectangle(ctx, 8 + Math.cos(angle) * 52, -29 + Math.sin(angle) * 32, 4, 2, i % 3 ? color : def.light);
      }
    } else {
      for (let i = 0; i < 9; i++) rectangle(ctx, 19 + i * 6, -Math.sin(i / 8 * Math.PI) * 8, 4, 2, i % 2 ? color : def.light);
    }
  }
  ctx.restore();
  const pixelScale = scale * def.size;
  mainCtx.imageSmoothingEnabled = false;
  mainCtx.drawImage(fighterBuffer.canvas, x - Math.round(96 * pixelScale), y - Math.round(116 * pixelScale), Math.round(192 * pixelScale), Math.round(144 * pixelScale));
  mainCtx.restore();
}

export function drawArenaPreview(canvas: HTMLCanvasElement, arena: ArenaId) {
  canvas.width = W;
  canvas.height = H;
  drawArena(canvas.getContext('2d')!, arena, 4);
}