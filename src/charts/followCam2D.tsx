/**
 * Top-down "follow cam": the view stays centred on one car and rotates so it
 * always drives up the screen; the other laps appear around it as ghosts.
 */
import { useEffect, useRef } from 'react';
import type { Circuit } from '../lib/story';
import type { GhostCar, GhostRace } from '../lib/ghost';
import { colors, fontFamily } from '../theme';

const TRACK_WIDTH = 140; // decimetres (~14 m)

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
    if (heading.current === null) heading.current = target;
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

    // corner numbers
    ctx.font = `600 12px ${fontFamily}`;
    ctx.textAlign = 'center';
    ctx.textBaseline = 'middle';
    ctx.fillStyle = colors.muted;
    for (const c of circuit.corners) {
      const [sx, sy] = toScreen(c.textX, c.textY);
      if (sx > -20 && sx < width + 20 && sy > -20 && sy < height + 20) ctx.fillText(c.label, sx, sy);
    }

    // cars: the followed one last so it's on top
    const others = race.cars.filter((c) => c !== follow);
    for (const car of [...others, follow]) {
      const s = car === follow ? me : race.state(car, time);
      const [sx, sy] = toScreen(s.x, s.y);
      const r = Math.max(6, 22 * scale);
      ctx.globalAlpha = s.finished && car !== follow ? 0.35 : 1;
      ctx.beginPath();
      ctx.arc(sx, sy, r, 0, Math.PI * 2);
      ctx.fillStyle = car.driver.color;
      ctx.fill();
      ctx.lineWidth = car === follow ? 3 : 1.5;
      ctx.strokeStyle = car === follow ? '#ffffff' : colors.bg;
      ctx.stroke();
      ctx.fillStyle = colors.text;
      ctx.font = `700 12px ${fontFamily}`;
      ctx.fillText(`${car.driver.code}${race.cars.filter((x) => x.driver.number === car.driver.number).length > 1 ? ` L${car.lap}` : ''}`, sx, sy - r - 9);
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
