import { useState } from 'react';
import { ToggleButton, ToggleButtonGroup } from '@mui/material';
import Plot from '../components/Plot';
import { Panel } from '../components/ui';
import { cleanLaps, EnergySet, SessionStory } from '../lib/story';
import { focusOpacity, useFocus } from '../hooks';
import { colors } from '../theme';
import { driverLookup, lineDash, periodShapes, totalLaps } from './common';
import { CLIP_COLOR, LIFT_COLOR } from './headToHead';

type Metric = 'lift' | 'clip';

const label: Record<Metric, { title: string; unit: string; axis: string }> = {
  lift: { title: 'Lift-and-coast', unit: 's', axis: 'Lift-and-coast per lap (s)' },
  clip: { title: 'Clipping', unit: 'm', axis: 'Clipping per lap (m)' },
};

/** Per-driver averages over clean laps (no lap 1, pit laps or safety cars). */
export function energySummary(story: SessionStory, energy: EnergySet) {
  return energy.drivers
    .map((e) => {
      const series = story.laps.find((s) => s.driver === e.driver);
      const clean = new Set(series ? cleanLaps(story, series).map((l) => l.lap) : []);
      const idx = e.lap.map((_, i) => i).filter((i) => clean.has(e.lap[i]));
      const avg = (values: number[]) => (idx.length ? idx.reduce((a, i) => a + values[i], 0) / idx.length : 0);
      return { driver: e.driver, lift: avg(e.lift), clip: avg(e.clip), laps: idx.length };
    })
    .filter((r) => r.laps >= 5);
}

/** Centred rolling mean, so the trend shows through lap-to-lap noise. */
function rolling(values: number[], window: number): number[] {
  const half = Math.floor(window / 2);
  return values.map((_, i) => {
    const slice = values.slice(Math.max(0, i - half), i + half + 1);
    return slice.reduce((a, v) => a + v, 0) / slice.length;
  });
}

/** Lift-and-coast or clipping lap by lap, for highlighted drivers or the top 6. */
export function EnergyThroughRace({ story, energy }: { story: SessionStory; energy: EnergySet }) {
  const { focused } = useFocus();
  const [metric, setMetric] = useState<Metric>('lift');
  const drivers = driverLookup(story);
  const order = story.classification.map((r) => r.driver);
  const shown = focused.size ? energy.drivers.filter((e) => focused.has(e.driver)) : energy.drivers.filter((e) => order.indexOf(e.driver) >= 0 && order.indexOf(e.driver) < 6);
  return (
    <Panel
      title={`${label[metric].title}, lap by lap`}
      actions={
        <ToggleButtonGroup size="small" exclusive value={metric} onChange={(_, v) => v && setMetric(v)}>
          <ToggleButton value="lift">Lift-and-coast</ToggleButton>
          <ToggleButton value="clip">Clipping</ToggleButton>
        </ToggleButtonGroup>
      }
      caption={`Showing ${focused.size ? 'highlighted drivers' : 'the top six (highlight drivers above to change)'}. Lines are 5-lap averages, dots single laps. Estimated from car telemetry sampled about four times a second.`}
    >
      <Plot
        filename={`energy-${metric}`}
        height={400}
        data={shown.flatMap((e) => {
          const d = drivers.get(e.driver);
          const values = metric === 'lift' ? e.lift : e.clip;
          return [
            {
              type: 'scatter',
              mode: 'markers',
              x: e.lap,
              y: values,
              marker: { size: 4, color: d?.color },
              opacity: 0.35,
              hovertemplate: `${d?.code} lap %{x}: %{y}${label[metric].unit}<extra></extra>`,
              showlegend: false,
            },
            {
              type: 'scatter',
              mode: 'lines',
              name: d?.code,
              x: e.lap,
              y: rolling(values, 5),
              line: { color: d?.color, width: 2.5, dash: lineDash(d), shape: 'spline' },
              hovertemplate: `${d?.code} around lap %{x}: %{y:.${metric === 'lift' ? 1 : 0}f}${label[metric].unit} (5-lap average)<extra></extra>`,
            },
          ];
        })}
        layout={{
          shapes: periodShapes(story.periods),
          xaxis: { title: 'Lap', range: [1, totalLaps(story)] },
          yaxis: { title: label[metric].axis, rangemode: 'tozero' },
          legend: { orientation: 'h', y: 1.1, x: 0 },
          margin: { l: 60, r: 16, t: 30, b: 40 },
        }}
      />
    </Panel>
  );
}

/** Average lift-and-coast and clipping per clean lap, for every driver. */
export function EnergyAverages({ story, energy }: { story: SessionStory; energy: EnergySet }) {
  const { focused } = useFocus();
  const drivers = driverLookup(story);
  const rows = energySummary(story, energy).sort((a, b) => b.lift - a.lift);
  const codes = rows.map((r) => drivers.get(r.driver)?.code);
  return (
    <Plot
      filename="energy-averages"
      height={Math.max(360, rows.length * 22)}
      data={[
        {
          type: 'bar',
          orientation: 'h',
          name: 'Lift-and-coast (s per lap)',
          y: codes,
          x: rows.map((r) => r.lift),
          marker: { color: LIFT_COLOR, opacity: rows.map((r) => focusOpacity(focused, r.driver, 0.25)) },
          hovertemplate: '%{y}: %{x:.2f}s of lift-and-coast per lap<extra></extra>',
        },
        {
          type: 'bar',
          orientation: 'h',
          name: 'Clipping (m per lap)',
          y: codes,
          x: rows.map((r) => r.clip),
          xaxis: 'x2',
          marker: { color: CLIP_COLOR, opacity: rows.map((r) => focusOpacity(focused, r.driver, 0.25)) },
          hovertemplate: '%{y}: %{x:.0f} m of clipping per lap<extra></extra>',
        },
      ]}
      layout={{
        xaxis: { domain: [0, 0.47], title: 'Lift-and-coast (s per lap)' },
        xaxis2: { domain: [0.53, 1], title: 'Clipping (m per lap)', anchor: 'y' },
        yaxis: { autorange: 'reversed', fixedrange: true },
        showlegend: false,
        margin: { l: 50, r: 16, t: 10, b: 50 },
        annotations: [{ xref: 'paper', yref: 'paper', x: 1, y: 1.02, showarrow: false, text: 'Average per clean lap', font: { size: 11, color: colors.muted }, xanchor: 'right' }],
      }}
    />
  );
}
