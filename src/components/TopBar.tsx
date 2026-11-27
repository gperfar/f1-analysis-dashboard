import { AppBar, Box, Button, Chip, MenuItem, Select, Stack, Toolbar, Typography } from '@mui/material';
import { FIRST_YEAR } from '../lib/f1data';
import { loadSeason } from '../lib/data';
import { navigate, Route, useAsync } from '../hooks';
import { colors } from '../theme';

const years = Array.from({ length: new Date().getUTCFullYear() - FIRST_YEAR + 1 }, (_, i) => new Date().getUTCFullYear() - i);

/** Sticky bar: brand, season link, and year › race › session pickers. */
export default function TopBar({ route }: { route: Route }) {
  const year = route.page === 'latest' ? years[0] : route.year;
  const season = useAsync(() => loadSeason(year), `season-${year}`);
  const current = route.page === 'session' ? route : null;
  const event = current ? season.data?.events.find((e) => e.round === current.round) : undefined;
  const now = Date.now();

  return (
    <AppBar position="sticky" elevation={0} sx={{ position: { xs: 'static', md: 'sticky' }, bgcolor: 'rgba(13,13,16,0.85)', backdropFilter: 'blur(10px)', borderBottom: `1px solid ${colors.border}` }}>
      <Toolbar sx={{ gap: 2, flexWrap: 'wrap', py: { xs: 1, md: 0 }, minHeight: { md: 64 } }}>
        <Box component="a" href="#/" sx={{ display: 'flex', alignItems: 'center', gap: 1, textDecoration: 'none', color: 'inherit', mr: 1 }}>
          <Box sx={{ width: 10, height: 26, bgcolor: colors.accent, transform: 'skewX(-18deg)' }} />
          <Typography variant="h6" sx={{ fontWeight: 800, letterSpacing: '-0.01em' }}>
            F1 Analysis
          </Typography>
        </Box>

        <Stack direction="row" spacing={1} alignItems="center" sx={{ flexWrap: 'wrap', rowGap: 1, flex: 1 }}>
          <Select
            size="small"
            value={year}
            onChange={(e) => navigate({ page: 'season', year: Number(e.target.value) })}
            sx={{ minWidth: 90 }}
          >
            {years.map((y) => (
              <MenuItem key={y} value={y}>
                {y}
              </MenuItem>
            ))}
          </Select>

          <Select
            size="small"
            displayEmpty
            value={current?.round ?? ''}
            onChange={(e) => {
              const ev = season.data?.events.find((x) => x.round === Number(e.target.value));
              const done = ev?.sessions.filter((s) => Date.parse(s.dateEnd) < now) ?? [];
              const code = done.find((s) => s.code === 'R')?.code ?? done[done.length - 1]?.code ?? 'R';
              navigate({ page: 'session', year, round: Number(e.target.value), code });
            }}
            sx={{ minWidth: { xs: 180, md: 240 } }}
            renderValue={(v: number | '') => (v === '' ? <span style={{ color: colors.muted }}>Choose a race weekend</span> : `R${v} · ${season.data?.events.find((x) => x.round === v)?.name ?? ''}`)}
          >
            {season.data?.events.map((e) => {
              const started = e.sessions.some((s) => Date.parse(s.dateStart) < now);
              return (
                <MenuItem key={e.round} value={e.round} disabled={!started}>
                  R{e.round} · {e.name}
                </MenuItem>
              );
            })}
          </Select>

          {event && current && (
            <Stack direction="row" spacing={0.5} sx={{ flexWrap: 'wrap', rowGap: 0.5 }}>
              {event.sessions.map((s) => {
                const done = Date.parse(s.dateEnd) < now;
                return (
                  <Chip
                    key={s.code}
                    label={s.code}
                    title={s.name}
                    size="small"
                    disabled={!done}
                    color={s.code === current.code ? 'primary' : 'default'}
                    variant={s.code === current.code ? 'filled' : 'outlined'}
                    onClick={() => navigate({ page: 'session', year, round: event.round, code: s.code, tab: current.tab })}
                  />
                );
              })}
            </Stack>
          )}
        </Stack>

        <Button href={`#/${year}`} size="small" variant={route.page === 'season' ? 'contained' : 'text'} color="inherit" sx={{ fontWeight: 700 }}>
          {year} season
        </Button>
      </Toolbar>
    </AppBar>
  );
}
