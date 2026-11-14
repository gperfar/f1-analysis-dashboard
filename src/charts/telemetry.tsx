import { useEffect, useMemo, useRef, useState } from 'react';
import { Box, IconButton, MenuItem, Select, Slider, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import Plot from '../components/Plot';
import type { Circuit, SessionStory, TelemetryLap, TelemetrySet } from '../lib/story';
import { loadReplay, ReplayTiming } from '../lib/data';
import { useAsync } from '../hooks';
import { colors } from '../theme';
import { driverLookup, fmtSeconds, trackLayout, trackTraces } from './common';
import { ErrorBox, Loading } from '../components/ui';

// -- helpers ---------------------------------------------------------------------------

/** Linear interpolation of ys at x over increasing xs. */
function interp(xs: number[], ys: number[], x: number): number {
  if (x <= xs[0]) return ys[0];
  if (x >= xs[xs.length - 1]) return ys[ys.length - 1];
  let lo = 0;
  let hi = xs.length - 1;
  while (hi - lo > 1) {
    const mid = (lo + hi) >> 1;
    if (xs[mid] <= x) lo = mid;
    else hi = mid;
  }
  const f = (x - xs[lo]) / (xs[hi] - xs[lo] || 1);
  return ys[lo] + f * (ys[hi] - ys[lo]);
}

/**
 * Distance integrated from speed drifts a little per driver; scale each lap to
 * the same length so traces line up corner by corner.
 */
function normalised(lap: TelemetryLap, length: number) {
  const total = lap.distance[lap.distance.length - 1] || 1;
  return lap.distance.map((d) => (d / total) * length);
}

/** Length of the track outline in metres (coordinates are decimetres). */
function perimeterMeters(circuit: Circuit): number {
  let total = 0;
  for (let i = 0; i < circuit.x.length; i++) {
    const j = (i + 1) % circuit.x.length;
    total += Math.hypot(circuit.x[j] - circuit.x[i], circuit.y[j] - circuit.y[i]);
  }
  return total / 10;
}

/** Lap-distance fraction (0..1) of every point of the track outline. */
function outlineFractions(circuit: Circuit): number[] | null {
  const n = circuit.x.length;
  const cum = [0];
  for (let i = 1; i < n; i++) cum.push(cum[i - 1] + Math.hypot(circuit.x[i] - circuit.x[i - 1], circuit.y[i] - circuit.y[i - 1]));
  const perimeter = cum[n - 1] + Math.hypot(circuit.x[0] - circuit.x[n - 1], circuit.y[0] - circuit.y[n - 1]);
  const anchors = circuit.corners.filter((c) => c.distance !== null);
  if (!anchors.length) return null;
  // Where each corner sits along the outline, and where that puts the finish line.
  const nearest = (x: number, y: number) => {
    let best = 0;
    let bestD = Infinity;
    for (let i = 0; i < n; i++) {
      const dd = (circuit.x[i] - x) ** 2 + (circuit.y[i] - y) ** 2;
      if (dd < bestD) [best, bestD] = [i, dd];
    }
    return best;
  };
  const offsets = anchors.map((c) => {
    const along = cum[nearest(c.x, c.y)] / 10; // decimetres -> metres
    return ((along - c.distance! + perimeter / 10) % (perimeter / 10) + perimeter / 10) % (perimeter / 10);
  });
  offsets.sort((a, b) => a - b);
  const finish = offsets[offsets.length >> 1] * 10;
  return cum.map((s) => (((s - finish) % perimeter) + perimeter) % perimeter / perimeter);
}

// -- head to head ------------------------------------------------------------------------

export function HeadToHead({ story, telemetry, a, b }: { story: SessionStory; telemetry: TelemetrySet; a: number; b: number }) {
  const drivers = driverLookup(story);
  const da = drivers.get(a);
  const db = drivers.get(b);
  const la = telemetry.drivers.find((t) => t.driver === a);
  const lb = telemetry.drivers.find((t) => t.driver === b);

  const computed = useMemo(() => {
    if (!la || !lb) return null;
    const length = (la.distance[la.distance.length - 1] + lb.distance[lb.distance.length - 1]) / 2;
    const xa = normalised(la, length);
    const xb = normalised(lb, length);
    const grid: number[] = [];
    for (let d = 0; d <= length; d += 10) grid.push(d);
    const delta = grid.map((d) => interp(xb, lb.time, d) - interp(xa, la.time, d));
    return { length, xa, xb, grid, delta };
  }, [la, lb]);

  if (!la || !lb || !da || !db || !computed) return <ErrorBox message="No telemetry for one of these drivers." />;
  const { xa, xb, grid, delta } = computed;
  const colorB = db.color.toLowerCase() === da.color.toLowerCase() ? '#ffffff' : db.color;

  const corners = (story.circuit?.corners ?? []).filter((c) => c.distance !== null);
  return (
    <Plot
      filename={`${da.code}-vs-${db.code}`}
      height={620}
      data={[
        { type: 'scatter', mode: 'lines', name: da.code, x: xa, y: la.speed, line: { color: da.color, width: 2 }, hovertemplate: `${da.code} %{y} km/h<extra></extra>` },
        { type: 'scatter', mode: 'lines', name: db.code, x: xb, y: lb.speed, line: { color: colorB, width: 2, dash: db.dashed && da.team === db.team ? 'dot' : 'solid' }, hovertemplate: `${db.code} %{y} km/h<extra></extra>` },
        { type: 'scatter', mode: 'lines', x: grid, y: delta, yaxis: 'y2', line: { color: colors.text, width: 1.5 }, fill: 'tozeroy', fillcolor: 'rgba(236,236,241,0.08)', hovertemplate: `%{y:+.3f}s (${db.code} vs ${da.code})<extra></extra>`, showlegend: false },
        { type: 'scatter', mode: 'lines', x: xa, y: la.throttle, yaxis: 'y3', line: { color: da.color, width: 1.2 }, hovertemplate: `${da.code} throttle %{y}%<extra></extra>`, showlegend: false },
        { type: 'scatter', mode: 'lines', x: xb, y: lb.throttle, yaxis: 'y3', line: { color: colorB, width: 1.2 }, hovertemplate: `${db.code} throttle %{y}%<extra></extra>`, showlegend: false },
        { type: 'scatter', mode: 'lines', x: xa, y: la.brake.map((v) => v * 100), yaxis: 'y4', line: { color: da.color, width: 1.2, shape: 'hv' }, fill: 'tozeroy', hoverinfo: 'skip', showlegend: false },
        { type: 'scatter', mode: 'lines', x: xb, y: lb.brake.map((v) => -v * 100), yaxis: 'y4', line: { color: colorB, width: 1.2, shape: 'hv' }, fill: 'tozeroy', hoverinfo: 'skip', showlegend: false },
      ]}
      layout={{
        hovermode: 'x unified',
        xaxis: { title: 'Distance (m)', anchor: 'y4' },
        yaxis: { domain: [0.5, 1], title: 'Speed (km/h)' },
        yaxis2: { domain: [0.3, 0.46], title: `Δ ${db.code} (s)`, zeroline: true, zerolinecolor: colors.muted },
        yaxis3: { domain: [0.12, 0.27], title: 'Throttle', range: [0, 105] },
        yaxis4: { domain: [0, 0.09], title: 'Brake', showticklabels: false, range: [-110, 110] },
        legend: { orientation: 'h', y: 1.06, x: 0 },
        annotations: corners.map((c) => ({ x: (c.distance! * computed.length) / perimeterMeters(story.circuit!), y: 1, yref: 'paper', text: c.label, showarrow: false, yanchor: 'bottom', font: { size: 9, color: colors.muted } })),
        margin: { l: 60, r: 16, t: 30, b: 40 },
      }}
    />
  );
}

/** Track map split into mini-sectors, coloured by who was faster in each. */
export function TrackDominance({ story, telemetry, a, b, sectors = 25 }: { story: SessionStory; telemetry: TelemetrySet; a: number; b: number; sectors?: number }) {
  const drivers = driverLookup(story);
  const da = drivers.get(a);
  const db = drivers.get(b);
  const la = telemetry.drivers.find((t) => t.driver === a);
  const lb = telemetry.drivers.find((t) => t.driver === b);
  const circuit = story.circuit;
  const fractions = useMemo(() => (circuit ? outlineFractions(circuit) : null), [circuit]);
  if (!circuit || !fractions || !la || !lb || !da || !db) return null;

  const length = (la.distance[la.distance.length - 1] + lb.distance[lb.distance.length - 1]) / 2;
  const xa = normalised(la, length);
  const xb = normalised(lb, length);
  const colorB = db.color.toLowerCase() === da.color.toLowerCase() ? '#ffffff' : db.color;
  let wonA = 0;
  const traces: any[] = trackTraces(circuit, { width: 14, corners: false });
  for (let k = 0; k < sectors; k++) {
    const d0 = (k / sectors) * length;
    const d1 = ((k + 1) / sectors) * length;
    const ta = interp(xa, la.time, d1) - interp(xa, la.time, d0);
    const tb = interp(xb, lb.time, d1) - interp(xb, lb.time, d0);
    const aFaster = ta <= tb;
    if (aFaster) wonA++;
    const idx = fractions.map((f, i) => [f, i] as const).filter(([f]) => f >= k / sectors && f <= (k + 1) / sectors).map(([, i]) => i).sort((p, q) => fractions[p] - fractions[q]);
    if (idx.length === 0) continue;
    // include the next point so segments join up
    const next = fractions.indexOf(Math.min(...fractions.filter((f) => f > (k + 1) / sectors)));
    if (next >= 0) idx.push(next);
    traces.push({
      type: 'scatter',
      mode: 'lines',
      x: idx.map((i) => circuit.x[i]),
      y: idx.map((i) => circuit.y[i]),
      line: { color: aFaster ? da.color : colorB, width: 7 },
      hovertemplate: `Mini-sector ${k + 1}: ${aFaster ? da.code : db.code} faster by ${Math.abs(ta - tb).toFixed(3)}s<extra></extra>`,
      showlegend: false,
    });
  }
  traces.push(...trackTraces(circuit, { corners: true }).slice(1));
  return (
    <Box>
      <Plot filename={`${da.code}-vs-${db.code}-map`} height={420} data={traces} layout={trackLayout} />
      <Typography variant="body2" sx={{ color: colors.muted, textAlign: 'center' }}>
        <b style={{ color: da.color }}>{da.code}</b> faster in {wonA} of {sectors} mini-sectors, <b style={{ color: colorB }}>{db.code}</b> in {sectors - wonA}
      </Typography>
    </Box>
  );
}

export function DriverPicker({ story, value, onChange, exclude }: { story: SessionStory; value: number; onChange: (n: number) => void; exclude?: number }) {
  const withTelemetry = story.drivers;
  return (
    <Select size="small" value={value} onChange={(e) => onChange(Number(e.target.value))} sx={{ minWidth: 170 }}>
      {withTelemetry
        .filter((d) => d.number !== exclude)
        .map((d) => (
          <MenuItem key={d.number} value={d.number}>
            <Box component="span" sx={{ display: 'inline-block', width: 10, height: 10, bgcolor: d.color, borderRadius: '2px', mr: 1 }} />
            {d.code} · {d.name}
          </MenuItem>
        ))}
    </Select>
  );
}

// -- replay ------------------------------------------------------------------------------

/** Animated car positions on the track map for one lap of the race. */
export function Replay({ story }: { story: SessionStory }) {
  const drivers = driverLookup(story);
  const total = story.meta.totalLaps || 1;
  const [lap, setLap] = useState(1);
  const [pendingLap, setPendingLap] = useState(1);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(4);
  const replay = useAsync(() => loadReplay(story, lap), `${story.meta.sessionKey}:${lap}`);
  const lastTick = useRef<number | null>(null);

  useEffect(() => setT(0), [lap]);
  useEffect(() => {
    if (!playing || !replay.data) return;
    const id = window.setInterval(() => {
      const now = performance.now();
      const dt = lastTick.current === null ? 0 : (now - lastTick.current) / 1000;
      lastTick.current = now;
      setT((v) => {
        const next = v + dt * speed;
        if (next >= replay.data!.duration) {
          setPlaying(false);
          return replay.data!.duration;
        }
        return next;
      });
    }, 80);
    return () => {
      window.clearInterval(id);
      lastTick.current = null;
    };
  }, [playing, speed, replay.data]);

  if (!story.circuit) return <ErrorBox message="No circuit layout for this session." />;
  const cars = replay.data ? [...replay.data.cars].filter(([, f]) => f.t.length > 1) : [];
  const tower = replay.data ? timingTower(story, lap, replay.data.timing, t) : { live: false, rows: [] };

  // Fixed axis ranges from the track's bounds: with autorange, labels near the
  // edge change the plot's extent on every frame and the chart shakes.
  const xs = story.circuit.x;
  const ys = story.circuit.y;
  const pad = Math.max(Math.max(...xs) - Math.min(...xs), Math.max(...ys) - Math.min(...ys)) * 0.06;
  const replayLayout = {
    ...trackLayout,
    xaxis: { ...trackLayout.xaxis, range: [Math.min(...xs) - pad, Math.max(...xs) + pad], autorange: false, automargin: false },
    yaxis: { ...trackLayout.yaxis, range: [Math.min(...ys) - pad, Math.max(...ys) + pad * 1.6], autorange: false, automargin: false },
    uirevision: 'replay', // keep the user's zoom/pan between frames
    transition: { duration: 0 },
  };

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={2} alignItems={{ sm: 'center' }} sx={{ mb: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1 }}>
          <Typography variant="body2" sx={{ color: colors.muted, minWidth: 54 }}>
            Lap {pendingLap}
          </Typography>
          <Slider
            size="small"
            min={1}
            max={total}
            value={pendingLap}
            onChange={(_, v) => setPendingLap(v as number)}
            onChangeCommitted={(_, v) => {
              setLap(v as number);
              setPlaying(false);
            }}
            marks={story.periods.map((p) => ({ value: Math.max(1, Math.round(p.start)), label: p.type }))}
          />
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center">
          <IconButton onClick={() => (t >= (replay.data?.duration ?? 0) ? (setT(0), setPlaying(true)) : setPlaying((p) => !p))} disabled={!replay.data} color="primary">
            {playing ? <PauseIcon /> : <PlayArrowIcon />}
          </IconButton>
          <ToggleButtonGroup size="small" exclusive value={speed} onChange={(_, v) => v && setSpeed(v)}>
            {[1, 4, 10].map((s) => (
              <ToggleButton key={s} value={s}>
                {s}×
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <Typography variant="body2" sx={{ color: colors.muted, fontVariantNumeric: 'tabular-nums', minWidth: 64 }}>
            {fmtSeconds(t)}
          </Typography>
        </Stack>
      </Stack>
      {replay.loading && <Loading label="Loading car positions…" minHeight={420} />}
      {replay.error && <ErrorBox message={replay.error} />}
      {replay.data && (
        <Stack direction={{ xs: 'column', md: 'row' }} spacing={2}>
          <Box sx={{ flex: 1 }}>
            <Plot
              filename={`replay-lap-${lap}`}
              height={460}
              data={[
                ...trackTraces(story.circuit, { width: 12 }),
                {
                  type: 'scatter',
                  mode: 'markers+text',
                  x: cars.map(([, f]) => interp(f.t, f.x, t)),
                  y: cars.map(([, f]) => interp(f.t, f.y, t)),
                  text: cars.map(([n]) => drivers.get(n)?.code ?? String(n)),
                  textposition: 'top center',
                  textfont: { size: 10, color: colors.text },
                  cliponaxis: false, // labels may overflow the plot area without resizing it
                  marker: { size: 12, color: cars.map(([n]) => drivers.get(n)?.color ?? '#888'), line: { color: colors.bg, width: 1.5 } },
                  hovertemplate: '%{text}<extra></extra>',
                  showlegend: false,
                },
              ]}
              layout={replayLayout}
            />
          </Box>
          <Box sx={{ minWidth: 230 }}>
            <Typography variant="overline" sx={{ color: colors.muted }}>
              {tower.live ? 'Live timing' : `Order at end of lap ${lap}`}
            </Typography>
            <Stack direction="row" sx={{ color: colors.muted, fontSize: 11, pb: 0.5 }}>
              <Box sx={{ width: 22 }} />
              <Box sx={{ flex: 1, pl: 1.5 }}>Driver</Box>
              <Box sx={{ width: 64, textAlign: 'right' }}>Leader</Box>
              <Box sx={{ width: 56, textAlign: 'right' }}>Ahead</Box>
            </Stack>
            {tower.rows.slice(0, 22).map((row, i) => {
              const d = drivers.get(row.driver);
              return (
                <Stack key={row.driver} direction="row" alignItems="center" sx={{ py: 0.2, fontVariantNumeric: 'tabular-nums' }}>
                  <Typography variant="body2" sx={{ width: 22, color: colors.muted }}>
                    {i + 1}
                  </Typography>
                  <Box sx={{ width: 4, height: 14, bgcolor: d?.color, mr: 1 }} />
                  <Typography variant="body2" sx={{ flex: 1 }}>
                    {d?.code ?? row.driver}
                  </Typography>
                  <Typography variant="body2" sx={{ width: 64, textAlign: 'right' }}>
                    {i === 0 ? 'Leader' : fmtGap(row.gap)}
                  </Typography>
                  <Typography variant="body2" sx={{ width: 56, textAlign: 'right', color: colors.muted }}>
                    {i === 0 ? '' : fmtGap(row.interval)}
                  </Typography>
                </Stack>
              );
            })}
          </Box>
        </Stack>
      )}
    </Box>
  );
}

// -- timing tower ------------------------------------------------------------------------

type Gap = number | string | null;

const fmtGap = (g: Gap) => (g === null || g === undefined ? '' : typeof g === 'number' ? `+${g.toFixed(1)}` : g);

/** Sort key for a gap: numbers first, then lapped cars ("+1 LAP", "+2 LAPS"...). */
function gapRank(g: Gap): number {
  if (typeof g === 'number') return g;
  const laps = typeof g === 'string' ? parseInt(g.replace(/[^\d]/g, ''), 10) : NaN;
  return Number.isNaN(laps) ? 1e9 : 1e6 * laps;
}

/**
 * Gaps at replay time `t`: the latest OpenF1 interval sample for each car.
 * Falls back to the end-of-lap gaps from the story when there are none.
 */
function timingTower(story: SessionStory, lap: number, timing: Map<number, ReplayTiming>, t: number) {
  if (timing.size) {
    const rows = [...timing].map(([driver, s]) => {
      let i = 0;
      while (i + 1 < s.t.length && s.t[i + 1] <= t) i++;
      return { driver, gap: s.gap[i], interval: s.interval[i] };
    });
    rows.sort((a, b) => gapRank(a.gap) - gapRank(b.gap));
    return { live: true, rows };
  }
  const rows = story.laps
    .map((s) => {
      const i = s.lap.indexOf(lap);
      return { driver: s.driver, pos: s.position[i], gap: s.gap[i] as Gap, interval: null as Gap };
    })
    .filter((r) => r.pos)
    .sort((a, b) => a.pos! - b.pos!);
  rows.forEach((r, i) => {
    if (i > 0 && typeof r.gap === 'number' && typeof rows[i - 1].gap === 'number') r.interval = Math.round((r.gap - (rows[i - 1].gap as number)) * 10) / 10;
  });
  return { live: false, rows };
}
