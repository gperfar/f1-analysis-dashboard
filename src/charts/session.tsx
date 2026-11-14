import { Box, Table, TableBody, TableCell, TableHead, TableRow } from '@mui/material';
import Plot from '../components/Plot';
import { cleanLaps, SessionStory } from '../lib/story';
import { formatTime } from '../lib/narrative';
import { focusOpacity, useFocus } from '../hooks';
import { colors, tyreColors } from '../theme';
import { driverLookup, fmtSeconds } from './common';
import { DriverChip } from '../components/ui';

type Props = { story: SessionStory };

const bestQ = (q: (number | null)[] | null) => {
  const t = q?.filter((v): v is number => v !== null) ?? [];
  return t.length ? t[t.length - 1] : null;
};

/** Qualifying result with Q1/Q2/Q3 times; eliminated rows are dimmed. */
export function QualifyingTable({ story }: Props) {
  const { focused, toggle } = useFocus();
  const drivers = driverLookup(story);
  const rows = story.classification.filter((r) => r.position);
  const best = [0, 1, 2].map((i) => Math.min(...rows.map((r) => r.qTimes?.[i] ?? Infinity)));
  const pole = bestQ(rows[0]?.qTimes ?? null);
  return (
    <Box sx={{ overflowX: 'auto' }}>
      <Table size="small" sx={{ '& td, & th': { borderColor: colors.border, whiteSpace: 'nowrap' } }}>
        <TableHead>
          <TableRow>
            {['Pos', 'Driver', 'Team', 'Q1', 'Q2', 'Q3', 'Gap'].map((h) => (
              <TableCell key={h} sx={{ color: colors.muted, fontWeight: 600 }}>
                {h}
              </TableCell>
            ))}
          </TableRow>
        </TableHead>
        <TableBody>
          {rows.map((r) => {
            const d = drivers.get(r.driver);
            const reached = r.qTimes?.filter((v) => v !== null).length ?? 0;
            const t = bestQ(r.qTimes);
            return (
              <TableRow key={r.driver} hover sx={{ opacity: focusOpacity(focused, r.driver, 0.35) }}>
                <TableCell>{r.position}</TableCell>
                <TableCell>
                  <DriverChip driver={d} active={focused.has(r.driver)} onClick={() => toggle(r.driver)} /> {d?.name}
                </TableCell>
                <TableCell sx={{ color: colors.muted }}>{d?.team}</TableCell>
                {[0, 1, 2].map((i) => {
                  const v = r.qTimes?.[i] ?? null;
                  return (
                    <TableCell key={i} sx={{ fontVariantNumeric: 'tabular-nums', color: v === best[i] ? '#c77dff' : i >= reached ? colors.muted : colors.text, fontWeight: v === best[i] ? 700 : 400 }}>
                      {v ? formatTime(v) : '–'}
                    </TableCell>
                  );
                })}
                <TableCell sx={{ fontVariantNumeric: 'tabular-nums', color: colors.muted }}>{t && pole && t !== pole ? `+${(t - pole).toFixed(3)}` : ''}</TableCell>
              </TableRow>
            );
          })}
        </TableBody>
      </Table>
    </Box>
  );
}

/** Each driver's best qualifying lap vs pole, with the Q1/Q2 cut-off lines. */
export function GapToPole({ story }: Props) {
  const { focused } = useFocus();
  const drivers = driverLookup(story);
  const rows = story.classification.filter((r) => r.position && bestQ(r.qTimes));
  const pole = bestQ(rows[0]?.qTimes ?? null) ?? 0;
  const segmentOf = (r: (typeof rows)[number]) => r.qTimes?.filter((v) => v !== null).length ?? 0;
  const cuts: number[] = [];
  rows.forEach((r, i) => i > 0 && segmentOf(r) < segmentOf(rows[i - 1]) && cuts.push(i - 0.5));
  return (
    <Plot
      filename="gap-to-pole"
      height={Math.max(400, rows.length * 22)}
      data={[
        {
          type: 'bar',
          orientation: 'h',
          y: rows.map((r) => drivers.get(r.driver)?.code),
          x: rows.map((r) => bestQ(r.qTimes)! - pole),
          marker: { color: rows.map((r) => drivers.get(r.driver)?.color), opacity: rows.map((r) => focusOpacity(focused, r.driver, 0.25)) },
          text: rows.map((r, i) => (i === 0 ? formatTime(pole) : `+${(bestQ(r.qTimes)! - pole).toFixed(3)}`)),
          textposition: 'outside',
          customdata: rows.map((r) => `Q${segmentOf(r)}`),
          hovertemplate: '%{y}: +%{x:.3f}s (best lap set in %{customdata})<extra></extra>',
        },
      ]}
      layout={{
        yaxis: { autorange: 'reversed', fixedrange: true },
        xaxis: { title: 'Gap to pole (s)', rangemode: 'tozero' },
        shapes: cuts.map((y) => ({ type: 'line', xref: 'paper', x0: 0, x1: 1, y0: y, y1: y, line: { color: colors.accent, width: 1.5, dash: 'dash' } })),
        annotations: cuts.map((y, i) => ({ xref: 'paper', x: 1, y, text: cuts.length === 2 ? (i === 0 ? 'Q2 cut' : 'Q1 cut') : 'cut', showarrow: false, xanchor: 'right', yanchor: 'bottom', font: { size: 10, color: colors.accent } })),
        margin: { l: 50, r: 40, t: 10, b: 40 },
      }}
    />
  );
}

/** Ranking in each sector (who was quickest where), as a heatmap. */
export function SectorHeatmap({ story }: Props) {
  const drivers = driverLookup(story);
  const rows = story.bestSectors.filter((b) => b.sectors.every((v) => v !== null));
  const order = story.classification.map((r) => r.driver).filter((n) => rows.some((r) => r.driver === n));
  const ranks = [0, 1, 2].map((i) => {
    const sorted = [...rows].sort((a, b) => a.sectors[i]! - b.sectors[i]!);
    return new Map(sorted.map((r, k) => [r.driver, k + 1]));
  });
  const byDriver = new Map(rows.map((r) => [r.driver, r]));
  return (
    <Plot
      filename="sectors"
      height={Math.max(380, order.length * 22)}
      data={[
        {
          type: 'heatmap',
          x: ['Sector 1', 'Sector 2', 'Sector 3'],
          y: order.map((n) => drivers.get(n)?.code),
          z: order.map((n) => [0, 1, 2].map((i) => ranks[i].get(n))),
          text: order.map((n) => [0, 1, 2].map((i) => `${byDriver.get(n)!.sectors[i]!.toFixed(3)}  (P${ranks[i].get(n)})`)),
          texttemplate: '%{text}',
          textfont: { size: 11, color: colors.text },
          colorscale: [
            [0, '#7b2cbf'],
            [0.12, '#3a2f5c'],
            [1, '#1d1d24'],
          ],
          showscale: false,
          hovertemplate: '%{y} %{x}: %{text}<extra></extra>',
          xgap: 3,
          ygap: 3,
        },
      ]}
      layout={{ yaxis: { autorange: 'reversed', fixedrange: true }, xaxis: { side: 'top', fixedrange: true }, margin: { l: 50, r: 10, t: 30, b: 10 } }}
    />
  );
}

/** Best lap vs "ideal lap" (sum of best sectors): time left on the table. */
export function IdealLap({ story }: Props) {
  const drivers = driverLookup(story);
  const rows = story.classification
    .map((r) => {
      const ideal = story.bestSectors.find((b) => b.driver === r.driver)?.ideal;
      const fast = story.fastest.find((f) => f.driver === r.driver)?.time;
      return { driver: r.driver, ideal, fast, lost: ideal && fast ? fast - ideal : null };
    })
    .filter((r): r is { driver: number; ideal: number; fast: number; lost: number } => r.lost !== null)
    .sort((a, b) => a.ideal - b.ideal);
  return (
    <Plot
      filename="ideal-lap"
      height={Math.max(380, rows.length * 22)}
      data={[
        {
          type: 'bar',
          orientation: 'h',
          y: rows.map((r) => drivers.get(r.driver)?.code),
          x: rows.map((r) => r.lost),
          marker: { color: rows.map((r) => drivers.get(r.driver)?.color) },
          customdata: rows.map((r) => [fmtSeconds(r.fast), fmtSeconds(r.ideal)]),
          text: rows.map((r) => `${r.lost.toFixed(3)}s`),
          textposition: 'outside',
          hovertemplate: '%{y}: best lap %{customdata[0]}, ideal %{customdata[1]}<extra></extra>',
        },
      ]}
      layout={{ yaxis: { autorange: 'reversed', fixedrange: true, title: 'Ordered by ideal lap' }, xaxis: { title: 'Time left on the table (s)', rangemode: 'tozero' }, margin: { l: 60, r: 50, t: 10, b: 40 } }}
    />
  );
}

/** Every push lap through the session: shows track evolution and run plans. */
export function SessionTimeline({ story }: Props) {
  const { focused } = useFocus();
  const drivers = driverLookup(story);
  const best = story.fastest[0]?.time ?? 0;
  const traces = story.laps.map((s) => {
    const d = drivers.get(s.driver);
    const idx = s.lap.map((_, i) => i).filter((i) => s.time[i] && s.time[i]! < best * 1.07 && s.end[i] !== null);
    return {
      type: 'scatter',
      mode: 'markers',
      name: d?.code,
      x: idx.map((i) => s.end[i]! / 60),
      y: idx.map((i) => s.time[i]),
      marker: {
        size: 8,
        color: idx.map((i) => tyreColors[s.compound[i] ?? 'UNKNOWN'] ?? tyreColors.UNKNOWN),
        line: { color: d?.color, width: 2 },
      },
      opacity: focusOpacity(focused, s.driver),
      customdata: idx.map((i) => [s.lap[i], (s.compound[i] ?? '').toLowerCase(), fmtSeconds(s.time[i]!)]),
      hovertemplate: `${d?.code} lap %{customdata[0]}: %{customdata[2]} (%{customdata[1]})<extra></extra>`,
    };
  });
  return (
    <Plot
      filename="session-timeline"
      height={420}
      data={traces}
      layout={{ showlegend: false, xaxis: { title: 'Minutes into the session' }, yaxis: { title: 'Lap time (s)', tickformat: '.1f' }, margin: { l: 55, r: 16, t: 10, b: 40 } }}
    />
  );
}

/** Practice long runs: average clean lap time of stints of 5+ laps. */
export function LongRuns({ story }: Props) {
  const { focused } = useFocus();
  const drivers = driverLookup(story);
  const runs = story.laps.flatMap((s) => {
    const laps = cleanLaps(story, s);
    return story.stints
      .filter((st) => st.driver === s.driver)
      .map((st) => {
        const inStint = laps.filter((l) => l.lap >= st.from && l.lap <= st.to);
        return { driver: s.driver, compound: st.compound, laps: inStint.length, avg: inStint.reduce((a, l) => a + l.time, 0) / (inStint.length || 1) };
      })
      .filter((r) => r.laps >= 5);
  });
  const best = new Map<number, number>();
  runs.forEach((r) => best.set(r.driver, Math.min(best.get(r.driver) ?? Infinity, r.avg)));
  const order = [...best].sort((a, b) => a[1] - b[1]).map(([n]) => drivers.get(n)?.code);
  if (!runs.length) return null;
  return (
    <Plot
      filename="long-runs"
      height={Math.max(320, order.length * 26)}
      data={[
        {
          type: 'scatter',
          mode: 'markers',
          y: runs.map((r) => drivers.get(r.driver)?.code),
          x: runs.map((r) => r.avg),
          marker: {
            size: runs.map((r) => 8 + Math.min(r.laps, 20)),
            color: runs.map((r) => tyreColors[r.compound] ?? tyreColors.UNKNOWN),
            line: { color: runs.map((r) => drivers.get(r.driver)?.color), width: 2 },
            opacity: runs.map((r) => focusOpacity(focused, r.driver, 0.2)),
          },
          customdata: runs.map((r) => [r.laps, r.compound.toLowerCase(), fmtSeconds(r.avg)]),
          hovertemplate: '%{y}: %{customdata[2]} average over %{customdata[0]} laps (%{customdata[1]})<extra></extra>',
        },
      ]}
      layout={{ yaxis: { categoryorder: 'array', categoryarray: [...order].reverse(), fixedrange: true }, xaxis: { title: 'Average lap time (s)', tickformat: '.1f' }, margin: { l: 50, r: 16, t: 10, b: 40 } }}
    />
  );
}
