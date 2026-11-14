import { useEffect, useRef, useState } from 'react';
import { Box, IconButton, Slider, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import Plot from '../components/Plot';
import type { SessionStory } from '../lib/story';
import { interp } from '../lib/telemetryAnalysis';
import { loadReplay, ReplayTiming } from '../lib/data';
import { useAsync } from '../hooks';
import { colors } from '../theme';
import { driverLookup, fmtSeconds, trackLayout, trackTraces } from './common';
import { ErrorBox, Loading } from '../components/ui';
import { feedItems, FeedRow } from '../components/radio';

// -- replay ------------------------------------------------------------------------------

/** Animated car positions on the track map for one lap of the race. */
export function Replay({ story, goto }: { story: SessionStory; goto?: { lap: number; at: number } | null }) {
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
    if (!goto) return;
    const target = Math.min(Math.max(1, goto.lap), total);
    setLap(target);
    setPendingLap(target);
    setPlaying(false);
  }, [goto?.at]); // eslint-disable-line react-hooks/exhaustive-deps
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
      <LapEvents story={story} lap={lap} />
    </Box>
  );
}

/** Team radio and race control messages from the replayed lap. */
function LapEvents({ story, lap }: { story: SessionStory; lap: number }) {
  const items = feedItems(story).filter((item) => {
    if (item.t < 0) return false; // before lights out (OpenF1 labels pre-race messages lap 1)
    if (item.type === 'message') return item.lap === lap;
    return item.lap !== null && item.lap > lap - 1 && item.lap <= lap;
  });
  if (!items.length) return null;
  return (
    <Box sx={{ mt: 2 }}>
      <Typography variant="overline" sx={{ color: colors.muted }}>
        During lap {lap}
      </Typography>
      {items.map((item, i) => (
        <FeedRow key={i} story={story} item={item} />
      ))}
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
