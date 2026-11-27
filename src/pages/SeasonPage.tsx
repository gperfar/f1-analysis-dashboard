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

      <Hub season={season} />

      {season.standings.labels.length > 0 && (
        <Chapter id="championship" title="Championship" takeaway="Points after every race and sprint. Click a driver in the legend to hide them; double-click to isolate.">
          <StandingsChart season={season} />
        </Chapter>
      )}

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

    </>
  );
}

const lastPoints = (p: (number | null)[]) => {
  for (let i = p.length - 1; i >= 0; i--) if (p[i] != null) return p[i]!;
  return 0;
};

/** Top of the season page: latest and next race, then the standings at a glance. */
function Hub({ season }: { season: SeasonStory }) {
  const drivers = new Map(season.drivers.map((d) => [d.number, d]));
  const now = Date.now();
  const latest = [...season.events].reverse().find((e) => e.sessions.some((s) => Date.parse(s.dateEnd) < now));
  const next = season.events.find((e) => !e.sessions.some((s) => Date.parse(s.dateEnd) < now));
  const latestCode = latest && (latest.sessions.find((s) => s.code === 'R' && Date.parse(s.dateEnd) < now)?.code ?? [...latest.sessions].reverse().find((s) => Date.parse(s.dateEnd) < now)?.code);
  const driverRows = [...season.standings.drivers].map((r) => ({ ...r, total: lastPoints(r.points) })).sort((a, b) => b.total - a.total).slice(0, 10);
  const teamRows = [...season.standings.teams].map((r) => ({ ...r, total: lastPoints(r.points) })).sort((a, b) => b.total - a.total);
  const leaderPts = driverRows[0]?.total ?? 0;
  const teamLeaderPts = teamRows[0]?.total ?? 0;
  const date = (iso: string) => new Date(iso).toLocaleDateString(undefined, { day: 'numeric', month: 'short' });

  return (
    <Box sx={{ mt: 3 }}>
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '1fr 1fr' }, gap: 1.5 }}>
        {latest && latestCode && (
          <Card sx={{ borderLeft: `4px solid ${drivers.get(latest.podium[0])?.color ?? colors.accent}` }}>
            <CardActionArea href={`#/${season.year}/${latest.round}/${latestCode}`} sx={{ p: 2, height: '100%' }}>
              <Typography variant="overline" sx={{ color: colors.muted }}>
                Latest · R{latest.round} · {date(latest.dateStart)}
              </Typography>
              <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
                {latest.name}
              </Typography>
              <Typography variant="body2" sx={{ color: colors.muted, mt: 0.5 }}>
                {latest.podium.length ? `Won by ${drivers.get(latest.podium[0])?.name ?? '?'}, ahead of ${latest.podium.slice(1).map((n) => drivers.get(n)?.code ?? n).join(' and ')}. ` : ''}
                Read the story →
              </Typography>
            </CardActionArea>
          </Card>
        )}
        {next ? (
          <Card sx={{ p: 2 }}>
            <Typography variant="overline" sx={{ color: colors.muted }}>
              Next · R{next.round} · {date(next.dateStart)}
            </Typography>
            <Typography variant="h5" sx={{ lineHeight: 1.2 }}>
              {next.name}
            </Typography>
            <Typography variant="body2" sx={{ color: colors.muted, mt: 0.5 }}>
              {next.location}
              {next.sessions.some((s) => s.code === 'S') && ' · Sprint weekend'}
            </Typography>
          </Card>
        ) : (
          <Card sx={{ p: 2 }}>
            <Typography variant="overline" sx={{ color: colors.muted }}>
              Season complete
            </Typography>
            <Typography variant="h5">{driverRows[0] ? `${drivers.get(driverRows[0].driver)?.name} is champion` : 'All races run'}</Typography>
          </Card>
        )}
      </Box>

      {driverRows.length > 0 && (
        <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', md: '3fr 2fr' }, gap: 1.5, mt: 1.5 }}>
          <Panel title="Drivers">
            {driverRows.map((r, i) => {
              const d = drivers.get(r.driver);
              return (
                <Stack key={r.driver} direction="row" spacing={1.5} alignItems="center" sx={{ py: 0.5, borderTop: i ? `1px solid ${colors.border}` : 'none', fontVariantNumeric: 'tabular-nums' }}>
                  <Typography sx={{ width: 22, color: colors.muted, fontWeight: 700 }}>{i + 1}</Typography>
                  <Box sx={{ width: 4, height: 18, bgcolor: d?.color, borderRadius: 1 }} />
                  <Typography sx={{ flex: 1, fontWeight: i === 0 ? 800 : 600 }}>
                    {d?.name ?? r.driver}
                    <Typography component="span" variant="body2" sx={{ color: colors.muted, ml: 1, display: { xs: 'none', sm: 'inline' } }}>
                      {d?.team}
                    </Typography>
                  </Typography>
                  <Typography sx={{ fontWeight: 700 }}>{r.total}</Typography>
                  <Typography variant="body2" sx={{ width: 52, textAlign: 'right', color: colors.muted }}>
                    {i ? `−${leaderPts - r.total}` : ''}
                  </Typography>
                </Stack>
              );
            })}
          </Panel>
          <Panel title="Constructors">
            {teamRows.map((r, i) => (
              <Stack key={r.team} direction="row" spacing={1.5} alignItems="center" sx={{ py: 0.5, borderTop: i ? `1px solid ${colors.border}` : 'none', fontVariantNumeric: 'tabular-nums' }}>
                <Typography sx={{ width: 22, color: colors.muted, fontWeight: 700 }}>{i + 1}</Typography>
                <Box sx={{ width: 4, height: 18, bgcolor: r.color, borderRadius: 1 }} />
                <Typography sx={{ flex: 1, fontWeight: i === 0 ? 800 : 600 }}>{r.team}</Typography>
                <Typography sx={{ fontWeight: 700 }}>{r.total}</Typography>
                <Typography variant="body2" sx={{ width: 52, textAlign: 'right', color: colors.muted }}>
                  {i ? `−${teamLeaderPts - r.total}` : ''}
                </Typography>
              </Stack>
            ))}
          </Panel>
        </Box>
      )}
    </Box>
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
