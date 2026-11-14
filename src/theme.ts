import { createTheme } from '@mui/material/styles';

export const colors = {
  bg: '#0d0d10',
  panel: '#16161b',
  panelRaised: '#1d1d24',
  border: '#2a2a33',
  grid: '#26262e',
  text: '#ececf1',
  muted: '#9a9aa8',
  accent: '#e10600', // F1 red
  sc: 'rgba(255, 196, 0, 0.16)',
  vsc: 'rgba(255, 196, 0, 0.08)',
  red: 'rgba(225, 6, 0, 0.18)',
};

export const tyreColors: Record<string, string> = {
  SOFT: '#e8002d',
  MEDIUM: '#ffd12e',
  HARD: '#f0f0ec',
  INTERMEDIATE: '#43b02a',
  WET: '#0067ad',
  UNKNOWN: '#6b6b76',
  TEST_UNKNOWN: '#6b6b76',
};

export const fontFamily = '"Titillium Web", "Roboto", "Helvetica", "Arial", sans-serif';

export const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: { main: colors.accent },
    background: { default: colors.bg, paper: colors.panel },
    text: { primary: colors.text, secondary: colors.muted },
    divider: colors.border,
  },
  shape: { borderRadius: 10 },
  typography: {
    fontFamily,
    h1: { fontWeight: 700, letterSpacing: '-0.02em' },
    h2: { fontWeight: 700, letterSpacing: '-0.01em' },
    h3: { fontWeight: 700 },
    h4: { fontWeight: 700 },
    h5: { fontWeight: 700 },
    h6: { fontWeight: 600 },
    overline: { letterSpacing: '0.12em', fontWeight: 600 },
  },
  components: {
    MuiPaper: { styleOverrides: { root: { backgroundImage: 'none', border: `1px solid ${colors.border}` } } },
    MuiChip: { styleOverrides: { root: { fontWeight: 600 } } },
  },
});
