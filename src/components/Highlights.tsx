import { useState } from 'react';
import { Box, Link, Stack, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import { loadVideo } from '../lib/data';
import { useAsync } from '../hooks';
import { colors } from '../theme';
import type { SessionStory } from '../lib/story';

/**
 * The official highlights video. Shows the thumbnail first and only loads
 * YouTube's player (privacy-enhanced domain) when clicked.
 */
export default function Highlights({ story }: { story: SessionStory }) {
  const { year, round, code, name } = story.meta;
  const video = useAsync(() => loadVideo(year, round, code), `${year}/${round}/${code}`);
  const [playing, setPlaying] = useState(false);
  if (!video.data) return null;
  const { id, title } = video.data;

  return (
    <Box sx={{ mt: 3, maxWidth: 720 }}>
      <Typography variant="overline" sx={{ color: colors.muted }}>
        {name} highlights
      </Typography>
      <Box sx={{ position: 'relative', width: '100%', aspectRatio: '16 / 9', borderRadius: 2, overflow: 'hidden', bgcolor: '#000', border: `1px solid ${colors.border}` }}>
        {playing ? (
          <Box
            component="iframe"
            src={`https://www.youtube-nocookie.com/embed/${id}?autoplay=1&rel=0`}
            title={title}
            allow="autoplay; encrypted-media; picture-in-picture; fullscreen"
            allowFullScreen
            sx={{ position: 'absolute', inset: 0, width: '100%', height: '100%', border: 0 }}
          />
        ) : (
          <Box
            component="button"
            onClick={() => setPlaying(true)}
            aria-label={`Play ${title}`}
            sx={{
              position: 'absolute',
              inset: 0,
              p: 0,
              border: 0,
              cursor: 'pointer',
              background: `center / cover no-repeat url(https://i.ytimg.com/vi/${id}/hqdefault.jpg)`,
              '&:hover .play': { transform: 'scale(1.08)' },
            }}
          >
            <Stack className="play" alignItems="center" justifyContent="center" sx={{ position: 'absolute', left: '50%', top: '50%', width: 72, height: 72, ml: '-36px', mt: '-36px', borderRadius: '50%', bgcolor: colors.accent, color: '#fff', transition: 'transform .15s' }}>
              <PlayArrowIcon sx={{ fontSize: 44 }} />
            </Stack>
          </Box>
        )}
      </Box>
      <Typography variant="caption" sx={{ color: colors.muted }}>
        {title} · <Link href={`https://www.youtube.com/watch?v=${id}`} target="_blank" rel="noopener" color="inherit">Watch on YouTube</Link>
      </Typography>
    </Box>
  );
}
