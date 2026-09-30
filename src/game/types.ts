export type FighterId = 'vortex' | 'spark' | 'titan';
export type ArenaId = 'sunset' | 'forest' | 'city';
export type Difficulty = 'easy' | 'normal' | 'hard';
export type Action = 'left' | 'right' | 'up' | 'down' | 'jab' | 'heavy' | 'kick' | 'heavyKick' | 'block' | 'special';
export type AttackId = 'jab' | 'heavy' | 'kick' | 'heavyKick' | 'uppercut' | 'sweep' | 'airKick' | 'dash' | 'special';
export type Phase = 'menu' | 'countdown' | 'fight' | 'round-end' | 'match-end';
export type Pose = 'idle' | 'walk' | 'jump' | 'crouch' | 'attack' | 'block' | 'hurt' | 'ko' | 'victory';

export interface FighterDefinition {
  id: FighterId;
  name: string;
  role: string;
  description: string;
  color: string;
  light: string;
  dark: string;
  speed: number;
  damage: number;
  timing: number;
  size: number;
  special: string;
  specialDescription: string;
  specialDamage: number;
  specialRange: number;
}

export const FIGHTERS: Record<FighterId, FighterDefinition> = {
  vortex: {
    id: 'vortex', name: 'Вихрь', role: 'Баланс и точность',
    description: 'Держит темп. Наказывает за ошибки. Всегда готов к следующему удару.',
    color: '#ff8558', light: '#ffc28a', dark: '#8b3b2d',
    speed: 212, damage: 1, timing: 1, size: 1,
    special: 'Вихревой удар', specialDescription: 'Рывок вперёд с мощным вращающимся ударом.',
    specialDamage: 18, specialRange: 148,
  },
  spark: {
    id: 'spark', name: 'Искра', role: 'Скорость и напор',
    description: 'Быстрее мысли. Легче ветра. Собирает длинные комбинации.',
    color: '#b49bff', light: '#e3d5ff', dark: '#59448d',
    speed: 263, damage: 0.88, timing: 0.86, size: 0.95,
    special: 'Разряд', specialDescription: 'Дальний электрический удар и короткое уклонение.',
    specialDamage: 16, specialRange: 194,
  },
  titan: {
    id: 'titan', name: 'Титан', role: 'Сила и характер',
    description: 'Не спешит. Не отступает. Каждый удар имеет вес.',
    color: '#6ccfd5', light: '#b4f5eb', dark: '#30616e',
    speed: 164, damage: 1.22, timing: 1.12, size: 1.12,
    special: 'Разлом', specialDescription: 'Удар по земле, подбрасывающий соперника.',
    specialDamage: 20, specialRange: 164,
  },
};

export const ARENAS: Record<ArenaId, { name: string; description: string; color: string }> = {
  sunset: { name: 'Багровый перевал', description: 'Горы на закате', color: '#ee9268' },
  forest: { name: 'Шёпот леса', description: 'Лес и водопад', color: '#67b5a0' },
  city: { name: 'Над городом', description: 'Ночная крыша', color: '#a791de' },
};

export const DIFFICULTIES: Record<Difficulty, { name: string; description: string }> = {
  easy: { name: 'Лёгкий', description: 'Освой приёмы. Соперник прощает ошибки.' },
  normal: { name: 'Обычный', description: 'Честный вызов. Соперник держит удар.' },
  hard: { name: 'Сложный', description: 'Меньше ошибок. Больше блоков и комбинаций.' },
};

export interface AttackDefinition {
  name: string;
  damage: number;
  startup: number;
  active: number;
  recovery: number;
  range: number;
  top: number;
  bottom: number;
  heavy: boolean;
}

const move = (name: string, damage: number, startup: number, active: number, recovery: number, range: number, top: number, bottom: number, heavy = false): AttackDefinition => ({
  name, damage, startup: startup / 60, active: active / 60, recovery: recovery / 60, range, top, bottom, heavy,
});

export const ATTACKS: Record<AttackId, AttackDefinition> = {
  jab: move('Быстрый удар рукой', 5, 5, 3, 10, 78, 91, 42),
  heavy: move('Сильный удар рукой', 11, 10, 4, 18, 91, 99, 39, true),
  kick: move('Быстрый удар ногой', 7, 7, 4, 12, 105, 64, 19),
  heavyKick: move('Сильный удар ногой', 14, 12, 5, 20, 122, 99, 30, true),
  uppercut: move('Апперкот', 12, 10, 4, 24, 83, 151, 27, true),
  sweep: move('Подсечка', 10, 11, 4, 22, 126, 27, 0, true),
  airKick: move('Удар в прыжке', 9, 8, 5, 16, 127, 61, 0),
  dash: move('Рывок с ударом', 9, 9, 4, 18, 104, 92, 29),
  special: move('Спецприём', 18, 15, 6, 26, 148, 119, 0, true),
};

export interface MatchConfig {
  player: FighterId;
  enemy: FighterId;
  arena: ArenaId;
  difficulty: Difficulty;
}

export interface Settings {
  volume: number;
  muted: boolean;
  shake: boolean;
  touch: boolean;
}

export interface FighterSnapshot {
  id: FighterId;
  health: number;
  energy: number;
  wins: number;
  combo: number;
  comboDamage: number;
}

export interface Snapshot {
  phase: Phase;
  paused: boolean;
  timer: number;
  round: number;
  countdown: string;
  message: string;
  roundWinner: number | null;
  winner: number | null;
  player: FighterSnapshot;
  enemy: FighterSnapshot;
}

export interface FighterVisual {
  id: FighterId;
  x: number;
  y: number;
  facing: number;
  pose: Pose;
  attack?: AttackId;
  extension?: number;
  hitFlash?: number;
  blockFlash?: number;
  invulnerable?: boolean;
}

export const DEFAULT_MATCH: MatchConfig = { player: 'vortex', enemy: 'titan', arena: 'sunset', difficulty: 'normal' };
export const WORLD_WIDTH = 960;
export const WORLD_HEIGHT = 540;
export const GROUND = 450;