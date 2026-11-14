import type { Circuit, DriverRef, FlagPeriod, SessionStory } from '../lib/story';
import { colors } from '../theme';

export type DriverLookup = Map<number, DriverRef>;

export function driverLookup(story: { drivers: DriverRef[] }): DriverLookup {
  return new Map(story.drivers.map((d) => [d.number, d]));
}

export const lineDash = (d: DriverRef | undefined) => (d?.dashed ? 'dot' : 'solid');

const periodStyle: Record<FlagPeriod['type'], { fill: string; label: string }> = {
  SC: { fill: colors.sc, label: 'SC' },
  VSC: { fill: colors.vsc, label: 'VSC' },
  RED: { fill: colors.red, label: 'RED' },
};

/** Background bands for safety car / VSC / red flag periods on a lap axis. */
export function periodShapes(periods: FlagPeriod[]) {
  return periods.map((p) => ({
    type: 'rect',
    xref: 'x',
    yref: 'paper',
    x0: p.start,
    x1: p.end,
    y0: 0,
    y1: 1,
    fillcolor: periodStyle[p.type].fill,
    line: { width: 0 },
    layer: 'below',
  }));
}

export function periodAnnotations(periods: FlagPeriod[]) {
  return periods.map((p) => ({
    x: (p.start + p.end) / 2,
    y: 1,
    xref: 'x',
    yref: 'paper',
    yanchor: 'bottom',
    text: periodStyle[p.type].label,
    showarrow: false,
    font: { size: 10, color: p.type === 'RED' ? '#ff6b6b' : '#ffd166' },
  }));
}

/** Track outline and corner numbers as Plotly traces (equal-aspect axes needed). */
export function trackTraces(circuit: Circuit, opts: { color?: string; width?: number; corners?: boolean } = {}) {
  const x = [...circuit.x, circuit.x[0]];
  const y = [...circuit.y, circuit.y[0]];
  const traces: any[] = [
    { type: 'scatter', mode: 'lines', x, y, line: { color: opts.color ?? '#3a3a46', width: opts.width ?? 10 }, hoverinfo: 'skip', showlegend: false },
  ];
  if (opts.corners !== false) {
    traces.push({
      type: 'scatter',
      mode: 'text',
      x: circuit.corners.map((c) => c.textX),
      y: circuit.corners.map((c) => c.textY),
      text: circuit.corners.map((c) => c.label),
      textfont: { color: colors.muted, size: 10 },
      hoverinfo: 'skip',
      showlegend: false,
    });
  }
  return traces;
}

export const trackLayout = {
  xaxis: { visible: false, scaleanchor: 'y', scaleratio: 1 },
  yaxis: { visible: false },
  margin: { l: 8, r: 8, t: 8, b: 8 },
  showlegend: false,
  dragmode: 'pan',
};

/** Leader's lap count, for x-axis ranges. */
export const totalLaps = (story: SessionStory) => story.meta.totalLaps || Math.max(...story.laps.map((s) => s.lap.length));

export const fmtSeconds = (v: number) => (v >= 60 ? `${Math.floor(v / 60)}:${(v % 60).toFixed(3).padStart(6, '0')}` : v.toFixed(3));
