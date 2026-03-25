import { useEffect, useRef, useState, useCallback } from "react";

// ─── CONSTANTS ───────────────────────────────────────────────────────────────
const FIELD_W = 400;
const FIELD_H = 700;
const PUCK_R = 16;
const PADDLE_R = 32;
const GOAL_W = 130;
const MAX_SCORE = 7;
const PUCK_MAX_SPEED = 14;
const PUCK_MIN_BOUNCE_SPEED = 4;
const AI_SPEED_BASE = 3.5;
const AI_SPEED_MAX = 7.5;

// ─── RANK SYSTEM ─────────────────────────────────────────────────────────────
interface RankTier {
  name: string;
  symbol: string;
  min: number;
  max: number;
  color: string;
  glowColor: string;
}

const RANK_TIERS: RankTier[] = [
  { name: "SYTER",   symbol: "◈", min: 1000, max: 1299, color: "#aaaaaa", glowColor: "#888888" },
  { name: "LUNAR",   symbol: "☾", min: 1300, max: 1599, color: "#88ccff", glowColor: "#4499cc" },
  { name: "VYNER",   symbol: "◆", min: 1600, max: 1899, color: "#44ffaa", glowColor: "#22cc77" },
  { name: "ZENTH",   symbol: "◇", min: 1900, max: 2199, color: "#ffee44", glowColor: "#ccaa00" },
  { name: "AETHER",  symbol: "☆", min: 2200, max: 2499, color: "#ff88ff", glowColor: "#cc44cc" },
  { name: "NEXUS",   symbol: "⨀", min: 2500, max: 2799, color: "#ff6622", glowColor: "#cc3300" },
  { name: "OMEGA",   symbol: "Ω", min: 2800, max: 3199, color: "#ff2244", glowColor: "#cc0022" },
  { name: "ETERNAL", symbol: "✦", min: 3200, max: 9999, color: "#ffdd00", glowColor: "#ff8800" },
];

interface ProLeague {
  name: string;
  symbol: string;
  maxRank: number;
  minRank: number;
  color: string;
}

const PRO_LEAGUES: ProLeague[] = [
  { name: "ELITE 100",    symbol: "⚡",      maxRank: 100, minRank: 51,  color: "#88aaff" },
  { name: "ELITE 50",     symbol: "⚡⚡",    maxRank: 50,  minRank: 21,  color: "#aaccff" },
  { name: "ELITE 20",     symbol: "⚡⚡⚡",  maxRank: 20,  minRank: 11,  color: "#ccddff" },
  { name: "CHALLENGER X", symbol: "✦⚡",    maxRank: 10,  minRank: 5,   color: "#ffd700" },
  { name: "CHALLENGER V", symbol: "✦⚡✦",   maxRank: 4,   minRank: 2,   color: "#ffaa00" },
  { name: "GRAND MASTER", symbol: "⭐",      maxRank: 1,   minRank: 1,   color: "#ff4400" },
];

function getRankInfo(elo: number): { tier: RankTier; sub: number; progress: number } {
  const tier = RANK_TIERS.find(r => elo >= r.min && elo <= r.max) || RANK_TIERS[RANK_TIERS.length - 1];
  const span = tier.max - tier.min + 1;
  const subSpan = span / 3;
  const pos = elo - tier.min;
  const sub = Math.min(2, Math.floor(pos / subSpan));
  const progress = ((pos % subSpan) / subSpan) * 100;
  return { tier, sub, progress };
}

function getSubLabel(sub: number): string {
  return ["III", "II", "I"][sub] || "I";
}

function getEloChange(elo: number, win: boolean): number {
  // Starts at +20/-20 (SYTER) → +11/-29 (ETERNAL)
  const t = Math.min(1, (elo - 1000) / (3200 - 1000));
  const winGain = Math.round(20 - t * 9);   // 20 → 11
  const lossPen = Math.round(20 + t * 9);   // 20 → 29
  return win ? winGain : -lossPen;
}

// ─── GAME STATE TYPES ────────────────────────────────────────────────────────
type GameScreen = "menu" | "playing" | "result";
type GameMode = "online" | "training";

interface Vec2 { x: number; y: number; }

interface GameState {
  puck: Vec2;
  puckVel: Vec2;
  playerPaddle: Vec2;
  aiPaddle: Vec2;
  scorePlayer: number;
  scoreAI: number;
  lastTouch: "player" | "ai" | null;
}

function clamp(v: number, lo: number, hi: number) { return Math.max(lo, Math.min(hi, v)); }
function dist(a: Vec2, b: Vec2) { return Math.sqrt((a.x - b.x) ** 2 + (a.y - b.y) ** 2); }
function norm(v: Vec2): Vec2 { const m = Math.sqrt(v.x ** 2 + v.y ** 2) || 1; return { x: v.x / m, y: v.y / m }; }

function loadElo(): number {
  try { return parseInt(localStorage.getItem("aerohockey_elo") || "1000", 10) || 1000; }
  catch { return 1000; }
}
function saveElo(elo: number) {
  try { localStorage.setItem("aerohockey_elo", String(elo)); } catch { /* ignore */ }
}

// ─── CANVAS DRAWING ───────────────────────────────────────────────────────────
function drawField(ctx: CanvasRenderingContext2D, W: number, H: number, time: number) {
  // Background
  ctx.fillStyle = "#0a0a0f";
  ctx.fillRect(0, 0, W, H);

  // Grain texture
  for (let i = 0; i < 120; i++) {
    const gx = Math.random() * W;
    const gy = Math.random() * H;
    const alpha = Math.random() * 0.06;
    ctx.fillStyle = `rgba(255,255,255,${alpha})`;
    ctx.fillRect(gx, gy, 1, 1);
  }

  // Field border glow
  ctx.strokeStyle = "#ff2266";
  ctx.lineWidth = 3;
  ctx.shadowColor = "#ff2266";
  ctx.shadowBlur = 18;
  ctx.strokeRect(2, 2, W - 4, H - 4);
  ctx.shadowBlur = 0;

  // Center line dashed
  ctx.setLineDash([10, 8]);
  ctx.strokeStyle = "rgba(255,34,102,0.35)";
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(0, H / 2);
  ctx.lineTo(W, H / 2);
  ctx.stroke();
  ctx.setLineDash([]);

  // Center circle
  ctx.strokeStyle = "rgba(255,34,102,0.25)";
  ctx.lineWidth = 2;
  ctx.shadowColor = "#ff2266";
  ctx.shadowBlur = 10;
  ctx.beginPath();
  ctx.arc(W / 2, H / 2, 55, 0, Math.PI * 2);
  ctx.stroke();
  ctx.shadowBlur = 0;

  // Goal zones
  const goalX = (W - GOAL_W) / 2;

  // Top goal
  ctx.strokeStyle = "#00ffcc";
  ctx.lineWidth = 4;
  ctx.shadowColor = "#00ffcc";
  ctx.shadowBlur = 16;
  ctx.strokeRect(goalX, 0, GOAL_W, 8);

  // Bottom goal
  ctx.strokeRect(goalX, H - 8, GOAL_W, 8);
  ctx.shadowBlur = 0;

  // Goal fill
  ctx.fillStyle = "rgba(0,255,204,0.07)";
  ctx.fillRect(goalX, 0, GOAL_W, 8);
  ctx.fillRect(goalX, H - 8, GOAL_W, 8);

  // Scanlines
  for (let y = 0; y < H; y += 4) {
    ctx.fillStyle = "rgba(0,0,0,0.08)";
    ctx.fillRect(0, y, W, 1);
  }
}

function drawPuck(ctx: CanvasRenderingContext2D, pos: Vec2, time: number) {
  const pulse = 0.7 + 0.3 * Math.sin(time * 0.008);
  ctx.save();
  // Outer glow
  ctx.shadowColor = "#00ffcc";
  ctx.shadowBlur = 28 * pulse;
  ctx.fillStyle = "#00ffcc";
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, PUCK_R, 0, Math.PI * 2);
  ctx.fill();
  // Inner
  ctx.shadowBlur = 0;
  ctx.fillStyle = "#003322";
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, PUCK_R * 0.55, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

function drawPaddle(ctx: CanvasRenderingContext2D, pos: Vec2, isPlayer: boolean, time: number) {
  const color = isPlayer ? "#ff2266" : "#4488ff";
  const pulse = 0.8 + 0.2 * Math.sin(time * 0.006 + (isPlayer ? 0 : Math.PI));
  ctx.save();
  ctx.shadowColor = color;
  ctx.shadowBlur = 22 * pulse;

  // Outer ring
  ctx.strokeStyle = color;
  ctx.lineWidth = 3;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, PADDLE_R, 0, Math.PI * 2);
  ctx.stroke();

  // Fill
  ctx.fillStyle = `rgba(${isPlayer ? "255,34,102" : "68,136,255"},0.18)`;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, PADDLE_R, 0, Math.PI * 2);
  ctx.fill();

  // Inner ring
  ctx.strokeStyle = `rgba(${isPlayer ? "255,34,102" : "68,136,255"},0.5)`;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, PADDLE_R * 0.6, 0, Math.PI * 2);
  ctx.stroke();

  // Center dot
  ctx.fillStyle = color;
  ctx.shadowBlur = 8;
  ctx.beginPath();
  ctx.arc(pos.x, pos.y, 5, 0, Math.PI * 2);
  ctx.fill();

  ctx.restore();
}

// ─── MAIN COMPONENT ───────────────────────────────────────────────────────────
export default function Index() {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<GameState | null>(null);
  const animRef = useRef<number>(0);
  const timeRef = useRef<number>(0);
  const pointerRef = useRef<Vec2 | null>(null);
  const prevPaddleRef = useRef<Vec2>({ x: FIELD_W / 2, y: FIELD_H - 120 });
  const scaleRef = useRef<number>(1);
  const canvasOffsetRef = useRef<{ left: number; top: number }>({ left: 0, top: 0 });

  const [screen, setScreen] = useState<GameScreen>("menu");
  const [mode, setMode] = useState<GameMode>("online");
  const [elo, setElo] = useState<number>(loadElo);
  const [scorePlayer, setScorePlayer] = useState(0);
  const [scoreAI, setScoreAI] = useState(0);
  const [goalFlash, setGoalFlash] = useState<"player" | "ai" | null>(null);
  const [eloChange, setEloChange] = useState<number | null>(null);
  const [resultWin, setResultWin] = useState<boolean>(false);

  // Scale canvas to fit screen
  const updateScale = useCallback(() => {
    const canvas = canvasRef.current;
    const container = containerRef.current;
    if (!canvas || !container) return;
    const cw = container.clientWidth;
    const ch = container.clientHeight;
    const s = Math.min(cw / FIELD_W, ch / FIELD_H);
    scaleRef.current = s;
    canvas.style.width = `${FIELD_W * s}px`;
    canvas.style.height = `${FIELD_H * s}px`;
    const rect = canvas.getBoundingClientRect();
    canvasOffsetRef.current = { left: rect.left, top: rect.top };
  }, []);

  useEffect(() => {
    updateScale();
    window.addEventListener("resize", updateScale);
    return () => window.removeEventListener("resize", updateScale);
  }, [updateScale]);

  function initGameState(): GameState {
    const angle = (Math.random() * 0.6 + 0.2) * (Math.random() < 0.5 ? 1 : -1);
    const speed = 5;
    return {
      puck: { x: FIELD_W / 2, y: FIELD_H / 2 },
      puckVel: { x: Math.sin(angle) * speed, y: Math.cos(angle) * speed * (Math.random() < 0.5 ? 1 : -1) },
      playerPaddle: { x: FIELD_W / 2, y: FIELD_H - 120 },
      aiPaddle: { x: FIELD_W / 2, y: 120 },
      scorePlayer: 0,
      scoreAI: 0,
      lastTouch: null,
    };
  }

  function resetPuck(gs: GameState, side: "player" | "ai") {
    gs.puck = { x: FIELD_W / 2, y: FIELD_H / 2 };
    const angle = (Math.random() * 0.5 + 0.15) * (Math.random() < 0.5 ? 1 : -1);
    const speed = 5;
    const dir = side === "player" ? -1 : 1;
    gs.puckVel = { x: Math.sin(angle) * speed, y: dir * Math.cos(angle) * speed };
    gs.lastTouch = null;
  }

  function circleBounce(puck: Vec2, vel: Vec2, paddle: Vec2): Vec2 {
    const d = dist(puck, paddle);
    if (d < PUCK_R + PADDLE_R + 1) {
      const n = norm({ x: puck.x - paddle.x, y: puck.y - paddle.y });
      // Reflect velocity
      const dot = vel.x * n.x + vel.y * n.y;
      let nx = vel.x - 2 * dot * n.x;
      let ny = vel.y - 2 * dot * n.y;
      // Add spin based on paddle movement
      const speed = Math.sqrt(nx ** 2 + ny ** 2);
      const newSpeed = Math.max(PUCK_MIN_BOUNCE_SPEED, Math.min(PUCK_MAX_SPEED, speed * 1.05));
      const nm = Math.sqrt(nx ** 2 + ny ** 2) || 1;
      nx = (nx / nm) * newSpeed;
      ny = (ny / nm) * newSpeed;
      // Push puck out of collision
      const overlap = (PUCK_R + PADDLE_R + 2) - d;
      puck.x += n.x * overlap;
      puck.y += n.y * overlap;
      return { x: nx, y: ny };
    }
    return vel;
  }

  function stepPhysics(gs: GameState): { goal: "player" | "ai" | null } {
    const { puck, puckVel } = gs;

    // Apply velocity
    puck.x += puckVel.x;
    puck.y += puckVel.y;

    // Wall bounce X
    if (puck.x - PUCK_R < 0) {
      puck.x = PUCK_R;
      puckVel.x = Math.abs(puckVel.x);
    } else if (puck.x + PUCK_R > FIELD_W) {
      puck.x = FIELD_W - PUCK_R;
      puckVel.x = -Math.abs(puckVel.x);
    }

    // Wall bounce Y (top/bottom)
    const goalX = (FIELD_W - GOAL_W) / 2;
    const goalXEnd = goalX + GOAL_W;
    const inGoalX = puck.x > goalX && puck.x < goalXEnd;

    if (puck.y - PUCK_R < 0) {
      if (inGoalX) {
        // GOAL for player!
        return { goal: "player" };
      }
      puck.y = PUCK_R;
      puckVel.y = Math.abs(puckVel.y);
    } else if (puck.y + PUCK_R > FIELD_H) {
      if (inGoalX) {
        // GOAL for AI!
        return { goal: "ai" };
      }
      puck.y = FIELD_H - PUCK_R;
      puckVel.y = -Math.abs(puckVel.y);
    }

    // Paddle collisions
    gs.puckVel = circleBounce(puck, gs.puckVel, gs.playerPaddle);
    gs.puckVel = circleBounce(puck, gs.puckVel, gs.aiPaddle);

    // Friction
    const speed = Math.sqrt(gs.puckVel.x ** 2 + gs.puckVel.y ** 2);
    if (speed > 0.5) {
      gs.puckVel.x *= 0.999;
      gs.puckVel.y *= 0.999;
    }

    return { goal: null };
  }

  function stepAI(gs: GameState, difficulty: number) {
    const ai = gs.aiPaddle;
    const puck = gs.puck;

    let targetX = puck.x;
    let targetY = 120;

    if (puck.y < FIELD_H / 2) {
      // Puck in AI half — attack/defend
      if (gs.puckVel.y < 0) {
        // Puck coming toward AI goal — intercept
        const timeToGoal = Math.abs((puck.y - 80) / (gs.puckVel.y || -0.1));
        targetX = clamp(puck.x + gs.puckVel.x * timeToGoal * 0.7, PADDLE_R + 10, FIELD_W - PADDLE_R - 10);
        targetY = clamp(puck.y - 40, PADDLE_R + 10, FIELD_H / 2 - 20);
      } else {
        // Attack
        targetX = puck.x;
        targetY = clamp(puck.y + 30, PADDLE_R + 10, FIELD_H / 2 - 20);
      }
    } else {
      // Puck in player half — reset to center top
      targetX = FIELD_W / 2;
      targetY = 110;
    }

    const aiSpeed = AI_SPEED_BASE + difficulty * (AI_SPEED_MAX - AI_SPEED_BASE);
    const dx = targetX - ai.x;
    const dy = targetY - ai.y;
    const d = Math.sqrt(dx ** 2 + dy ** 2);
    if (d > 1) {
      ai.x += (dx / d) * Math.min(d, aiSpeed);
      ai.y += (dy / d) * Math.min(d, aiSpeed);
    }
    ai.x = clamp(ai.x, PADDLE_R + 2, FIELD_W - PADDLE_R - 2);
    ai.y = clamp(ai.y, PADDLE_R + 2, FIELD_H / 2 - 10);
  }

  function startGame(m: GameMode) {
    setMode(m);
    gameRef.current = initGameState();
    prevPaddleRef.current = { x: FIELD_W / 2, y: FIELD_H - 120 };
    setScorePlayer(0);
    setScoreAI(0);
    setGoalFlash(null);
    setScreen("playing");
  }

  // refs to avoid stale closure in game loop
  const eloRef = useRef(elo);
  const modeRef = useRef(mode);
  useEffect(() => { eloRef.current = elo; }, [elo]);
  useEffect(() => { modeRef.current = mode; }, [mode]);

  // ─── GAME LOOP ──────────────────────────────────────────────────────────────
  useEffect(() => {
    if (screen !== "playing") { cancelAnimationFrame(animRef.current); return; }
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d")!;
    let frozen = 0;
    let localScorePlayer = 0;
    let localScoreAI = 0;

    const eloNow = eloRef.current;
    const currentMode = modeRef.current;
    const difficulty = currentMode === "training"
      ? 0.35
      : clamp((eloNow - 1000) / 2200, 0.2, 0.95);

    function loop(ts: number) {
      timeRef.current = ts;
      const gs = gameRef.current!;

      // Update canvas offset for pointer mapping
      const rect = canvas.getBoundingClientRect();
      canvasOffsetRef.current = { left: rect.left, top: rect.top };

      // Player paddle follows pointer
      if (pointerRef.current) {
        const target = pointerRef.current;
        const prev = prevPaddleRef.current;
        const speed = 18;
        const dx = target.x - prev.x;
        const dy = target.y - prev.y;
        const d = Math.sqrt(dx ** 2 + dy ** 2);
        let nx = prev.x, ny = prev.y;
        if (d > 0.5) {
          nx = prev.x + (dx / d) * Math.min(d, speed);
          ny = prev.y + (dy / d) * Math.min(d, speed);
        }
        nx = clamp(nx, PADDLE_R + 2, FIELD_W - PADDLE_R - 2);
        ny = clamp(ny, FIELD_H / 2 + 10, FIELD_H - PADDLE_R - 2);
        gs.playerPaddle.x = nx;
        gs.playerPaddle.y = ny;
        prevPaddleRef.current = { x: nx, y: ny };
      }

      if (frozen > 0) {
        frozen--;
        // Still draw frozen state
      } else {
        // Physics
        const { goal } = stepPhysics(gs);
        stepAI(gs, difficulty);

        if (goal) {
          if (goal === "player") {
            localScorePlayer++;
            setScorePlayer(localScorePlayer);
          } else {
            localScoreAI++;
            setScoreAI(localScoreAI);
          }
          setGoalFlash(goal);
          setTimeout(() => setGoalFlash(null), 800);
          frozen = 55;

          if (localScorePlayer >= MAX_SCORE || localScoreAI >= MAX_SCORE) {
            const playerWon = localScorePlayer >= MAX_SCORE;
            setResultWin(playerWon);
            if (currentMode === "online") {
              const change = getEloChange(eloNow, playerWon);
              const newElo = Math.max(1000, eloNow + change);
              setEloChange(change);
              setElo(newElo);
              saveElo(newElo);
            } else {
              setEloChange(null);
            }
            cancelAnimationFrame(animRef.current);
            setScreen("result");
            return;
          } else {
            resetPuck(gs, goal === "player" ? "ai" : "player");
          }
        }
      }

      // Draw
      drawField(ctx, FIELD_W, FIELD_H, ts);
      drawPuck(ctx, gs.puck, ts);
      drawPaddle(ctx, gs.playerPaddle, true, ts);
      drawPaddle(ctx, gs.aiPaddle, false, ts);

      animRef.current = requestAnimationFrame(loop);
    }

    animRef.current = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animRef.current);
  }, [screen]);

  // ─── POINTER/TOUCH EVENTS ───────────────────────────────────────────────────
  const handlePointerMove = useCallback((e: React.PointerEvent | React.TouchEvent) => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const rect = canvas.getBoundingClientRect();
    const s = scaleRef.current;
    let cx: number, cy: number;
    if ("touches" in e) {
      cx = e.touches[0].clientX;
      cy = e.touches[0].clientY;
    } else {
      cx = (e as React.PointerEvent).clientX;
      cy = (e as React.PointerEvent).clientY;
    }
    const fx = (cx - rect.left) / s;
    const fy = (cy - rect.top) / s;
    pointerRef.current = { x: fx, y: fy };
  }, []);

  const handlePointerLeave = useCallback(() => {
    pointerRef.current = null;
  }, []);

  // ─── RENDER ─────────────────────────────────────────────────────────────────
  const rankInfo = getRankInfo(elo);

  return (
    <div className="aerohockey-root" style={{
      minHeight: "100dvh",
      background: "#0a0a0f",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center",
      fontFamily: "'IBM Plex Mono', monospace",
      position: "relative",
      overflow: "hidden",
      userSelect: "none",
    }}>
      {/* BG noise */}
      <div style={{
        position: "fixed", inset: 0, pointerEvents: "none", zIndex: 0,
        backgroundImage: `url("data:image/svg+xml,%3Csvg viewBox='0 0 256 256' xmlns='http://www.w3.org/2000/svg'%3E%3Cfilter id='n'%3E%3CfeTurbulence type='fractalNoise' baseFrequency='0.9' numOctaves='4' stitchTiles='stitch'/%3E%3C/filter%3E%3Crect width='100%25' height='100%25' filter='url(%23n)' opacity='0.04'/%3E%3C/svg%3E")`,
        backgroundRepeat: "repeat", backgroundSize: "128px",
      }} />

      {/* ── MENU ── */}
      {screen === "menu" && (
        <MenuScreen
          elo={elo}
          rankInfo={rankInfo}
          onStart={startGame}
        />
      )}

      {/* ── GAME ── */}
      {screen === "playing" && (
        <div style={{ display: "flex", flexDirection: "column", alignItems: "center", width: "100%", height: "100dvh", position: "relative" }}>
          {/* HUD */}
          <div style={{
            display: "flex", justifyContent: "space-between", alignItems: "center",
            width: "100%", maxWidth: 400,
            padding: "8px 12px",
            flexShrink: 0,
          }}>
            <div style={{ textAlign: "center" }}>
              <div style={{ color: "#4488ff", fontSize: 11, letterSpacing: 2, fontFamily: "'Oswald', sans-serif" }}>AI</div>
              <div style={{ color: "#fff", fontSize: 28, fontFamily: "'Russo One', sans-serif", lineHeight: 1 }}>{scoreAI}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{
                fontSize: 9, letterSpacing: 3, color: mode === "online" ? "#ff2266" : "#888",
                fontFamily: "'IBM Plex Mono', monospace",
                border: `1px solid ${mode === "online" ? "#ff2266" : "#333"}`,
                padding: "2px 6px",
              }}>{mode === "online" ? "● ОНЛАЙН" : "◌ ТРЕН."}</div>
              <div style={{ color: "#888", fontSize: 10, marginTop: 2 }}>ELO {elo}</div>
            </div>
            <div style={{ textAlign: "center" }}>
              <div style={{ color: "#ff2266", fontSize: 11, letterSpacing: 2, fontFamily: "'Oswald', sans-serif" }}>ВЫ</div>
              <div style={{ color: "#fff", fontSize: 28, fontFamily: "'Russo One', sans-serif", lineHeight: 1 }}>{scorePlayer}</div>
            </div>
          </div>

          {/* Canvas area */}
          <div
            ref={containerRef}
            style={{
              flex: 1,
              width: "100%",
              display: "flex",
              alignItems: "center",
              justifyContent: "center",
              position: "relative",
              touchAction: "none",
            }}
            onPointerMove={handlePointerMove}
            onPointerLeave={handlePointerLeave}
            onTouchMove={handlePointerMove}
            onTouchEnd={handlePointerLeave}
          >
            <canvas
              ref={canvasRef}
              width={FIELD_W}
              height={FIELD_H}
              style={{
                display: "block",
                imageRendering: "pixelated",
                cursor: "none",
                touchAction: "none",
              }}
              onPointerMove={handlePointerMove}
              onTouchMove={handlePointerMove}
            />
            {/* Goal flash overlay */}
            {goalFlash && (
              <div style={{
                position: "absolute", inset: 0,
                background: goalFlash === "player" ? "rgba(0,255,150,0.13)" : "rgba(255,34,102,0.13)",
                pointerEvents: "none",
                animation: "goalFlash 0.8s ease-out forwards",
              }}>
                <div style={{
                  position: "absolute", top: "50%", left: "50%",
                  transform: "translate(-50%,-50%)",
                  fontSize: 38, fontFamily: "'Russo One', sans-serif",
                  color: goalFlash === "player" ? "#00ffaa" : "#ff2266",
                  textShadow: `0 0 30px ${goalFlash === "player" ? "#00ffaa" : "#ff2266"}`,
                  letterSpacing: 4,
                  whiteSpace: "nowrap",
                }}>
                  {goalFlash === "player" ? "ГОООЛ!" : "ПРОПУСТИЛ"}
                </div>
              </div>
            )}
          </div>

          {/* Bottom hint */}
          <div style={{ color: "#333", fontSize: 10, letterSpacing: 2, padding: "6px", fontFamily: "'IBM Plex Mono', monospace" }}>
            ДВИГАЙТЕ ПАЛЬЦЕМ
          </div>
        </div>
      )}

      {/* ── RESULT ── */}
      {screen === "result" && (
        <ResultScreen
          win={resultWin}
          scorePlayer={scorePlayer}
          scoreAI={scoreAI}
          elo={elo}
          eloChange={eloChange}
          mode={mode}
          onMenu={() => setScreen("menu")}
          onRematch={() => startGame(mode)}
        />
      )}
    </div>
  );
}

// ─── MENU SCREEN ─────────────────────────────────────────────────────────────
function MenuScreen({
  elo, rankInfo, onStart
}: {
  elo: number;
  rankInfo: ReturnType<typeof getRankInfo>;
  onStart: (m: GameMode) => void;
}) {
  const { tier, sub, progress } = rankInfo;
  const progressBarW = Math.max(4, (progress / 100) * 240);

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 0, padding: "20px 16px", width: "100%", maxWidth: 400, zIndex: 1,
    }}>
      {/* Logo */}
      <div style={{ textAlign: "center", marginBottom: 32 }}>
        <div style={{
          fontFamily: "'Russo One', sans-serif",
          fontSize: 42,
          letterSpacing: 6,
          color: "#fff",
          textShadow: "0 0 30px #ff2266, 0 0 60px #ff226644",
          lineHeight: 1,
        }}>AERO</div>
        <div style={{
          fontFamily: "'Russo One', sans-serif",
          fontSize: 42,
          letterSpacing: 6,
          color: "#00ffcc",
          textShadow: "0 0 30px #00ffcc, 0 0 60px #00ffcc44",
          lineHeight: 1,
          marginTop: -4,
        }}>HOCKEY</div>
        <div style={{
          fontSize: 10, letterSpacing: 6, color: "#555",
          marginTop: 6, fontFamily: "'IBM Plex Mono', monospace"
        }}>Y2K EDITION // 2K26</div>
      </div>

      {/* Rank card */}
      <div style={{
        background: "rgba(255,255,255,0.03)",
        border: `1px solid ${tier.color}44`,
        borderLeft: `3px solid ${tier.color}`,
        padding: "16px 20px",
        width: "100%",
        marginBottom: 32,
        position: "relative",
      }}>
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start" }}>
          <div>
            <div style={{ fontSize: 9, letterSpacing: 3, color: "#666" }}>ТЕКУЩИЙ РАНГ</div>
            <div style={{
              fontSize: 26, fontFamily: "'Russo One', sans-serif",
              color: tier.color,
              textShadow: `0 0 20px ${tier.glowColor}`,
              letterSpacing: 2,
              lineHeight: 1.1,
            }}>{tier.symbol} {tier.name} {getSubLabel(sub)}</div>
            <div style={{ fontSize: 10, color: "#666", marginTop: 4, letterSpacing: 2 }}>ELO: {elo}</div>
          </div>
          <div style={{ textAlign: "right" }}>
            <div style={{ fontSize: 9, letterSpacing: 2, color: "#555" }}>ДО СЛЕД. РАНГА</div>
            <div style={{ fontSize: 20, color: "#fff", fontFamily: "'Russo One', sans-serif" }}>{Math.round(progress)}%</div>
          </div>
        </div>
        {/* Progress bar */}
        <div style={{ marginTop: 12, background: "#111", height: 4, position: "relative" }}>
          <div style={{
            position: "absolute", left: 0, top: 0, bottom: 0,
            width: `${progress}%`,
            background: `linear-gradient(90deg, ${tier.glowColor}, ${tier.color})`,
            boxShadow: `0 0 8px ${tier.color}`,
            transition: "width 0.5s ease",
          }} />
        </div>
      </div>

      {/* Mode buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: 12, width: "100%" }}>
        <button
          onClick={() => onStart("online")}
          style={{
            background: "transparent",
            border: "2px solid #ff2266",
            color: "#ff2266",
            fontFamily: "'Russo One', sans-serif",
            fontSize: 18,
            letterSpacing: 4,
            padding: "18px 24px",
            cursor: "pointer",
            position: "relative",
            overflow: "hidden",
            transition: "all 0.15s",
            textShadow: "0 0 12px #ff2266",
            boxShadow: "0 0 20px #ff226622, inset 0 0 20px #ff226608",
          }}
          onMouseEnter={e => {
            (e.target as HTMLButtonElement).style.background = "#ff226622";
            (e.target as HTMLButtonElement).style.boxShadow = "0 0 30px #ff226644, inset 0 0 30px #ff226616";
          }}
          onMouseLeave={e => {
            (e.target as HTMLButtonElement).style.background = "transparent";
            (e.target as HTMLButtonElement).style.boxShadow = "0 0 20px #ff226622, inset 0 0 20px #ff226608";
          }}
        >
          ▶ ОНЛАЙН МАТЧ
        </button>
        <button
          onClick={() => onStart("training")}
          style={{
            background: "transparent",
            border: "2px solid #444",
            color: "#888",
            fontFamily: "'Russo One', sans-serif",
            fontSize: 18,
            letterSpacing: 4,
            padding: "18px 24px",
            cursor: "pointer",
            transition: "all 0.15s",
          }}
          onMouseEnter={e => {
            (e.target as HTMLButtonElement).style.borderColor = "#888";
            (e.target as HTMLButtonElement).style.color = "#bbb";
          }}
          onMouseLeave={e => {
            (e.target as HTMLButtonElement).style.borderColor = "#444";
            (e.target as HTMLButtonElement).style.color = "#888";
          }}
        >
          ◌ ТРЕНИРОВКА
        </button>
      </div>

      {/* Rank table hint */}
      <div style={{ marginTop: 32, width: "100%" }}>
        <div style={{ fontSize: 9, letterSpacing: 3, color: "#444", marginBottom: 8, textAlign: "center" }}>
          ТАБЛИЦА РАНГОВ
        </div>
        <div style={{ display: "flex", flexWrap: "wrap", gap: 6, justifyContent: "center" }}>
          {RANK_TIERS.map(r => (
            <div key={r.name} style={{
              fontSize: 9, letterSpacing: 1,
              color: elo >= r.min ? r.color : "#333",
              border: `1px solid ${elo >= r.min ? r.color + "44" : "#222"}`,
              padding: "3px 7px",
              fontFamily: "'IBM Plex Mono', monospace",
            }}>
              {r.symbol} {r.name}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ─── RESULT SCREEN ────────────────────────────────────────────────────────────
function ResultScreen({
  win, scorePlayer, scoreAI, elo, eloChange, mode, onMenu, onRematch
}: {
  win: boolean; scorePlayer: number; scoreAI: number;
  elo: number; eloChange: number | null; mode: GameMode;
  onMenu: () => void; onRematch: () => void;
}) {
  const rankInfo = getRankInfo(elo);
  const { tier, sub } = rankInfo;

  return (
    <div style={{
      display: "flex", flexDirection: "column", alignItems: "center",
      gap: 0, padding: "30px 16px", width: "100%", maxWidth: 400, zIndex: 1,
    }}>
      {/* Result */}
      <div style={{ textAlign: "center", marginBottom: 28 }}>
        <div style={{
          fontFamily: "'Russo One', sans-serif",
          fontSize: win ? 52 : 38,
          letterSpacing: 6,
          color: win ? "#00ffcc" : "#ff2266",
          textShadow: `0 0 40px ${win ? "#00ffcc" : "#ff2266"}`,
          lineHeight: 1,
        }}>{win ? "ПОБЕДА" : "ПОРАЖЕНИЕ"}</div>
        <div style={{
          fontSize: 36, color: "#fff", marginTop: 8,
          fontFamily: "'Russo One', sans-serif",
          letterSpacing: 3,
        }}>{scorePlayer} : {scoreAI}</div>
      </div>

      {/* ELO change */}
      {eloChange !== null && (
        <div style={{
          background: `rgba(${eloChange > 0 ? "0,255,150" : "255,34,102"},0.07)`,
          border: `1px solid ${eloChange > 0 ? "#00ff9644" : "#ff226644"}`,
          padding: "14px 24px",
          textAlign: "center",
          marginBottom: 24,
          width: "100%",
        }}>
          <div style={{ fontSize: 9, letterSpacing: 3, color: "#666" }}>РЕЙТИНГ</div>
          <div style={{
            fontSize: 32, fontFamily: "'Russo One', sans-serif",
            color: eloChange > 0 ? "#00ffaa" : "#ff4466",
            textShadow: `0 0 20px ${eloChange > 0 ? "#00ffaa" : "#ff4466"}`,
          }}>
            {eloChange > 0 ? "+" : ""}{eloChange} ELO
          </div>
          <div style={{ fontSize: 14, color: "#888", marginTop: 4, fontFamily: "'IBM Plex Mono', monospace" }}>
            Итого: {elo}
          </div>
        </div>
      )}

      {/* Current rank */}
      <div style={{
        display: "flex", alignItems: "center", gap: 12,
        marginBottom: 28, padding: "12px 20px",
        border: `1px solid ${tier.color}33`,
        width: "100%",
      }}>
        <span style={{
          fontSize: 28, color: tier.color,
          textShadow: `0 0 16px ${tier.glowColor}`
        }}>{tier.symbol}</span>
        <div>
          <div style={{ fontSize: 9, letterSpacing: 2, color: "#555" }}>РАНГ</div>
          <div style={{
            fontSize: 18, fontFamily: "'Russo One', sans-serif",
            color: tier.color, letterSpacing: 2,
          }}>{tier.name} {getSubLabel(sub)}</div>
        </div>
        {mode === "training" && (
          <div style={{ marginLeft: "auto", fontSize: 9, color: "#555", letterSpacing: 1, textAlign: "right" }}>
            ТРЕНИРОВКА<br />РЕЙ. НЕ МЕНЯЕТСЯ
          </div>
        )}
      </div>

      {/* Buttons */}
      <div style={{ display: "flex", flexDirection: "column", gap: 10, width: "100%" }}>
        <button
          onClick={onRematch}
          style={{
            background: "transparent",
            border: `2px solid ${win ? "#00ffcc" : "#ff2266"}`,
            color: win ? "#00ffcc" : "#ff2266",
            fontFamily: "'Russo One', sans-serif",
            fontSize: 17,
            letterSpacing: 4,
            padding: "16px 24px",
            cursor: "pointer",
            textShadow: `0 0 12px ${win ? "#00ffcc" : "#ff2266"}`,
          }}
        >▶ РЕВАНШ</button>
        <button
          onClick={onMenu}
          style={{
            background: "transparent",
            border: "2px solid #333",
            color: "#666",
            fontFamily: "'Russo One', sans-serif",
            fontSize: 17,
            letterSpacing: 4,
            padding: "16px 24px",
            cursor: "pointer",
          }}
        >← МЕНЮ</button>
      </div>
    </div>
  );
}