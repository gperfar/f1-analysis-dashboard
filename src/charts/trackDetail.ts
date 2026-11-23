/** Track furniture shared by the 2D and 3D lap animations. */
import type { Circuit } from '../lib/story';

export const TRACK_WIDTH = 140; // decimetres (~14 m)
/** How far either side of a corner's apex the kerbs run. */
const KERB_REACH = 380; // decimetres

export interface Edge {
  /** Outline indices (consecutive, may wrap) the kerb runs along. */
  indices: number[];
}

/** Unit normal (pointing left of the direction of travel) at each outline point. */
export function normals(circuit: Circuit): [number, number][] {
  const n = circuit.x.length;
  return circuit.x.map((_, i) => {
    const prev = (i - 1 + n) % n;
    const next = (i + 1) % n;
    const tx = circuit.x[next] - circuit.x[prev];
    const ty = circuit.y[next] - circuit.y[prev];
    const len = Math.hypot(tx, ty) || 1;
    return [-ty / len, tx / len];
  });
}

/** Stretches of outline around each corner, where kerbs go. */
export function kerbs(circuit: Circuit): Edge[] {
  const n = circuit.x.length;
  const step = (i: number) => Math.hypot(circuit.x[(i + 1) % n] - circuit.x[i], circuit.y[(i + 1) % n] - circuit.y[i]);
  return circuit.corners.map((c) => {
    let best = 0;
    let bestD = Infinity;
    circuit.x.forEach((x, i) => {
      const d = (x - c.x) ** 2 + (circuit.y[i] - c.y) ** 2;
      if (d < bestD) [best, bestD] = [i, d];
    });
    const indices = [best];
    for (let i = best, run = 0; run < KERB_REACH && indices.length < n / 2; ) {
      i = (i - 1 + n) % n;
      run += step(i);
      indices.unshift(i);
    }
    for (let i = best, run = 0; run < KERB_REACH && indices.length < n; ) {
      run += step(i);
      i = (i + 1) % n;
      indices.push(i);
    }
    return { indices };
  });
}
