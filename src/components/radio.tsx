/**
 * Team radio playback and the radio + race control feed.
 *
 * One shared <audio> element plays a clip at a time, so starting a clip from
 * the feed, the gap chart or the replay stops whatever was playing.
 */
import { createContext, ReactNode, useContext, useEffect, useRef, useState } from 'react';
import { Box, Chip, IconButton, Stack, ToggleButton, ToggleButtonGroup, Typography } from '@mui/material';
import PlayArrowIcon from '@mui/icons-material/PlayArrow';
import PauseIcon from '@mui/icons-material/Pause';
import type { MessageKind, RaceControlMessage, RadioClip, SessionStory } from '../lib/story';
import { driverLookup } from '../charts/common';
import { useFocus } from '../hooks';
import { colors } from '../theme';
import { DriverChip } from './ui';

// -- player --------------------------------------------------------------------------------

interface RadioPlayer {
  playing: string | null;
  toggle: (url: string) => void;
}

const RadioContext = createContext<RadioPlayer>({ playing: null, toggle: () => {} });

export function RadioProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playing, setPlaying] = useState<string | null>(null);

  useEffect(() => {
    const el = new Audio();
    el.preload = 'none';
    el.onended = () => setPlaying(null);
    el.onerror = () => setPlaying(null);
    audio.current = el;
    return () => {
      el.pause();
      audio.current = null;
    };
  }, []);

  const toggle = (url: string) => {
    const el = audio.current;
    if (!el) return;
    if (playing === url) {
      el.pause();
      setPlaying(null);
      return;
    }
    el.src = url;
    el.play().then(
      () => setPlaying(url),
      () => setPlaying(null)
    );
  };

  return <RadioContext.Provider value={{ playing, toggle }}>{children}</RadioContext.Provider>;
}

export function useRadio() {
  return useContext(RadioContext);
}

export function PlayButton({ url, size = 'small' }: { url: string; size?: 'small' | 'medium' }) {
  const { playing, toggle } = useRadio();
  const active = playing === url;
  return (
    <IconButton size={size} onClick={() => toggle(url)} aria-label={active ? 'Pause team radio' : 'Play team radio'} sx={{ color: active ? colors.accent : colors.text, border: `1px solid ${active ? colors.accent : colors.border}` }}>
      {active ? <PauseIcon fontSize="small" /> : <PlayArrowIcon fontSize="small" />}
    </IconButton>
  );
}

// -- feed ----------------------------------------------------------------------------------

export const messageStyle: Record<MessageKind | 'radio', { label: string; color: string }> = {
  radio: { label: 'Team radio', color: '#4dabf7' },
  penalty: { label: 'Penalty', color: '#ff6b6b' },
  investigation: { label: 'Stewards', color: '#ffa94d' },
  'track-limits': { label: 'Track limits', color: '#ced4da' },
  flag: { label: 'Flag', color: '#ffd43b' },
  conditions: { label: 'Conditions', color: '#69db7c' },
  other: { label: 'Race control', color: '#9a9aa8' },
};

type FeedItem = { t: number; lap: number | null } & ({ type: 'radio'; clip: RadioClip } | { type: 'message'; message: RaceControlMessage });

type Filter = 'all' | 'radio' | 'stewards' | 'flags';

const matches = (item: FeedItem, filter: Filter) => {
  if (filter === 'all') return true;
  if (filter === 'radio') return item.type === 'radio';
  if (item.type !== 'message') return false;
  if (filter === 'stewards') return ['penalty', 'investigation', 'track-limits'].includes(item.message.kind);
  return item.message.kind === 'flag' || item.message.kind === 'conditions';
};

/** "Lap 12" in races, minutes into the session otherwise. */
export function when(story: SessionStory, t: number, lap: number | null) {
  if (story.meta.kind === 'race') return lap === null || lap < 1 ? (t < 0 ? 'Pre-race' : 'Lap 1') : `Lap ${Math.ceil(lap)}`;
  const minutes = Math.max(0, Math.floor(t / 60));
  return `${minutes}'`;
}

/** One row of the feed (also used in the replay). */
export function FeedRow({ story, item }: { story: SessionStory; item: FeedItem }) {
  const drivers = driverLookup(story);
  const { focused, toggle } = useFocus();
  const style = item.type === 'radio' ? messageStyle.radio : messageStyle[item.message.kind];
  const named = item.type === 'radio' ? [item.clip.driver] : item.message.drivers;
  return (
    <Stack direction="row" spacing={1.5} alignItems="center" sx={{ py: 0.75, borderBottom: `1px solid ${colors.border}` }}>
      <Typography variant="caption" sx={{ width: 56, flexShrink: 0, color: colors.muted, fontVariantNumeric: 'tabular-nums' }}>
        {when(story, item.t, item.lap)}
      </Typography>
      <Box sx={{ width: 3, alignSelf: 'stretch', bgcolor: style.color, borderRadius: 1, flexShrink: 0 }} />
      {item.type === 'radio' ? (
        <>
          <PlayButton url={item.clip.url} />
          <DriverChip driver={drivers.get(item.clip.driver)} active={focused.has(item.clip.driver)} onClick={() => toggle(item.clip.driver)} />
          <Typography variant="body2" sx={{ color: colors.muted }}>
            Team radio · {drivers.get(item.clip.driver)?.name}
          </Typography>
        </>
      ) : (
        <>
          <Typography variant="caption" sx={{ color: style.color, width: 84, flexShrink: 0, fontWeight: 600 }}>
            {style.label}
          </Typography>
          <Typography variant="body2" sx={{ flex: 1, minWidth: 0 }}>
            {item.message.text}
          </Typography>
          {named.length > 0 && (
            <Stack direction="row" spacing={0.5} sx={{ display: { xs: 'none', sm: 'flex' } }}>
              {named.map((n) => (
                <DriverChip key={n} driver={drivers.get(n)} active={focused.has(n)} onClick={() => toggle(n)} />
              ))}
            </Stack>
          )}
        </>
      )}
    </Stack>
  );
}

export function feedItems(story: SessionStory): FeedItem[] {
  const items: FeedItem[] = [
    ...(story.radio ?? []).map((clip) => ({ t: clip.t, lap: clip.lap, type: 'radio' as const, clip })),
    ...(story.messages ?? []).map((message) => ({ t: message.t, lap: message.lap, type: 'message' as const, message })),
  ];
  return items.sort((a, b) => a.t - b.t);
}

/** Chronological feed of team radio and race control, filtered by type and highlighted drivers. */
export function RadioFeed({ story }: { story: SessionStory }) {
  const { focused } = useFocus();
  const [filter, setFilter] = useState<Filter>('all');
  const [showAll, setShowAll] = useState(false);
  const all = feedItems(story);
  const items = all.filter(
    (item) =>
      matches(item, filter) &&
      (focused.size === 0 || (item.type === 'radio' ? focused.has(item.clip.driver) : item.message.drivers.some((n) => focused.has(n))))
  );
  const shown = showAll ? items : items.slice(0, 40);
  const count = (f: Filter) => all.filter((i) => matches(i, f)).length;

  return (
    <Box>
      <Stack direction={{ xs: 'column', sm: 'row' }} spacing={1} alignItems={{ sm: 'center' }} justifyContent="space-between" sx={{ mb: 1 }}>
        <ToggleButtonGroup size="small" exclusive value={filter} onChange={(_, v) => v && setFilter(v)}>
          <ToggleButton value="all">All ({count('all')})</ToggleButton>
          <ToggleButton value="radio">Radio ({count('radio')})</ToggleButton>
          <ToggleButton value="stewards">Stewards ({count('stewards')})</ToggleButton>
          <ToggleButton value="flags">Flags & conditions ({count('flags')})</ToggleButton>
        </ToggleButtonGroup>
        {focused.size > 0 && (
          <Typography variant="caption" sx={{ color: colors.muted }}>
            Showing highlighted drivers only
          </Typography>
        )}
      </Stack>
      {shown.length === 0 && (
        <Typography variant="body2" sx={{ color: colors.muted, py: 2 }}>
          Nothing here{focused.size ? ' for the highlighted drivers' : ''}.
        </Typography>
      )}
      <Box sx={{ maxHeight: showAll ? 'none' : 640, overflowY: 'auto' }}>
        {shown.map((item, i) => (
          <FeedRow key={`${item.type}-${item.t}-${i}`} story={story} item={item} />
        ))}
      </Box>
      {items.length > shown.length && (
        <Chip label={`Show all ${items.length}`} onClick={() => setShowAll(true)} variant="outlined" sx={{ mt: 1.5 }} />
      )}
    </Box>
  );
}
