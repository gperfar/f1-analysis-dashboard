/**
 * Ghost laps: several laps replayed from the same start, with a camera that
 * follows one car (2D top-down or 3D chase cam), live gaps and a HUD.
 */
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { Box, Chip, IconButton, MenuItem, Select, Slider, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import ReplayIcon from '@mui/icons-material/Replay';
import type { SessionStory, TelemetrySet } from '../lib/story';
import { loadLapPositions, loadLapTelemetry } from '../lib/data';
import { GhostCar, GhostRace } from '../lib/ghost';
import { formatTime } from '../lib/narrative';
import { useAsync } from '../hooks';
import { colors } from '../theme';
import { driverLookup, fmtSeconds } from './common';
import { DriverChip, ErrorBox, Loading } from '../components/ui';
import { LapPicker } from './headToHead';
import FollowCam2D from './followCam2D';

const ChaseCam3D = lazy(() => import('./ChaseCam3D'));

const HEIGHT = 480;
const MAX_CARS = 8;

interface Selection {
  driver: number;
  lap: number;
}

/** Default laps: the five fastest (qualifying/practice) or the top five finishers' best laps (races). */
function defaultSelection(story: SessionStory): Selection[] {
  const best = new Map(story.fastest.map((f) => [f.driver, f.lap]));
  const order = story.meta.kind === 'race' ? story.classification.map((r) => r.driver) : story.fastest.map((f) => f.driver);
  return order.filter((n) => best.has(n)).slice(0, 5).map((n) => ({ driver: n, lap: best.get(n)! }));
}

export default function LapAnimation({ story, telemetry }: { story: SessionStory; telemetry: TelemetrySet | null }) {
  const drivers = driverLookup(story);
  const [selection, setSelection] = useState<Selection[]>(() => defaultSelection(story));
  const [followKey, setFollowKey] = useState<string>(() => {
    const first = defaultSelection(story)[0];
    return first ? `${first.driver}:${first.lap}` : '';
  });
  const [mode, setMode] = useState<'2d' | '3d'>('2d');
  const [viewMeters, setViewMeters] = useState(450);
  const [time, setTime] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [speed, setSpeed] = useState(1);

  const key = selection.map((s) => `${s.driver}:${s.lap}`).join(',');
  const loaded = useAsync(
    () =>
      Promise.all(
        selection.map(async (s) => {
          const [positions, tel] = await Promise.all([loadLapPositions(story, s.driver, s.lap), loadLapTelemetry(story, s.driver, s.lap, telemetry)]);
          const series = story.laps.find((x) => x.driver === s.driver);
          const lapTime = series?.time[series.lap.indexOf(s.lap)] ?? tel?.lapTime ?? null;
          const driver = drivers.get(s.driver);
          return positions && lapTime && driver ? ({ driver, lap: s.lap, lapTime, positions, telemetry: tel } as GhostCar) : null;
        })
      ),
    `${story.meta.sessionKey}:${key}:${!!telemetry}`
  );
  const cars = useMemo(() => (loaded.data ?? []).filter((c): c is GhostCar => c !== null), [loaded.data]);
  const race = useMemo(() => (cars.length && story.circuit ? new GhostRace(story, cars) : null), [cars, story]);
  const follow = cars.find((c) => `${c.driver.number}:${c.lap}` === followKey) ?? cars[0];
  const missing = (loaded.data ?? []).filter((c) => c === null).length;

  // Animation clock
  const last = useRef<number | null>(null);
  useEffect(() => {
    if (!playing || !race) return;
    let frame = 0;
    const tick = (now: number) => {
      const dt = last.current === null ? 0 : (now - last.current) / 1000;
      last.current = now;
      setTime((t) => {
        const next = t + dt * speed;
        if (next >= race.duration + 1) {
          setPlaying(false);
          return race.duration;
        }
        return next;
      });
      frame = requestAnimationFrame(tick);
    };
    frame = requestAnimationFrame(tick);
    return () => {
      cancelAnimationFrame(frame);
      last.current = null;
    };
  }, [playing, speed, race]);
  useEffect(() => setTime(0), [key]);

  const toggleDriver = (n: number) => {
    setSelection((current) => {
      if (current.some((s) => s.driver === n)) {
        const next = current.filter((s) => s.driver !== n);
        return next.length ? next : current;
      }
      if (current.length >= MAX_CARS) return current;
      const lap = story.fastest.find((f) => f.driver === n)?.lap;
      return lap ? [...current, { driver: n, lap }] : current;
    });
  };

  if (!story.circuit) return <ErrorBox message="No circuit layout for this session." />;

  const order = race ? race.order(time) : [];
  const me = race && follow ? race.state(follow, time) : null;

  return (
    <Box>
      {/* Drivers and laps */}
      <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.75, mb: 1.5 }}>
        {story.classification
          .map((r) => r.driver)
          .filter((n) => story.fastest.some((f) => f.driver === n))
          .map((n) => (
            <DriverChip key={n} driver={drivers.get(n)} active={selection.some((s) => s.driver === n)} onClick={() => toggleDriver(n)} />
          ))}
      </Stack>
      <Stack direction="row" spacing={1} sx={{ flexWrap: 'wrap', rowGap: 1, mb: 1.5 }}>
        {selection.map((s) => (
          <Stack key={s.driver} direction="row" spacing={0.5} alignItems="center">
            <Typography variant="body2" sx={{ fontWeight: 700, color: drivers.get(s.driver)?.color }}>
              {drivers.get(s.driver)?.code}
            </Typography>
            <LapPicker story={story} driver={s.driver} value={s.lap} onChange={(lap) => setSelection((cur) => cur.map((x) => (x.driver === s.driver ? { ...x, lap } : x)))} />
          </Stack>
        ))}
      </Stack>

      {/* Controls */}
      <Stack direction={{ xs: 'column', md: 'row' }} spacing={1.5} alignItems={{ md: 'center' }} sx={{ mb: 1 }}>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flex: 1 }}>
          <IconButton color="primary" disabled={!race} onClick={() => (race && time >= race.duration ? (setTime(0), setPlaying(true)) : setPlaying((p) => !p))}>
            {playing ? <PauseIcon /> : <PlayArrowIcon />}
          </IconButton>
          <IconButton size="small" disabled={!race} onClick={() => setTime(0)} aria-label="Restart">
            <ReplayIcon fontSize="small" />
          </IconButton>
          <Slider size="small" min={0} max={race?.duration ?? 1} step={0.05} value={time} onChange={(_, v) => setTime(v as number)} disabled={!race} sx={{ mx: 1 }} />
          <Typography variant="body2" sx={{ fontVariantNumeric: 'tabular-nums', minWidth: 70, color: colors.muted }}>
            {formatTime(Math.min(time, race?.duration ?? 0))}
          </Typography>
        </Stack>
        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1 }}>
          <ToggleButtonGroup size="small" exclusive value={speed} onChange={(_, v) => v && setSpeed(v)}>
            {[0.25, 0.5, 1, 2].map((s) => (
              <ToggleButton key={s} value={s}>
                {s}×
              </ToggleButton>
            ))}
          </ToggleButtonGroup>
          <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)}>
            <ToggleButton value="2d">2D</ToggleButton>
            <ToggleButton value="3d">3D</ToggleButton>
          </ToggleButtonGroup>
          {mode === '2d' && (
            <ToggleButtonGroup size="small" exclusive value={viewMeters} onChange={(_, v) => v && setViewMeters(v)}>
              <ToggleButton value={250}>Close</ToggleButton>
              <ToggleButton value={450}>Mid</ToggleButton>
              <ToggleButton value={1200}>Wide</ToggleButton>
            </ToggleButtonGroup>
          )}
          {cars.length > 1 && follow && (
            <Select size="small" value={`${follow.driver.number}:${follow.lap}`} onChange={(e) => setFollowKey(String(e.target.value))} sx={{ minWidth: 130 }}>
              {cars.map((c) => (
                <MenuItem key={`${c.driver.number}:${c.lap}`} value={`${c.driver.number}:${c.lap}`}>
                  Follow {c.driver.code} L{c.lap}
                </MenuItem>
              ))}
            </Select>
          )}
        </Stack>
      </Stack>

      {loaded.loading && <Loading label="Loading car positions…" minHeight={HEIGHT} />}
      {loaded.error && <ErrorBox message={loaded.error} />}
      {missing > 0 && !loaded.loading && <ErrorBox message={`No position data for ${missing} of the chosen laps.`} />}

      {race && follow && me && (
        <Box sx={{ position: 'relative' }}>
          {mode === '2d' ? (
            <FollowCam2D race={race} circuit={story.circuit} time={time} follow={follow} viewMeters={viewMeters} height={HEIGHT} />
          ) : (
            <Suspense fallback={<Loading label="Loading 3D view…" minHeight={HEIGHT} />}>
              <ChaseCam3D race={race} circuit={story.circuit} time={time} follow={follow} height={HEIGHT} />
            </Suspense>
          )}

          {/* HUD: followed car */}
          <Box sx={{ position: 'absolute', left: 12, bottom: 12, px: 1.5, py: 1, bgcolor: 'rgba(13,13,16,0.78)', borderRadius: 1.5, borderLeft: `4px solid ${follow.driver.color}`, pointerEvents: 'none' }}>
            <Typography variant="caption" sx={{ color: colors.muted }}>
              {follow.driver.name} · lap {follow.lap} · {formatTime(follow.lapTime)}
            </Typography>
            <Stack direction="row" spacing={2} alignItems="baseline">
              <Typography sx={{ fontSize: 34, fontWeight: 800, fontVariantNumeric: 'tabular-nums', lineHeight: 1 }}>
                {me.speed ?? '–'}
                <Typography component="span" sx={{ fontSize: 13, color: colors.muted, ml: 0.5 }}>
                  km/h
                </Typography>
              </Typography>
              <Typography sx={{ fontSize: 22, fontWeight: 700, color: colors.muted }}>{me.gear ? `G${me.gear}` : ''}</Typography>
            </Stack>
          </Box>

          {/* Tower: order and gaps to the followed lap */}
          <Box sx={{ position: 'absolute', left: 12, top: 12, py: 0.75, px: 1, bgcolor: 'rgba(13,13,16,0.78)', borderRadius: 1.5, minWidth: 150, pointerEvents: 'none' }}>
            {order.map((c, i) => {
              const gap = race.gap(follow, c, time);
              return (
                <Stack key={`${c.driver.number}:${c.lap}`} direction="row" spacing={1} alignItems="center" sx={{ fontVariantNumeric: 'tabular-nums' }}>
                  <Typography variant="caption" sx={{ width: 12, color: colors.muted }}>
                    {i + 1}
                  </Typography>
                  <Box sx={{ width: 3, height: 13, bgcolor: c.driver.color }} />
                  <Typography variant="caption" sx={{ fontWeight: c === follow ? 800 : 600, flex: 1 }}>
                    {c.driver.code}
                    {cars.filter((x) => x.driver.number === c.driver.number).length > 1 ? ` L${c.lap}` : ''}
                  </Typography>
                  <Typography variant="caption" sx={{ color: c === follow ? colors.text : gap !== null && gap < 0 ? '#69db7c' : colors.muted }}>
                    {c === follow ? (time >= c.lapTime ? fmtSeconds(c.lapTime) : 'ref') : gap === null ? '' : `${gap >= 0 ? '+' : ''}${gap.toFixed(2)}`}
                  </Typography>
                </Stack>
              );
            })}
          </Box>
        </Box>
      )}
      <Stack direction="row" spacing={1} sx={{ mt: 1, flexWrap: 'wrap', rowGap: 0.5 }}>
        <Typography variant="caption" sx={{ color: colors.muted }}>
          All laps start together. Gaps are measured at the same point on track against the car you follow. Positions come from OpenF1 location data (about 4 a second), smoothed between samples.
        </Typography>
        {selection.length >= MAX_CARS && <Chip size="small" label={`Up to ${MAX_CARS} laps`} variant="outlined" />}
      </Stack>
    </Box>
  );
}
