/**
 * Tiny dependency-free confetti burst. Renders ~30 pieces from the given
 * origin, animated with rAF for ~1.4s. Safe to call repeatedly — each call
 * mounts and tears down its own canvas.
 */
export function celebrate(opts: { x?: number; y?: number; colors?: string[]; pieces?: number } = {}) {
  if (typeof window === "undefined") return;
  const { x = window.innerWidth / 2, y = window.innerHeight / 2, pieces = 32 } = opts;
  const colors = opts.colors ?? ["#22c55e", "#10b981", "#0ea5e9", "#a78bfa", "#f59e0b"];

  const canvas = document.createElement("canvas");
  canvas.style.cssText =
    "position:fixed;inset:0;pointer-events:none;z-index:9999;width:100vw;height:100vh;";
  canvas.width = window.innerWidth;
  canvas.height = window.innerHeight;
  document.body.appendChild(canvas);
  const ctx = canvas.getContext("2d");
  if (!ctx) return;

  const parts = Array.from({ length: pieces }, () => ({
    x,
    y,
    vx: (Math.random() - 0.5) * 9,
    vy: -Math.random() * 9 - 3,
    g: 0.32,
    r: 3 + Math.random() * 4,
    rot: Math.random() * Math.PI,
    vr: (Math.random() - 0.5) * 0.3,
    color: colors[(Math.random() * colors.length) | 0],
    life: 0,
  }));

  const start = performance.now();
  const TTL = 1400;

  function frame(t: number) {
    const elapsed = t - start;
    ctx!.clearRect(0, 0, canvas.width, canvas.height);
    parts.forEach((p) => {
      p.vy += p.g;
      p.x += p.vx;
      p.y += p.vy;
      p.rot += p.vr;
      const alpha = Math.max(0, 1 - elapsed / TTL);
      ctx!.save();
      ctx!.globalAlpha = alpha;
      ctx!.translate(p.x, p.y);
      ctx!.rotate(p.rot);
      ctx!.fillStyle = p.color;
      ctx!.fillRect(-p.r, -p.r * 0.5, p.r * 2, p.r);
      ctx!.restore();
    });
    if (elapsed < TTL) requestAnimationFrame(frame);
    else canvas.remove();
  }
  requestAnimationFrame(frame);
}
