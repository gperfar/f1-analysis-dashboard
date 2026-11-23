/**
 * Top-down "follow cam": the view stays centred on one car and rotates so it
 * always drives up the screen; the other laps appear around it as ghosts.
 */
import { useEffect, useMemo, useRef } from 'react';
import type { Circuit } from '../lib/story';
import type { GhostCar, GhostRace } from '../lib/ghost';
import { colors, fontFamily } from '../theme';
import { kerbs, normals, TRACK_WIDTH } from './trackDetail';

const CAR_LENGTH = 56; // decimetres

/**
 * Top view of an F1 car, nose along +x, length 1 (so it scales freely):
 * front and rear wings, nose, sidepods, cockpit and four tyres.
 */
function drawCar(ctx: CanvasRenderingContext2D, x: number, y: number, angle: number, length: number, color: string, followed: boolean) {
  ctx.save();
  ctx.translate(x, y);
  ctx.rotate(angle);
  ctx.scale(length, length);
  const rect = (x0: number, y0: number, w: number, h: number) => ctx.fillRect(x0, y0, w, h);
  // tyres
  ctx.fillStyle = '#0b0b0d';
  rect(0.2, -0.19, 0.13, 0.075);
  rect(0.2, 0.115, 0.13, 0.075);
  rect(-0.4, -0.2, 0.15, 0.085);
  rect(-0.4, 0.115, 0.15, 0.085);
  // body: engine cover, sidepods, tapering nose
  ctx.beginPath();
  ctx.moveTo(-0.42, -0.055);
  ctx.lineTo(-0.24, -0.08);
  ctx.lineTo(-0.16, -0.14);
  ctx.lineTo(0.06, -0.135);
  ctx.lineTo(0.14, -0.06);
  ctx.lineTo(0.43, -0.03);
  ctx.lineTo(0.46, 0);
  ctx.lineTo(0.43, 0.03);
  ctx.lineTo(0.14, 0.06);
  ctx.lineTo(0.06, 0.135);
  ctx.lineTo(-0.16, 0.14);
  ctx.lineTo(-0.24, 0.08);
  ctx.lineTo(-0.42, 0.055);
  ctx.closePath();
  ctx.fillStyle = color;
  ctx.fill();
  if (followed) {
    ctx.lineWidth = 2.5 / length;
    ctx.strokeStyle = '#ffffff';
    ctx.stroke();
  }
  // wings
  ctx.fillStyle = color;
  rect(0.4, -0.19, 0.09, 0.38);
  rect(-0.5, -0.15, 0.09, 0.3);
  ctx.fillStyle = 'rgba(0,0,0,0.55)';
  rect(0.4, -0.19, 0.09, 0.03);
  rect(0.4, 0.16, 0.09, 0.03);
  rect(-0.5, -0.15, 0.09, 0.025);
  rect(-0.5, 0.125, 0.09, 0.025);
  // cockpit and helmet
  ctx.fillStyle = '#0b0b0d';
  ctx.beginPath();
  ctx.ellipse(-0.04, 0, 0.07, 0.035, 0, 0, Math.PI * 2);
  ctx.fill();
  ctx.fillStyle = '#f2f2f2';
  ctx.beginPath();
  ctx.arc(-0.05, 0, 0.022, 0, Math.PI * 2);
  ctx.fill();
  ctx.restore();
}

interface Props {
  race: GhostRace;
  circuit: Circuit;
  time: number;
  follow: GhostCar;
  /** Metres shown across the view. */
  viewMeters: number;
  height: number;
}

export default function FollowCam2D({ race, circuit, time, follow, viewMeters, height }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const heading = useRef<number | null>(null);
  const lastTime = useRef<number | null>(null);
  const kerbSet = useMemo(() => kerbs(circuit), [circuit]);
  const edgeNormals = useMemo(() => normals(circuit), [circuit]);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const dpr = window.devicePixelRatio || 1;
    const width = canvas.clientWidth;
    if (canvas.width !== Math.round(width * dpr) || canvas.height !== Math.round(height * dpr)) {
      canvas.width = Math.round(width * dpr);
      canvas.height = Math.round(height * dpr);
    }
    const ctx = canvas.getContext('2d');
    if (!ctx) return;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.clearRect(0, 0, width, height);

    const me = race.state(follow, time);
    // ease the camera's rotation so it doesn't twitch between samples
    const target = me.heading;
    // snap instead of easing after a scrub (or a new car to follow)
    if (heading.current === null || lastTime.current === null || Math.abs(time - lastTime.current) > 0.5) heading.current = target;
    lastTime.current = time;
    let diff = target - heading.current;
    while (diff > Math.PI) diff -= 2 * Math.PI;
    while (diff < -Math.PI) diff += 2 * Math.PI;
    heading.current += diff * 0.18;

    const scale = width / (viewMeters * 10); // px per decimetre
    const angle = Math.PI / 2 - heading.current; // rotate travel direction to "up"
    const cos = Math.cos(angle);
    const sin = Math.sin(angle);
    const cx = width / 2;
    const cy = height * 0.62;
    const toScreen = (x: number, y: number): [number, number] => {
      const dx = x - me.x;
      const dy = y - me.y;
      return [cx + (dx * cos - dy * sin) * scale, cy - (dx * sin + dy * cos) * scale];
    };

    // track
    const path = () => {
      ctx.beginPath();
      circuit.x.forEach((x, i) => {
        const [sx, sy] = toScreen(x, circuit.y[i]);
        if (i === 0) ctx.moveTo(sx, sy);
        else ctx.lineTo(sx, sy);
      });
      ctx.closePath();
    };
    ctx.lineJoin = 'round';
    ctx.lineCap = 'round';
    path();
    ctx.strokeStyle = '#4a4a56';
    ctx.lineWidth = (TRACK_WIDTH + 16) * scale;
    ctx.stroke();
    path();
    ctx.strokeStyle = '#2b2b33';
    ctx.lineWidth = TRACK_WIDTH * scale;
    ctx.stroke();

    // kerbs: red and white along both edges through each corner
    const kerbWidth = Math.max(2, 9 * scale);
    for (const kerb of kerbSet) {
      for (const side of [1, -1]) {
        ctx.beginPath();
        kerb.indices.forEach((i, k) => {
          const off = side * (TRACK_WIDTH / 2 + 4);
          const [sx, sy] = toScreen(circuit.x[i] + edgeNormals[i][0] * off, circuit.y[i] + edgeNormals[i][1] * off);
          if (k === 0) ctx.moveTo(sx, sy);
          else ctx.lineTo(sx, sy);
        });
        ctx.lineCap = 'butt';
        ctx.lineWidth = kerbWidth;
        ctx.setLineDash([]);
        ctx.strokeStyle = '#e8e8ec';
        ctx.stroke();
        ctx.setLineDash([Math.max(3, 20 * scale), Math.max(3, 20 * scale)]);
        ctx.strokeStyle = '#d6303a';
        ctx.stroke();
        ctx.setLineDash([]);
      }
    }
    ctx.lineCap = 'round';

    // start/finish line, chequered (cells drawn as quads so they turn with the view)
    {
      // where the laps start (the timing line), not the outline's first point
      const line = race.state(follow, 0);
      const [tx, ty] = [Math.cos(line.heading), Math.sin(line.heading)];
      const [nx, ny] = [-ty, tx];
      const cells = 8;
      const cell = TRACK_WIDTH / cells;
      for (let k = 0; k < cells; k++) {
        for (let row = 0; row < 2; row++) {
          const across = -TRACK_WIDTH / 2 + k * cell;
          const along = (row - 1) * cell;
          const corner = (a: number, b: number) => toScreen(line.x + nx * (across + a) + tx * (along + b), line.y + ny * (across + a) + ty * (along + b));
          const quad = [corner(0, 0), corner(cell, 0), corner(cell, cell), corner(0, cell)];
          ctx.beginPath();
          quad.forEach(([qx, qy], q) => (q ? ctx.lineTo(qx, qy) : ctx.moveTo(qx, qy)));
          ctx.closePath();
          ctx.fillStyle = (k + row) % 2 ? '#111' : '#f2f2f2';
          ctx.fill();
        }
      }
    }

    // corner numbers
    ctx.font = `600 12px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colors.muted;
    for (const c of circuit.corners) {
      const [sx, sy] = toScreen(c.textX, c.textY);
      if (sx > -20 && sx < width + 20 && sy > -20 && sy < height + 20) ctx.fillText(c.label, sx, sy);
    }

    // trails: the last 1.5 s of each car's line, to compare lines through corners
    ctx.lineCap = 'round';
    for (const car of race.cars) {
      if (time > car.lapTime + 0.5 && car !== follow) continue;
      const pts = race.trail(car, time, 1.5).map(([x, y]) => toScreen(x, y));
      for (let i = 1; i < pts.length; i++) {
        ctx.globalAlpha = (i / pts.length) * 0.75;
        ctx.strokeStyle = car.driver.color;
        ctx.lineWidth = Math.max(2, 7 * scale);
        ctx.beginPath();
        ctx.moveTo(pts[i - 1][0], pts[i - 1][1]);
        ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
      }
    }
    ctx.globalAlpha = 1;

    // cars: the followed one last so it's on top
    const others = race.cars.filter((c) => c !== follow);
    // drawn 1.6x real size (like broadcast graphics) so the shape reads at any zoom
    const length = Math.max(36, CAR_LENGTH * scale * 1.6);
    for (const car of [...others, follow]) {
      const s = car === follow ? me : race.state(car, time);
      const [sx, sy] = toScreen(s.x, s.y);
      ctx.globalAlpha = s.finished && car !== follow ? 0.35 : 1;
      drawCar(ctx, sx, sy, -(s.heading + angle), length, car.driver.color, car === follow);
      ctx.fillStyle = colors.text;
      ctx.font = `700 12px ${fontFamily}`;
      ctx.fillText(`${car.driver.code}${race.cars.filter((x) => x.driver.number === car.driver.number).length > 1 ? ` L${car.lap}` : ''}`, sx, sy - length * 0.45 - 10);
      ctx.globalAlpha = 1;
    }

    // mini-map (not rotated) in the corner
    const size = Math.min(150, width * 0.28);
    const xs = circuit.x;
    const ys = circuit.y;
    const minX = Math.min(...xs);
    const maxX = Math.max(...xs);
    const minY = Math.min(...ys);
    const maxY = Math.max(...ys);
    const k = (size - 16) / Math.max(maxX - minX, maxY - minY);
    const ox = width - size - 12;
    const oy = 12;
    const toMini = (x: number, y: number): [number, number] => [ox + 8 + (x - minX) * k, oy + 8 + (maxY - y) * k];
    ctx.fillStyle = 'rgba(13,13,16,0.75)';
    ctx.fillRect(ox, oy, size, (maxY - minY) * k + 16);
    ctx.beginPath();
    xs.forEach((x, i) => {
      const [mx, my] = toMini(x, ys[i]);
      if (i === 0) ctx.moveTo(mx, my);
      else ctx.lineTo(mx, my);
    });
    ctx.closePath();
    ctx.strokeStyle = '#5a5a66';
    ctx.lineWidth = 2;
    ctx.stroke();
    for (const car of race.cars) {
      const s = car === follow ? me : race.state(car, time);
      const [mx, my] = toMini(s.x, s.y);
      ctx.beginPath();
      ctx.arc(mx, my, car === follow ? 4 : 3, 0, Math.PI * 2);
      ctx.fillStyle = car.driver.color;
      ctx.fill();
    }
  });

  return <canvas ref={canvasRef} style={{ width: '100%', height, display: 'block', borderRadius: 8, background: '#121216' }} />;
}
