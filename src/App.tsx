import { useEffect } from 'react';
import { CssBaseline, Container, ThemeProvider } from '@mui/material';
import TopBar from './components/TopBar';
import { ErrorBox, Loading } from './components/ui';
import SeasonPage from './pages/SeasonPage';
import SessionPage from './pages/SessionPage';
import { latestSession } from './lib/data';
import { navigate, useAsync, useRoute } from './hooks';
import { theme } from './theme';

export default function App() {
  const route = useRoute();
  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <TopBar route={route} />
      {route.page === 'latest' && <Latest />}
      {route.page === 'season' && <SeasonPage year={route.year} />}
      {route.page === 'session' && <SessionPage key={`${route.year}/${route.round}/${route.code}`} year={route.year} round={route.round} code={route.code} />}
    </ThemeProvider>
  );
}

/** The home page is the most recent session's story. */
function Latest() {
  const latest = useAsync(latestSession, 'latest');
  useEffect(() => {
    if (latest.data) navigate({ page: 'session', ...latest.data }, true);
  }, [latest.data]);
  return (
    <Container maxWidth="lg" sx={{ py: 5 }}>
      {latest.error ? <ErrorBox message={latest.error} /> : <Loading label="Finding the latest session…" minHeight={400} />}
    </Container>
  );
}
