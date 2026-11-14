/**
 * Telemetry deep dive: two laps compared metre by metre (any lap of any
 * driver), where the time went corner by corner, energy management zones,
 * and field-wide corner and straight-line speeds.
 */
import { useMemo } from 'react';
import { Box, MenuItem, Select, Table, TableBody, TableCell, TableHead, TableRow, Typography } from '@mui/material';
import Plot from '../components/Plot';
import type { Circuit, DriverRef, SessionStory, TelemetryLap, TelemetrySet } from '../lib/story';
import { alignedDistance, cornerMetrics, energyZones, lapTimeline, perimeterMeters, Zone } from '../lib/telemetryAnalysis';
import { formatTime } from '../lib/narrative';
import { focusOpacity, useFocus } from '../hooks';
import { colors, tyreColors } from '../theme';
import { driverLookup, trackLayout, trackTraces } from './common';

export const LIFT_COLOR = '#4dabf7';
export const CLIP_COLOR = '#ffa94d';

/** Second driver's colour, made distinguishable when both are teammates. */
export function contrastColors(da: DriverRef, db: DriverRef) {
  return { a: da.color, b: db.color.toLowerCase() === da.color.toLowerCase() ? '#ffffff' : db.color };
}

const lapLength = (la: TelemetryLap, lb: TelemetryLap) => (la.distance[la.distance.length - 1] + lb.distance[lb.distance.length - 1]) / 2;

// -- pickers ---------------------------------------------------------------------------------

export function DriverPicker({ story, value, onChange, exclude }: { story: SessionStory; value: number; onChange: (n: number) => void; exclude?: number }) {
  return (
    <Select size="small" value={value} onChange={(e) => onChange(Number(e.target.value))} sx={{ minWidth: 150 }}>
      {story.drivers
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

/** Pick one of a driver's timed laps; the fastest is listed first. */
export function LapPicker({ story, driver, value, onChange }: { story: SessionStory; driver: number; value: number; onChange: (lap: number) => void }) {
  const series = story.laps.find((s) => s.driver === driver);
  const fastest = story.fastest.find((f) => f.driver === driver);
  const flagged = (lap: number) => story.periods.some((p) => lap > Math.floor(p.start) && lap <= Math.ceil(p.end));
  const laps = series ? series.lap.map((lap, i) => ({ lap, time: series.time[i], compound: series.compound[i], pit: series.pitIn[i] || series.pitOut[i] })).filter((l) => l.time) : [];
  return (
    <Select size="small" value={laps.some((l) => l.lap === value) ? value : ''} onChange={(e) => onChange(Number(e.target.value))} sx={{ minWidth: 150 }} MenuProps={{ PaperProps: { sx: { maxHeight: 420 } } }}>
      {laps.map((l) => (
        <MenuItem key={l.lap} value={l.lap}>
          <Box component="span" sx={{ display: 'inline-block', width: 8, height: 8, borderRadius: '50%', bgcolor: tyreColors[l.compound ?? 'UNKNOWN'] ?? tyreColors.UNKNOWN, mr: 1 }} />
          Lap {l.lap} · {formatTime(l.time)}
          {fastest?.lap === l.lap && ' · fastest'}
          {l.pit && ' · pit'}
          {flagged(l.lap) && ' · SC/VSC'}
        </MenuItem>
      ))}
    </Select>
  );
}

// -- traces ----------------------------------------------------------------------------------

/** Speed trace values only inside zones (null elsewhere), to draw highlighted segments. */
function zoneTrace(x: number[], y: number[], zones: Zone[]) {
  return y.map((v, i) => (zones.some((z) => x[i] >= z.start - 1 && x[i] <= z.end + 1) ? v : null));
}

export function LapComparison({ story, la, lb }: { story: SessionStory; la: TelemetryLap; lb: TelemetryLap }) {
  const drivers = driverLookup(story);
  const da = drivers.get(la.driver)!;
  const db = drivers.get(lb.driver)!;
  const { a: colorA, b: colorB } = contrastColors(da, db);

  const computed = useMemo(() => {
    const length = lapLength(la, lb);
    const xa = alignedDistance(la, story.circuit, length);
    const xb = alignedDistance(lb, story.circuit, length);
    const grid: number[] = [];
    for (let d = 0; d <= length; d += 10) grid.push(d);
    const ta = lapTimeline(la, xa, length);
    const tb = lapTimeline(lb, xb, length);
    const delta = grid.map((d) => tb(d) - ta(d));
    return { length, xa, xb, grid, delta, ea: energyZones(la, xa), eb: energyZones(lb, xb) };
  }, [la, lb, story.circuit]);
  const { length, xa, xb, grid, delta, ea, eb } = computed;
  const corners = (story.circuit?.corners ?? []).filter((c) => c.distance !== null);
  const scale = story.circuit ? length / perimeterMeters(story.circuit) : 1;
  const nameA = `${da.code} L${la.lap}`;
  const nameB = `${db.code} L${lb.lap}`;

  return (
    <Box>
      <Plot
        filename={`${da.code}-L${la.lap}-vs-${db.code}-L${lb.lap}`}
        height={660}
        data={[
          { type: 'scatter', mode: 'lines', name: nameA, x: xa, y: la.speed, line: { color: colorA, width: 2 }, hovertemplate: `${nameA} %{y} km/h · gear %{customdata}<extra></extra>`, customdata: la.gear },
          { type: 'scatter', mode: 'lines', name: nameB, x: xb, y: lb.speed, line: { color: colorB, width: 2, dash: da.team === db.team && db.dashed ? 'dot' : 'solid' }, hovertemplate: `${nameB} %{y} km/h · gear %{customdata}<extra></extra>`, customdata: lb.gear },
          // energy zones drawn as wide translucent bands over each speed trace
          { type: 'scatter', mode: 'lines', name: 'Lift & coast', x: xa, y: zoneTrace(xa, la.speed, ea.liftAndCoast), line: { color: LIFT_COLOR, width: 9 }, opacity: 0.45, hoverinfo: 'skip', legendgroup: 'lift' },
          { type: 'scatter', mode: 'lines', x: xb, y: zoneTrace(xb, lb.speed, eb.liftAndCoast), line: { color: LIFT_COLOR, width: 9 }, opacity: 0.45, hoverinfo: 'skip', legendgroup: 'lift', showlegend: false },
          { type: 'scatter', mode: 'lines', name: 'Clipping', x: xa, y: zoneTrace(xa, la.speed, ea.clipping), line: { color: CLIP_COLOR, width: 9 }, opacity: 0.45, hoverinfo: 'skip', legendgroup: 'clip' },
          { type: 'scatter', mode: 'lines', x: xb, y: zoneTrace(xb, lb.speed, eb.clipping), line: { color: CLIP_COLOR, width: 9 }, opacity: 0.45, hoverinfo: 'skip', legendgroup: 'clip', showlegend: false },
          { type: 'scatter', mode: 'lines', x: grid, y: delta, yaxis: 'y2', line: { color: colors.text, width: 1.5 }, fill: 'tozeroy', fillcolor: 'rgba(236,236,241,0.08)', hovertemplate: `%{y:+.3f}s (${nameB} vs ${nameA})<extra></extra>`, showlegend: false },
          { type: 'scatter', mode: 'lines', x: xa, y: la.throttle, yaxis: 'y3', line: { color: colorA, width: 1.2 }, hovertemplate: `${nameA} throttle %{y}%<extra></extra>`, showlegend: false },
          { type: 'scatter', mode: 'lines', x: xb, y: lb.throttle, yaxis: 'y3', line: { color: colorB, width: 1.2 }, hovertemplate: `${nameB} throttle %{y}%<extra></extra>`, showlegend: false },
          { type: 'scatter', mode: 'lines', x: xa, y: la.brake.map((v) => v * 100), yaxis: 'y4', line: { color: colorA, width: 1.2, shape: 'hv' }, fill: 'tozeroy', hoverinfo: 'skip', showlegend: false },
          { type: 'scatter', mode: 'lines', x: xb, y: lb.brake.map((v) => -v * 100), yaxis: 'y4', line: { color: colorB, width: 1.2, shape: 'hv' }, fill: 'tozeroy', hoverinfo: 'skip', showlegend: false },
        ]}
        layout={{
          hovermode: 'x unified',
          xaxis: { title: 'Distance (m)', anchor: 'y4' },
          yaxis: { domain: [0.5, 1], title: 'Speed (km/h)' },
          yaxis2: { domain: [0.3, 0.46], title: 'Gap (s)', zeroline: true, zerolinecolor: colors.muted },
          yaxis3: { domain: [0.12, 0.27], title: 'Throttle', range: [0, 105] },
          yaxis4: { domain: [0, 0.09], title: 'Brake', showticklabels: false, range: [-110, 110] },
          legend: { orientation: 'h', y: 1.07, x: 0 },
          annotations: corners.map((c) => ({ x: c.distance! * scale, y: 1, yref: 'paper', text: c.label, showarrow: false, yanchor: 'bottom', font: { size: 9, color: colors.muted } })),
          margin: { l: 60, r: 16, t: 34, b: 40 },
        }}
      />
      <Typography variant="body2" sx={{ color: colors.muted }}>
        <b style={{ color: colorA }}>{nameA}</b> {formatTime(la.lapTime)}: {ea.liftSeconds}s lift-and-coast, {ea.clippingMeters} m clipping ·{' '}
        <b style={{ color: colorB }}>{nameB}</b> {formatTime(lb.lapTime)}: {eb.liftSeconds}s lift-and-coast, {eb.clippingMeters} m clipping. The gap panel is {nameB}'s time behind {nameA} at each point.
      </Typography>
    </Box>
  );
}

// -- corners ---------------------------------------------------------------------------------

/** Time gained or lost in each corner's section, plus the numbers behind it. */
export function CornerComparison({ story, la, lb }: { story: SessionStory; la: TelemetryLap; lb: TelemetryLap }) {
  const drivers = driverLookup(story);
  const da = drivers.get(la.driver)!;
  const db = drivers.get(lb.driver)!;
  const { a: colorA, b: colorB } = contrastColors(da, db);
  const rows = useMemo(() => {
    if (!story.circuit) return [];
    const length = lapLength(la, lb);
    const ca = cornerMetrics(la, story.circuit, length);
    const cb = cornerMetrics(lb, story.circuit, length);
    return ca.map((c, i) => ({ a: c, b: cb[i], gain: cb[i].sectionTime - c.sectionTime })).filter((r) => Number.isFinite(r.gain));
  }, [la, lb, story.circuit]);
  if (!rows.length) return null;
  const nameA = `${da.code} L${la.lap}`;
  const nameB = `${db.code} L${lb.lap}`;
  const brake = (v: number | null) => (v === null ? '–' : `${v} m`);

  return (
    <Box>
      <Plot
        filename={`${da.code}-vs-${db.code}-corners`}
        height={320}
        data={[
          {
            type: 'bar',
            x: rows.map((r) => `T${r.a.label}`),
            y: rows.map((r) => r.gain),
            marker: { color: rows.map((r) => (r.gain >= 0 ? colorA : colorB)) },
            customdata: rows.map((r) => [r.gain >= 0 ? nameA : nameB, Math.abs(r.gain).toFixed(3), r.a.minSpeed, r.b.minSpeed]),
            hovertemplate: '%{x}: %{customdata[0]} faster by %{customdata[1]}s<br>Min speed %{customdata[2]} vs %{customdata[3]} km/h<extra></extra>',
          },
        ]}
        layout={{
          yaxis: { title: `← ${nameB} faster · ${nameA} faster →`, zeroline: true, zerolinecolor: colors.muted, tickformat: '+.2f' },
          xaxis: { fixedrange: true },
          margin: { l: 70, r: 16, t: 10, b: 40 },
        }}
      />
      <Box sx={{ overflowX: 'auto' }}>
        <Table size="small" sx={{ '& td, & th': { borderColor: colors.border, whiteSpace: 'nowrap', fontVariantNumeric: 'tabular-nums', px: 1 } }}>
          <TableHead>
            <TableRow>
              <TableCell sx={{ color: colors.muted }}>Corner</TableCell>
              <TableCell sx={{ color: colors.muted }} colSpan={2} align="center">Braking (before apex)</TableCell>
              <TableCell sx={{ color: colors.muted }} colSpan={2} align="center">Minimum speed</TableCell>
              <TableCell sx={{ color: colors.muted }} colSpan={2} align="center">Exit speed</TableCell>
              <TableCell sx={{ color: colors.muted }} align="right">Time</TableCell>
            </TableRow>
            <TableRow>
              <TableCell />
              {[0, 1, 2].flatMap((k) => [
                <TableCell key={`a${k}`} align="right" sx={{ color: colorA, fontWeight: 700 }}>{da.code}</TableCell>,
                <TableCell key={`b${k}`} align="right" sx={{ color: colorB, fontWeight: 700 }}>{db.code}</TableCell>,
              ])}
              <TableCell />
            </TableRow>
          </TableHead>
          <TableBody>
            {rows.map((r) => {
              const better = (x: number, y: number, higher = true) => (x === y ? undefined : (higher ? x > y : x < y) ? 700 : undefined);
              return (
                <TableRow key={r.a.label} hover>
                  <TableCell>T{r.a.label}</TableCell>
                  <TableCell align="right">{brake(r.a.brakeBefore)}</TableCell>
                  <TableCell align="right">{brake(r.b.brakeBefore)}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: better(r.a.minSpeed, r.b.minSpeed) }}>{r.a.minSpeed}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: better(r.b.minSpeed, r.a.minSpeed) }}>{r.b.minSpeed}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: better(r.a.exitSpeed, r.b.exitSpeed) }}>{r.a.exitSpeed}</TableCell>
                  <TableCell align="right" sx={{ fontWeight: better(r.b.exitSpeed, r.a.exitSpeed) }}>{r.b.exitSpeed}</TableCell>
                  <TableCell align="right" sx={{ color: r.gain >= 0 ? colorA : colorB, fontWeight: 700 }}>
                    {r.gain >= 0 ? da.code : db.code} {Math.abs(r.gain).toFixed(3)}s
                  </TableCell>
                </TableRow>
              );
            })}
          </TableBody>
        </Table>
      </Box>
    </Box>
  );
}

// -- track map -------------------------------------------------------------------------------

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

/** Track map split into mini-sectors, coloured by who was faster in each. */
export function TrackDominance({ story, la, lb, sectors = 25 }: { story: SessionStory; la: TelemetryLap; lb: TelemetryLap; sectors?: number }) {
  const drivers = driverLookup(story);
  const da = drivers.get(la.driver)!;
  const db = drivers.get(lb.driver)!;
  const circuit = story.circuit;
  const fractions = useMemo(() => (circuit ? outlineFractions(circuit) : null), [circuit]);
  if (!circuit || !fractions) return null;

  const length = lapLength(la, lb);
  const xa = alignedDistance(la, circuit, length);
  const xb = alignedDistance(lb, circuit, length);
  const { a: colorA, b: colorB } = contrastColors(da, db);
  const timeA = lapTimeline(la, xa, length);
  const timeB = lapTimeline(lb, xb, length);
  let wonA = 0;
  const traces: any[] = trackTraces(circuit, { width: 14, corners: false });
  for (let k = 0; k < sectors; k++) {
    const d0 = (k / sectors) * length;
    const d1 = ((k + 1) / sectors) * length;
    const ta = timeA(d1) - timeA(d0);
    const tb = timeB(d1) - timeB(d0);
    const aFaster = ta <= tb;
    if (aFaster) wonA++;
    const idx = fractions.map((f, i) => [f, i] as const).filter(([f]) => f >= k / sectors && f <= (k + 1) / sectors).map(([, i]) => i).sort((p, q) => fractions[p] - fractions[q]);
    if (idx.length === 0) continue;
    const next = fractions.indexOf(Math.min(...fractions.filter((f) => f > (k + 1) / sectors)));
    if (next >= 0) idx.push(next); // join segments up
    traces.push({
      type: 'scatter',
      mode: 'lines',
      x: idx.map((i) => circuit.x[i]),
      y: idx.map((i) => circuit.y[i]),
      line: { color: aFaster ? colorA : colorB, width: 7 },
      hovertemplate: `Mini-sector ${k + 1}: ${aFaster ? da.code : db.code} faster by ${Math.abs(ta - tb).toFixed(3)}s<extra></extra>`,
      showlegend: false,
    });
  }
  traces.push(...trackTraces(circuit, { corners: true }).slice(1));
  return (
    <Box>
      <Plot filename={`${da.code}-vs-${db.code}-map`} height={420} data={traces} layout={trackLayout} />
      <Typography variant="body2" sx={{ color: colors.muted, textAlign: 'center' }}>
        <b style={{ color: colorA }}>{da.code} L{la.lap}</b> faster in {wonA} of {sectors} mini-sectors, <b style={{ color: colorB }}>{db.code} L{lb.lap}</b> in {sectors - wonA}
      </Typography>
    </Box>
  );
}

// -- field-wide ------------------------------------------------------------------------------

/** Every driver's minimum speed through each corner on their fastest lap. */
export function CornerSpeeds({ story, telemetry }: { story: SessionStory; telemetry: TelemetrySet }) {
  const { focused } = useFocus();
  const drivers = driverLookup(story);
  const data = useMemo(() => {
    if (!story.circuit || !telemetry.drivers.length) return [];
    const length = telemetry.drivers.reduce((a, l) => a + l.distance[l.distance.length - 1], 0) / telemetry.drivers.length;
    return telemetry.drivers.map((lap) => ({ lap, corners: cornerMetrics(lap, story.circuit!, length) }));
  }, [story.circuit, telemetry]);
  if (!data.length) return null;
  const labels = data[0].corners.map((c) => `T${c.label}`);
  return (
    <Plot
      filename="corner-speeds"
      height={420}
      data={data.map(({ lap, corners }) => {
        const d = drivers.get(lap.driver);
        return {
          type: 'scatter',
          mode: 'markers',
          name: d?.code,
          x: labels,
          y: corners.map((c) => c.minSpeed),
          marker: { color: d?.color, size: focused.has(lap.driver) ? 11 : 8, symbol: d?.dashed ? 'diamond' : 'circle', line: { color: colors.bg, width: 1 } },
          opacity: focusOpacity(focused, lap.driver, 0.18),
          hovertemplate: `${d?.code} %{x}: %{y} km/h<extra></extra>`,
        };
      })}
      layout={{ showlegend: false, yaxis: { title: 'Minimum speed (km/h)' }, xaxis: { fixedrange: true }, margin: { l: 60, r: 16, t: 10, b: 40 } }}
    />
  );
}

/** Top speed against average minimum corner speed: low drag vs high downforce. */
export function SetupScatter({ story, telemetry }: { story: SessionStory; telemetry: TelemetrySet }) {
  const { focused } = useFocus();
  const drivers = driverLookup(story);
  const points = useMemo(() => {
    if (!story.circuit || !telemetry.drivers.length) return [];
    const length = telemetry.drivers.reduce((a, l) => a + l.distance[l.distance.length - 1], 0) / telemetry.drivers.length;
    return telemetry.drivers.map((lap) => {
      const corners = cornerMetrics(lap, story.circuit!, length).filter((c) => Number.isFinite(c.minSpeed));
      return {
        driver: lap.driver,
        top: Math.max(...lap.speed),
        corner: corners.reduce((a, c) => a + c.minSpeed, 0) / (corners.length || 1),
      };
    });
  }, [story.circuit, telemetry]);
  if (!points.length) return null;
  return (
    <Plot
      filename="setup"
      height={420}
      data={[
        {
          type: 'scatter',
          mode: 'markers+text',
          x: points.map((p) => p.corner),
          y: points.map((p) => p.top),
          text: points.map((p) => drivers.get(p.driver)?.code),
          textposition: 'top center',
          textfont: { size: 10, color: colors.muted },
          marker: {
            size: 12,
            color: points.map((p) => drivers.get(p.driver)?.color),
            symbol: points.map((p) => (drivers.get(p.driver)?.dashed ? 'diamond' : 'circle')),
            opacity: points.map((p) => focusOpacity(focused, p.driver, 0.2)),
            line: { color: colors.bg, width: 1 },
          },
          customdata: points.map((p) => drivers.get(p.driver)?.team),
          hovertemplate: '%{text} (%{customdata})<br>Top speed %{y} km/h<br>Average corner minimum %{x:.1f} km/h<extra></extra>',
        },
      ]}
      layout={{
        xaxis: { title: 'Average minimum corner speed (km/h) → more downforce' },
        yaxis: { title: 'Top speed (km/h) → less drag' },
        margin: { l: 60, r: 16, t: 10, b: 50 },
      }}
    />
  );
}
