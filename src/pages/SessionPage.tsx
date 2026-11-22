import { ReactNode, useEffect, useRef, useState } from 'react';
import { Box, Button, Chip, Container, Link, Paper, Stack, Typography } from '@mui/material';
import { Chapter, contrastText, DriverChip, ErrorBox, Loading, Panel } from '../components/ui';
import { loadEnergy, loadLapTelemetry, loadStory, loadTelemetry } from '../lib/data';
import { cleanLaps, EnergySet, SessionStory } from '../lib/story';
import { formatTime, onTrackOvertakes } from '../lib/narrative';
import { FocusContext, useAsync, useFocus, useFocusState } from '../hooks';
import { colors } from '../theme';
import { driverLookup } from '../charts/common';
import { ChampionshipImpact, FastestLapGaps, GapToLeader, GridToFlag, LapOneChanges, LaunchChart, PaceDistribution, PitStops, PositionChart, StintPace, TyreStrategy } from '../charts/race';
import { GapToPole, IdealLap, LongRuns, QualifyingTable, SectorHeatmap, SessionTimeline } from '../charts/session';
import { Replay } from '../charts/telemetry';
import { CornerComparison, CornerSpeeds, DriverPicker, LapComparison, LapPicker, SetupScatter, TrackDominance } from '../charts/headToHead';
import { EnergyAverages, energySummary, EnergyThroughRace } from '../charts/energy';
import { RadioFeed, RadioProvider } from '../components/radio';
import KeyMoments from '../components/KeyMoments';
import LapAnimation from '../charts/lapAnimation';
import Highlights from '../components/Highlights';
import Press from '../components/Press';

export default function SessionPage({ year, round, code }: { year: number; round: number; code: string }) {
  const story = useAsync(() => loadStory(year, round, code), `${year}/${round}/${code}`);
  const focus = useFocusState();
  useEffect(() => focus.clear(), [year, round, code]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => {
    if (story.data) document.title = `${story.data.meta.event} ${story.data.meta.year} · ${story.data.meta.name} · F1 Analysis`;
  }, [story.data]);

  return (
    <FocusContext.Provider value={focus}>
      <RadioProvider>
        <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
          {story.loading && <Loading label="Building the story…" minHeight={400} />}
          {story.error && <ErrorBox message={story.error} />}
          {story.data && <Story story={story.data} />}
        </Container>
      </RadioProvider>
    </FocusContext.Provider>
  );
}

function Story({ story }: { story: SessionStory }) {
  const kind = story.meta.kind;
  const { year, round, code } = story.meta;
  // Energy analysis only exists once the data build has processed the session.
  const energy = useAsync(() => (kind === 'race' ? loadEnergy(year, round, code) : Promise.resolve(null)), `energy:${year}/${round}/${code}`);
  const chapters = kind === 'race' ? raceChapters(story, energy.data) : kind === 'qualifying' ? qualifyingChapters(story) : practiceChapters(story);
  return (
    <>
      <Hero story={story} chapters={chapters.map((c) => ({ id: c.id, title: c.title }))} />
      <DriverBar story={story} />
      {chapters.map((c, i) => (
        <Chapter key={c.id} id={c.id} index={i + 1} title={c.title} takeaway={c.takeaway}>
          {c.content}
        </Chapter>
      ))}
      <Typography variant="body2" sx={{ color: colors.muted, mt: 8, textAlign: 'center' }}>
        Data: <Link href="https://openf1.org" color="inherit">OpenF1</Link> · track layouts: MultiViewer. Unofficial; not associated with Formula 1.
      </Typography>
    </>
  );
}

interface ChapterDef {
  id: string;
  title: string;
  takeaway?: ReactNode;
  content: ReactNode;
}

// -- header ------------------------------------------------------------------------------

function Hero({ story, chapters }: { story: SessionStory; chapters: { id: string; title: string }[] }) {
  const drivers = driverLookup(story);
  const { meta } = story;
  const date = meta.dateStart ? new Date(meta.dateStart).toLocaleDateString(undefined, { day: 'numeric', month: 'long', year: 'numeric' }) : '';
  return (
    <Box>
      <Typography variant="overline" sx={{ color: colors.accent }}>
        Round {meta.round} · {meta.name} · {date}
      </Typography>
      <Typography variant="h2" component="h1" sx={{ fontSize: { xs: 36, md: 56 }, lineHeight: 1.05, mb: 1 }}>
        {meta.event}
      </Typography>
      <Stack direction="row" spacing={1} sx={{ mb: 3, flexWrap: 'wrap', rowGap: 1 }}>
        <Chip size="small" label={meta.location} variant="outlined" />
        {meta.totalLaps > 0 && meta.kind === 'race' && <Chip size="small" label={`${meta.totalLaps} laps`} variant="outlined" />}
        {meta.weather?.air != null && <Chip size="small" label={`Air ${meta.weather.air}°C · track ${meta.weather.track}°C`} variant="outlined" />}
        {meta.weather?.rain && <Chip size="small" label="Rain" color="info" variant="outlined" />}
      </Stack>

      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr 1fr', md: `repeat(${Math.min(story.headlines.length, 4)}, 1fr)` }, gap: 1.5 }}>
        {story.headlines.map((h) => {
          const d = h.driver != null ? drivers.get(h.driver) : undefined;
          return (
            <Paper key={h.label} sx={{ p: 2, borderLeft: `4px solid ${d?.color ?? colors.border}` }}>
              <Typography variant="overline" sx={{ color: colors.muted, lineHeight: 1.4, display: 'block' }}>
                {h.label}
              </Typography>
              <Typography variant="h5" sx={{ fontSize: { xs: 18, md: 22 }, lineHeight: 1.2, my: 0.5 }}>
                {h.value}
              </Typography>
              <Typography variant="body2" sx={{ color: colors.muted }}>
                {h.detail}
              </Typography>
            </Paper>
          );
        })}
      </Box>

      <Box sx={{ mt: 3, maxWidth: 860 }}>
        {story.aiSummary ? (
          <>
            <Typography sx={{ fontSize: 19, lineHeight: 1.6 }}>{story.aiSummary}</Typography>
            <Typography variant="caption" sx={{ color: colors.muted }}>
              Recap written by Claude from the session data.
            </Typography>
          </>
        ) : (
          <Typography sx={{ fontSize: 19, lineHeight: 1.6 }}>{story.summary.join(' ')}</Typography>
        )}
      </Box>

      <KeyMoments story={story} />
      <Highlights story={story} />
      <Press story={story} />

      <Stack direction="row" spacing={1} sx={{ mt: 3, flexWrap: 'wrap', rowGap: 1 }}>
        {chapters.map((c, i) => (
          <Button key={c.id} href={`#${c.id}`} onClick={(e) => { e.preventDefault(); document.getElementById(c.id)?.scrollIntoView({ behavior: 'smooth' }); }} size="small" color="inherit" sx={{ color: colors.muted }}>
            {String(i + 1).padStart(2, '0')} {c.title}
          </Button>
        ))}
      </Stack>
    </Box>
  );
}

/** Sticky row of driver chips: click to highlight drivers in every chart. */
function DriverBar({ story }: { story: SessionStory }) {
  const { focused, toggle, clear } = useFocus();
  const drivers = driverLookup(story);
  const order = story.classification.map((r) => r.driver).filter((n) => drivers.has(n));
  return (
    <Paper sx={{ position: 'sticky', top: { xs: 104, md: 64 }, zIndex: 5, mt: 3, px: 1.5, py: 1, bgcolor: 'rgba(22,22,27,0.92)', backdropFilter: 'blur(8px)' }}>
      <Stack direction="row" spacing={0.75} alignItems="center" sx={{ overflowX: 'auto', '&::-webkit-scrollbar': { display: 'none' } }}>
        <Typography variant="caption" sx={{ color: colors.muted, whiteSpace: 'nowrap', mr: 0.5 }}>
          Highlight:
        </Typography>
        {order.map((n) => (
          <DriverChip key={n} driver={drivers.get(n)} active={focused.has(n)} onClick={() => toggle(n)} />
        ))}
        {focused.size > 0 && (
          <Chip size="small" label="Clear" onClick={clear} variant="outlined" sx={{ ml: 1 }} />
        )}
      </Stack>
    </Paper>
  );
}

// -- telemetry chapter (loads when scrolled into view) -----------------------------------

function useInView<T extends Element>(): [React.RefObject<T>, boolean] {
  const ref = useRef<T>(null);
  const [seen, setSeen] = useState(false);
  useEffect(() => {
    if (!ref.current || seen) return;
    const observer = new IntersectionObserver(([entry]) => entry.isIntersecting && setSeen(true), { rootMargin: '300px' });
    observer.observe(ref.current);
    return () => observer.disconnect();
  }, [seen]);
  return [ref, seen];
}

const never = () => new Promise<never>(() => {});

function HeadToHeadChapter({ story, defaults }: { story: SessionStory; defaults: [number, number] }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const fastestLap = (n: number) => story.fastest.find((f) => f.driver === n)?.lap ?? story.laps.find((s) => s.driver === n)?.lap[0] ?? 1;
  const [a, setA] = useState(defaults[0]);
  const [b, setB] = useState(defaults[1]);
  const [lapA, setLapA] = useState(() => fastestLap(defaults[0]));
  const [lapB, setLapB] = useState(() => fastestLap(defaults[1]));
  const { year, round, code } = story.meta;
  const telemetry = useAsync(() => (seen ? loadTelemetry(year, round, code) : never()), `${story.meta.sessionKey}:${seen}`);
  // Any lap other than the fastest is fetched on demand (one small request).
  const ready = !!telemetry.data || !!telemetry.error;
  const pair = useAsync(
    () => (ready ? Promise.all([loadLapTelemetry(story, a, lapA, telemetry.data), loadLapTelemetry(story, b, lapB, telemetry.data)]) : never()),
    `${a}:${lapA}:${b}:${lapB}:${ready}`
  );
  const [la, lb] = pair.data ?? [null, null];

  return (
    <div ref={ref}>
      <Panel
        title="Two laps, compared"
        actions={
          <Stack direction={{ xs: 'column', md: 'row' }} spacing={1} alignItems={{ md: 'center' }}>
            <Stack direction="row" spacing={0.5}>
              <DriverPicker story={story} value={a} onChange={(n) => { setA(n); setLapA(fastestLap(n)); }} exclude={b} />
              <LapPicker story={story} driver={a} value={lapA} onChange={setLapA} />
            </Stack>
            <Typography sx={{ color: colors.muted, textAlign: 'center' }}>vs</Typography>
            <Stack direction="row" spacing={0.5}>
              <DriverPicker story={story} value={b} onChange={(n) => { setB(n); setLapB(fastestLap(n)); }} exclude={a} />
              <LapPicker story={story} driver={b} value={lapB} onChange={setLapB} />
            </Stack>
          </Stack>
        }
        caption="Pick any two laps, including two laps of the same driver (e.g. early and late in a stint). Blue bands mark lift-and-coast, orange bands clipping (losing speed at full throttle when the battery stops deploying)."
      >
        {(telemetry.loading || pair.loading) && <Loading label="Loading car telemetry…" minHeight={420} />}
        {pair.error && <ErrorBox message={pair.error} />}
        {pair.data && (!la || !lb) && <ErrorBox message="No telemetry for one of these laps." />}
        {la && lb && <LapComparison story={story} la={la} lb={lb} />}
      </Panel>
      {la && lb && story.circuit && (
        <>
          <Panel title="Where the time went, corner by corner" caption="Each corner's section runs from halfway after the previous corner to halfway before the next. Braking point is how far before the slowest point the driver hit the brakes.">
            <CornerComparison story={story} la={la} lb={lb} />
          </Panel>
          <Panel title="Who was faster where" caption="The lap split into 25 equal mini-sectors, coloured by the quicker lap.">
            <TrackDominance story={story} la={la} lb={lb} />
          </Panel>
        </>
      )}
    </div>
  );
}

/** Ghost laps with a follow camera; telemetry (speed, gear, gaps) loads with it. */
function LapAnimationChapter({ story }: { story: SessionStory }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const { year, round, code } = story.meta;
  const telemetry = useAsync(() => (seen ? loadTelemetry(year, round, code) : never()), `${story.meta.sessionKey}:${seen}`);
  const ready = !!telemetry.data || !!telemetry.error;
  return (
    <div ref={ref}>
      <Panel>{seen && ready ? <LapAnimation story={story} telemetry={telemetry.data} /> : <Loading label="Loading car telemetry…" minHeight={480} />}</Panel>
    </div>
  );
}

/** Field-wide view of the fastest laps: corner speeds and the drag/downforce trade-off. */
function CornersChapter({ story }: { story: SessionStory }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  const { year, round, code } = story.meta;
  const telemetry = useAsync(() => (seen ? loadTelemetry(year, round, code) : never()), `${story.meta.sessionKey}:${seen}`);
  return (
    <div ref={ref}>
      {telemetry.loading && <Loading label="Loading car telemetry…" minHeight={300} />}
      {telemetry.error && <ErrorBox message={telemetry.error} />}
      {telemetry.data && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' }, gap: 2 }}>
          <Panel title="Minimum speed in every corner" caption="Each dot is a driver's fastest lap. Highlight drivers above to compare them.">
            <CornerSpeeds story={story} telemetry={telemetry.data} />
          </Panel>
          <Panel title="Downforce or top speed?" caption="Cars to the right carry more speed through corners (more downforce); cars higher up are faster on the straights (less drag).">
            <SetupScatter story={story} telemetry={telemetry.data} />
          </Panel>
        </Box>
      )}
    </div>
  );
}

function ReplayChapter({ story }: { story: SessionStory }) {
  const [ref, seen] = useInView<HTMLDivElement>();
  // Key moments ask for a lap with a "replay:goto" event; it may arrive before the replay has mounted.
  const [goto, setGoto] = useState<{ lap: number; at: number } | null>(null);
  useEffect(() => {
    const onGoto = (e: Event) => setGoto({ lap: (e as CustomEvent).detail.lap, at: Date.now() });
    window.addEventListener('replay:goto', onGoto);
    return () => window.removeEventListener('replay:goto', onGoto);
  }, []);
  return (
    <div ref={ref}>
      <Panel caption="Car positions on track for the chosen lap of the leader. Drag to a lap, then press play.">
        {seen || goto ? <Replay story={story} goto={goto} /> : <Box sx={{ height: 460 }} />}
      </Panel>
    </div>
  );
}

// -- race ------------------------------------------------------------------------------

function raceChapters(story: SessionStory, energy: EnergySet | null): ChapterDef[] {
  const drivers = driverLookup(story);
  const code = (n?: number) => (n == null ? '' : drivers.get(n)?.code ?? String(n));
  const finishers = story.classification.filter((r) => r.position);
  const [p1, p2] = finishers;

  // Laps led
  const led = new Map<number, number>();
  story.laps.forEach((s) => s.position.forEach((p) => p === 1 && led.set(s.driver, (led.get(s.driver) ?? 0) + 1)));
  const leaders = [...led].sort((a, b) => b[1] - a[1]);

  // Stops
  const stopsBy = new Map<number, number>();
  story.pits.forEach((p) => stopsBy.set(p.driver, (stopsBy.get(p.driver) ?? 0) + 1));
  const stopCounts = finishers.map((r) => stopsBy.get(r.driver) ?? 0);
  const commonStops = mode(stopCounts);

  // Pace
  const medians = story.laps
    .map((s) => ({ driver: s.driver, laps: cleanLaps(story, s).map((l) => l.time).sort((a, b) => a - b) }))
    .filter((x) => x.laps.length >= 10)
    .map((x) => ({ driver: x.driver, median: x.laps[x.laps.length >> 1] }))
    .sort((a, b) => a.median - b.median);

  const lap1 = story.start.filter((s) => s.grid && s.afterLap1).map((s) => ({ ...s, gain: s.grid! - s.afterLap1! })).sort((a, b) => b.gain - a.gain);
  const passes = onTrackOvertakes(story);
  const top3 = finishers.slice(0, 3).map((r) => r.driver);

  const chapters: ChapterDef[] = [
    {
      id: 'result',
      title: 'From grid to flag',
      takeaway: p1 ? `${drivers.get(p1.driver)?.name} won from ${p1.grid ? `P${p1.grid}` : 'the grid'}. Lines show where everyone started and finished.` : undefined,
      content: <Panel><GridToFlag story={story} /></Panel>,
    },
  ];

  if (story.start.length) {
    chapters.push({
      id: 'start',
      title: 'The start',
      takeaway: lap1[0]?.gain > 0 ? `${code(lap1[0].driver)} was the star of lap 1, gaining ${lap1[0].gain} places.${lap1[lap1.length - 1]?.gain < -2 ? ` ${code(lap1[lap1.length - 1].driver)} lost ${-lap1[lap1.length - 1].gain}.` : ''}` : 'Positions gained and lost on the opening lap.',
      content: (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          <Panel title="Lap 1: places gained"><LapOneChanges story={story} /></Panel>
          <Panel title="Launch" caption="Time from standstill to 100 km/h (bars) and 200 km/h (diamonds), from car telemetry at about 4 samples per second.">
            <LaunchChart story={story} />
          </Panel>
        </Box>
      ),
    });
  }

  chapters.push({
    id: 'unfolded',
    title: 'How it unfolded',
    takeaway: `${leaders.map(([n, laps]) => `${code(n)} led ${laps} lap${laps > 1 ? 's' : ''}`).slice(0, 3).join(', ')}.${story.periods.length ? ' Shaded bands mark safety car, VSC and red flag periods.' : ''}${passes.length ? ` ${passes.length} on-track overtakes after lap 1.` : ''}`,
    content: (
      <>
        <Panel title="Gap to the leader" caption="Seconds behind the leader at the end of each lap. Circles mark pit stops, blue squares team radio (click to listen) and red crosses penalties. Highlight drivers above to follow their race.">
          <GapToLeader story={story} />
        </Panel>
        <Panel title="Running order"><PositionChart story={story} /></Panel>
      </>
    ),
  });

  const radio = radioChapter(story);
  if (radio) chapters.push(radio);

  chapters.push({
    id: 'strategy',
    title: 'Strategy',
    takeaway: `Most drivers stopped ${commonStops === 1 ? 'once' : `${commonStops} times`}${p1 ? `; the winner stopped ${(stopsBy.get(p1.driver) ?? 0) === 1 ? 'once' : `${stopsBy.get(p1.driver) ?? 0} times`}` : ''}.`,
    content: (
      <>
        <Panel title="Tyre stints" caption="Numbers are stint lengths in laps (+ tyre age at fitting if used). Vertical ticks are pit stops; hover for stop times.">
          <TyreStrategy story={story} />
        </Panel>
        {story.pits.some((p) => p.stop) && (
          <Panel title="Pit stops, fastest first" caption="Stationary time as reported in timing data.">
            <PitStops story={story} />
          </Panel>
        )}
      </>
    ),
  });

  chapters.push({
    id: 'pace',
    title: 'Race pace',
    takeaway: medians[0] ? `On clean laps (no lap 1, pit laps or safety cars), ${code(medians[0].driver)} had the best median pace at ${formatTime(medians[0].median)}${medians[1] ? `, ${(medians[1].median - medians[0].median).toFixed(3)}s a lap quicker than ${code(medians[1].driver)}` : ''}.` : undefined,
    content: (
      <>
        <Panel title="Lap time distribution" caption="Each box spans the middle half of a driver's clean laps; the line is the median.">
          <PaceDistribution story={story} />
        </Panel>
        <StintPanel story={story} defaults={top3} />
      </>
    ),
  });

  if (energy?.drivers.length) {
    const summary = energySummary(story, energy);
    const mostLift = [...summary].sort((x, y) => y.lift - x.lift)[0];
    const mostClip = [...summary].sort((x, y) => y.clip - x.clip)[0];
    chapters.push({
      id: 'energy',
      title: 'Energy management',
      takeaway: mostLift && mostClip
        ? `${code(mostLift.driver)} lifted and coasted the most (${mostLift.lift.toFixed(1)}s per lap on average); ${code(mostClip.driver)} spent the most distance clipping (${Math.round(mostClip.clip)} m per lap). Saving energy here buys deployment elsewhere.`
        : 'How much each driver lifted and coasted, and how far they ran out of electric deployment at full throttle.',
      content: (
        <>
          <EnergyThroughRace story={story} energy={energy} />
          <Panel title="Average per lap" caption="Clean laps only: no lap 1, pit laps or safety car laps. Estimates from car telemetry (throttle, brake and speed about four times a second).">
            <EnergyAverages story={story} energy={energy} />
          </Panel>
        </>
      ),
    });
  }

  if (story.circuit) chapters.push({ id: 'lap-animation', title: 'Lap animation', takeaway: 'Watch the best laps race each other from the same start, with the camera following one car. Pick drivers and laps, and switch between the 2D and 3D cameras.', content: <LapAnimationChapter story={story} /> });
  if (p1 && p2) chapters.push({ id: 'head-to-head', title: 'Head to head', takeaway: 'Any two laps compared metre by metre: speed, throttle, braking, energy zones and where the time went, corner by corner.', content: <HeadToHeadChapter story={story} defaults={[p1.driver, p2.driver]} /> });
  chapters.push({ id: 'corners', title: 'Corners and car setup', takeaway: 'How fast every car was through each corner on its best lap, and who traded downforce for straight-line speed.', content: <CornersChapter story={story} /> });
  if (story.circuit && story.meta.t0) chapters.push({ id: 'replay', title: 'Replay', takeaway: 'Watch any lap unfold on track.', content: <ReplayChapter story={story} /> });

  chapters.push({
    id: 'fastest',
    title: 'Fastest laps',
    takeaway: story.fastest[0] ? `${code(story.fastest[0].driver)} set the fastest lap, ${formatTime(story.fastest[0].time)} on lap ${story.fastest[0].lap}.` : undefined,
    content: <Panel><FastestLapGaps story={story} /></Panel>,
  });

  if (story.standings.drivers.length) {
    chapters.push({
      id: 'championship',
      title: 'Championship',
      takeaway: (
        <>
          How the standings moved. <Link href={`#/${story.meta.year}`} color="inherit">See the whole season →</Link>
        </>
      ),
      content: <Panel><ChampionshipImpact story={story} /></Panel>,
    });
  }
  return chapters;
}

function StintPanel({ story, defaults }: { story: SessionStory; defaults: number[] }) {
  const { focused } = useFocus();
  const selected = focused.size ? [...focused] : defaults;
  return (
    <Panel
      title="Stint by stint"
      caption={`Showing ${focused.size ? 'highlighted drivers' : 'the podium (highlight drivers above to change)'}. Dots are coloured by tyre; lines are the lap-time trend in each stint (hover for seconds per lap). Fuel burn makes cars faster as the race goes on, so a flat line still means the tyres were dropping off.`}
    >
      <StintPace story={story} drivers={selected} />
    </Panel>
  );
}

// -- qualifying ----------------------------------------------------------------------------

function qualifyingChapters(story: SessionStory): ChapterDef[] {
  const drivers = driverLookup(story);
  const rows = story.classification.filter((r) => r.position);
  const sectorBest = [0, 1, 2].map((i) => {
    const sorted = story.bestSectors.filter((b) => b.sectors[i] !== null).sort((a, b) => a.sectors[i]! - b.sectors[i]!);
    return sorted[0]?.driver;
  });
  const chapters: ChapterDef[] = [
    { id: 'result', title: 'Result', takeaway: 'Best times from each part of qualifying. Purple marks the fastest time of each segment.', content: <Panel><QualifyingTable story={story} /></Panel> },
    { id: 'gaps', title: 'Gap to pole', takeaway: 'How far each driver was from pole; dashed lines show where the knock-out cuts fell.', content: <Panel><GapToPole story={story} /></Panel> },
    ...(story.circuit ? [{ id: 'lap-animation', title: 'Lap animation', takeaway: 'The fastest laps racing each other as ghosts, with the camera following one car. Pick drivers and laps, and switch between 2D and 3D.', content: <LapAnimationChapter story={story} /> }] : []),
    {
      id: 'sectors',
      title: 'Where the time is',
      takeaway: `Fastest sectors: ${sectorBest.map((n, i) => `S${i + 1} ${drivers.get(n!)?.code ?? '–'}`).join(', ')}. The "ideal lap" adds up each driver's best three sectors.`,
      content: (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 2 }}>
          <Panel title="Sector rankings"><SectorHeatmap story={story} /></Panel>
          <Panel title="Time left on the table" caption="Best lap minus ideal lap."><IdealLap story={story} /></Panel>
        </Box>
      ),
    },
    { id: 'evolution', title: 'Session evolution', takeaway: 'Every push lap through the session. The track gets faster as rubber goes down.', content: <Panel><SessionTimeline story={story} /></Panel> },
  ];
  if (rows[0] && rows[1]) chapters.push({ id: 'head-to-head', title: 'Head to head', takeaway: 'The two best laps compared, metre by metre, and corner by corner. Pick any two laps.', content: <HeadToHeadChapter story={story} defaults={[rows[0].driver, rows[1].driver]} /> });
  chapters.push({ id: 'corners', title: 'Corners and car setup', takeaway: 'Every car through every corner on its best lap, and the downforce vs top speed trade-off.', content: <CornersChapter story={story} /> });
  const radio = radioChapter(story);
  if (radio) chapters.push(radio);
  return chapters;
}

// -- practice ------------------------------------------------------------------------------

function practiceChapters(story: SessionStory): ChapterDef[] {
  const [f1, f2] = story.fastest;
  const chapters: ChapterDef[] = [
    { id: 'fastest', title: 'Fastest laps', takeaway: 'One-lap pace. In practice, fuel loads and programmes differ, so read with care.', content: <Panel><FastestLapGaps story={story} /></Panel> },
    ...(story.circuit ? [{ id: 'lap-animation', title: 'Lap animation', takeaway: 'The fastest laps racing each other as ghosts. Pick drivers and laps, and switch between 2D and 3D.', content: <LapAnimationChapter story={story} /> }] : []),
    { id: 'long-runs', title: 'Long runs', takeaway: 'Average lap time on stints of 5+ clean laps: the best hint of race pace. Bigger dots are longer runs.', content: <Panel><LongRuns story={story} /></Panel> },
    { id: 'evolution', title: 'Session evolution', takeaway: 'Every push lap, coloured by tyre.', content: <Panel><SessionTimeline story={story} /></Panel> },
  ];
  if (f1 && f2) chapters.push({ id: 'head-to-head', title: 'Head to head', takeaway: 'The two fastest laps compared.', content: <HeadToHeadChapter story={story} defaults={[f1.driver, f2.driver]} /> });
  const radio = radioChapter(story);
  if (radio) chapters.push(radio);
  return chapters;
}

/** Team radio and race control, if the session has any. */
function radioChapter(story: SessionStory): ChapterDef | null {
  const radio = story.radio ?? [];
  const messages = story.messages ?? [];
  if (!radio.length && !messages.length) return null;
  const drivers = driverLookup(story);
  const penalties = messages.filter((m) => m.kind === 'penalty' && !/SERVED/i.test(m.text)).length;
  const investigations = messages.filter((m) => m.kind === 'investigation' && /UNDER INVESTIGATION|WILL BE INVESTIGATED/i.test(m.text)).length;
  const deleted = messages.filter((m) => m.kind === 'track-limits').length;
  const talk = new Map<number, number>();
  radio.forEach((c) => talk.set(c.driver, (talk.get(c.driver) ?? 0) + 1));
  const chatty = [...talk].sort((a, b) => b[1] - a[1])[0];
  const parts = [
    radio.length && `${radio.length} team radio clips${chatty ? ` (most from ${drivers.get(chatty[0])?.code})` : ''}`,
    investigations && `${investigations} investigation${investigations > 1 ? 's' : ''}`,
    penalties && `${penalties} penalt${penalties > 1 ? 'ies' : 'y'}`,
    deleted && `${deleted} lap times deleted for track limits`,
  ].filter(Boolean);
  return {
    id: 'radio',
    title: 'Radio and race control',
    takeaway: `${parts.join(', ')}. Press play to listen; highlight drivers above to see only their messages.`,
    content: (
      <Panel>
        <RadioFeed story={story} />
      </Panel>
    ),
  };
}

function mode(values: number[]) {
  const counts = new Map<number, number>();
  values.forEach((v) => counts.set(v, (counts.get(v) ?? 0) + 1));
  return [...counts].sort((a, b) => b[1] - a[1])[0]?.[0] ?? 0;
}

export { contrastText };
