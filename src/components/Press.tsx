import { useState } from 'react';
import { Box, Button, Paper, Stack, Typography } from '@mui/material';
import OpenInNewIcon from '@mui/icons-material/OpenInNew';
import { loadPress } from '../lib/data';
import { useAsync } from '../hooks';
import { colors } from '../theme';
import type { SessionStory } from '../lib/story';

const outletColors: Record<string, string> = {
  'BBC Sport': '#ffd230',
  Autosport: '#e10600',
  'Motorsport.com': '#4dabf7',
  'Formula1.com': '#ff6b6b',
  RaceFans: '#69db7c',
};

function ago(iso: string) {
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' }) + ' ' + d.toLocaleTimeString(undefined, { hour: '2-digit', minute: '2-digit' });
}

/** "In the press": articles about this session from outlets' feeds, plus an optional AI digest. */
export default function Press({ story }: { story: SessionStory }) {
  const { year, round, code } = story.meta;
  const press = useAsync(() => loadPress(year, round, code), `${year}/${round}/${code}`);
  const [all, setAll] = useState(false);
  const articles = press.data?.articles ?? [];
  if (!articles.length) return null;
  const shown = all ? articles : articles.slice(0, 4);

  return (
    <Box sx={{ mt: 4, maxWidth: 900 }}>
      <Typography variant="overline" sx={{ color: colors.muted }}>
        In the press
      </Typography>
      {press.data?.digest && (
        <Box sx={{ mb: 1.5 }}>
          <Typography sx={{ fontSize: 17, lineHeight: 1.6 }}>{press.data.digest}</Typography>
          <Typography variant="caption" sx={{ color: colors.muted }}>
            Digest written by Claude from the headlines below.
          </Typography>
        </Box>
      )}
      <Box sx={{ display: 'grid', gridTemplateColumns: { xs: '1fr', sm: '1fr 1fr' }, gap: 1.25 }}>
        {shown.map((a) => (
          <Paper
            key={a.url}
            component="a"
            href={a.url}
            target="_blank"
            rel="noopener"
            sx={{ p: 1.5, textDecoration: 'none', color: 'inherit', borderLeft: `3px solid ${outletColors[a.outlet] ?? colors.border}`, '&:hover': { bgcolor: colors.panelRaised } }}
          >
            <Stack direction="row" justifyContent="space-between" alignItems="center">
              <Typography variant="caption" sx={{ color: outletColors[a.outlet] ?? colors.muted, fontWeight: 700 }}>
                {a.outlet}
              </Typography>
              <Typography variant="caption" sx={{ color: colors.muted, display: 'flex', alignItems: 'center', gap: 0.5 }}>
                {ago(a.published)} <OpenInNewIcon sx={{ fontSize: 12 }} />
              </Typography>
            </Stack>
            <Typography sx={{ fontWeight: 700, lineHeight: 1.3, mt: 0.25 }}>{a.title}</Typography>
            {a.teaser && (
              <Typography variant="body2" sx={{ color: colors.muted, mt: 0.5 }}>
                {a.teaser}
              </Typography>
            )}
          </Paper>
        ))}
      </Box>
      {articles.length > shown.length && (
        <Button size="small" onClick={() => setAll(true)} sx={{ mt: 1 }}>
          Show all {articles.length} articles
        </Button>
      )}
      <Typography variant="caption" sx={{ display: 'block', color: colors.muted, mt: 0.5 }}>
        Headlines and teasers from the outlets' public feeds; click through to read the full articles on their sites.
      </Typography>
    </Box>
  );
}
