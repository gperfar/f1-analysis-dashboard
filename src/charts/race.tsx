import { useMemo } from 'react';
import Plot from '../components/Plot';
import { cleanLaps, SessionStory } from '../lib/story';
import { focusOpacity, useFocus } from '../hooks';
import { colors, tyreColors } from '../theme';
import { driverLookup, fmtSeconds, lineDash, periodAnnotations, periodShapes, totalLaps } from './common';

type Props = { story: SessionStory };

/** Slope chart: grid slot on the left, finishing position on the right. */
export function GridToFlag({ story }: Props) {
  const { focused } = useFocus();
  const drivers = driverLookup(story);
  const rows = story.classification.filter((r) => r.grid && r.position);
  const n = Math.max(...rows.map((r) => Math.max(r.grid!, r.position!)), 20);
  const traces = rows.map((r) => {
    const d = drivers.get(r.driver);
    const gain = r.grid! - r.position!;
    return {
      type: 'scatter',
      mode: 'lines+markers+text',
      x: ['Grid', 'Finish'],
      y: [r.grid, r.position],
      text: [d?.code ?? '', `${d?.code ?? ''} ${gain > 0 ? `▲${gain}` : gain < 0 ? `▼${-gain}` : '='}`],
      textposition: ['middle left', 'middle right'],
      textfont: { size: 11, color: colors.text },
      line: { color: d?.color, width: 2.5, dash: lineDash(d) },
      marker: { size: 7, color: d?.color },
      opacity: focusOpacity(focused, r.driver),
      hovertemplate: `${d?.name}<br>P${r.grid} → P${r.position}<extra></extra>`,
      showlegend: false,
    };
  });
  return (
    <Plot
      data={traces}
      height={Math.max(420, n * 24)}
      filename="grid-to-flag"
      layout={{
        xaxis: { range: [-0.6, 1.6], fixedrange: true, showgrid: false },
        yaxis: { range: [n + 0.5, 0.5], dtick: 1, showgrid: false, fixedrange: true, title: 'Position' },
        margin: { l: 50, r: 30, t: 10, b: 30 },
      }}
    />
  );
}

/** Places gained or lost on the opening lap. */
export function LapOneChanges({ story }: Props) {
  const { focused } = useFocus();
  const drivers = driverLookup(story);
  const rows = story.start
    .filter((s) => s.grid && s.afterLap1)
    .map((s) => ({ ...s, gain: s.grid! - s.afterLap1! }))
    .sort((a, b) => b.gain - a.gain);
  return (
    <Plot
      filename="lap-1"
      height={Math.max(360, rows.length * 22)}
      data={[
        {
          type: 'bar',
          orientation: 'h',
          y: rows.map((r) => drivers.get(r.driver)?.code),
          x: rows.map((r) => r.gain),
          marker: { color: rows.map((r) => drivers.get(r.driver)?.color), opacity: rows.map((r) => focusOpacity(focused, r.driver, 0.25)) },
          text: rows.map((r) => (r.gain > 0 ? `+${r.gain}` : String(r.gain))),
          textposition: 'outside',
          customdata: rows.map((r) => [r.grid, r.afterLap1]),
          hovertemplate: '%{y}: P%{customdata[0]} → P%{customdata[1]}<extra></extra>',
        },
      ]}
      layout={{ yaxis: { autorange: 'reversed', fixedrange: true }, xaxis: { title: 'Places gained on lap 1', zeroline: true, fixedrange: true }, margin: { l: 50, r: 30, t: 10, b: 40 } }}
    />
  );
}

/** Launch: time from standstill to 100 and 200 km/h. */
export function LaunchChart({ story }: Props) {
  const drivers = driverLookup(story);
  const rows = story.start.filter((s) => s.timeTo100).sort((a, b) => a.timeTo100! - b.timeTo100!);
  const codes = rows.map((r) => drivers.get(r.driver)?.code);
  return (
    <Plot
      filename="launch"
      height={340}
      data={[
        { type: 'bar', name: '0–100 km/h', x: codes, y: rows.map((r) => r.timeTo100), marker: { color: rows.map((r) => drivers.get(r.driver)?.color) }, hovertemplate: '%{x}: %{y:.2f}s to 100 km/h<extra></extra>' },
        { type: 'scatter', mode: 'markers', name: '0–200 km/h', x: codes, y: rows.map((r) => (r.timeTo200 && r.timeTo200 < 12 ? r.timeTo200 : null)), yaxis: 'y2', marker: { color: colors.text, symbol: 'diamond', size: 8 }, hovertemplate: '%{x}: %{y:.2f}s to 200 km/h<extra></extra>' },
      ]}
      layout={{
        yaxis: { title: '0–100 km/h (s)', rangemode: 'tozero' },
        yaxis2: { title: '0–200 km/h (s)', overlaying: 'y', side: 'right', showgrid: false, tickfont: { color: colors.muted } },
        legend: { orientation: 'h', y: 1.12 },
        margin: { l: 50, r: 50, t: 30, b: 40 },
      }}
    />
  );
}

/** Gap to the leader after every lap, with SC/VSC/red flag bands and pit stops. */
export function GapToLeader({ story }: Props) {
  const { focused } = useFocus();
  const drivers = driverLookup(story);
  const order = story.classification.map((r) => r.driver);
  const series = [...story.laps].sort((a, b) => order.indexOf(a.driver) - order.indexOf(b.driver));
  const gaps = series.flatMap((s) => s.gap.filter((g): g is number => g !== null)).sort((a, b) => a - b);
  const cap = gaps.length ? Math.min(gaps[Math.floor(gaps.length * 0.9)] * 1.15, 150) : 60;

  const traces = series.flatMap((s) => {
    const d = drivers.get(s.driver);
    const opacity = focusOpacity(focused, s.driver);
    const pitIdx = s.lap.map((_, i) => i).filter((i) => s.pitIn[i]);
    return [
      {
        type: 'scatter',
        mode: 'lines',
        name: d?.code,
        x: s.lap,
        y: s.gap,
        line: { color: d?.color, width: focused.has(s.driver) ? 3 : 1.8, dash: lineDash(d) },
        opacity,
        hovertemplate: `${d?.code} lap %{x}: +%{y:.1f}s<extra></extra>`,
      },
      {
        type: 'scatter',
        mode: 'markers',
        x: pitIdx.map((i) => s.lap[i]),
        y: pitIdx.map((i) => s.gap[i]),
        marker: { color: colors.bg, size: 7, line: { color: d?.color, width: 2 } },
        opacity,
        hovertemplate: `${d?.code} pits on lap %{x}<extra></extra>`,
        showlegend: false,
      },
    ];
  });

  return (
    <Plot
      filename="gap-to-leader"
      height={480}
      data={traces}
      layout={{
        shapes: periodShapes(story.periods),
        annotations: periodAnnotations(story.periods),
        xaxis: { title: 'Lap', range: [1, totalLaps(story)] },
        yaxis: { title: 'Gap to leader (s)', autorange: false, range: [cap, -cap * 0.04] },
        showlegend: false,
        margin: { l: 55, r: 16, t: 24, b: 40 },
      }}
    />
  );
}

/** Running order lap by lap. */
export function PositionChart({ story }: Props) {
  const { focused } = useFocus();
  const drivers = driverLookup(story);
  const traces = story.laps.map((s) => {
    const d = drivers.get(s.driver);
    return {
      type: 'scatter',
      mode: 'lines',
      x: s.lap,
      y: s.position,
      line: { color: d?.color, width: focused.has(s.driver) ? 3.5 : 1.8, dash: lineDash(d) },
      opacity: focusOpacity(focused, s.driver),
      hovertemplate: `${d?.code} lap %{x}: P%{y}<extra></extra>`,
      showlegend: false,
    };
  });
  const ends = story.laps
    .map((s) => ({ x: s.lap[s.lap.length - 1], y: s.position[s.position.length - 1], code: drivers.get(s.driver)?.code }))
    .filter((e) => e.y);
  const n = story.drivers.length;
  return (
    <Plot
      filename="positions"
      height={Math.max(440, n * 22)}
      data={traces}
      layout={{
        shapes: periodShapes(story.periods),
        annotations: ends.map((e) => ({ x: e.x, y: e.y, text: e.code, xanchor: 'left', showarrow: false, xshift: 4, font: { size: 10, color: colors.muted } })),
        xaxis: { title: 'Lap', range: [1, totalLaps(story) + 3] },
        yaxis: { range: [n + 0.5, 0.5], dtick: 1, title: 'Position' },
        margin: { l: 50, r: 16, t: 10, b: 40 },
      }}
    />
  );
}

/** Tyre stints per driver, in finishing order, with pit stop times. */
export function TyreStrategy({ story }: Props) {
  const { focused } = useFocus();
  const drivers = driverLookup(story);
  const order = story.classification.map((r) => r.driver).filter((n) => story.stints.some((s) => s.driver === n));
  const compounds = [...new Set(story.stints.map((s) => s.compound))];
  const traces = compounds.map((compound) => {
    const stints = story.stints.filter((s) => s.compound === compound && order.includes(s.driver));
    return {
      type: 'bar',
      orientation: 'h',
      name: compound.charAt(0) + compound.slice(1).toLowerCase(),
      y: stints.map((s) => drivers.get(s.driver)?.code),
      base: stints.map((s) => s.from - 1),
      x: stints.map((s) => s.to - s.from + 1),
      marker: {
        color: tyreColors[compound] ?? tyreColors.UNKNOWN,
        opacity: stints.map((s) => focusOpacity(focused, s.driver, 0.25)),
        line: { color: colors.bg, width: 2 },
      },
      text: stints.map((s) => (s.to - s.from >= 3 ? `${s.to - s.from + 1}${s.ageAtStart ? ` (+${s.ageAtStart})` : ''}` : '')),
      textposition: 'inside',
      insidetextanchor: 'middle',
      textfont: { color: '#111', size: 10 },
      customdata: stints.map((s) => [s.from, s.to, s.ageAtStart]),
      hovertemplate: `%{y} · ${compound.toLowerCase()}<br>Laps %{customdata[0]}–%{customdata[1]}, tyres %{customdata[2]} laps old at start<extra></extra>`,
    };
  });
  const stops = story.pits.filter((p) => order.includes(p.driver));
  traces.push({
    type: 'scatter',
    mode: 'markers',
    name: 'Pit stop',
    y: stops.map((p) => drivers.get(p.driver)?.code),
    x: stops.map((p) => p.lap - 0.5),
    marker: { symbol: 'line-ns', size: 18, line: { color: colors.bg, width: 3 } },
    customdata: stops.map((p) => [p.lap, p.stop ?? '–', p.lane ?? '–']),
    hovertemplate: '%{y} pit stop, lap %{customdata[0]}<br>Stationary %{customdata[1]}s · pit lane %{customdata[2]}s<extra></extra>',
    showlegend: false,
  } as any);
  return (
    <Plot
      filename="tyre-strategy"
      height={Math.max(420, order.length * 24 + 80)}
      data={traces}
      layout={{
        barmode: 'overlay',
        yaxis: { autorange: 'reversed', categoryorder: 'array', categoryarray: order.map((n) => drivers.get(n)?.code), fixedrange: true },
        xaxis: { title: 'Lap', range: [0, totalLaps(story) + 1] },
        legend: { orientation: 'h', y: 1.06, x: 0 },
        margin: { l: 50, r: 16, t: 30, b: 40 },
      }}
    />
  );
}

/** Stationary time of every pit stop, fastest first. */
export function PitStops({ story }: Props) {
  const drivers = driverLookup(story);
  const stops = story.pits.filter((p) => p.stop && p.stop > 1.5 && p.stop < 15).sort((a, b) => a.stop! - b.stop!).slice(0, 30);
  return (
    <Plot
      filename="pit-stops"
      height={360}
      data={[
        {
          type: 'bar',
          x: stops.map((p, i) => `${drivers.get(p.driver)?.code} L${p.lap}${' '.repeat(i % 2)}`),
          y: stops.map((p) => p.stop),
          marker: { color: stops.map((p) => drivers.get(p.driver)?.color) },
          customdata: stops.map((p) => [drivers.get(p.driver)?.team, p.lane]),
          hovertemplate: '%{x}<br>%{customdata[0]}<br>Stationary %{y:.1f}s · pit lane %{customdata[1]:.1f}s<extra></extra>',
        },
      ]}
      layout={{ yaxis: { title: 'Stationary time (s)', rangemode: 'tozero' }, xaxis: { tickangle: -45, fixedrange: true }, margin: { l: 55, r: 16, t: 10, b: 80 } }}
    />
  );
}

/** Distribution of clean race laps per driver. */
export function PaceDistribution({ story }: Props) {
  const { focused } = useFocus();
  const drivers = driverLookup(story);
  const order = story.classification.map((r) => r.driver);
  const series = [...story.laps].sort((a, b) => order.indexOf(a.driver) - order.indexOf(b.driver));
  const traces = series
    .map((s) => ({ s, laps: cleanLaps(story, s) }))
    .filter(({ laps }) => laps.length >= 5)
    .map(({ s, laps }) => {
      const d = drivers.get(s.driver);
      return {
        type: 'box',
        name: d?.code,
        y: laps.map((l) => l.time),
        marker: { color: d?.color, size: 3 },
        line: { color: d?.color, width: 1.5 },
        fillcolor: `${d?.color}55`,
        boxpoints: 'outliers',
        opacity: focusOpacity(focused, s.driver, 0.2),
        hoverinfo: 'y',
      };
    });
  return (
    <Plot
      filename="race-pace"
      height={420}
      data={traces}
      layout={{ showlegend: false, yaxis: { title: 'Lap time (s)', tickformat: '.1f' }, xaxis: { fixedrange: true }, margin: { l: 55, r: 16, t: 10, b: 40 } }}
    />
  );
}

/** Lap times through each stint for selected drivers, with the trend per stint. */
export function StintPace({ story, drivers: selected }: Props & { drivers: number[] }) {
  const drivers = driverLookup(story);
  const traces = useMemo(() => {
    const out: any[] = [];
    for (const n of selected) {
      const s = story.laps.find((x) => x.driver === n);
      const d = drivers.get(n);
      if (!s || !d) continue;
      const laps = cleanLaps(story, s);
      out.push({
        type: 'scatter',
        mode: 'markers',
        name: d.code,
        x: laps.map((l) => l.lap),
        y: laps.map((l) => l.time),
        marker: { color: laps.map((l) => tyreColors[l.compound ?? 'UNKNOWN'] ?? tyreColors.UNKNOWN), size: 7, line: { color: d.color, width: 2 } },
        hovertemplate: `${d.code} lap %{x}: %{y:.3f}s<extra></extra>`,
      });
      // trend line per stint (least squares)
      for (const stint of story.stints.filter((x) => x.driver === n)) {
        const pts = laps.filter((l) => l.lap >= stint.from && l.lap <= stint.to);
        if (pts.length < 4) continue;
        const mx = pts.reduce((a, p) => a + p.lap, 0) / pts.length;
        const my = pts.reduce((a, p) => a + p.time, 0) / pts.length;
        const slope = pts.reduce((a, p) => a + (p.lap - mx) * (p.time - my), 0) / pts.reduce((a, p) => a + (p.lap - mx) ** 2, 0);
        const x0 = pts[0].lap;
        const x1 = pts[pts.length - 1].lap;
        out.push({
          type: 'scatter',
          mode: 'lines',
          x: [x0, x1],
          y: [my + slope * (x0 - mx), my + slope * (x1 - mx)],
          line: { color: d.color, width: 2.5, dash: d.dashed ? 'dot' : 'solid' },
          hovertemplate: `${d.code} ${stint.compound.toLowerCase()} stint: ${slope >= 0 ? '+' : ''}${slope.toFixed(3)}s per lap<extra></extra>`,
          showlegend: false,
        });
      }
    }
    return out;
  }, [story, selected.join(',')]);
  return (
    <Plot
      filename="stint-pace"
      height={420}
      data={traces}
      layout={{
        shapes: periodShapes(story.periods),
        xaxis: { title: 'Lap', range: [1, totalLaps(story)] },
        yaxis: { title: 'Lap time (s)', tickformat: '.1f' },
        legend: { orientation: 'h', y: 1.08, x: 0 },
        margin: { l: 55, r: 16, t: 30, b: 40 },
      }}
    />
  );
}

/** Gap of every driver's fastest lap to the fastest overall. */
export function FastestLapGaps({ story }: Props) {
  const { focused } = useFocus();
  const drivers = driverLookup(story);
  const best = story.fastest[0]?.time ?? 0;
  const rows = story.fastest;
  return (
    <Plot
      filename="fastest-laps"
      height={Math.max(380, rows.length * 22)}
      data={[
        {
          type: 'bar',
          orientation: 'h',
          y: rows.map((r) => drivers.get(r.driver)?.code),
          x: rows.map((r) => r.time - best),
          marker: { color: rows.map((r) => drivers.get(r.driver)?.color), opacity: rows.map((r) => focusOpacity(focused, r.driver, 0.25)) },
          text: rows.map((r, i) => (i === 0 ? fmtSeconds(r.time) : `+${(r.time - best).toFixed(3)}`)),
          textposition: 'outside',
          customdata: rows.map((r) => [fmtSeconds(r.time), r.lap, (r.compound ?? '').toLowerCase()]),
          hovertemplate: '%{y}: %{customdata[0]} (lap %{customdata[1]}, %{customdata[2]})<extra></extra>',
        },
      ]}
      layout={{ yaxis: { autorange: 'reversed', fixedrange: true }, xaxis: { title: 'Gap to fastest lap (s)', rangemode: 'tozero' }, margin: { l: 50, r: 40, t: 10, b: 40 } }}
    />
  );
}

/** Championship points before and after this session. */
export function ChampionshipImpact({ story }: Props) {
  const drivers = driverLookup(story);
  const rows = story.standings.drivers
    .filter((r) => r.positionAfter && r.positionAfter <= 12 && r.driver)
    .sort((a, b) => a.positionAfter! - b.positionAfter!);
  const label = (r: (typeof rows)[number]) => {
    const d = drivers.get(r.driver!);
    const move = (r.positionBefore ?? 0) - (r.positionAfter ?? 0);
    return `${r.positionAfter}. ${d?.code ?? r.driver}${move > 0 ? ` ▲${move}` : move < 0 ? ` ▼${-move}` : ''}`;
  };
  return (
    <Plot
      filename="championship"
      height={Math.max(320, rows.length * 28)}
      data={[
        {
          type: 'bar',
          orientation: 'h',
          name: 'Before',
          y: rows.map(label),
          x: rows.map((r) => r.pointsBefore),
          marker: { color: rows.map((r) => `${drivers.get(r.driver!)?.color ?? '#888888'}88`) },
          hovertemplate: '%{y}: %{x} pts before<extra></extra>',
        },
        {
          type: 'bar',
          orientation: 'h',
          name: 'Scored here',
          y: rows.map(label),
          x: rows.map((r) => (r.pointsAfter ?? 0) - (r.pointsBefore ?? 0)),
          marker: { color: rows.map((r) => drivers.get(r.driver!)?.color ?? '#888888') },
          text: rows.map((r) => `${r.pointsAfter} pts`),
          textposition: 'outside',
          hovertemplate: '%{y}: +%{x} pts<extra></extra>',
        },
      ]}
      layout={{ barmode: 'stack', yaxis: { autorange: 'reversed', fixedrange: true }, xaxis: { title: 'Points', fixedrange: true }, legend: { orientation: 'h', y: 1.1, x: 0 }, margin: { l: 90, r: 60, t: 30, b: 40 } }}
    />
  );
}
