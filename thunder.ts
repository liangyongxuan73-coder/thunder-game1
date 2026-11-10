// 雷霆战线 — 单机纵版射击引擎
// 全部机体、弹幕、粒子均由 Canvas 2D 绘制，音效由 Web Audio 合成，不依赖外部素材。
//
// 操控（屏幕坐标，+x 向右，+y 向下）：
//   A / ← 向左，D / → 向右，W / ↑ 向上，S / ↓ 向下。
//   setSteer(+1) 与 A 同向（向左）。这是平面平移，不是追逐相机的偏航。

export type Phase = "menu" | "play" | "pause" | "win" | "lose";

export type HudState = {
  phase: Phase;
  score: number;
  best: number;
  combo: number;
  maxCombo: number;
  hp: number;
  shield: number;
  bombs: number;
  weapon: number;
  weaponLabel: string;
  sector: number;
  bossRatio: number;
  bossPhase: number;
  muted: boolean;
  volume: number;
  shake: boolean;
  kills: number;
};

export type GameHandle = {
  start: () => void;
  pause: () => void;
  resume: () => void;
  restart: () => void;
  nextSector: () => void;
  toMenu: () => void;
  bomb: () => void;
  setMuted: (v: boolean) => void;
  setVolume: (v: number) => void;
  setShake: (v: boolean) => void;
  dispose: () => void;
};

const W = 480;
const H = 854;
const STEP = 1 / 60;
const SPEED = 360;
const SAVE_KEY = "thunder-line-v1";

declare global {
  interface Window {
    __controlsTest?: {
      getYaw: () => number;
      getSpeed: () => number;
      getX: () => number;
      getY: () => number;
      setKeys: (codes: string[]) => void;
      setSteer: (v: number) => void;
    };
    __thunderReady?: boolean;
  }
}

const CYAN = "#3ee0ff";
const MAGENTA = "#ff3d8a";
const FG = "#e7f6ff";
const BG0 = "#05070e";
const BG1 = "#12182c";

const WEAPON_LABELS = ["", "脉冲单发", "双联光矛", "散射矩阵", "极速激光"];

type Bullet = {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  r: number;
  dmg: number;
  friendly: boolean;
  life: number;
};

type Enemy = {
  alive: boolean;
  kind: 0 | 1 | 2;
  x: number;
  y: number;
  ox: number;
  vy: number;
  hp: number;
  max: number;
  r: number;
  t: number;
  fire: number;
  fire2: number;
  spin: number;
  flash: number;
  enter: number;
  phase: number;
  touch: number;
  seed: number;
};

type Drop = {
  alive: boolean;
  kind: 0 | 1 | 2;
  x: number;
  y: number;
  vy: number;
  life: number;
  bob: number;
};

type Particle = {
  alive: boolean;
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  max: number;
  size: number;
  c: number;
};

type Pop = {
  alive: boolean;
  x: number;
  y: number;
  life: number;
  max: number;
  text: string;
  kind: number;
};

type Hazard = {
  alive: boolean;
  x: number;
  w: number;
  vx: number;
  life: number;
  warn: number;
};

type Star = { x: number; y: number; v: number; s: number; a: number };
type Streak = { x: number; y: number; len: number; v: number; a: number };
type Nebula = { x: number; y: number; r: number; v: number; c: string };

function clamp(v: number, a: number, b: number) {
  return v < a ? a : v > b ? b : v;
}

function loadBest(): number {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return 0;
    const data = JSON.parse(raw) as { v?: number; best?: number };
    if (data.v !== 1 || typeof data.best !== "number" || !Number.isFinite(data.best)) return 0;
    return Math.max(0, Math.floor(data.best));
  } catch {
    return 0;
  }
}

export function mountThunder(
  canvas: HTMLCanvasElement,
  onHud: (hud: HudState) => void,
): GameHandle {
  const maybeCtx = canvas.getContext("2d");
  if (!maybeCtx) throw new Error("Canvas 2D 不可用");
  const ctx: CanvasRenderingContext2D = maybeCtx;

  const reduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  let dead = false;
  let raf = 0;
  let acc = 0;
  let animT = 0;
  let lastNow = performance.now();

  let phase: Phase = "menu";
  let score = 0;
  let best = loadBest();
  let combo = 0;
  let maxCombo = 0;
  let comboT = 0;
  let sector = 1;
  let kills = 0;
  let elapsed = 0;
  let intro = 0;
  let warnT = 0;
  let bossUp = false;
  let trauma = 0;
  let flash = 0;
  let hitstop = 0;
  let beamTick = 0;
  let boomCd = 0;
  let hudAcc = 0;
  let hudDirty = true;
  let shakeOn = !reduced;
  let volume = 0.8;
  let muted = false;

  const player = {
    x: W / 2,
    y: H - 150,
    r: 9,
    hp: 100,
    hpMax: 100,
    sh: 40,
    shMax: 100,
    weapon: 1,
    bombs: 2,
    fire: 0,
    inv: 0,
    hurtCd: 0,
    trail: 0,
  };

  let lastVx = 0;
  let lastVy = 0;
  let steer = 0;
  const keys = new Set<string>();
  const injected = new Set<string>();
  let pointing = false;
  const pointer = { x: W / 2, y: H - 150 };

  let cssW = 0;
  let cssH = 0;
  let scale = 1;
  let offsetX = 0;
  let offsetY = 0;
  let dpr = 1;

  const bullets: Bullet[] = Array.from({ length: 360 }, () => ({
    alive: false, x: 0, y: 0, vx: 0, vy: 0, r: 4, dmg: 0, friendly: false, life: 0,
  }));
  const enemies: Enemy[] = Array.from({ length: 36 }, () => ({
    alive: false, kind: 0, x: 0, y: 0, ox: 0, vy: 0, hp: 0, max: 0, r: 12,
    t: 0, fire: 0, fire2: 0, spin: 0, flash: 0, enter: 0, phase: 1, touch: 0, seed: 0,
  }));
  const drops: Drop[] = Array.from({ length: 16 }, () => ({
    alive: false, kind: 0, x: 0, y: 0, vy: 40, life: 0, bob: 0,
  }));
  const parts: Particle[] = Array.from({ length: 480 }, () => ({
    alive: false, x: 0, y: 0, vx: 0, vy: 0, life: 0, max: 1, size: 2, c: 0,
  }));
  const pops: Pop[] = Array.from({ length: 40 }, () => ({
    alive: false, x: 0, y: 0, life: 0, max: 1, text: "", kind: 0,
  }));
  const hazards: Hazard[] = Array.from({ length: 4 }, () => ({
    alive: false, x: 0, w: 30, vx: 0, life: 0, warn: 0,
  }));

  let boss: Enemy | null = null;

  const stars: Star[] = Array.from({ length: 130 }, () => {
    const far = Math.random() < 0.55;
    return {
      x: Math.random() * W,
      y: Math.random() * H,
      v: far ? 16 + Math.random() * 36 : 80 + Math.random() * 180,
      s: far ? 1 : 1.3 + Math.random() * 1.5,
      a: far ? 0.28 + Math.random() * 0.35 : 0.55 + Math.random() * 0.45,
    };
  });
  const streaks: Streak[] = Array.from({ length: 8 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    len: 36 + Math.random() * 100,
    v: 420 + Math.random() * 520,
    a: 0.12 + Math.random() * 0.22,
  }));
  const nebula: Nebula[] = Array.from({ length: 5 }, () => ({
    x: Math.random() * W,
    y: Math.random() * H,
    r: 90 + Math.random() * 140,
    v: 10 + Math.random() * 22,
    c: Math.random() < 0.5 ? "rgba(62,224,255,0.055)" : "rgba(255,61,138,0.05)",
  }));

  // —— 音频：手势内同步 resume，分轨 master / music / sfx ——
  let actx: AudioContext | null = null;
  let master: GainNode | null = null;
  let musicBus: GainNode | null = null;
  let sfxBus: GainNode | null = null;
  let noiseBuf: AudioBuffer | null = null;
  let musicOn = false;
  let musicTimer = 0;
  let musicStep = 0;
  const SCALE = [110, 130.81, 146.83, 164.81, 196, 164.81, 146.83, 130.81];

  function applyGain() {
    if (!master || !actx) return;
    const target = muted ? 0.0001 : Math.max(0.0001, volume * volume);
    master.gain.setTargetAtTime(target, actx.currentTime, 0.03);
  }

  function unlock() {
    const AC =
      window.AudioContext ||
      (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AC) return;
    if (!actx) {
      actx = new AC({ latencyHint: "interactive" });
      master = actx.createGain();
      musicBus = actx.createGain();
      sfxBus = actx.createGain();
      musicBus.gain.value = 0.7;
      sfxBus.gain.value = 1;
      musicBus.connect(master);
      sfxBus.connect(master);
      master.connect(actx.destination);
      applyGain();
      const len = actx.sampleRate;
      noiseBuf = actx.createBuffer(1, len, actx.sampleRate);
      const data = noiseBuf.getChannelData(0);
      for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    }
    if (actx.state === "suspended") void actx.resume();
  }

  function tone(
    freq: number,
    dur: number,
    type: OscillatorType,
    gain: number,
    slide?: number,
  ) {
    if (!actx || !sfxBus || muted) return;
    const t = actx.currentTime;
    const osc = actx.createOscillator();
    const g = actx.createGain();
    osc.type = type;
    osc.frequency.setValueAtTime(freq, t);
    if (slide) osc.frequency.exponentialRampToValueAtTime(Math.max(40, slide), t + dur);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.012);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    osc.connect(g);
    g.connect(sfxBus);
    osc.start(t);
    osc.stop(t + dur + 0.02);
    osc.onended = () => {
      osc.disconnect();
      g.disconnect();
    };
  }

  function noise(dur: number, gain: number, freq = 800) {
    if (!actx || !sfxBus || !noiseBuf || muted) return;
    const t = actx.currentTime;
    const src = actx.createBufferSource();
    src.buffer = noiseBuf;
    const filter = actx.createBiquadFilter();
    filter.type = "lowpass";
    filter.frequency.setValueAtTime(freq, t);
    filter.frequency.exponentialRampToValueAtTime(180, t + dur);
    const g = actx.createGain();
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(gain, t + 0.01);
    g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
    src.connect(filter);
    filter.connect(g);
    g.connect(sfxBus);
    src.start(t);
    src.stop(t + dur);
    src.onended = () => {
      src.disconnect();
      filter.disconnect();
      g.disconnect();
    };
  }

  const sfx = {
    shot(kind: number) {
      if (kind >= 4) tone(220 + Math.random() * 40, 0.09, "sawtooth", 0.035, 140);
      else tone(640 + Math.random() * 80, 0.06, "square", 0.04, 220);
    },
    boom(big: boolean) {
      if (!big && boomCd > 0) return;
      boomCd = big ? 0 : 0.06;
      noise(big ? 0.45 : 0.22, big ? 0.28 : 0.16, big ? 1400 : 900);
      tone(big ? 90 : 140, big ? 0.3 : 0.14, "sine", big ? 0.2 : 0.08, 40);
    },
    hit() {
      tone(180, 0.08, "triangle", 0.06, 70);
    },
    power() {
      tone(523, 0.08, "square", 0.05);
      tone(784, 0.12, "square", 0.045);
    },
    bomb() {
      noise(0.5, 0.32, 1800);
      tone(90, 0.4, "sine", 0.22, 40);
    },
    dry() {
      tone(140, 0.05, "square", 0.03);
    },
    alarm() {
      tone(440, 0.16, "square", 0.06);
      tone(330, 0.18, "square", 0.05);
    },
  };

  function scheduleMusic() {
    if (!musicOn || dead || !actx || !musicBus) return;
    if (phase === "play" && !muted) {
      const t = actx.currentTime;
      const osc = actx.createOscillator();
      const g = actx.createGain();
      osc.type = "sine";
      osc.frequency.value = SCALE[musicStep % SCALE.length] / 2;
      g.gain.setValueAtTime(0.0001, t);
      g.gain.exponentialRampToValueAtTime(0.05, t + 0.02);
      g.gain.exponentialRampToValueAtTime(0.0001, t + 0.32);
      osc.connect(g);
      g.connect(musicBus);
      osc.start(t);
      osc.stop(t + 0.36);
      osc.onended = () => {
        osc.disconnect();
        g.disconnect();
      };
      if (musicStep % 2 === 0) noise(0.04, 0.02, 2500);
      musicStep++;
    }
    if (!musicOn || dead) return;
    musicTimer = window.setTimeout(scheduleMusic, 320);
  }

  function startMusic() {
    if (musicOn) return;
    musicOn = true;
    musicStep = 0;
    scheduleMusic();
  }

  function stopMusic() {
    musicOn = false;
    if (musicTimer) window.clearTimeout(musicTimer);
    musicTimer = 0;
  }

  function saveBest() {
    try {
      localStorage.setItem(SAVE_KEY, JSON.stringify({ v: 1, best }));
    } catch {
      /* 隐私模式等写入失败时忽略 */
    }
  }

  function noteScore(add: number) {
    score += add;
    if (score > best) {
      best = score;
      saveBest();
    }
  }

  function acquire<T extends { alive: boolean }>(pool: T[]): T | null {
    for (let i = 0; i < pool.length; i++) if (!pool[i].alive) return pool[i];
    return null;
  }

  function spawnParticle(
    x: number, y: number, vx: number, vy: number, life: number, size: number, c: number,
  ) {
    let slot: Particle | null = null;
    let oldest = Infinity;
    let oldestP: Particle | null = null;
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p.alive) {
        slot = p;
        break;
      }
      if (p.life < oldest) {
        oldest = p.life;
        oldestP = p;
      }
    }
    const p = slot ?? oldestP;
    if (!p) return;
    p.alive = true;
    p.x = x;
    p.y = y;
    p.vx = vx;
    p.vy = vy;
    p.life = life;
    p.max = life;
    p.size = size;
    p.c = c;
  }

  function burst(x: number, y: number, n: number, hot: boolean) {
    for (let i = 0; i < n; i++) {
      const a = Math.random() * Math.PI * 2;
      const s = 30 + Math.random() * (hot ? 460 : 280);
      spawnParticle(
        x, y,
        Math.cos(a) * s,
        Math.sin(a) * s,
        0.28 + Math.random() * 0.45,
        1.2 + Math.random() * 2.6,
        hot ? (i % 2 === 0 ? 1 : 2) : Math.random() < 0.6 ? 0 : 1,
      );
    }
  }

  function popText(x: number, y: number, text: string, kind: number) {
    const p = acquire(pops);
    if (!p) return;
    p.alive = true;
    p.x = x;
    p.y = y;
    p.text = text;
    p.kind = kind;
    p.life = kind === 0 ? 0.45 : 0.8;
    p.max = p.life;
  }

  function clearAlive<T extends { alive: boolean }>(pool: T[]) {
    for (let i = 0; i < pool.length; i++) pool[i].alive = false;
  }

  function bolt(x: number, y: number, vx: number, vy: number, dmg: number) {
    const b = acquire(bullets);
    if (!b) return;
    b.alive = true;
    b.x = x;
    b.y = y;
    b.vx = vx;
    b.vy = vy;
    b.r = 4;
    b.dmg = dmg;
    b.friendly = true;
    b.life = 2.2;
  }

  function pellet(x: number, y: number, vx: number, vy: number, r = 5) {
    const b = acquire(bullets);
    if (!b) return;
    b.alive = true;
    b.x = x;
    b.y = y;
    b.vx = vx;
    b.vy = vy;
    b.r = r;
    b.dmg = 12;
    b.friendly = false;
    b.life = 4.5;
  }

  function aimedFan(x: number, y: number, n: number, spread: number, speed: number) {
    const ang = Math.atan2(player.y - y, player.x - x);
    const mid = (n - 1) / 2;
    for (let i = 0; i < n; i++) {
      const a = ang + (i - mid) * spread;
      pellet(x, y, Math.cos(a) * speed, Math.sin(a) * speed);
    }
  }

  function ring(x: number, y: number, n: number, speed: number, rot: number) {
    for (let i = 0; i < n; i++) {
      const a = rot + (i / n) * Math.PI * 2;
      pellet(x, y, Math.cos(a) * speed, Math.sin(a) * speed, 4.5);
    }
  }

  function spawnGrunt() {
    const e = acquire(enemies);
    if (!e) return;
    e.alive = true;
    e.kind = 0;
    e.x = 36 + Math.random() * (W - 72);
    e.y = -28;
    e.ox = e.x;
    e.vy = 120 + sector * 14 + Math.random() * 30;
    e.max = 18 + sector * 5;
    e.hp = e.max;
    e.r = 14;
    e.t = 0;
    e.fire = 0.6 + Math.random() * 1.1;
    e.fire2 = 0;
    e.spin = 0;
    e.flash = 0;
    e.enter = 0;
    e.phase = 1;
    e.touch = 0;
    e.seed = Math.random() * 6;
  }

  function spawnElite() {
    const e = acquire(enemies);
    if (!e) return;
    e.alive = true;
    e.kind = 1;
    e.x = 80 + Math.random() * (W - 160);
    e.y = -36;
    e.ox = e.x;
    e.vy = 78 + sector * 8;
    e.max = 78 + sector * 16;
    e.hp = e.max;
    e.r = 18;
    e.t = 0;
    e.fire = 0.8;
    e.fire2 = 0;
    e.spin = 0;
    e.flash = 0;
    e.enter = 0;
    e.phase = 1;
    e.touch = 0;
    e.seed = Math.random() * Math.PI * 2;
  }

  // 击败足够敌机或存活过久后，旗舰从顶部落入
  function summonBoss() {
    if (bossUp) return;
    const e = acquire(enemies);
    if (!e) return;
    bossUp = true;
    boss = e;
    e.alive = true;
    e.kind = 2;
    e.x = W / 2;
    e.y = -80;
    e.ox = W / 2;
    e.vy = 0;
    e.max = 1600 + (sector - 1) * 750;
    e.hp = e.max;
    e.r = 52;
    e.t = 0;
    e.fire = 0.8;
    e.fire2 = 1.6;
    e.spin = 0;
    e.flash = 0;
    e.enter = 1.35;
    e.phase = 1;
    e.touch = 0;
    e.seed = 0;
    warnT = 1.7;
    sfx.alarm();
    popText(W / 2, H * 0.38, "旗舰接近", 2);
    hudDirty = true;
  }

  function maybeDrop(x: number, y: number, bias: number) {
    const r = Math.random();
    const w = 0.2 * bias;
    const s = w + 0.15 * bias;
    const b = s + 0.09 * bias;
    let kind: 0 | 1 | 2 = 0;
    if (r < w) kind = 0;
    else if (r < s) kind = 1;
    else if (r < b) kind = 2;
    else return;
    const d = acquire(drops);
    if (!d) return;
    d.alive = true;
    d.kind = kind;
    d.x = x;
    d.y = y;
    d.vy = 56;
    d.life = 9;
    d.bob = Math.random() * 6;
  }

  function killEnemy(e: Enemy, quiet = false) {
    if (!e.alive) return;
    e.alive = false;
    const isBoss = e.kind === 2;
    burst(e.x, e.y, isBoss ? 64 : e.kind === 1 ? 28 : 18, isBoss);
    if (isBoss) {
      burst(e.x - 30, e.y, 24, true);
      burst(e.x + 30, e.y + 10, 24, false);
    }
    if (!quiet) {
      sfx.boom(isBoss);
      trauma = Math.min(1, trauma + (isBoss ? 0.85 : 0.28));
      hitstop = Math.max(hitstop, isBoss ? 0.1 : 0.04);
    }
    if (isBoss) {
      boss = null;
      bossUp = false;
      noteScore(4800 + sector * 400);
      popText(e.x, e.y - 20, "星区肃清", 2);
      phase = "win";
      stopMusic();
      saveBest();
      hudDirty = true;
      return;
    }
    kills++;
    combo = comboT > 0 ? combo + 1 : 1;
    comboT = 2.05;
    if (combo > maxCombo) maxCombo = combo;
    const base = e.kind === 1 ? 360 : 100;
    const add = Math.round(base * (1 + (combo - 1) * 0.12));
    noteScore(add);
    popText(e.x, e.y - 12, `+${add}`, 1);
    if (combo >= 3 && combo % 3 === 0) popText(e.x, e.y - 32, `COMBO x${combo}`, 2);
    maybeDrop(e.x, e.y, e.kind === 1 ? 1.35 : 1);
  }

  function damageEnemy(e: Enemy, dmg: number, floating: boolean) {
    if (!e.alive) return;
    if (e.kind === 2 && e.enter > 0) return;
    e.hp -= dmg;
    e.flash = 0.08;
    if (floating) popText(e.x + (Math.random() - 0.5) * 16, e.y - 8, String(Math.round(dmg)), 0);
    if (e.hp <= 0) killEnemy(e);
  }

  function hurt(amount: number) {
    if (player.inv > 0 || phase !== "play") return;
    let left = amount;
    if (player.sh > 0) {
      const use = Math.min(player.sh, left);
      player.sh -= use;
      left -= use;
    }
    if (left > 0) player.hp -= left;
    player.inv = 0.85;
    player.hurtCd = 2.15;
    trauma = Math.min(1, trauma + 0.38);
    hitstop = Math.max(hitstop, 0.05);
    flash = Math.min(1, flash + (reduced ? 0.08 : 0.22));
    sfx.hit();
    burst(player.x, player.y, 12, true);
    hudDirty = true;
    if (player.hp <= 0) {
      player.hp = 0;
      phase = "lose";
      burst(player.x, player.y, 56, true);
      sfx.boom(true);
      trauma = 1;
      stopMusic();
      saveBest();
      hudDirty = true;
    }
  }

  function shoot() {
    const x = player.x;
    const y = player.y - 18;
    const w = player.weapon;
    if (w === 1) bolt(x, y, 0, -860, 14);
    else if (w === 2) {
      bolt(x - 12, y + 4, 0, -860, 12);
      bolt(x + 12, y + 4, 0, -860, 12);
    } else {
      const angles = [-0.46, -0.22, 0, 0.22, 0.46];
      for (let i = 0; i < angles.length; i++) {
        const a = angles[i];
        bolt(x, y, Math.sin(a) * 780, -Math.cos(a) * 780, 9);
      }
    }
    sfx.shot(w);
    spawnParticle(x, y, 0, -40, 0.12, 4, 0);
  }

  function laserDamage(dt: number) {
    const half = 18;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive || e.y > player.y + 8) continue;
      if (e.x + e.r < player.x - half || e.x - e.r > player.x + half) continue;
      damageEnemy(e, 210 * dt, false);
      if (Math.random() < 0.4) {
        spawnParticle(player.x + (Math.random() - 0.5) * 10, e.y, (Math.random() - 0.5) * 40, -80, 0.2, 2, 0);
      }
      if (phase !== "play") return;
    }
  }

  function spawnSweep() {
    const specs = [
      { x: 70, vx: 110 },
      { x: W - 70, vx: -110 },
    ];
    for (let i = 0; i < specs.length; i++) {
      const h = acquire(hazards);
      if (!h) return;
      h.alive = true;
      h.x = specs[i].x;
      h.vx = specs[i].vx;
      h.w = 34;
      h.warn = 0.55;
      h.life = 1.35;
    }
  }

  function updateBoss(e: Enemy, dt: number) {
    e.t += dt;
    e.flash = Math.max(0, e.flash - dt);
    if (e.enter > 0) {
      e.enter -= dt;
      e.y += (148 - e.y) * Math.min(1, dt * 2.4);
      return;
    }
    const phase2 = e.hp < e.max * 0.5;
    if (e.phase === 1 && phase2) {
      e.phase = 2;
      popText(e.x, e.y + 70, "激光炮充能", 2);
      sfx.alarm();
      hudDirty = true;
    }
    if (!phase2) {
      e.x = W / 2 + Math.sin(e.t * 0.85) * (W * 0.3);
      e.y = 150 + Math.sin(e.t * 1.6) * 22;
      e.fire -= dt;
      if (e.fire <= 0) {
        e.fire = Math.max(0.42, 0.72 - sector * 0.04);
        aimedFan(e.x, e.y + 30, 3, 0.16, 250 + sector * 10);
      }
      e.fire2 -= dt;
      if (e.fire2 <= 0) {
        e.fire2 = 2.5;
        ring(e.x, e.y, 12, 150, e.t);
      }
    } else {
      e.x += (W / 2 - e.x) * Math.min(1, dt * 1.1);
      e.y += (128 - e.y) * Math.min(1, dt * 1.1);
      e.fire -= dt;
      if (e.fire <= 0) {
        e.fire = 0.085;
        e.spin += 0.28;
        pellet(e.x, e.y, Math.cos(e.spin) * 210, Math.sin(e.spin) * 210, 5);
        pellet(e.x, e.y, Math.cos(e.spin + Math.PI) * 210, Math.sin(e.spin + Math.PI) * 210, 5);
      }
      e.fire2 -= dt;
      if (e.fire2 <= 0) {
        e.fire2 = 3.15;
        spawnSweep();
      }
    }
  }

  function updateStars(dt: number) {
    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      s.y += s.v * dt;
      if (s.y > H) {
        s.y = 0;
        s.x = Math.random() * W;
      }
    }
    for (let i = 0; i < streaks.length; i++) {
      const s = streaks[i];
      s.y += s.v * dt;
      if (s.y - s.len > H) {
        s.y = -20;
        s.x = Math.random() * W;
      }
    }
    for (let i = 0; i < nebula.length; i++) {
      const n = nebula[i];
      n.y += n.v * dt;
      if (n.y - n.r > H) {
        n.y = -n.r;
        n.x = Math.random() * W;
      }
    }
  }

  function updateParticles(dt: number) {
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p.alive) continue;
      p.life -= dt;
      if (p.life <= 0) {
        p.alive = false;
        continue;
      }
      p.x += p.vx * dt;
      p.y += p.vy * dt;
      const drag = Math.exp(-1.6 * dt);
      p.vx *= drag;
      p.vy *= drag;
    }
    for (let i = 0; i < pops.length; i++) {
      const p = pops[i];
      if (!p.alive) continue;
      p.life -= dt;
      p.y -= 36 * dt;
      if (p.life <= 0) p.alive = false;
    }
  }

  function collect(d: Drop) {
    d.alive = false;
    if (d.kind === 0) {
      if (player.weapon < 4) {
        player.weapon++;
        popText(player.x, player.y - 36, WEAPON_LABELS[player.weapon], 2);
      } else {
        noteScore(400);
        popText(player.x, player.y - 36, "火力已满 +400", 2);
      }
      sfx.power();
    } else if (d.kind === 1) {
      let add = 50;
      const room = player.shMax - player.sh;
      const toSh = Math.min(room, add);
      player.sh += toSh;
      add -= toSh;
      if (add > 0) player.hp = Math.min(player.hpMax, player.hp + add);
      popText(player.x, player.y - 36, "护盾补给", 2);
      sfx.power();
    } else {
      player.bombs = Math.min(5, player.bombs + 1);
      popText(player.x, player.y - 36, "清屏弹 +1", 2);
      sfx.power();
    }
    hudDirty = true;
  }

  function readAxes() {
    let ax = 0;
    let ay = 0;
    const down = (code: string) => keys.has(code) || injected.has(code);
    // A 减小 x（向左），D 增大 x（向右）。W 减小 y（向上）。
    if (down("KeyA") || down("ArrowLeft")) ax -= 1;
    if (down("KeyD") || down("ArrowRight")) ax += 1;
    if (down("KeyW") || down("ArrowUp")) ay -= 1;
    if (down("KeyS") || down("ArrowDown")) ay += 1;
    ax -= steer;
    return { ax, ay };
  }

  function update(dt: number) {
    if (phase !== "play") return;
    boomCd = Math.max(0, boomCd - dt);
    if (intro > 0) intro -= dt;
    if (warnT > 0) warnT -= dt;
    if (comboT > 0) {
      comboT -= dt;
      if (comboT <= 0) combo = 0;
    }
    player.inv = Math.max(0, player.inv - dt);
    beamTick = Math.max(0, beamTick - dt);
    if (player.hurtCd > 0) player.hurtCd -= dt;
    else if (player.sh < player.shMax) player.sh = Math.min(player.shMax, player.sh + 16 * dt);

    const { ax, ay } = readAxes();
    const mag = Math.hypot(ax, ay);
    if (mag > 0) {
      lastVx = (ax / mag) * SPEED;
      lastVy = (ay / mag) * SPEED;
      player.x += lastVx * dt;
      player.y += lastVy * dt;
    } else if (pointing) {
      const k = 1 - Math.exp(-14 * dt);
      let dx = (pointer.x - player.x) * k;
      let dy = (pointer.y - player.y) * k;
      const step = Math.hypot(dx, dy);
      const maxStep = 680 * dt;
      if (step > maxStep) {
        dx *= maxStep / step;
        dy *= maxStep / step;
      }
      player.x += dx;
      player.y += dy;
      lastVx = dx / dt;
      lastVy = dy / dt;
    } else {
      lastVx = 0;
      lastVy = 0;
    }
    player.x = clamp(player.x, 24, W - 24);
    player.y = clamp(player.y, 28, H - 28);

    player.trail -= dt;
    if (player.trail <= 0) {
      player.trail = 0.03;
      spawnParticle(player.x, player.y + 16, (Math.random() - 0.5) * 20, 80, 0.22, 2.2, 0);
    }

    player.fire -= dt;
    if (player.weapon === 4) {
      laserDamage(dt);
      if (phase !== "play") return;
      if (player.fire <= 0) {
        player.fire = 0.11;
        sfx.shot(4);
      }
    } else if (player.fire <= 0) {
      player.fire = player.weapon === 3 ? 0.16 : player.weapon === 2 ? 0.11 : 0.13;
      shoot();
    }

    if (!bossUp && intro <= 0) {
      elapsed += dt;
      // 用 fire 字段复用会混乱，单独用 player 之外的 spawn 计时
    }

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      if (e.kind === 2) {
        updateBoss(e, dt);
      } else if (e.kind === 1) {
        e.t += dt;
        e.ox += (player.x - e.ox) * dt * 0.35;
        e.ox = clamp(e.ox, 56, W - 56);
        e.x = clamp(e.ox + Math.sin(e.t * 2.35 + e.seed) * 68, 24, W - 24);
        e.y += e.vy * dt;
        e.fire -= dt;
        e.flash = Math.max(0, e.flash - dt);
        if (e.fire <= 0 && e.y > 20 && e.y < H * 0.78) {
          e.fire = Math.max(0.85, 1.35 - sector * 0.05);
          aimedFan(e.x, e.y + 8, 5, 0.22, 230);
        }
      } else {
        e.t += dt;
        e.y += e.vy * dt;
        e.flash = Math.max(0, e.flash - dt);
        e.fire -= dt;
        if (e.fire <= 0 && e.y > 30 && e.y < H * 0.7 && Math.random() < 0.72) {
          pellet(e.x, e.y + 10, 0, 300 + sector * 8, 5);
          e.fire = 1.35 + Math.random() * 0.8;
        } else if (e.fire <= 0) e.fire = 0.4;
      }
      if (e.kind !== 2 && e.y > H + 48) e.alive = false;
      if (!e.alive || phase !== "play") continue;
      e.touch = Math.max(0, e.touch - dt);
      const rr = e.r + player.r;
      const dx = e.x - player.x;
      const dy = e.y - player.y;
      if (e.touch <= 0 && dx * dx + dy * dy < rr * rr) {
        e.touch = 0.55;
        hurt(e.kind === 2 ? 26 : 14);
        if (phase !== "play") return;
      }
    }

    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (!b.alive) continue;
      b.life -= dt;
      b.x += b.vx * dt;
      b.y += b.vy * dt;
      if (b.life <= 0 || b.y < -40 || b.y > H + 40 || b.x < -40 || b.x > W + 40) {
        b.alive = false;
        continue;
      }
      if (b.friendly) {
        for (let j = 0; j < enemies.length; j++) {
          const e = enemies[j];
          if (!e.alive) continue;
          const dx = b.x - e.x;
          const dy = b.y - e.y;
          const rr = b.r + e.r;
          if (dx * dx + dy * dy <= rr * rr) {
            b.alive = false;
            damageEnemy(e, b.dmg, true);
            spawnParticle(b.x, b.y, 0, 0, 0.12, 3, 0);
            if (phase !== "play") return;
            break;
          }
        }
      } else if (player.inv <= 0) {
        const dx = b.x - player.x;
        const dy = b.y - player.y;
        const rr = b.r + player.r;
        if (dx * dx + dy * dy <= rr * rr) {
          b.alive = false;
          hurt(b.dmg);
          if (phase !== "play") return;
        }
      }
    }

    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      if (!h.alive) continue;
      h.life -= dt;
      if (h.warn > 0) h.warn -= dt;
      else h.x += h.vx * dt;
      if (h.life <= 0 || h.x < -40 || h.x > W + 40) {
        h.alive = false;
        continue;
      }
      if (h.warn <= 0 && beamTick <= 0 && Math.abs(player.x - h.x) < h.w * 0.5 + player.r * 0.55) {
        beamTick = 0.55;
        hurt(18);
        if (phase !== "play") return;
      }
    }

    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (!d.alive) continue;
      d.life -= dt;
      d.bob += dt;
      const dx = player.x - d.x;
      const dy = player.y - d.y;
      const dist = Math.hypot(dx, dy);
      if (dist < 130 && dist > 0.001) {
        d.x += (dx / dist) * 320 * dt;
        d.y += (dy / dist) * 320 * dt;
      } else d.y += d.vy * dt;
      if (dist < 24) collect(d);
      else if (d.life <= 0 || d.y > H + 30) d.alive = false;
    }

    updateStars(dt);
    updateParticles(dt);

    if (phase === "play" && !bossUp && intro <= 0 && (kills >= 16 + (sector - 1) * 6 || elapsed > 70)) {
      summonBoss();
    }
  }

  // 刷怪计时，与敌机自身开火计时分开
  let spawnCd = 0.45;

  function updateSpawns(dt: number) {
    if (phase !== "play" || bossUp || intro > 0) return;
    spawnCd -= dt;
    if (spawnCd > 0) return;
    const gap = Math.max(0.32, 1.05 - sector * 0.08 - elapsed * 0.003);
    spawnCd = gap * (0.72 + Math.random() * 0.45);
    const eliteP = Math.min(0.4, 0.1 + elapsed * 0.003 + sector * 0.045);
    if (Math.random() < eliteP) spawnElite();
    else spawnGrunt();
    if (sector > 1 && Math.random() < 0.28) spawnGrunt();
  }

  function resetWorld(keepSector: boolean) {
    clearAlive(bullets);
    clearAlive(enemies);
    clearAlive(drops);
    clearAlive(hazards);
    clearAlive(parts);
    clearAlive(pops);
    boss = null;
    bossUp = false;
    if (!keepSector) {
      sector = 1;
      score = 0;
      combo = 0;
      maxCombo = 0;
      player.weapon = 1;
      player.bombs = 2;
      player.hp = player.hpMax;
      player.sh = 40;
    }
    comboT = 0;
    kills = 0;
    elapsed = 0;
    intro = 1.35;
    warnT = 0;
    spawnCd = 0.4;
    player.x = W / 2;
    player.y = H - 150;
    player.inv = 1.1;
    player.fire = 0.2;
    player.hurtCd = 0;
    lastVx = 0;
    lastVy = 0;
    pointing = false;
    hitstop = 0;
    popText(W / 2, H * 0.34, `星区 ${String(sector).padStart(2, "0")}`, 2);
  }

  function snapshot(): HudState {
    return {
      phase,
      score,
      best,
      combo,
      maxCombo,
      hp: player.hp / player.hpMax,
      shield: player.sh / player.shMax,
      bombs: player.bombs,
      weapon: player.weapon,
      weaponLabel: WEAPON_LABELS[player.weapon],
      sector,
      bossRatio: boss && boss.alive ? boss.hp / boss.max : -1,
      bossPhase: boss && boss.alive ? boss.phase : 0,
      muted,
      volume,
      shake: shakeOn,
      kills,
    };
  }

  function emit(force = false) {
    if (dead) return;
    if (!force && !hudDirty && hudAcc < 0.08) return;
    hudAcc = 0;
    hudDirty = false;
    onHud(snapshot());
  }

  function render(time: number) {
    if (cssW < 2 || scale <= 0) return;
    const shake = shakeOn && !reduced ? trauma * trauma : 0;
    const shx = shake * (Math.sin(time * 47) * 7 + Math.sin(time * 23) * 3);
    const shy = shake * Math.cos(time * 41) * 7;

    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.fillStyle = BG0;
    ctx.fillRect(0, 0, canvas.width, canvas.height);
    ctx.setTransform(dpr * scale, 0, 0, dpr * scale, dpr * (offsetX + shx), dpr * (offsetY + shy));

    const g = ctx.createLinearGradient(0, 0, 0, H);
    g.addColorStop(0, BG0);
    g.addColorStop(1, BG1);
    ctx.fillStyle = g;
    ctx.fillRect(0, 0, W, H);

    for (let i = 0; i < nebula.length; i++) {
      const n = nebula[i];
      ctx.beginPath();
      ctx.fillStyle = n.c;
      ctx.arc(n.x, n.y, n.r, 0, Math.PI * 2);
      ctx.fill();
    }

    for (let i = 0; i < stars.length; i++) {
      const s = stars[i];
      ctx.globalAlpha = s.a;
      ctx.fillStyle = FG;
      ctx.fillRect(s.x, s.y, s.s, s.s);
    }
    ctx.globalAlpha = 1;

    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.5;
    for (let i = 0; i < streaks.length; i++) {
      const s = streaks[i];
      ctx.globalAlpha = s.a;
      ctx.beginPath();
      ctx.moveTo(s.x, s.y - s.len);
      ctx.lineTo(s.x, s.y);
      ctx.stroke();
    }
    ctx.globalAlpha = 1;

    for (let i = 0; i < drops.length; i++) {
      const d = drops[i];
      if (!d.alive) continue;
      drawDrop(d, time);
    }

    for (let i = 0; i < hazards.length; i++) {
      const h = hazards[i];
      if (!h.alive) continue;
      ctx.save();
      if (h.warn > 0) {
        ctx.globalAlpha = 0.35 + Math.sin(time * 28) * 0.15;
        ctx.strokeStyle = MAGENTA;
        ctx.lineWidth = 2;
        ctx.setLineDash([8, 8]);
        ctx.strokeRect(h.x - h.w / 2, 0, h.w, H);
        ctx.setLineDash([]);
      } else {
        ctx.globalAlpha = 0.28;
        ctx.fillStyle = MAGENTA;
        ctx.fillRect(h.x - h.w / 2, 0, h.w, H);
        ctx.globalAlpha = 0.9;
        ctx.fillStyle = FG;
        ctx.fillRect(h.x - 3, 0, 6, H);
        ctx.shadowBlur = 18;
        ctx.shadowColor = MAGENTA;
        ctx.fillRect(h.x - 2, 0, 4, H);
      }
      ctx.restore();
    }

    if (phase === "play" && player.weapon === 4) {
      const pulse = 14 + Math.sin(time * 40) * 4;
      ctx.save();
      ctx.globalCompositeOperation = "lighter";
      ctx.fillStyle = "rgba(62,224,255,0.18)";
      ctx.fillRect(player.x - pulse, 0, pulse * 2, player.y - 10);
      ctx.fillStyle = "rgba(231,246,255,0.85)";
      ctx.shadowBlur = 16;
      ctx.shadowColor = CYAN;
      ctx.fillRect(player.x - 2.5, 0, 5, player.y - 16);
      ctx.restore();
    }

    for (let i = 0; i < bullets.length; i++) {
      const b = bullets[i];
      if (!b.alive) continue;
      ctx.save();
      ctx.translate(b.x, b.y);
      if (b.friendly) {
        ctx.rotate(Math.atan2(b.vy, b.vx) + Math.PI / 2);
        ctx.fillStyle = CYAN;
        ctx.beginPath();
        ctx.ellipse(0, 0, 3.2, 9, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = FG;
        ctx.beginPath();
        ctx.ellipse(0, 0, 1.4, 4, 0, 0, Math.PI * 2);
        ctx.fill();
      } else {
        ctx.fillStyle = "rgba(255,61,138,0.35)";
        ctx.beginPath();
        ctx.arc(0, 0, b.r + 3, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = MAGENTA;
        ctx.beginPath();
        ctx.arc(0, 0, b.r, 0, Math.PI * 2);
        ctx.fill();
        ctx.fillStyle = FG;
        ctx.beginPath();
        ctx.arc(0, 0, b.r * 0.45, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      if (e.kind === 2) drawBoss(e, time);
      else if (e.kind === 1) drawElite(e);
      else drawGrunt(e);
      if (e.kind !== 2 && e.hp < e.max) {
        const bw = e.kind === 1 ? 32 : 24;
        ctx.fillStyle = "rgba(0,0,0,0.45)";
        ctx.fillRect(e.x - bw / 2, e.y - e.r - 12, bw, 3);
        ctx.fillStyle = e.kind === 1 ? CYAN : MAGENTA;
        ctx.fillRect(e.x - bw / 2, e.y - e.r - 12, bw * clamp(e.hp / e.max, 0, 1), 3);
      }
    }

    if (phase !== "lose") drawPlayer(time);

    ctx.save();
    ctx.globalCompositeOperation = "lighter";
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i];
      if (!p.alive) continue;
      const a = clamp(p.life / p.max, 0, 1);
      ctx.globalAlpha = a;
      ctx.fillStyle = p.c === 0 ? CYAN : p.c === 1 ? MAGENTA : FG;
      ctx.beginPath();
      ctx.arc(p.x, p.y, p.size * (0.45 + a), 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
    ctx.globalAlpha = 1;

    ctx.textAlign = "center";
    ctx.font = "700 15px Oxanium, Noto Sans SC, sans-serif";
    for (let i = 0; i < pops.length; i++) {
      const p = pops[i];
      if (!p.alive) continue;
      ctx.globalAlpha = clamp(p.life / p.max, 0, 1);
      ctx.fillStyle = p.kind === 0 ? FG : p.kind === 1 ? CYAN : MAGENTA;
      ctx.fillText(p.text, p.x, p.y);
    }
    ctx.globalAlpha = 1;

    if (intro > 0 && phase === "play") {
      ctx.globalAlpha = clamp(intro, 0, 1);
      ctx.fillStyle = FG;
      ctx.font = "700 28px Oxanium, Noto Sans SC, sans-serif";
      ctx.fillText(`星区 ${String(sector).padStart(2, "0")}`, W / 2, H * 0.36);
      ctx.font = "500 14px Noto Sans SC, sans-serif";
      ctx.fillStyle = CYAN;
      ctx.fillText("突入", W / 2, H * 0.36 + 28);
      ctx.globalAlpha = 1;
    }
    if (warnT > 0) {
      ctx.globalAlpha = clamp(warnT, 0, 1);
      ctx.fillStyle = MAGENTA;
      ctx.font = "700 26px Oxanium, Noto Sans SC, sans-serif";
      ctx.fillText("WARNING", W / 2, H * 0.46);
      ctx.globalAlpha = 1;
    }

    if (pointing && phase === "play") {
      ctx.strokeStyle = CYAN;
      ctx.globalAlpha = 0.7;
      ctx.lineWidth = 1;
      ctx.beginPath();
      ctx.arc(pointer.x, pointer.y, 10, 0, Math.PI * 2);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(pointer.x - 14, pointer.y);
      ctx.lineTo(pointer.x + 14, pointer.y);
      ctx.moveTo(pointer.x, pointer.y - 14);
      ctx.lineTo(pointer.x, pointer.y + 14);
      ctx.stroke();
      ctx.globalAlpha = 1;
    }

    if (flash > 0) {
      ctx.fillStyle = `rgba(231,246,255,${flash * (reduced ? 0.12 : 0.28)})`;
      ctx.fillRect(0, 0, W, H);
    }

    const vg = ctx.createRadialGradient(W / 2, H / 2, H * 0.25, W / 2, H * 0.45, H * 0.75);
    vg.addColorStop(0, "rgba(0,0,0,0)");
    vg.addColorStop(1, "rgba(0,0,0,0.5)");
    ctx.fillStyle = vg;
    ctx.fillRect(0, 0, W, H);
  }

  function drawPlayer(time: number) {
    if (player.inv > 0 && Math.floor(time * 22) % 2 === 0) return;
    ctx.save();
    ctx.translate(player.x, player.y);
    ctx.rotate(clamp(lastVx / SPEED, -1, 1) * 0.42);
    const flick = 8 + Math.sin(time * 36) * 4;
    ctx.fillStyle = CYAN;
    ctx.globalAlpha = 0.8;
    ctx.beginPath();
    ctx.moveTo(-4, 12);
    ctx.lineTo(0, 16 + flick);
    ctx.lineTo(4, 12);
    ctx.closePath();
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.shadowBlur = 14;
    ctx.shadowColor = CYAN;
    ctx.beginPath();
    ctx.moveTo(0, -26);
    ctx.lineTo(7, -6);
    ctx.lineTo(18, 12);
    ctx.lineTo(6, 7);
    ctx.lineTo(0, 14);
    ctx.lineTo(-6, 7);
    ctx.lineTo(-18, 12);
    ctx.lineTo(-7, -6);
    ctx.closePath();
    ctx.fillStyle = "#dff7ff";
    ctx.fill();
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = CYAN;
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = MAGENTA;
    ctx.beginPath();
    ctx.ellipse(0, -4, 3.2, 7.5, 0, 0, Math.PI * 2);
    ctx.fill();
    if (player.sh > 4) {
      ctx.beginPath();
      ctx.arc(0, -2, 26, time * 1.6, time * 1.6 + Math.PI * 1.35);
      ctx.strokeStyle = CYAN;
      ctx.globalAlpha = 0.25 + (player.sh / player.shMax) * 0.5;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    ctx.restore();
  }

  function drawGrunt(e: Enemy) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.beginPath();
    ctx.moveTo(0, 16);
    ctx.lineTo(13, -12);
    ctx.lineTo(0, -4);
    ctx.lineTo(-13, -12);
    ctx.closePath();
    ctx.fillStyle = e.flash > 0 ? FG : "#2a1022";
    ctx.strokeStyle = MAGENTA;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = MAGENTA;
    ctx.fillRect(-2, -2, 4, 8);
    ctx.restore();
  }

  function drawElite(e: Enemy) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.rotate(Math.sin(e.t * 2.35 + e.seed) * 0.18);
    ctx.beginPath();
    ctx.moveTo(0, 20);
    ctx.lineTo(22, -4);
    ctx.lineTo(10, -16);
    ctx.lineTo(0, -8);
    ctx.lineTo(-10, -16);
    ctx.lineTo(-22, -4);
    ctx.closePath();
    ctx.fillStyle = e.flash > 0 ? FG : "#10202e";
    ctx.strokeStyle = CYAN;
    ctx.lineWidth = 1.6;
    ctx.fill();
    ctx.stroke();
    ctx.strokeStyle = MAGENTA;
    ctx.beginPath();
    ctx.moveTo(-16, -2);
    ctx.lineTo(0, 8);
    ctx.lineTo(16, -2);
    ctx.stroke();
    ctx.restore();
  }

  function drawBoss(e: Enemy, time: number) {
    ctx.save();
    ctx.translate(e.x, e.y);
    ctx.shadowBlur = 20;
    ctx.shadowColor = e.phase === 2 ? MAGENTA : CYAN;
    ctx.beginPath();
    ctx.moveTo(0, 58);
    ctx.lineTo(78, 10);
    ctx.lineTo(58, -28);
    ctx.lineTo(24, -18);
    ctx.lineTo(0, -42);
    ctx.lineTo(-24, -18);
    ctx.lineTo(-58, -28);
    ctx.lineTo(-78, 10);
    ctx.closePath();
    ctx.fillStyle = e.flash > 0 ? "#f4fbff" : "#121826";
    ctx.strokeStyle = e.phase === 2 ? MAGENTA : CYAN;
    ctx.lineWidth = 2;
    ctx.fill();
    ctx.stroke();
    ctx.shadowBlur = 0;
    ctx.fillStyle = e.phase === 2 ? MAGENTA : CYAN;
    ctx.globalAlpha = 0.85 + Math.sin(time * 6) * 0.15;
    ctx.beginPath();
    ctx.arc(0, -4, 12, 0, Math.PI * 2);
    ctx.fill();
    ctx.globalAlpha = 1;
    ctx.fillStyle = FG;
    ctx.fillRect(-46, 6, 10, 16);
    ctx.fillRect(36, 6, 10, 16);
    ctx.restore();
  }

  function drawDrop(d: Drop, time: number) {
    const y = d.y + Math.sin(time * 4 + d.bob) * 3;
    ctx.save();
    ctx.translate(d.x, y);
    ctx.rotate(time * 1.4 + d.bob);
    ctx.shadowBlur = 12;
    ctx.shadowColor = d.kind === 2 ? MAGENTA : CYAN;
    ctx.strokeStyle = d.kind === 2 ? MAGENTA : d.kind === 1 ? FG : CYAN;
    ctx.fillStyle = "rgba(16,24,38,0.85)";
    ctx.lineWidth = 2;
    ctx.beginPath();
    if (d.kind === 0) {
      ctx.moveTo(0, -12);
      ctx.lineTo(10, 8);
      ctx.lineTo(0, 3);
      ctx.lineTo(-10, 8);
    } else if (d.kind === 1) {
      ctx.arc(0, 0, 10, 0, Math.PI * 2);
    } else {
      for (let i = 0; i < 6; i++) {
        const a = (i / 6) * Math.PI * 2 - Math.PI / 2;
        const px = Math.cos(a) * 11;
        const py = Math.sin(a) * 11;
        if (i === 0) ctx.moveTo(px, py);
        else ctx.lineTo(px, py);
      }
    }
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    ctx.restore();
    ctx.font = "700 11px Oxanium, Noto Sans SC, sans-serif";
    ctx.textAlign = "center";
    ctx.fillStyle = FG;
    ctx.fillText(d.kind === 0 ? "W" : d.kind === 1 ? "S" : "B", d.x, y + 4);
  }

  function resize() {
    const rect = canvas.getBoundingClientRect();
    cssW = rect.width;
    cssH = rect.height;
    if (cssW < 2 || cssH < 2) return;
    dpr = Math.min(window.devicePixelRatio || 1, 2);
    canvas.width = Math.floor(cssW * dpr);
    canvas.height = Math.floor(cssH * dpr);
    scale = Math.min(cssW / W, cssH / H);
    offsetX = (cssW - W * scale) / 2;
    offsetY = (cssH - H * scale) / 2;
  }

  function canvasPos(ev: PointerEvent) {
    const rect = canvas.getBoundingClientRect();
    return {
      x: (ev.clientX - rect.left - offsetX) / scale,
      y: (ev.clientY - rect.top - offsetY) / scale,
    };
  }

  function onPointerDown(ev: PointerEvent) {
    unlock();
    if (phase !== "play") return;
    ev.preventDefault();
    pointing = true;
    const p = canvasPos(ev);
    pointer.x = p.x;
    pointer.y = p.y;
    try {
      canvas.setPointerCapture(ev.pointerId);
    } catch {
      /* 某些嵌入环境不支持 capture */
    }
  }
  function onPointerMove(ev: PointerEvent) {
    if (!pointing) return;
    const p = canvasPos(ev);
    pointer.x = p.x;
    pointer.y = p.y;
  }
  function onPointerUp(ev: PointerEvent) {
    pointing = false;
    try {
      canvas.releasePointerCapture(ev.pointerId);
    } catch {
      /* ignore */
    }
  }

  function onKeyDown(ev: KeyboardEvent) {
    const tag = (ev.target as HTMLElement | null)?.tagName;
    if (tag === "INPUT" || tag === "TEXTAREA") return;
    if (ev.code.startsWith("Arrow") || ev.code === "Space") ev.preventDefault();
    if (ev.repeat) return;
    keys.add(ev.code);
    unlock();
    if ((ev.code === "Enter" || ev.code === "Space") && phase === "menu") start();
    if (ev.code === "Escape" || ev.code === "KeyP") {
      if (phase === "play") pause();
      else if (phase === "pause") resume();
    }
    if (ev.code === "KeyB" && phase === "play") tryBomb();
  }
  function onKeyUp(ev: KeyboardEvent) {
    keys.delete(ev.code);
  }
  function onBlur() {
    keys.clear();
    pointing = false;
  }
  function onVis() {
    if (document.visibilityState === "visible") unlock();
  }

  function tryBomb() {
    if (phase !== "play" || player.bombs <= 0) {
      sfx.dry();
      return;
    }
    player.bombs--;
    for (let i = 0; i < enemies.length; i++) {
      const e = enemies[i];
      if (!e.alive) continue;
      if (e.kind === 2) damageEnemy(e, 820, true);
      else killEnemy(e, true);
      if (phase !== "play") break;
    }
    for (let i = 0; i < bullets.length; i++) if (!bullets[i].friendly) bullets[i].alive = false;
    for (let i = 0; i < hazards.length; i++) hazards[i].alive = false;
    burst(W / 2, H / 2, 48, true);
    flash = reduced ? 0.18 : 0.7;
    trauma = Math.min(1, trauma + (reduced ? 0.2 : 0.72));
    hitstop = Math.max(hitstop, 0.08);
    sfx.bomb();
    popText(player.x, player.y - 46, "清屏", 2);
    hudDirty = true;
  }

  function start() {
    unlock();
    if (phase !== "menu") return;
    resetWorld(false);
    phase = "play";
    startMusic();
    hudDirty = true;
    emit(true);
  }
  function pause() {
    if (phase !== "play") return;
    phase = "pause";
    keys.clear();
    pointing = false;
    hudDirty = true;
    emit(true);
  }
  function resume() {
    unlock();
    if (phase !== "pause") return;
    phase = "play";
    hudDirty = true;
    emit(true);
  }
  function restart() {
    unlock();
    resetWorld(false);
    phase = "play";
    startMusic();
    hudDirty = true;
    emit(true);
  }
  function nextSector() {
    unlock();
    if (phase !== "win") return;
    sector += 1;
    player.hp = Math.min(player.hpMax, player.hp + 36);
    player.sh = Math.min(player.shMax, player.sh + 45);
    resetWorld(true);
    phase = "play";
    startMusic();
    hudDirty = true;
    emit(true);
  }
  function toMenu() {
    phase = "menu";
    stopMusic();
    clearAlive(bullets);
    clearAlive(enemies);
    clearAlive(drops);
    clearAlive(hazards);
    boss = null;
    bossUp = false;
    keys.clear();
    pointing = false;
    hudDirty = true;
    emit(true);
  }
  function setMuted(v: boolean) {
    muted = v;
    applyGain();
    hudDirty = true;
    emit(true);
  }
  function setVolume(v: number) {
    volume = clamp(v, 0, 1);
    if (volume <= 0.001) muted = true;
    applyGain();
    hudDirty = true;
    emit(true);
  }
  function setShake(v: boolean) {
    shakeOn = v;
    hudDirty = true;
    emit(true);
  }

  function frame(now: number) {
    if (dead) return;
    let dt = (now - lastNow) / 1000;
    lastNow = now;
    if (!Number.isFinite(dt) || dt < 0) dt = 0;
    if (dt > 0.1) dt = 0.1;
    animT += dt;
    if (canvas.clientWidth !== Math.round(cssW) || canvas.clientHeight !== Math.round(cssH)) resize();

    if (hitstop > 0) hitstop -= dt;

    if (phase === "play" && hitstop <= 0) {
      acc += dt;
      let steps = 0;
      while (acc >= STEP && steps < 5 && hitstop <= 0) {
        updateSpawns(STEP);
        update(STEP);
        acc -= STEP;
        steps++;
      }
    } else if (phase === "menu" || phase === "pause") {
      updateStars(dt * (phase === "pause" ? 0.35 : 1));
    } else {
      updateStars(dt * 0.45);
      updateParticles(dt);
    }

    flash = Math.max(0, flash - dt * 1.35);
    if (trauma > 0) trauma = Math.max(0, trauma - dt * 1.45);
    hudAcc += dt;
    render(animT);
    emit(false);
    raf = requestAnimationFrame(frame);
  }

  resize();
  window.__controlsTest = {
    getYaw: () => 0,
    getSpeed: () => Math.hypot(lastVx, lastVy),
    getX: () => player.x,
    getY: () => player.y,
    setKeys: (codes: string[]) => {
      injected.clear();
      for (let i = 0; i < codes.length; i++) injected.add(codes[i]);
    },
    setSteer: (v: number) => {
      steer = v;
    },
  };
  window.__thunderReady = true;

  canvas.addEventListener("pointerdown", onPointerDown, { passive: false });
  canvas.addEventListener("pointermove", onPointerMove);
  canvas.addEventListener("pointerup", onPointerUp);
  canvas.addEventListener("pointercancel", onPointerUp);
  window.addEventListener("keydown", onKeyDown);
  window.addEventListener("keyup", onKeyUp);
  window.addEventListener("blur", onBlur);
  document.addEventListener("visibilitychange", onVis);
  window.addEventListener("resize", resize);

  emit(true);
  raf = requestAnimationFrame(frame);

  return {
    start, pause, resume, restart, nextSector, toMenu, bomb: tryBomb,
    setMuted, setVolume, setShake,
    dispose() {
      dead = true;
      cancelAnimationFrame(raf);
      stopMusic();
      canvas.removeEventListener("pointerdown", onPointerDown);
      canvas.removeEventListener("pointermove", onPointerMove);
      canvas.removeEventListener("pointerup", onPointerUp);
      canvas.removeEventListener("pointercancel", onPointerUp);
      window.removeEventListener("keydown", onKeyDown);
      window.removeEventListener("keyup", onKeyUp);
      window.removeEventListener("blur", onBlur);
      document.removeEventListener("visibilitychange", onVis);
      window.removeEventListener("resize", resize);
      if (window.__controlsTest) delete window.__controlsTest;
      window.__thunderReady = false;
      if (actx) void actx.close();
    },
  };
}
