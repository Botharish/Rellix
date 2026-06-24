"use client";

import { useEffect, useRef } from "react";

// 3D floating light-sphere background, ported from the original index.html.
export default function OrbCanvas() {
  const ref = useRef<HTMLCanvasElement>(null);

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    let W = 0;
    let H = 0;
    let mx = 0.5;
    let my = 0.5;
    let tick = 0;
    let raf = 0;

    const resize = () => {
      W = canvas.width = window.innerWidth;
      H = canvas.height = window.innerHeight;
    };
    const onMove = (e: MouseEvent) => {
      mx = e.clientX / W;
      my = e.clientY / H;
    };
    resize();
    window.addEventListener("resize", resize);
    window.addEventListener("mousemove", onMove);

    const draw = () => {
      ctx.clearRect(0, 0, W, H);
      tick += 0.004;

      const ox = (mx - 0.5) * 60;
      const oy = (my - 0.5) * 40;
      const cx = W * 0.5 + ox;
      const cy = H * 0.42 + oy;

      // Outer halo
      const halo = ctx.createRadialGradient(cx, cy, 0, cx, cy, H * 0.55);
      halo.addColorStop(0, `rgba(100,110,255,${0.06 + Math.sin(tick) * 0.01})`);
      halo.addColorStop(
        0.4,
        `rgba(140,80,255,${0.04 + Math.sin(tick + 1) * 0.01})`
      );
      halo.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = halo;
      ctx.fillRect(0, 0, W, H);

      const r = Math.min(W, H) * 0.26;
      const pulse = 1 + Math.sin(tick * 1.3) * 0.015;

      // Deep glow
      const glow = ctx.createRadialGradient(cx, cy, 0, cx, cy, r * 2.8);
      glow.addColorStop(0, `rgba(90,105,255,${0.18 + Math.sin(tick) * 0.03})`);
      glow.addColorStop(0.3, `rgba(140,80,255,${0.1})`);
      glow.addColorStop(0.6, `rgba(30,10,80,${0.06})`);
      glow.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = glow;
      ctx.fillRect(0, 0, W, H);

      // Orb body
      const sphereGrad = ctx.createRadialGradient(
        cx - r * 0.28,
        cy - r * 0.28,
        r * 0.05,
        cx,
        cy,
        r * pulse
      );
      sphereGrad.addColorStop(0, "rgba(160,150,255,0.22)");
      sphereGrad.addColorStop(0.3, "rgba(100,90,220,0.14)");
      sphereGrad.addColorStop(0.6, "rgba(60,40,140,0.10)");
      sphereGrad.addColorStop(1, "rgba(10,8,30,0.06)");
      ctx.beginPath();
      ctx.arc(cx, cy, r * pulse, 0, Math.PI * 2);
      ctx.fillStyle = sphereGrad;
      ctx.fill();

      // Rim light
      const rimGrad = ctx.createRadialGradient(
        cx,
        cy,
        r * 0.7 * pulse,
        cx,
        cy,
        r * 1.05 * pulse
      );
      const hue1 = 220 + Math.sin(tick * 0.7) * 30;
      const hue2 = 270 + Math.sin(tick * 0.5 + 1) * 25;
      rimGrad.addColorStop(0, "rgba(0,0,0,0)");
      rimGrad.addColorStop(0.7, "rgba(0,0,0,0)");
      rimGrad.addColorStop(0.88, `hsla(${hue1},80%,70%,0.08)`);
      rimGrad.addColorStop(0.95, `hsla(${hue2},90%,75%,0.18)`);
      rimGrad.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, r * pulse, 0, Math.PI * 2);
      ctx.fillStyle = rimGrad;
      ctx.fill();

      // Specular highlight
      const spec = ctx.createRadialGradient(
        cx - r * 0.3,
        cy - r * 0.35,
        0,
        cx - r * 0.3,
        cy - r * 0.35,
        r * 0.45
      );
      spec.addColorStop(0, "rgba(220,225,255,0.12)");
      spec.addColorStop(0.5, "rgba(180,190,255,0.04)");
      spec.addColorStop(1, "rgba(0,0,0,0)");
      ctx.beginPath();
      ctx.arc(cx, cy, r * pulse, 0, Math.PI * 2);
      ctx.fillStyle = spec;
      ctx.fill();

      // Floating ring
      const ringR = r * 1.55 * pulse;
      const ringTilt = 0.35;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ringTilt);
      ctx.rotate(tick * 0.18);
      const ringGrad = ctx.createConicGradient(0, 0, 0);
      ringGrad.addColorStop(0, "rgba(120,140,255,0)");
      ringGrad.addColorStop(0.2, "rgba(120,140,255,0.18)");
      ringGrad.addColorStop(0.5, "rgba(180,120,255,0.12)");
      ringGrad.addColorStop(0.8, "rgba(80,200,180,0.14)");
      ringGrad.addColorStop(1, "rgba(120,140,255,0)");
      ctx.strokeStyle = ringGrad;
      ctx.lineWidth = 1.5;
      ctx.globalAlpha = 0.55;
      ctx.beginPath();
      ctx.arc(0, 0, ringR, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;

      // Counter-rotating ring
      ctx.save();
      ctx.translate(cx, cy);
      ctx.scale(1, ringTilt * 0.7);
      ctx.rotate(-tick * 0.28 + Math.PI * 0.4);
      ctx.strokeStyle = `rgba(61,232,160,${0.06 + Math.sin(tick * 2) * 0.03})`;
      ctx.lineWidth = 0.8;
      ctx.globalAlpha = 0.4;
      ctx.beginPath();
      ctx.arc(0, 0, ringR * 0.78, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
      ctx.globalAlpha = 1;

      raf = requestAnimationFrame(draw);
    };
    draw();

    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", resize);
      window.removeEventListener("mousemove", onMove);
    };
  }, []);

  return <canvas id="orb-canvas" ref={ref} />;
}
