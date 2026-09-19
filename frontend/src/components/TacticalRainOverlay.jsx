import React, { useRef, useEffect } from 'react';

/**
 * SingleNodeRainCanvas
 * Renders rain strictly masked inside an individual circular ward node.
 * 
 * Fixes:
 * 1. Calls ctx.clearRect(0, 0, canvas.width, canvas.height) at the very top of requestAnimationFrame.
 * 2. Particle Lifecycle: Resets y = -10 immediately when y > canvas.height.
 * 3. Parent wrapper has `rounded-full overflow-hidden` to guarantee zero bleeding into the grid.
 */
export function SingleNodeRainCanvas({ status = 0 }) {
  const canvasRef = useRef(null);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let animationFrameId;
    const dpr = window.devicePixelRatio || 1;
    const size = 64; // Size in CSS pixels matching the w-16 h-16 circular node
    canvas.width = size * dpr;
    canvas.height = size * dpr;

    // Status configuration
    const isCrit = status === 2;
    const isWarn = status === 1;

    // Drop count: Safe=4 (light drizzle), Warning=18 (moderate), Critical=38 (heavy/torrential)
    const dropCount = isCrit ? 38 : isWarn ? 18 : 4;
    const angleRad = isCrit ? (16 * Math.PI) / 180 : isWarn ? (6 * Math.PI) / 180 : 0;
    const sinA = Math.sin(angleRad);
    const cosA = Math.cos(angleRad);

    const strokeColor = isCrit
      ? 'rgba(239, 68, 68, '
      : isWarn
      ? 'rgba(245, 158, 11, '
      : 'rgba(52, 211, 153, ';

    // Initialize particle pool for this node
    const particles = Array.from({ length: dropCount }, () => ({
      x: Math.random() * (canvas.width + 20 * dpr) - 10 * dpr,
      y: Math.random() * canvas.height,
      speed: (isCrit ? 7 + Math.random() * 4 : isWarn ? 4 + Math.random() * 2.5 : 1.5 + Math.random() * 1.5) * dpr,
      length: (isCrit ? 14 + Math.random() * 8 : isWarn ? 8 + Math.random() * 5 : 4 + Math.random() * 3) * dpr,
      opacity: isCrit ? 0.85 : isWarn ? 0.50 : 0.20,
    }));

    // Animation Loop
    const render = () => {
      // 1. MUST clear canvas at the very top of each frame to prevent smearing
      ctx.clearRect(0, 0, canvas.width, canvas.height);

      ctx.lineWidth = (isCrit ? 1.8 : isWarn ? 1.3 : 0.9) * dpr;
      ctx.lineCap = 'round';

      for (let i = 0; i < particles.length; i++) {
        const p = particles[i];

        // Advance particle position
        p.y += p.speed * cosA;
        p.x += p.speed * sinA;

        // 2. Particle Lifecycle: immediately recycle when y exceeds canvas.height
        if (p.y > canvas.height + p.length) {
          p.y = -10 * dpr;
          p.x = Math.random() * (canvas.width + 20 * dpr) - 10 * dpr;
        }

        // Draw clean drop line
        const tailX = p.x - p.length * sinA;
        const tailY = p.y - p.length * cosA;

        ctx.strokeStyle = `${strokeColor}${p.opacity})`;
        ctx.beginPath();
        ctx.moveTo(tailX, tailY);
        ctx.lineTo(p.x, p.y);
        ctx.stroke();
      }

      animationFrameId = requestAnimationFrame(render);
    };

    animationFrameId = requestAnimationFrame(render);

    return () => {
      cancelAnimationFrame(animationFrameId);
    };
  }, [status]);

  return (
    <canvas
      ref={canvasRef}
      className="w-full h-full rounded-full"
    />
  );
}

/**
 * TacticalRainOverlay
 * Positions 16 circular masked rain nodes directly over the schematic map.
 * Guaranteed zero smearing, clean particle recycling, and circular masking with rounded-full overflow-hidden.
 */
export default function TacticalRainOverlay({
  nodes = [],
  viewBoxWidth = 800,
  viewBoxHeight = 600,
}) {
  return (
    <div className="absolute inset-0 pointer-events-none z-10">
      {nodes.map((node) => (
        <div
          key={node.id}
          className="absolute -translate-x-1/2 -translate-y-1/2 w-16 h-16 rounded-full overflow-hidden"
          style={{
            left: `${(node.x / viewBoxWidth) * 100}%`,
            top: `${(node.y / viewBoxHeight) * 100}%`,
          }}
        >
          <SingleNodeRainCanvas status={node.status} />
        </div>
      ))}
    </div>
  );
}
