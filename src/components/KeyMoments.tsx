import { Box, Paper, Stack, Tooltip, Typography } from '@mui/material';
import { keyMoments, Moment, MomentType } from '../lib/moments';
import type { SessionStory } from '../lib/story';
import { driverLookup } from '../charts/common';
import { colors } from '../theme';

export const momentColors: Record<MomentType, string> = {
  start: colors.text,
  finish: colors.text,
  lead: colors.accent,
  sc: '#ffd43b',
  vsc: '#ffe066',
  red: '#ff6b6b',
  penalty: '#ff8787',
  retirement: colors.muted,
  weather: '#4dabf7',
  pass: '#69db7c',
  fastest: '#c77dff',
};

/** Ask the replay chapter to show a lap (it listens for this event). */
export function goToReplayLap(lap: number) {
  window.dispatchEvent(new CustomEvent('replay:goto', { detail: { lap } }));
  document.getElementById('replay')?.scrollIntoView({ behavior: 'smooth' });
}

/** The race at a glance: a lap axis with markers, and a card per moment. */
export default function KeyMoments({ story }: { story: SessionStory }) {
  const moments = keyMoments(story);
  if (moments.length < 2) return null;
  const drivers = driverLookup(story);
  const total = story.meta.totalLaps || Math.max(...moments.map((m) => m.lap));
  const canReplay = !!story.circuit && !!story.meta.t0;
  const pct = (lap: number) => `${((lap - 1) / Math.max(1, total - 1)) * 100}%`;
  const open = (m: Moment) => (canReplay ? goToReplayLap(m.lap) : document.getElementById('unfolded')?.scrollIntoView({ behavior: 'smooth' }));

  return (
    <Box sx={{ mt: 4 }}>
      <Typography variant="overline" sx={{ color: colors.muted }}>
        Key moments{canReplay && ' · click one to watch that lap'}
      </Typography>

      {/* Lap axis */}
      <Box sx={{ position: 'relative', height: 34, mx: 1, mt: 0.5 }}>
        <Box sx={{ position: 'absolute', left: 0, right: 0, top: 15, height: 3, bgcolor: colors.border, borderRadius: 2 }} />
        {story.periods.map((p, i) => (
          <Box
            key={i}
            sx={{
              position: 'absolute',
              top: 13,
              height: 7,
              left: pct(Math.max(1, p.start)),
              width: `calc(${pct(Math.min(total, p.end))} - ${pct(Math.max(1, p.start))})`,
              minWidth: 4,
              bgcolor: p.type === 'RED' ? momentColors.red : momentColors.sc,
              opacity: p.type === 'VSC' ? 0.5 : 0.85,
              borderRadius: 1,
            }}
          />
        ))}
        {moments.map((m, i) => (
          <Tooltip key={i} title={`Lap ${m.lap}: ${m.title}${m.detail ? ` (${m.detail})` : ''}`} arrow>
            <Box
              onClick={() => open(m)}
              sx={{
                position: 'absolute',
                left: pct(m.lap),
                top: 9,
                width: 15,
                height: 15,
                ml: '-7.5px',
                borderRadius: '50%',
                bgcolor: momentColors[m.type],
                border: `2px solid ${colors.bg}`,
                cursor: 'pointer',
                '&:hover': { transform: 'scale(1.3)' },
              }}
            />
          </Tooltip>
        ))}
        <Typography variant="caption" sx={{ position: 'absolute', left: 0, top: 22, color: colors.muted }}>
          Lap 1
        </Typography>
        <Typography variant="caption" sx={{ position: 'absolute', right: 0, top: 22, color: colors.muted }}>
          Lap {total}
        </Typography>
      </Box>

      {/* Cards */}
      <Stack direction="row" spacing={1.25} sx={{ overflowX: 'auto', pb: 1, mt: 1.5, scrollSnapType: 'x proximity' }}>
        {moments.map((m, i) => {
          const d = m.drivers.length ? drivers.get(m.drivers[0]) : undefined;
          return (
            <Paper
              key={i}
              onClick={() => open(m)}
              sx={{
                minWidth: 190,
                maxWidth: 230,
                flexShrink: 0,
                p: 1.5,
                cursor: 'pointer',
                scrollSnapAlign: 'start',
                borderTop: `3px solid ${momentColors[m.type]}`,
                '&:hover': { bgcolor: colors.panelRaised },
              }}
            >
              <Typography variant="caption" sx={{ color: colors.muted }}>
                Lap {m.lap}
              </Typography>
              <Typography sx={{ fontWeight: 700, lineHeight: 1.25, display: 'flex', alignItems: 'center', gap: 0.75 }}>
                {d && <Box component="span" sx={{ width: 4, height: 16, bgcolor: d.color, display: 'inline-block', flexShrink: 0 }} />}
                {m.title}
              </Typography>
              {m.detail && (
                <Typography variant="body2" sx={{ color: colors.muted, mt: 0.25 }}>
                  {m.detail}
                </Typography>
              )}
            </Paper>
          );
        })}
      </Stack>
    </Box>
  );
}
