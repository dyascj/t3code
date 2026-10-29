import { observeResize } from "../lib/observeResize";

// Port of the "ASCII Ocean" Framer component (ascii-ocean.framer.website) with
// its settings baked in. The canvas clears to transparent instead of black so the
// glass shows through, and its black-on-black grid lines are left out.

type Vec = { x: number; y: number };

interface Species {
  readonly cruise: number;
  readonly maxSpeed: number;
  readonly minSpeed: number;
  readonly weight: number;
  readonly schoolSize: readonly [number, number];
  readonly spacing: readonly [number, number];
  readonly align: number;
  readonly cohesion: number;
  readonly jitter: number;
  readonly mill: number;
  readonly verticalDrag: number;
}

interface Fish {
  x: number;
  y: number;
  vx: number;
  vy: number;
  species: number;
  alarm: number;
  alive: boolean;
  respawnAt: number;
  phase: number;
  turn: number;
  depth: number;
  millDir: number;
}

interface Shark {
  readonly id: number;
  readonly kind: SharkKind;
  length: number;
  readonly nodes: Float32Array;
  heading: number;
  speed: number;
  phase: number;
  turn: number;
  hunger: number;
  wander: number;
  readonly orbitDir: number;
  orbitRadius: number;
  target: Fish | null;
  retargetAt: number;
  /** The shark's size relative to the largest, which also sets how near it swims. */
  readonly depth: number;
}

interface WorldEvent {
  readonly kind: "eat" | "splash";
  readonly x: number;
  readonly y: number;
}

interface SharkShape {
  readonly halfWidth: (s: number) => number;
  readonly head?: { span: number; sweep: number; depth: number; notch: number };
  readonly pectoral: readonly [number, number, number, number];
  readonly falcate: boolean;
  readonly pelvic: readonly [number, number, number, number];
  readonly caudal: number;
  readonly dorsal: readonly [number, number];
  readonly secondDorsal: readonly [number, number];
  readonly eye: readonly [number, number] | null;
  readonly gills: readonly [number, number];
}

// The page's settings: five sharks of mixed kinds at 1.35x, 170 fish in mixed
// schools, speed 0.6, and white sharks, sparkles, and water glow.
const FISH_COUNT = 170;
const SPEED = 0.6;
const FISH_RGB = [230, 238, 255] as const;
const WAKE_RGB = [255, 255, 255] as const;
const SHARK_TINT = [1.05, 1.05, 1.05] as const;
const ACCENTS = ["rgb(255,255,255)"];
const RAMP = ":;t%SX8#@";
const FISH_GLYPH = "-";
export const ASCII_OCEAN_FONT = '"Thmanyah Serif Text", serif, ui-monospace, Menlo, monospace';

const TAU = Math.PI * 2;
const clamp = (v: number, lo: number, hi: number) => (v < lo ? lo : v > hi ? hi : v);
const rand = (lo: number, hi: number) => lo + Math.random() * (hi - lo);
const randInt = (lo: number, hi: number) => Math.floor(rand(lo, hi + 1));

function smoothstep(e0: number, e1: number, x: number) {
  const t = clamp((x - e0) / (e1 - e0), 0, 1);
  return t * t * (3 - 2 * t);
}

/** The signed turn from angle a to angle b, in (-PI, PI]. */
function angleDiff(a: number, b: number) {
  let d = (b - a) % TAU;
  if (d > Math.PI) d -= TAU;
  if (d < -Math.PI) d += TAU;
  return d;
}

function hash3(a: number, b: number, c: number) {
  let h = Math.imul(a | 0, 374761393) ^ Math.imul(b | 0, 668265263) ^ Math.imul(c | 0, 1442695041);
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  h ^= h >>> 16;
  return (h >>> 0) / 4294967296;
}

const FLOW_X = 1 / 260;
const FLOW_Y = 1 / 310;
const FLOW_D = 1 / 190;
const FLOW_SCALE = 3400;

/** A slow curl-like current the fish drift in. */
function flow(x: number, y: number, t: number, out: Vec) {
  const i = x * FLOW_X + t * 0.07;
  const a = y * FLOW_Y - t * 0.05;
  const o = (x + y) * FLOW_D + t * 0.11;
  out.x = (-FLOW_Y * Math.sin(i) * Math.sin(a) + 0.5 * FLOW_D * Math.cos(o)) * FLOW_SCALE;
  out.y = (-FLOW_X * Math.cos(i) * Math.cos(a) - 0.5 * FLOW_D * Math.cos(o)) * FLOW_SCALE;
  return out;
}

const SPECIES: readonly Species[] = [
  // sardine
  {
    cruise: 36,
    maxSpeed: 64,
    minSpeed: 18,
    weight: 3,
    schoolSize: [18, 28],
    spacing: [1.8, 1.1],
    align: 1.6,
    cohesion: 1.6,
    jitter: 40,
    mill: 70,
    verticalDrag: 0.5,
  },
  // anchovy
  {
    cruise: 46,
    maxSpeed: 78,
    minSpeed: 22,
    weight: 3,
    schoolSize: [20, 32],
    spacing: [1.5, 1],
    align: 3.2,
    cohesion: 0.45,
    jitter: 30,
    mill: 0,
    verticalDrag: 1.4,
  },
  // silverside
  {
    cruise: 40,
    maxSpeed: 70,
    minSpeed: 20,
    weight: 3,
    schoolSize: [12, 20],
    spacing: [2, 1.1],
    align: 2.4,
    cohesion: 1.1,
    jitter: 35,
    mill: 0,
    verticalDrag: 1.6,
  },
  // mackerel
  {
    cruise: 32,
    maxSpeed: 60,
    minSpeed: 16,
    weight: 2,
    schoolSize: [5, 9],
    spacing: [2.6, 1.3],
    align: 2,
    cohesion: 0.9,
    jitter: 25,
    mill: 0,
    verticalDrag: 2,
  },
  // goby
  {
    cruise: 26,
    maxSpeed: 56,
    minSpeed: 10,
    weight: 1,
    schoolSize: [8, 12],
    spacing: [1.4, 1.1],
    align: 0.35,
    cohesion: 1.4,
    jitter: 110,
    mill: 0,
    verticalDrag: 0.3,
  },
];
const SPECIES_WEIGHT = SPECIES.reduce((sum, s) => sum + s.weight, 0);

/** A species by weight: the page mixes all of them. */
function pickSpecies() {
  let r = Math.random() * SPECIES_WEIGHT;
  for (let i = 0; i < SPECIES.length; i++) {
    r -= SPECIES[i]!.weight;
    if (r <= 0) return i;
  }
  return 0;
}

const SPINE = 20;
const sharkBaseLength = (width: number, height: number) =>
  clamp(Math.min(width, height) * 0.44, 170, 430);
const SEPARATION = 420;
const ALIGNMENT = 1.4;
const COHESION = 1;
const FLEE = 1100;
const VIEW_COS = -0.6;

export class World {
  width = 0;
  height = 0;
  time = 0;
  fish: Fish[] = [];
  sharks: Shark[] = [];
  events: WorldEvent[] = [];
  pointer = { x: 0, y: 0, active: false };
  perception = 60;
  sepX: number[] = [];
  sepY: number[] = [];
  foreignSep = 40;
  bucketCols = 0;
  bucketRows = 0;
  bucketHead = new Int32Array();
  bucketCount = new Uint16Array();
  bucketNext = new Int32Array();
  lastSpawn = 0;
  tmp: Vec = { x: 0, y: 0 };

  private readonly sharkSpecs: readonly { kind: SharkKind; size: number }[];
  private readonly fishCount: number;

  constructor(sharkSpecs: readonly { kind: SharkKind; size: number }[], fishCount: number) {
    this.sharkSpecs = sharkSpecs;
    this.fishCount = fishCount;
  }

  resize(width: number, height: number, cw: number, ch: number) {
    const first = this.width === 0;
    const { width: prevW, height: prevH } = this;
    this.width = width;
    this.height = height;
    this.sepX = SPECIES.map((s) => s.spacing[0] * cw);
    this.sepY = SPECIES.map((s) => s.spacing[1] * ch);
    this.perception = Math.max(ch * 3, cw * 5.5);
    this.foreignSep = cw * 3;
    if (first || this.fish.length === 0) {
      this.seed();
      return;
    }
    // The page never resizes; a chat pane does. Stretch the scene to the new
    // size so it keeps filling the pane instead of circling the old area.
    const sx = width / prevW;
    const sy = height / prevH;
    const sShort = Math.min(width, height) / Math.min(prevW, prevH);
    for (const f of this.fish) {
      f.x = clamp(f.x * sx, 0, width);
      f.y = clamp(f.y * sy, 0, height);
    }
    const baseLength = sharkBaseLength(width, height);
    for (const s of this.sharks) {
      for (let n = 0; n < SPINE; n++) {
        s.nodes[n * 2] = s.nodes[n * 2]! * sx;
        s.nodes[n * 2 + 1] = s.nodes[n * 2 + 1]! * sy;
      }
      s.length = baseLength * s.depth;
      s.orbitRadius *= sShort;
    }
  }

  seed() {
    const { width: w, height: h } = this;
    const short = Math.min(w, h);
    const baseLength = sharkBaseLength(w, h);
    const count = this.sharkSpecs.length;
    this.sharks = [];
    for (let i = 0; i < count; i++) {
      const { kind, size } = this.sharkSpecs[i]!;
      const length = baseLength * size;
      const orbitRadius = short * rand(0.28, 0.4);
      const angle = (i / count) * TAU + rand(-0.4, 0.4);
      const orbitDir = i % 2 === 0 ? 1 : -1;
      const x = w / 2 + Math.cos(angle) * orbitRadius * (w / short) * 0.9;
      const y = h / 2 + Math.sin(angle) * orbitRadius;
      const heading = angle + (orbitDir * Math.PI) / 2;
      const nodes = new Float32Array(SPINE * 2);
      const seg = length / (SPINE - 1);
      for (let n = 0; n < SPINE; n++) {
        nodes[n * 2] = x - Math.cos(heading) * seg * n;
        nodes[n * 2 + 1] = y - Math.sin(heading) * seg * n;
      }
      this.sharks.push({
        id: i + 1,
        kind,
        length,
        nodes,
        heading,
        speed: 30,
        phase: rand(0, TAU),
        turn: 0,
        hunger: rand(0.25, 0.75),
        wander: 0,
        orbitDir,
        orbitRadius,
        target: null,
        retargetAt: 0,
        depth: size,
      });
    }
    this.sharks.sort((a, b) => a.length - b.length);
    const total = this.fishCount;
    this.fish = [];
    while (this.fish.length < total) {
      const species = pickSpecies();
      const sp = SPECIES[species]!;
      const size = Math.min(randInt(sp.schoolSize[0], sp.schoolSize[1]), total - this.fish.length);
      const millDir = Math.random() < 0.5 ? 1 : -1;
      const cx = rand(w * 0.06, w * 0.94);
      const cy = rand(h * 0.08, h * 0.92);
      const dir = (Math.random() < 0.5 ? 0 : Math.PI) + rand(-0.5, 0.5);
      for (let i = 0; i < size; i++) {
        this.fish.push({
          x: cx + rand(-1, 1) * this.sepX[species]! * Math.sqrt(size),
          y: cy + rand(-1, 1) * this.sepY[species]! * Math.sqrt(size) * 0.6,
          vx: Math.cos(dir) * sp.cruise,
          vy: Math.sin(dir) * sp.cruise,
          species,
          alarm: 0,
          alive: true,
          respawnAt: 0,
          phase: rand(0, TAU),
          turn: 0,
          depth: rand(0.55, 1),
          millDir,
        });
      }
    }
    this.bucketNext = new Int32Array(this.fish.length);
  }

  splash(x: number, y: number) {
    this.events.push({ kind: "splash", x, y });
    for (const f of this.fish) {
      if (!f.alive) continue;
      const dx = f.x - x;
      const dy = f.y - y;
      const d = Math.hypot(dx, dy);
      if (d > 240 || d < 0.001) continue;
      const push = (1 - d / 240) * 260;
      f.vx += (dx / d) * push;
      f.vy += (dy / d) * push;
      f.alarm = 1;
    }
  }

  step(dt: number) {
    this.time += dt;
    this.rebuildHash();
    this.stepFish(dt);
    this.stepSharks(dt);
    this.respawn();
  }

  rebuildHash() {
    const p = this.perception;
    this.bucketCols = Math.ceil(this.width / p) + 4;
    this.bucketRows = Math.ceil(this.height / p) + 4;
    const size = this.bucketCols * this.bucketRows;
    if (this.bucketHead.length !== size) {
      this.bucketHead = new Int32Array(size);
      this.bucketCount = new Uint16Array(size);
    }
    this.bucketHead.fill(-1);
    this.bucketCount.fill(0);
    if (this.bucketNext.length !== this.fish.length)
      this.bucketNext = new Int32Array(this.fish.length);
    for (let i = 0; i < this.fish.length; i++) {
      const f = this.fish[i]!;
      if (!f.alive) continue;
      const b = this.bucketOf(f.x, f.y);
      this.bucketNext[i] = this.bucketHead[b]!;
      this.bucketHead[b] = i;
      this.bucketCount[b]!++;
    }
  }

  bucketOf(x: number, y: number) {
    const p = this.perception;
    const col = clamp(Math.floor(x / p) + 2, 0, this.bucketCols - 1);
    return clamp(Math.floor(y / p) + 2, 0, this.bucketRows - 1) * this.bucketCols + col;
  }

  stepFish(dt: number) {
    const { fish, sharks, pointer, width: W, height: H, time } = this;
    const perception2 = this.perception * this.perception;
    const foreignSep = this.foreignSep;
    const cell = this.perception;
    const cols = this.bucketCols;
    const rows = this.bucketRows;
    const head = this.bucketHead;
    const next = this.bucketNext;
    const tmp = this.tmp;
    const calm = Math.exp(-dt * 0.7);
    const spread = Math.min(1, dt * 6);
    for (let idx = 0; idx < fish.length; idx++) {
      const f = fish[idx]!;
      if (!f.alive) continue;
      const sp = SPECIES[f.species]!;
      const loose = 1 + 1.8 * f.alarm;
      const sepX = this.sepX[f.species]! * loose;
      const sepY = this.sepY[f.species]! * loose;
      const speed = Math.hypot(f.vx, f.vy) || 1;
      const hx = f.vx / speed;
      const hy = f.vy / speed;
      let ax = 0;
      let ay = 0;
      let pushX = 0;
      let pushY = 0;
      let velX = 0;
      let velY = 0;
      let offX = 0;
      let offY = 0;
      let mates = 0;
      let nearAlarm = 0;
      const bc = clamp(Math.floor(f.x / cell) + 2, 0, cols - 1);
      const br = clamp(Math.floor(f.y / cell) + 2, 0, rows - 1);
      for (let row = Math.max(0, br - 1); row <= Math.min(rows - 1, br + 1); row++)
        for (let col = Math.max(0, bc - 1); col <= Math.min(cols - 1, bc + 1); col++) {
          let j = head[row * cols + col]!;
          while (j !== -1) {
            if (j !== idx) {
              const o = fish[j]!;
              const dx = o.x - f.x;
              const dy = o.y - f.y;
              const d2 = dx * dx + dy * dy;
              if (d2 < perception2 && d2 > 1e-6) {
                const d = Math.sqrt(d2);
                if ((dx * hx + dy * hy) / d > VIEW_COS) {
                  const rx = dx / sepX;
                  const ry = dy / sepY;
                  const q = rx * rx + ry * ry;
                  if (q < 1) {
                    const qd = Math.sqrt(q) || 0.001;
                    const k = (1 - qd) / qd;
                    pushX -= rx * k;
                    pushY -= ry * k;
                  }
                  if (o.species === f.species) {
                    velX += o.vx;
                    velY += o.vy;
                    offX += dx;
                    offY += dy;
                    mates++;
                  } else if (d < foreignSep) {
                    const k = ((1 - d / foreignSep) / d) * 0.6;
                    pushX -= dx * k;
                    pushY -= dy * k;
                  }
                  if (o.alarm > nearAlarm) nearAlarm = o.alarm;
                }
              }
            }
            j = next[j]!;
          }
        }
      ax += pushX * SEPARATION;
      ay += pushY * SEPARATION;
      if (mates > 0) {
        const al = ALIGNMENT * sp.align;
        const co = COHESION * sp.cohesion * (1 - 0.8 * f.alarm);
        ax += (velX / mates - f.vx) * al + (offX / mates) * co;
        ay += (velY / mates - f.vy) * al + (offY / mates) * co;
        if (sp.mill > 0) {
          const m = Math.hypot(offX, offY) || 1;
          ax += (-offY / m) * f.millDir * sp.mill * (1 - f.alarm);
          ay += (offX / m) * f.millDir * sp.mill * (1 - f.alarm);
        }
      }
      let fear = 0;
      for (const s of sharks) {
        const reach = s.length * 0.6 + 60;
        let best = Infinity;
        let nx = 0;
        let ny = 0;
        for (let n = 0; n <= 12; n += 3) {
          const px = s.nodes[n * 2]!;
          const py = s.nodes[n * 2 + 1]!;
          const d2 = (f.x - px) ** 2 + (f.y - py) ** 2;
          if (d2 < best) {
            best = d2;
            nx = px;
            ny = py;
          }
        }
        const d = Math.sqrt(best);
        if (d >= reach || d < 0.001) continue;
        let k = 1 - d / reach;
        k *= k;
        const ux = (f.x - nx) / d;
        const uy = (f.y - ny) / d;
        const c = Math.cos(s.heading);
        const sn = Math.sin(s.heading);
        const side = c * (f.y - s.nodes[1]!) - sn * (f.x - s.nodes[0]!) >= 0 ? 1 : -1;
        ax += (ux * 0.7 - sn * side * 0.9) * FLEE * k;
        ay += (uy * 0.7 + c * side * 0.9) * FLEE * k;
        fear = Math.max(fear, Math.sqrt(k));
      }
      if (pointer.active) {
        const dx = f.x - pointer.x;
        const dy = f.y - pointer.y;
        const d = Math.hypot(dx, dy);
        if (d < 130 && d > 0.001) {
          const k = (1 - d / 130) ** 2;
          ax += (dx / d) * FLEE * k;
          ay += (dy / d) * FLEE * k;
          fear = Math.max(fear, Math.sqrt(k) * 0.8);
        }
      }
      let alarm = Math.max(f.alarm * calm, fear);
      const caught = nearAlarm * 0.86;
      if (caught > alarm) alarm += (caught - alarm) * spread;
      f.alarm = alarm;
      if (f.x < 36) ax += (36 - f.x) * 7;
      else if (f.x > W - 36) ax -= (f.x - (W - 36)) * 7;
      if (f.y < 36) ay += (36 - f.y) * 7;
      else if (f.y > H - 36) ay -= (f.y - (H - 36)) * 7;
      flow(f.x, f.y, time, tmp);
      ax += tmp.x * 0.5 + (Math.random() - 0.5) * sp.jitter;
      ay += tmp.y * 0.5 + (Math.random() - 0.5) * sp.jitter;
      ay -= f.vy * sp.verticalDrag * (1 - 0.7 * f.alarm);
      const cruise = sp.cruise * (1 + 1.3 * f.alarm);
      ax += (cruise - speed) * hx * 1.6;
      ay += (cruise - speed) * hy * 1.6;
      const before = Math.atan2(f.vy, f.vx);
      f.vx += ax * dt;
      f.vy += ay * dt;
      const max = sp.maxSpeed * (1 + 1.8 * f.alarm);
      const v = Math.hypot(f.vx, f.vy);
      if (v > max) {
        f.vx *= max / v;
        f.vy *= max / v;
      } else if (v < sp.minSpeed && v > 0.001) {
        f.vx *= sp.minSpeed / v;
        f.vy *= sp.minSpeed / v;
      }
      f.turn += (angleDiff(before, Math.atan2(f.vy, f.vx)) / dt - f.turn) * Math.min(1, dt * 8);
      f.phase += dt * (7 + Math.hypot(f.vx, f.vy) * 0.12);
      f.x = clamp(f.x + f.vx * dt, -60, W + 60);
      f.y = clamp(f.y + f.vy * dt, -60, H + 60);
    }
  }

  stepSharks(dt: number) {
    const { sharks, width: W, height: H, time } = this;
    const short = Math.min(W, H);
    const cx = W / 2;
    const cy = H / 2;
    for (const s of sharks) {
      const L = s.length;
      const nodes = s.nodes;
      const x = nodes[0]!;
      const y = nodes[1]!;
      s.hunger = Math.min(1, s.hunger + dt * 0.03);
      let dx = Math.cos(s.heading);
      let dy = Math.sin(s.heading);
      s.wander = clamp(s.wander + (Math.random() - 0.5) * dt * 3.2, -1.1, 1.1);
      dx += Math.cos(s.heading + s.wander) * 0.45;
      dy += Math.sin(s.heading + s.wander) * 0.45;
      if (time >= s.retargetAt) {
        s.target = this.findPrey(s);
        s.retargetAt = time + 0.45;
      }
      const prey = s.target;
      let chasing = false;
      let close = 0;
      if (prey && prey.alive && s.hunger > 0.3) {
        const tx = prey.x + prey.vx * 0.35 - x;
        const ty = prey.y + prey.vy * 0.35 - y;
        const d = Math.hypot(tx, ty) || 1;
        const pull = 1.4 + 2.6 * s.hunger;
        dx += (tx / d) * pull;
        dy += (ty / d) * pull;
        chasing = true;
        close = clamp(1 - d / (L * 0.9), 0, 1);
      } else {
        const ox = (x - cx) / (W / short);
        const oy = y - cy;
        const r = Math.hypot(ox, oy) || 1;
        const want = s.orbitRadius * (1 + 0.15 * Math.sin(time * 0.05 + s.id));
        const k = clamp((want - r) / want, -1, 1);
        dx += ((-oy / r) * s.orbitDir + (ox / r) * k * 0.9) * 0.55;
        dy += ((ox / r) * s.orbitDir + (oy / r) * k * 0.9) * 0.55;
      }
      for (const o of sharks)
        if (o !== s)
          for (let n = 0; n < SPINE; n += 4) {
            const ex = x - o.nodes[n * 2]!;
            const ey = y - o.nodes[n * 2 + 1]!;
            const d = Math.hypot(ex, ey);
            const room = (L + o.length) * 0.45;
            if (d < room && d > 0.001) {
              const k = (1 - d / room) * 3;
              dx += (ex / d) * k;
              dy += (ey / d) * k;
            }
          }
      // Sharks keep out of a wide band through the middle.
      const mx = (x - cx) / (W * 0.3);
      const my = (y - cy) / (H * 0.16);
      const m2 = mx * mx + my * my;
      if (m2 < 1) {
        const m = Math.sqrt(m2) || 0.001;
        const k = (1 - m) * (chasing ? 1 : 2.5);
        dx += (mx / m) * k;
        dy += (my / m) * k;
      }
      const out = Math.max(-x, x - W, -y, y - H);
      if (out > -L * 0.05) {
        const k = clamp((out + L * 0.05) / (L * 0.35), 0, 1) * 3.5;
        const tx = cx - x;
        const ty = cy - y;
        const d = Math.hypot(tx, ty) || 1;
        dx += (tx / d) * k;
        dy += (ty / d) * k;
      }
      const want = Math.atan2(dy, dx);
      const maxTurn = Math.min(chasing ? 1.7 + close : 0.8, s.speed / (L * 0.22)) * dt;
      const turn = clamp(angleDiff(s.heading, want), -maxTurn, maxTurn);
      s.heading += turn;
      s.turn += (turn / dt - s.turn) * Math.min(1, dt * 3);
      const cruise = 30 + L * 0.04;
      const target = chasing ? cruise * (1.45 + close * 1.5) : cruise;
      s.speed += (target - s.speed) * Math.min(1, dt * 1.1);
      s.phase += dt * (2 + s.speed / 24);
      nodes[0] = nodes[0]! + Math.cos(s.heading) * s.speed * dt;
      nodes[1] = nodes[1]! + Math.sin(s.heading) * s.speed * dt;
      const seg = L / (SPINE - 1);
      let prev = s.heading + Math.PI;
      for (let n = 1; n < SPINE; n++) {
        const px = nodes[(n - 1) * 2]!;
        const py = nodes[(n - 1) * 2 + 1]!;
        let a = Math.atan2(nodes[n * 2 + 1]! - py, nodes[n * 2]! - px);
        a = prev + clamp(angleDiff(prev, a), -0.16, 0.16);
        nodes[n * 2] = px + Math.cos(a) * seg;
        nodes[n * 2 + 1] = py + Math.sin(a) * seg;
        prev = a;
      }
      if (s.hunger > 0.15) {
        const bite = L * 0.05 + 8;
        const hx = nodes[0]!;
        const hy = nodes[1]!;
        for (const f of this.fish)
          if (f.alive && (f.x - hx) ** 2 + (f.y - hy) ** 2 < bite * bite) {
            f.alive = false;
            f.respawnAt = time + rand(3, 8);
            s.hunger = Math.max(0, s.hunger - 0.16);
            this.events.push({ kind: "eat", x: f.x, y: f.y });
          }
      }
    }
  }

  findPrey(s: Shark) {
    const reach = s.length * 0.9 + 160;
    const hx = s.nodes[0]!;
    const hy = s.nodes[1]!;
    const c = Math.cos(s.heading);
    const sn = Math.sin(s.heading);
    let best: Fish | null = null;
    let bestScore = Infinity;
    let currentScore = Infinity;
    for (const f of this.fish) {
      if (!f.alive) continue;
      const dx = f.x - hx;
      const dy = f.y - hy;
      const d = Math.hypot(dx, dy);
      if (d > reach || d < 0.001) continue;
      const ahead = (dx * c + dy * sn) / d;
      if (ahead < 0.2) continue;
      const crowd = this.bucketCount[this.bucketOf(f.x, f.y)]!;
      const score = d * (1 + (1 - ahead) * 0.8) * (1 + crowd * 0.07);
      if (score < bestScore) {
        bestScore = score;
        best = f;
      }
      if (f === s.target) currentScore = score;
    }
    return s.target && currentScore < bestScore * 1.3 ? s.target : best;
  }

  respawn() {
    const { time, width: W, height: H } = this;
    const dead: Fish[] = [];
    for (const f of this.fish) if (!f.alive && f.respawnAt <= time) dead.push(f);
    if (dead.length === 0 || (dead.length < 6 && time - this.lastSpawn < 9)) return;
    this.lastSpawn = time;
    const edge = randInt(0, 3);
    const along = rand(0.15, 0.85);
    const x = edge === 0 ? -20 : edge === 1 ? W + 20 : along * W;
    const y = edge === 2 ? -20 : edge === 3 ? H + 20 : along * H;
    const dir = Math.atan2(H / 2 - y, W / 2 - x) + rand(-0.5, 0.5);
    const species = pickSpecies();
    const sp = SPECIES[species]!;
    const millDir = Math.random() < 0.5 ? 1 : -1;
    for (const f of dead.slice(0, sp.schoolSize[1])) {
      f.alive = true;
      f.species = species;
      f.alarm = 0;
      f.turn = 0;
      f.millDir = millDir;
      f.x = x + rand(-1, 1) * this.perception;
      f.y = y + rand(-1, 1) * this.perception;
      f.vx = Math.cos(dir) * sp.cruise * 1.4;
      f.vy = Math.sin(dir) * sp.cruise * 1.4;
    }
  }
}

// ── rendering ──────────────────────────────────────────────────────────

const SHADES = 6;
const FISH_ALPHAS = [0.28, 0.42, 0.58, 0.74, 0.9];
const FIN_CHARS = "%;tS:";
const DORSAL_CHARS = "@8%";
const EDGE_DENSE = ":;";
const EDGE_SPARSE = ".',`";
const MARK_CHARS = "#%@";
const BODY = 1;
const EDGE = 2;
const FIN = 3;
const DORSAL = 4;
const EYE = 5;
const MARK = 6;
/** Four points inside a cell, for how much of it a shark covers. */
const SUBSAMPLES = [0.25, 0.3, 0.75, 0.3, 0.25, 0.72, 0.75, 0.72];

function classicHalfWidth(s: number) {
  if (s < 0.13) return 0.09 * Math.sin(((s / 0.13) * Math.PI) / 2) ** 0.95;
  if (s < 0.3) return 0.09 + 0.016 * smoothstep(0.13, 0.3, s);
  if (s < 0.84) return 0.019 + 0.087 * (1 - (s - 0.3) / 0.54) ** 1.25;
  const t = (s - 0.84) / 0.16;
  return 0.019 * (1 - t) + 0.012 * Math.sin(t * Math.PI);
}

/** Is (px, py) inside the triangle (x1, y1), (x2, y2), (x3, y3)? */
function inTriangle(
  px: number,
  py: number,
  x1: number,
  y1: number,
  x2: number,
  y2: number,
  x3: number,
  y3: number,
) {
  const a = (px - x2) * (y1 - y2) - (x1 - x2) * (py - y2);
  const b = (px - x3) * (y2 - y3) - (x2 - x3) * (py - y3);
  const c = (px - x1) * (y3 - y1) - (x3 - x1) * (py - y1);
  return !((a < 0 || b < 0 || c < 0) && (a > 0 || b > 0 || c > 0));
}

const SHAPES = {
  classic: {
    halfWidth: classicHalfWidth,
    pectoral: [0.15, 0.43, 0.55, 0.26],
    falcate: true,
    pelvic: [0.57, 0.65, 0.69, 0.085],
    caudal: 0.085,
    dorsal: [0.33, 0.47],
    secondDorsal: [0.71, 0.76],
    eye: [0.1, 0.14],
    gills: [0.19, 0.29],
  },
  hammerhead: {
    halfWidth: (s) =>
      s < 0.06
        ? 0.045
        : s < 0.3
          ? 0.045 + 0.061 * smoothstep(0.06, 0.3, s)
          : classicHalfWidth(s) * 0.92,
    head: { span: 0.17, sweep: 0.035, depth: 0.09, notch: 0 },
    pectoral: [0.17, 0.4, 0.5, 0.22],
    falcate: true,
    pelvic: [0.56, 0.63, 0.67, 0.075],
    caudal: 0.11,
    dorsal: [0.28, 0.44],
    secondDorsal: [0.7, 0.74],
    eye: null,
    gills: [0.16, 0.26],
  },
  tiger: {
    halfWidth: (s) => {
      if (s < 0.13) return 0.1 * Math.sin(((s / 0.13) * Math.PI) / 2) ** 0.45;
      if (s < 0.3) return 0.1 + 0.014 * smoothstep(0.13, 0.3, s);
      if (s < 0.84) return 0.019 + 0.095 * (1 - (s - 0.3) / 0.54) ** 1.2;
      const t = (s - 0.84) / 0.16;
      return 0.019 * (1 - t) + 0.012 * Math.sin(t * Math.PI);
    },
    pectoral: [0.15, 0.42, 0.53, 0.25],
    falcate: true,
    pelvic: [0.57, 0.65, 0.69, 0.085],
    caudal: 0.095,
    dorsal: [0.33, 0.46],
    secondDorsal: [0.71, 0.75],
    eye: [0.08, 0.12],
    gills: [0.19, 0.28],
  },
  zebra: {
    halfWidth: (s) => {
      if (s < 0.1) return 0.075 * Math.sin(((s / 0.1) * Math.PI) / 2) ** 0.7;
      if (s < 0.28) return 0.075 + 0.025 * smoothstep(0.1, 0.28, s);
      if (s < 0.55) return 0.022 + 0.078 * (1 - (s - 0.28) / 0.27) ** 1.1;
      const t = (s - 0.55) / 0.45;
      return 0.022 * (1 - t * t) + 0.012 * Math.sin(t * Math.PI);
    },
    pectoral: [0.12, 0.3, 0.36, 0.19],
    falcate: false,
    pelvic: [0.42, 0.48, 0.51, 0.065],
    caudal: 0,
    dorsal: [0.36, 0.44],
    secondDorsal: [0.49, 0.53],
    eye: [0.06, 0.09],
    gills: [0.13, 0.2],
  },
  greathammer: {
    halfWidth: (s) =>
      s < 0.05
        ? 0.04
        : s < 0.3
          ? 0.04 + 0.07 * smoothstep(0.05, 0.3, s)
          : classicHalfWidth(s) * 0.95,
    head: { span: 0.21, sweep: 0.006, depth: 0.085, notch: 0.014 },
    pectoral: [0.16, 0.38, 0.49, 0.24],
    falcate: true,
    pelvic: [0.55, 0.62, 0.67, 0.085],
    caudal: 0.13,
    dorsal: [0.24, 0.45],
    secondDorsal: [0.68, 0.74],
    eye: null,
    gills: [0.15, 0.25],
  },
  mako: {
    halfWidth: (s) => {
      if (s < 0.17) return 0.088 * Math.sin(((s / 0.17) * Math.PI) / 2) ** 1.5;
      if (s < 0.32) return 0.088 + 0.012 * smoothstep(0.17, 0.32, s);
      if (s < 0.86) return 0.014 + 0.086 * (1 - (s - 0.32) / 0.54) ** 1.45;
      const t = (s - 0.86) / 0.14;
      return 0.014 * (1 - t) + 0.01 * Math.sin(t * Math.PI);
    },
    pectoral: [0.18, 0.4, 0.5, 0.21],
    falcate: true,
    pelvic: [0.58, 0.64, 0.68, 0.06],
    caudal: 0.13,
    dorsal: [0.34, 0.45],
    secondDorsal: [0.76, 0.79],
    eye: [0.11, 0.15],
    gills: [0.2, 0.3],
  },
  thresher: {
    halfWidth: (s) => {
      if (s < 0.08) return 0.07 * Math.sin(((s / 0.08) * Math.PI) / 2) ** 0.75;
      if (s < 0.2) return 0.07 + 0.02 * smoothstep(0.08, 0.2, s);
      if (s < 0.48) return 0.012 + 0.078 * (1 - (s - 0.2) / 0.28) ** 1.3;
      const t = (s - 0.48) / 0.52;
      return 0.012 * (1 - t) + 0.006 * Math.sin(t * Math.PI * 0.9) + 0.002;
    },
    pectoral: [0.12, 0.27, 0.36, 0.2],
    falcate: true,
    pelvic: [0.37, 0.41, 0.44, 0.045],
    caudal: 0,
    dorsal: [0.24, 0.32],
    secondDorsal: [0.45, 0.47],
    eye: [0.05, 0.1],
    gills: [0.11, 0.18],
  },
  nurse: {
    halfWidth: (s) => {
      if (s < 0.08) return 0.085 * Math.sin(((s / 0.08) * Math.PI) / 2) ** 0.4;
      if (s < 0.3) return 0.085 + 0.02 * smoothstep(0.08, 0.3, s);
      if (s < 0.72) return 0.022 + 0.083 * (1 - (s - 0.3) / 0.42) ** 1.1;
      const t = (s - 0.72) / 0.28;
      return 0.022 * (1 - t * t) + 0.014 * Math.sin(t * Math.PI);
    },
    pectoral: [0.16, 0.34, 0.4, 0.17],
    falcate: false,
    pelvic: [0.45, 0.52, 0.55, 0.075],
    caudal: 0,
    dorsal: [0.5, 0.58],
    secondDorsal: [0.63, 0.69],
    eye: [0.05, 0.075],
    gills: [0.14, 0.22],
  },
} satisfies Record<string, SharkShape>;
type SharkKind = keyof typeof SHAPES;
/** The order the page's "Mix of all" hands out kinds in. */
const MIX: readonly SharkKind[] = [
  "classic",
  "hammerhead",
  "tiger",
  "zebra",
  "greathammer",
  "mako",
  "thresher",
  "nurse",
];

class Renderer {
  private readonly ctx: CanvasRenderingContext2D;
  dpr = 1;
  width = 0;
  height = 0;
  cw = 12;
  ch = 18;
  cols = 0;
  rows = 0;
  fontFamily = ASCII_OCEAN_FONT;
  energy = new Float32Array();
  energyTmp = new Float32Array();
  heat = new Float32Array();
  sharkFlag = new Uint8Array();
  sharkShade = new Float32Array();
  sharkKey = new Uint32Array();
  sharkDepth = new Float32Array();
  fishStamp = new Uint32Array();
  frameId = 0;
  readonly spine = new Float32Array(SPINE * 2);
  readonly arc = new Float32Array(SPINE);
  arcTotal = 1;
  shape: SharkShape = SHAPES.classic;
  sharkId = 0;
  finTipLeft = 0;
  finTipRight = 0;
  hitFlag = 0;
  hitShade = 0;
  hitS = 0;
  hitV = 0;
  hitDist = 0;
  readonly fishBuckets: number[][] = FISH_ALPHAS.map(() => []);
  readonly fishStyles = FISH_ALPHAS.map((a) => `rgba(${FISH_RGB.join(",")},${a})`);
  readonly wakeBuckets: number[][] = Array.from({ length: SHADES }, () => []);
  readonly wakeStyles = Array.from(
    { length: SHADES },
    (_, i) => `rgba(${WAKE_RGB.join(",")},${((i + 1) / SHADES).toFixed(3)})`,
  );

  private readonly canvas: HTMLCanvasElement;

  constructor(canvas: HTMLCanvasElement) {
    this.canvas = canvas;
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas unavailable");
    this.ctx = ctx;
  }

  resize(width: number, height: number, dpr: number) {
    this.width = width;
    this.height = height;
    this.dpr = dpr;
    this.cw = clamp(Math.round(width / 124), 8, 13);
    this.ch = Math.round(this.cw * 1.45);
    this.cols = Math.ceil(width / this.cw);
    this.rows = Math.ceil(height / this.ch);
    this.canvas.width = Math.round(width * dpr);
    this.canvas.height = Math.round(height * dpr);
    const size = this.cols * this.rows;
    this.energy = new Float32Array(size);
    this.energyTmp = new Float32Array(size);
    this.heat = new Float32Array(size);
    this.sharkFlag = new Uint8Array(size);
    this.sharkShade = new Float32Array(size);
    this.sharkKey = new Uint32Array(size);
    this.sharkDepth = new Float32Array(size);
    this.fishStamp = new Uint32Array(size);
  }

  render(world: World, dt: number) {
    const { ctx, dpr, cols, ch } = this;
    if (cols === 0) return;
    const time = world.time;
    this.consumeEvents(world);
    this.rasterizeSharks(world.sharks, time);
    this.depositWake(world);
    this.diffuse(dt);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.clearRect(0, 0, this.canvas.width, this.canvas.height);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    this.markFish(world);
    this.drawWake();
    ctx.font = `600 ${Math.round(ch * 0.74)}px ${this.fontFamily}`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    this.drawHeat();
    this.drawFish();
    this.drawSharks(time);
  }

  cellIndex(x: number, y: number) {
    const col = Math.floor(x / this.cw);
    const row = Math.floor(y / this.ch);
    return col < 0 || row < 0 || col >= this.cols || row >= this.rows ? -1 : row * this.cols + col;
  }

  stamp(field: Float32Array, x: number, y: number, radius: number, amount: number) {
    const cc = Math.floor(x / this.cw);
    const cr = Math.floor(y / this.ch);
    for (let row = cr - radius; row <= cr + radius; row++)
      for (let col = cc - radius; col <= cc + radius; col++) {
        if (col < 0 || row < 0 || col >= this.cols || row >= this.rows) continue;
        const d = Math.hypot(col - cc, (row - cr) * 1.4);
        if (d > radius + 0.5) continue;
        const i = row * this.cols + col;
        field[i] = Math.min(1.6, field[i]! + amount * (1 - d / (radius + 1)));
      }
  }

  consumeEvents(world: World) {
    for (const e of world.events)
      if (e.kind === "eat") {
        this.stamp(this.heat, e.x, e.y, 2, 1);
        this.stamp(this.energy, e.x, e.y, 3, 0.9);
      } else this.stamp(this.energy, e.x, e.y, 6, 1.4);
    world.events.length = 0;
  }

  depositWake(world: World) {
    const energy = this.energy;
    for (const f of world.fish) {
      if (!f.alive) continue;
      const i = this.cellIndex(f.x, f.y);
      if (i >= 0) energy[i] = Math.min(1.6, energy[i]! + 0.012 + f.alarm * 0.03);
    }
    for (const s of world.sharks)
      for (let n = SPINE - 6; n < SPINE; n++) {
        const i = this.cellIndex(s.nodes[n * 2]!, s.nodes[n * 2 + 1]!);
        if (i >= 0) energy[i] = Math.min(1.6, energy[i]! + 0.05 + s.speed * 0.0012);
      }
    if (world.pointer.active) this.stamp(energy, world.pointer.x, world.pointer.y, 1, 0.08);
  }

  diffuse(dt: number) {
    const { cols, rows, energy: src, energyTmp: dst, heat } = this;
    const fade = Math.exp(-dt * 1.5);
    for (let row = 0; row < rows; row++)
      for (let col = 0; col < cols; col++) {
        const i = row * cols + col;
        const l = col > 0 ? src[i - 1]! : src[i]!;
        const r = col < cols - 1 ? src[i + 1]! : src[i]!;
        const u = row > 0 ? src[i - cols]! : src[i]!;
        const d = row < rows - 1 ? src[i + cols]! : src[i]!;
        dst[i] = (src[i]! * 4 + l + r + u + d) * 0.125 * fade;
      }
    this.energy = dst;
    this.energyTmp = src;
    const cool = Math.exp(-dt * 2.2);
    for (let i = 0; i < heat.length; i++) heat[i]! *= cool;
  }

  /** Is (px, py) on the shark whose spine is in this.spine? Sets the hit fields. */
  sampleShark(px: number, py: number, L: number) {
    const { spine, arc } = this;
    let best = Infinity;
    let sNorm = 0;
    let side = 1;
    let nx = 0;
    let ny = 0;
    for (let n = 0; n < SPINE - 1; n++) {
      const ax = spine[n * 2]!;
      const ay = spine[n * 2 + 1]!;
      const fx = spine[(n + 1) * 2]! - ax;
      const fy = spine[(n + 1) * 2 + 1]! - ay;
      const len2 = fx * fx + fy * fy || 1;
      const t = clamp(((px - ax) * fx + (py - ay) * fy) / len2, 0, 1);
      const gx = ax + fx * t;
      const gy = ay + fy * t;
      const d2 = (px - gx) ** 2 + (py - gy) ** 2;
      if (d2 < best) {
        best = d2;
        const len = Math.sqrt(len2);
        sNorm = (arc[n]! + t * len) / this.arcTotal;
        side = fx * (py - ay) - fy * (px - ax) >= 0 ? 1 : -1;
        nx = (-fy / len) * side;
        ny = (fx / len) * side;
      }
    }
    const d = Math.sqrt(best);
    const s = sNorm;
    const along = s * L;
    const shape = this.shape;
    const half = shape.halfWidth(s) * L;
    this.hitDist = d;
    this.hitS = s;
    this.hitV = d * side;
    const head = shape.head;
    if (head && along < L * (head.sweep + head.depth + head.notch)) {
      const e = d / (L * head.span);
      const front = L * head.sweep * e * e + L * head.notch * Math.max(0, 1 - e / 0.14);
      const depth = L * head.depth * (1 - 0.2 * e * e * e * e);
      if (e <= 1 && along >= front && along <= front + depth) {
        this.hitFlag = e > 0.84 ? EYE : BODY;
        this.hitShade = e > 0.84 ? 0 : 0.62 - 0.2 * e + (along < front + L * 0.012 ? 0.1 : 0);
        return true;
      }
    }
    if (d <= half) {
      const e = d / (half || 1);
      const light = (nx * -0.6 + ny * -0.8) * e;
      let shade = 0.58 - e * e * 0.42 + light * 0.26;
      let flag = BODY;
      if (s > shape.dorsal[0] && s < shape.dorsal[1] && e < 0.3) {
        flag = DORSAL;
        shade = 1;
      } else if (s > shape.secondDorsal[0] && s < shape.secondDorsal[1] && e < 0.4) {
        shade = Math.max(shade, 0.82);
      } else if (shape.eye && s > shape.eye[0] && s < shape.eye[1] && e > 0.6) {
        flag = EYE;
        shade = 0;
      } else if (s > shape.gills[0] && s < shape.gills[1] && e > 0.58) {
        if (Math.floor(((s - shape.gills[0]) / (shape.gills[1] - shape.gills[0])) * 5) % 2 === 0)
          shade *= 0.45;
      } else if (s < 0.05) {
        shade = Math.max(shade, 0.7);
      } else if (
        shape === SHAPES.zebra &&
        s > 0.08 &&
        s < 0.55 &&
        (e < 0.1 || Math.abs(e - 0.6) < 0.08)
      ) {
        shade = Math.max(shade, 0.8);
      } else if (this.marked(s, d * side, L, e)) {
        flag = MARK;
      }
      this.hitFlag = flag;
      this.hitShade = shade;
      return true;
    }
    const tip = side > 0 ? this.finTipRight : this.finTipLeft;
    const [p0, p1, p2] = shape.pectoral;
    if (
      inTriangle(along, d, L * p0, 0, L * p1, 0, L * p2, tip) &&
      !(
        shape.falcate &&
        inTriangle(along, d, L * p1, 0, L * (p1 + (p2 - p1) * 0.33), tip * 0.55, L * p2, tip)
      )
    ) {
      this.hitFlag = this.marked(s, d * side, L, 0) ? MARK : FIN;
      this.hitShade = 0.38 + 0.22 * (1 - clamp(d / tip, 0, 1));
      return true;
    }
    const [v0, v1, v2, v3] = shape.pelvic;
    if (
      inTriangle(along, d, L * v0, 0, L * v1, 0, L * v2, L * v3) ||
      (shape.caudal > 0 && inTriangle(along, d, L * 0.86, 0, L * 0.95, 0, L, L * shape.caudal))
    ) {
      this.hitFlag = FIN;
      this.hitShade = 0.36;
      return true;
    }
    return false;
  }

  /** Tiger stripes and zebra spots. */
  marked(s: number, v: number, L: number, e: number) {
    if (this.shape === SHAPES.tiger) {
      if (s < 0.2 || s > 0.9 || e > 0.85) return false;
      const wobble = 0.35 * Math.sin((v / L) * 25 + s * 5);
      return (
        Math.sin(s * Math.PI * 2 * 9 + wobble) >
        0.65 - 0.5 * smoothstep(0.2, 0.42, s) + 0.4 * smoothstep(0.8, 0.9, s)
      );
    }
    if (this.shape === SHAPES.zebra) {
      if (s < 0.07) return false;
      const u = (s * L) / (L * 0.06);
      const w = v / (L * 0.045);
      const cu = Math.floor(u);
      const cw = Math.floor(w);
      const ou = hash3(cu, cw, this.sharkId) * 0.5 + 0.25;
      const ow = hash3(cu, cw, this.sharkId + 11) * 0.5 + 0.25;
      return (u - cu - ou) ** 2 + (w - cw - ow) ** 2 < 0.08;
    }
    return false;
  }

  rasterizeSharks(sharks: readonly Shark[], time: number) {
    const { sharkFlag, sharkShade, sharkKey, sharkDepth, spine, arc, cw, ch, cols, rows } = this;
    sharkFlag.fill(0);
    for (const shark of sharks) {
      const L = shark.length;
      const nodes = shark.nodes;
      const swim = clamp(shark.speed / 60, 0.4, 1.4);
      this.shape = SHAPES[shark.kind];
      this.sharkId = shark.id;
      // The body sways in a wave that grows toward the tail.
      for (let n = 0; n < SPINE; n++) {
        const s = n / (SPINE - 1);
        const a = Math.max(0, n - 1);
        const b = Math.min(SPINE - 1, n + 1);
        let tx = nodes[a * 2]! - nodes[b * 2]!;
        let ty = nodes[a * 2 + 1]! - nodes[b * 2 + 1]!;
        const len = Math.hypot(tx, ty) || 1;
        tx /= len;
        ty /= len;
        const sway = L * 0.05 * (0.1 + 0.9 * s ** 1.8) * swim * Math.sin(shark.phase - s * 5.2);
        spine[n * 2] = nodes[n * 2]! - ty * sway;
        spine[n * 2 + 1] = nodes[n * 2 + 1]! + tx * sway;
      }
      arc[0] = 0;
      for (let n = 1; n < SPINE; n++)
        arc[n] =
          arc[n - 1]! +
          Math.hypot(
            spine[n * 2]! - spine[(n - 1) * 2]!,
            spine[n * 2 + 1]! - spine[(n - 1) * 2 + 1]!,
          );
      this.arcTotal = arc[SPINE - 1] || 1;
      const bank = clamp(shark.turn * 0.45, -0.35, 0.35);
      const beat = 1 + 0.06 * Math.sin(shark.phase * 0.5);
      const fin = this.shape.pectoral[3];
      this.finTipRight = L * fin * beat * (1 - bank);
      this.finTipLeft = L * fin * beat * (1 + bank);
      let minX = Infinity;
      let minY = Infinity;
      let maxX = -Infinity;
      let maxY = -Infinity;
      for (let n = 0; n < SPINE; n++) {
        minX = Math.min(minX, spine[n * 2]!);
        maxX = Math.max(maxX, spine[n * 2]!);
        minY = Math.min(minY, spine[n * 2 + 1]!);
        maxY = Math.max(maxY, spine[n * 2 + 1]!);
      }
      const pad = L * 0.36;
      const c0 = Math.max(0, Math.floor((minX - pad) / cw));
      const c1 = Math.min(cols - 1, Math.floor((maxX + pad) / cw));
      const r0 = Math.max(0, Math.floor((minY - pad) / ch));
      const r1 = Math.min(rows - 1, Math.floor((maxY + pad) / ch));
      if (c0 > c1 || r0 > r1) continue;
      const near = pad + Math.hypot(cw, ch);
      for (let row = r0; row <= r1; row++)
        for (let col = c0; col <= c1; col++) {
          const x = col * cw;
          const y = row * ch;
          const hit = this.sampleShark(x + cw / 2, y + ch / 2, L);
          if (!hit && this.hitDist > near) continue;
          const flag = this.hitFlag;
          const shade = this.hitShade;
          const hs = this.hitS;
          const hv = this.hitV;
          let covered = hit ? 1 : 0;
          for (let k = 0; k < SUBSAMPLES.length; k += 2)
            if (this.sampleShark(x + SUBSAMPLES[k]! * cw, y + SUBSAMPLES[k + 1]! * ch, L))
              covered++;
          if (covered === 0) continue;
          const coverage = covered / 5;
          const i = row * cols + col;
          sharkKey[i] =
            (hash3(Math.round(hs * 52), Math.round(hv / (cw * 0.9)), shark.id) * 4294967295) >>> 0;
          sharkDepth[i] = shark.depth;
          if (hit && coverage >= 0.6) {
            sharkFlag[i] = flag;
            const grain = (hash3(col, row, Math.floor(time * 6)) - 0.5) * 0.06;
            sharkShade[i] = clamp(shade + grain, 0, 1);
          } else {
            sharkFlag[i] = EDGE;
            sharkShade[i] = coverage;
          }
        }
    }
  }

  drawSharks(time: number) {
    const { ctx, cols, rows, cw, ch, sharkFlag, sharkShade, sharkKey, sharkDepth } = this;
    const [tr, tg, tb] = SHARK_TINT;
    for (let i = 0; i < cols * rows; i++) {
      const flag = sharkFlag[i]!;
      if (!flag) continue;
      const x = (i % cols) * cw;
      const y = ((i / cols) | 0) * ch;
      const key = sharkKey[i]!;
      const shade = sharkShade[i]!;
      const depth = 0.7 + 0.3 * sharkDepth[i]!;
      const twinkle = hash3(key, Math.floor(time * 2.4 + (key % 997) / 97), 7);
      if (flag === EDGE) {
        const chars = shade >= 0.5 ? EDGE_DENSE : EDGE_SPARSE;
        const v = (70 + shade * 80) * depth;
        ctx.fillStyle =
          twinkle < 0.07
            ? ACCENTS[key % ACCENTS.length]!
            : `rgb(${Math.round(v * tr)},${Math.round(v * tg)},${Math.min(255, Math.round(v * tb + 6))})`;
        ctx.fillText(chars[(key >>> 8) % chars.length]!, x + cw / 2, y + ch / 2 + 1);
        continue;
      }
      let v: number;
      let glyph: string;
      if (flag === DORSAL) {
        v = 226;
        glyph = DORSAL_CHARS[(key >>> 8) % 3]!;
      } else if (flag === EYE) {
        v = 12;
        glyph = "o";
      } else if (flag === MARK) {
        v = 24 + shade * 22;
        glyph = MARK_CHARS[(key >>> 8) % 3]!;
      } else if (flag === FIN) {
        v = 40 + shade * 120;
        glyph = FIN_CHARS[(key >>> 8) % 5]!;
      } else {
        v = 46 + shade * 160;
        const jitter = ((key >>> 4) % 3) - 1;
        glyph =
          RAMP[clamp(Math.floor((1 - shade) * (RAMP.length - 0.01)) + jitter, 0, RAMP.length - 1)]!;
      }
      v *= depth;
      ctx.fillStyle = `rgb(${Math.min(255, Math.round(v * tr))},${Math.min(255, Math.round(v * tg))},${Math.min(255, Math.round(v * tb + 4))})`;
      ctx.fillRect(x + 1, y + 1, cw - 1, ch - 1);
      ctx.fillStyle =
        flag === EYE
          ? "#9aa0ad"
          : flag === MARK
            ? `rgb(${Math.round(70 * tr)},${Math.round(70 * tg)},${Math.round(70 * tb)})`
            : twinkle < 0.09
              ? ACCENTS[key % ACCENTS.length]!
              : twinkle < 0.13
                ? "#ffffff"
                : shade > 0.55
                  ? "#0e0f13"
                  : "#1b1d24";
      ctx.fillText(glyph, x + cw / 2, y + ch / 2 + 1);
    }
  }

  markFish(world: World) {
    const { fishStamp, fishBuckets, sharkFlag } = this;
    const frame = ++this.frameId;
    for (const bucket of fishBuckets) bucket.length = 0;
    // Deep fish first, so a shallow one in the same cell wins.
    for (let pass = 0; pass < 2; pass++)
      for (const f of world.fish) {
        if (!f.alive || (f.depth > 0.78 ? 0 : 1) !== pass) continue;
        const i = this.cellIndex(f.x, f.y);
        if (i < 0 || fishStamp[i] === frame || sharkFlag[i]) continue;
        fishStamp[i] = frame;
        const turning = clamp(Math.abs(f.turn) / 3.5, 0, 1);
        const bright = 0.3 + (0.4 * (f.depth - 0.55)) / 0.45 + 0.3 * Math.max(turning, f.alarm);
        fishBuckets[
          clamp(Math.floor(bright * FISH_ALPHAS.length), 0, FISH_ALPHAS.length - 1)
        ]!.push(i);
      }
  }

  drawFish() {
    const { ctx, cw, ch, cols, fishBuckets } = this;
    for (let b = 0; b < fishBuckets.length; b++) {
      const cells = fishBuckets[b]!;
      if (!cells.length) continue;
      ctx.fillStyle = this.fishStyles[b]!;
      for (const i of cells)
        ctx.fillText(FISH_GLYPH, (i % cols) * cw + cw / 2, ((i / cols) | 0) * ch + ch / 2 + 1);
    }
  }

  drawHeat() {
    const { ctx, heat, cols, cw, ch } = this;
    for (let i = 0; i < heat.length; i++) {
      const h = heat[i]!;
      if (h < 0.08) continue;
      ctx.fillStyle =
        h > 0.5 ? `rgba(255,120,60,${h.toFixed(2)})` : `rgba(220,40,40,${(h * 1.6).toFixed(2)})`;
      ctx.fillText(
        h > 0.6 ? "*" : "·",
        (i % cols) * cw + cw / 2,
        ((i / cols) | 0) * ch + ch / 2 + 1,
      );
    }
  }

  /** The glowing dots a wake leaves in the water. */
  drawWake() {
    const { ctx, cols, cw, ch, energy, sharkFlag, fishStamp, frameId, wakeBuckets } = this;
    for (const bucket of wakeBuckets) bucket.length = 0;
    for (let i = 0; i < energy.length; i++) {
      const e = energy[i]!;
      if (sharkFlag[i] || fishStamp[i] === frameId || e <= 0.45) continue;
      wakeBuckets[clamp(Math.floor((e - 0.45) * 5), 0, SHADES - 1)]!.push(i);
    }
    const size = Math.max(2, Math.round(cw * 0.19)) + 1;
    for (let b = 0; b < SHADES; b++) {
      const cells = wakeBuckets[b]!;
      if (!cells.length) continue;
      ctx.fillStyle = this.wakeStyles[b]!;
      for (const i of cells)
        ctx.fillRect(
          Math.round((i % cols) * cw + cw * 0.66 - size / 2),
          Math.round(((i / cols) | 0) * ch + ch * 0.64 - size / 2),
          size,
          size,
        );
    }
  }
}

const STEP = 1 / 60;
const MAX_STEPS = 4;

/**
 * Runs the ocean on a canvas until the returned stop is called. It pauses
 * while the canvas is out of view, and holds a still frame under reduced motion.
 * Moving the pointer scares fish; clicking splashes.
 */
export function startAsciiOcean(canvas: HTMLCanvasElement): () => void {
  const sharkSpecs = Array.from({ length: 5 }, (_, i) => ({
    kind: MIX[i % MIX.length]!,
    size: Math.max(0.45, 1 - i * 0.09) * 1.35,
  }));
  const world = new World(sharkSpecs, FISH_COUNT);
  const renderer = new Renderer(canvas);
  const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)");
  let raf = 0;
  let last = 0;
  let acc = 0;
  let visible = true;
  let disposed = false;

  const drawStill = () => {
    if (world.time < 4) for (let i = 0; i < 240; i++) world.step(STEP);
    renderer.render(world, STEP);
  };
  const frame = (now: number) => {
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    acc += dt * SPEED;
    let steps = 0;
    while (acc >= STEP && steps < MAX_STEPS) {
      world.step(STEP);
      acc -= STEP;
      steps++;
    }
    if (steps === MAX_STEPS) acc = 0;
    renderer.render(world, dt);
    raf = requestAnimationFrame(frame);
  };
  const schedule = () => {
    cancelAnimationFrame(raf);
    if (disposed || !visible || reducedMotion.matches) return;
    last = performance.now();
    raf = requestAnimationFrame(frame);
  };
  const resize = () => {
    const rect = canvas.getBoundingClientRect();
    if (rect.width < 1 || rect.height < 1) return;
    renderer.resize(rect.width, rect.height, Math.min(window.devicePixelRatio || 1, 2));
    world.resize(rect.width, rect.height, renderer.cw, renderer.ch);
    if (reducedMotion.matches) drawStill();
  };
  const toLocal = (event: PointerEvent) => {
    const rect = canvas.getBoundingClientRect();
    const x = event.clientX - rect.left;
    const y = event.clientY - rect.top;
    return { x, y, inside: x >= 0 && y >= 0 && x <= rect.width && y <= rect.height };
  };
  const onMotionPreference = () => {
    if (reducedMotion.matches) {
      cancelAnimationFrame(raf);
      drawStill();
    } else schedule();
  };
  const onPointerMove = (event: PointerEvent) => {
    const { x, y, inside } = toLocal(event);
    world.pointer.x = x;
    world.pointer.y = y;
    world.pointer.active = inside && event.pointerType !== "touch";
  };
  const onPointerDown = (event: PointerEvent) => {
    const { x, y, inside } = toLocal(event);
    if (inside && !reducedMotion.matches) world.splash(x, y);
  };
  const onPointerLeave = () => {
    world.pointer.active = false;
  };

  const stopObservingResize = observeResize(canvas, resize);
  const intersectionObserver = new IntersectionObserver(([entry]) => {
    visible = entry?.isIntersecting ?? true;
    schedule();
  });
  intersectionObserver.observe(canvas);
  reducedMotion.addEventListener("change", onMotionPreference);
  window.addEventListener("pointermove", onPointerMove, { passive: true });
  window.addEventListener("pointerdown", onPointerDown, { passive: true });
  document.documentElement.addEventListener("pointerleave", onPointerLeave);
  window.addEventListener("blur", onPointerLeave);
  resize();
  void document.fonts?.load(`600 16px ${renderer.fontFamily}`).then(() => {
    if (!disposed && reducedMotion.matches) drawStill();
  });
  schedule();

  return () => {
    disposed = true;
    cancelAnimationFrame(raf);
    stopObservingResize();
    intersectionObserver.disconnect();
    reducedMotion.removeEventListener("change", onMotionPreference);
    window.removeEventListener("pointermove", onPointerMove);
    window.removeEventListener("pointerdown", onPointerDown);
    document.documentElement.removeEventListener("pointerleave", onPointerLeave);
    window.removeEventListener("blur", onPointerLeave);
  };
}
