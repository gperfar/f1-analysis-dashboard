import { ReactNode } from 'react';
import { Alert, Box, Chip, CircularProgress, LinearProgress, Paper, Stack, Typography } from '@mui/material';
import { useProgress } from '../hooks';
import { colors } from '../theme';
import type { DriverRef } from '../lib/story';

/** A chapter of the story: a numbered heading, one-line takeaway, then charts. */
export function Chapter({ id, index, title, takeaway, children }: { id: string; index?: number; title: string; takeaway?: ReactNode; children: ReactNode }) {
  return (
    <Box component="section" id={id} sx={{ scrollMarginTop: { xs: 64, md: 190 }, mt: { xs: 5, md: 7 } }}>
      <Stack direction="row" spacing={1.5} alignItems="baseline" sx={{ mb: 0.5 }}>
        {index !== undefined && (
          <Typography variant="overline" sx={{ color: colors.accent, fontSize: 13 }}>
            {String(index).padStart(2, '0')}
          </Typography>
        )}
        <Typography variant="h4" component="h2" sx={{ fontSize: { xs: 26, md: 32 } }}>
          {title}
        </Typography>
      </Stack>
      {takeaway && (
        <Typography sx={{ color: colors.muted, mb: 2.5, maxWidth: 820, fontSize: 17 }}>{takeaway}</Typography>
      )}
      <Stack spacing={2}>{children}</Stack>
    </Box>
  );
}

/** A panel holding one chart, with an optional title and caption. */
export function Panel({ title, caption, children, actions }: { title?: string; caption?: ReactNode; children: ReactNode; actions?: ReactNode }) {
  return (
    <Paper sx={{ p: { xs: 1.5, md: 2.5 } }}>
      {(title || actions) && (
        <Stack direction={{ xs: 'column', sm: 'row' }} justifyContent="space-between" alignItems={{ sm: 'center' }} spacing={1} sx={{ mb: 1 }}>
          {title && <Typography variant="h6">{title}</Typography>}
          {actions}
        </Stack>
      )}
      {children}
      {caption && (
        <Typography variant="body2" sx={{ color: colors.muted, mt: 1 }}>
          {caption}
        </Typography>
      )}
    </Paper>
  );
}

/** Loading state that shows OpenF1 download progress when there is any. */
export function Loading({ label = 'Loading…', minHeight = 200 }: { label?: string; minHeight?: number }) {
  const progress = useProgress();
  const pct = progress.started ? (progress.finished / progress.started) * 100 : null;
  return (
    <Box sx={{ minHeight, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', gap: 1.5, color: colors.muted }}>
      {pct === null ? <CircularProgress size={28} /> : <LinearProgress variant="determinate" value={pct} sx={{ width: 220 }} />}
      <Typography variant="body2">
        {label}
        {pct !== null && ` (${progress.finished}/${progress.started} requests)`}
      </Typography>
      {pct !== null && progress.started > 25 && (
        <Typography variant="caption" sx={{ maxWidth: 360, textAlign: 'center' }}>
          OpenF1 allows 30 requests a minute, so the first load takes a moment. It's cached afterwards.
        </Typography>
      )}
    </Box>
  );
}

export function ErrorBox({ message }: { message: string }) {
  return (
    <Alert severity="warning" variant="outlined" sx={{ my: 2 }}>
      {message}
    </Alert>
  );
}

export function DriverChip({ driver, active, onClick, size = 'small' }: { driver: DriverRef | undefined; active?: boolean; onClick?: () => void; size?: 'small' | 'medium' }) {
  if (!driver) return null;
  return (
    <Chip
      size={size}
      label={driver.code}
      onClick={onClick}
      variant={active ? 'filled' : 'outlined'}
      sx={{
        borderColor: driver.color,
        borderWidth: 2,
        borderStyle: driver.dashed ? 'dashed' : 'solid',
        bgcolor: active ? driver.color : 'transparent',
        color: active ? contrastText(driver.color) : colors.text,
        '&:hover': { bgcolor: active ? driver.color : `${driver.color}33` },
      }}
    />
  );
}

/** Black or white text, whichever reads better on the given background. */
export function contrastText(hex: string) {
  const v = hex.replace('#', '');
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(v.slice(i, i + 2), 16) || 0);
  return 0.299 * r + 0.587 * g + 0.114 * b > 150 ? '#111' : '#fff';
}
