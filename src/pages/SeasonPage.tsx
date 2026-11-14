import { Box, Card, CardActionArea, Chip, Container, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import { useEffect, useState } from 'react';
import Plot from '../components/Plot';
import { Chapter, ErrorBox, Loading, Panel } from '../components/ui';
import { loadSeason } from '../lib/data';
import type { SeasonStory } from '../lib/story';
import { focusOpacity, useAsync, useFocus } from '../hooks';
import { colors } from '../theme';

export default function SeasonPage({ year }: { year: number }) {
  const season = useAsync(() => loadSeason(year), `season-${year}`);
  useEffect(() => {
    document.title = `${year} season · F1 Analysis`;
  }, [year]);
  return (
    <Container maxWidth="lg" sx={{ py: { xs: 3, md: 5 } }}>
      <Typography variant="overline" sx={{ color: colors.accent }}>
        Formula 1 · {year}
      </Typography>
      <Typography variant="h2" component="h1" sx={{ fontSize: { xs: 36, md: 52 }, mb: 1 }}>
        The {year} season
      </Typography>
      {season.loading && <Loading label="Loading the season…" />}
      {season.error && <ErrorBox message={season.error} />}
      {season.data && <SeasonContent season={season.data} />}
    </Container>
  );
}

function SeasonContent({ season }: { season: SeasonStory }) {
  const drivers = new Map(season.drivers.map((d) => [d.number, d]));
  const now = Date.now();
  const run = season.events.filter((e) => e.podium.length);
  const leader = season.standings.drivers[0];
  const second = season.standings.drivers[1];
  const last = (p: (number | null)[]) => p[p.length - 1] ?? 0;
  const winners = new Map<number, number>();
  run.forEach((e) => winners.set(e.podium[0], (winners.get(e.podium[0]) ?? 0) + 1));
  const topWinner = [...winners].sort((a, b) => b[1] - a[1])[0];

  return (
    <>
      <Typography sx={{ color: colors.muted, fontSize: 18, maxWidth: 820 }}>
        {run.length} of {season.events.length} races run.
        {leader && second && ` ${drivers.get(leader.driver)?.name} leads the championship on ${last(leader.points)} points, ${last(leader.points) - last(second.points)} ahead of ${drivers.get(second.driver)?.name}.`}
        {topWinner && ` ${drivers.get(topWinner[0])?.name} has won the most races (${topWinner[1]}).`}
      </Typography>

      <Chapter id="calendar" title="Calendar" takeaway="Pick a weekend to read its story.">
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr', md: 'repeat(4, 1fr)' }, gap: 1.5 }}>
          {season.events.map((e) => {
            const started = e.sessions.some((s) => Date.parse(s.dateStart) < now);
            const done = e.sessions.filter((s) => Date.parse(s.dateEnd) < now);
            const code = done.find((s) => s.code === 'R') ? 'R' : done[done.length - 1]?.code;
            const winner = drivers.get(e.podium[0]);
            return (
              <Card key={e.round} sx={{ opacity: started ? 1 : 0.5, borderTop: `3px solid ${winner?.color ?? colors.border}` }}>
                <CardActionArea disabled={!code} href={code ? `#/${season.year}/${e.round}/${code}` : undefined} sx={{ p: 1.5, height: '100%' }}>
                  <Typography variant="caption" sx={{ color: colors.muted }}>
                    R{e.round} · {new Date(e.dateStart).toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}
                    {e.sessions.some((s) => s.code === 'S') && ' · Sprint'}
                  </Typography>
                  <Typography variant="subtitle1" sx={{ fontWeight: 700, lineHeight: 1.2 }}>
                    {e.name.replace(' Grand Prix', ' GP')}
                  </Typography>
                  <Typography variant="body2" sx={{ color: colors.muted, mb: 1 }}>
                    {e.location}
                  </Typography>
                  {e.podium.length ? (
                    <Stack direction="row" spacing={0.5}>
                      {e.podium.map((n, i) => {
                        const d = drivers.get(n);
                        return <Chip key={n} size="small" label={`${i + 1}. ${d?.code ?? n}`} sx={{ bgcolor: i === 0 ? d?.color : 'transparent', border: `1px solid ${d?.color ?? colors.border}`, color: i === 0 ? '#fff' : colors.text, fontSize: 11 }} />;
                      })}
                    </Stack>
                  ) : (
                    <Typography variant="body2" sx={{ color: colors.muted }}>
                      {started ? 'In progress' : 'Upcoming'}
                    </Typography>
                  )}
                </CardActionArea>
              </Card>
            );
          })}
        </Box>
      </Chapter>

      {season.standings.labels.length > 0 && (
        <Chapter id="championship" title="Championship" takeaway="Points after every race and sprint. Click a driver in the legend to hide them; double-click to isolate.">
          <StandingsChart season={season} />
        </Chapter>
      )}
    </>
  );
}

function StandingsChart({ season }: { season: SeasonStory }) {
  const [mode, setMode] = useState<'drivers' | 'teams'>('drivers');
  const { focused } = useFocus();
  const drivers = new Map(season.drivers.map((d) => [d.number, d]));
  const labels = season.standings.labels.map((l) => `R${l.round}${l.code === 'S' ? ' sprint' : ''}`);
  const seenTeams = new Map<string, number>();
  const traces =
    mode === 'drivers'
      ? season.standings.drivers.slice(0, 22).map((row, i) => {
          const d = drivers.get(row.driver);
          const k = seenTeams.get(d?.team ?? '') ?? 0;
          seenTeams.set(d?.team ?? '', k + 1);
          return {
            type: 'scatter',
            mode: 'lines',
            name: d?.code ?? String(row.driver),
            x: labels,
            y: row.points,
            line: { color: d?.color, width: i < 3 ? 3 : 1.6, dash: k > 0 ? 'dot' : 'solid' },
            opacity: focusOpacity(focused, row.driver),
            visible: i < 10 ? true : 'legendonly',
            hovertemplate: `${d?.name}: %{y} pts after %{x}<extra></extra>`,
          };
        })
      : season.standings.teams.map((row) => ({
          type: 'scatter',
          mode: 'lines',
          name: row.team,
          x: labels,
          y: row.points,
          line: { color: row.color, width: 2.5 },
          hovertemplate: `${row.team}: %{y} pts after %{x}<extra></extra>`,
        }));
  return (
    <Panel
      title={mode === 'drivers' ? "Drivers' championship" : "Constructors' championship"}
      actions={
        <ToggleButtonGroup size="small" exclusive value={mode} onChange={(_, v) => v && setMode(v)}>
          <ToggleButton value="drivers">Drivers</ToggleButton>
          <ToggleButton value="teams">Constructors</ToggleButton>
        </ToggleButtonGroup>
      }
    >
      <Plot filename={`championship-${season.year}-${mode}`} height={480} data={traces} layout={{ yaxis: { title: 'Points' }, xaxis: { tickangle: -45 }, legend: { orientation: 'v', x: 1.02, y: 1 }, margin: { l: 55, r: 120, t: 10, b: 70 } }} />
    </Panel>
  );
}
