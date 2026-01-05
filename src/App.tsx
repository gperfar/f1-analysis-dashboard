import { useState } from 'react';
import { ThemeProvider, createTheme } from '@mui/material/styles';
import { CssBaseline, Container, Typography, Box, Paper, Grid, Card, CardContent } from '@mui/material';
import { Timeline, Speed, Route, Assessment, TrendingUp, PlayArrow } from '@mui/icons-material';
import SessionSelector from './components/SessionSelector';
import FastestLapsChart from './components/FastestLapsChart';
import StartAnalysisChart from './components/StartAnalysisChart';
import TireStrategyChart from './components/TireStrategyChart';
import CorneringAnalysisChart from './components/CorneringAnalysisChart';
import CircuitMapChart from './components/CircuitMapChart';
import LapDeltasChart from './components/LapDeltasChart';
import FullThrottleChart from './components/FullThrottleChart';
import PositionChangesChart from './components/PositionChangesChart';
import SpeedDistanceChart from './components/SpeedDistanceChart';
import { SessionData } from './types';

const theme = createTheme({
  palette: {
    mode: 'dark',
    primary: {
      main: '#ff0000', // F1 red
    },
    secondary: {
      main: '#ffffff',
    },
    background: {
      default: '#121212',
      paper: '#1e1e1e',
    },
  },
  typography: {
    fontFamily: '"Roboto", "Helvetica", "Arial", sans-serif',
    h4: {
      fontWeight: 600,
    },
  },
});

function App() {
  const [selectedSession, setSelectedSession] = useState<SessionData | null>(null);
  const [loading, setLoading] = useState(false);

  return (
    <ThemeProvider theme={theme}>
      <CssBaseline />
      <Container maxWidth="xl" sx={{ py: 4 }}>
        {/* Hero Section */}
        <Box textAlign="center" mb={6}>
          <Typography variant="h2" component="h1" gutterBottom color="primary" sx={{ fontWeight: 700 }}>
            F1 Analysis Dashboard
          </Typography>
          <Typography variant="h5" color="text.secondary" sx={{ mb: 2, maxWidth: 600, mx: 'auto' }}>
            Deep-dive into Formula 1 telemetry data with interactive charts and advanced analytics
          </Typography>
          <Typography variant="body1" color="text.secondary" sx={{ maxWidth: 800, mx: 'auto', mb: 3 }}>
            Analyze lap times, speed profiles, tire strategies, and race performance across all F1 sessions.
            From pole position battles to corner-by-corner speed analysis.
          </Typography>
          <Typography variant="body2" color="text.secondary" sx={{ maxWidth: 600, mx: 'auto' }}>
            <strong>Data Coverage:</strong> F1 sessions from 2018 onwards with detailed telemetry including speed, throttle, brake data, and lap timing.
            <br />
            <strong>Live Data:</strong> Historical sessions are cached for fast loading. New sessions become available shortly after completion.
          </Typography>
        </Box>

        {/* Features Grid */}
        <Grid container spacing={3} sx={{ mb: 6 }}>
          <Grid item xs={12} md={6} lg={3}>
            <Card sx={{ height: '100%', bgcolor: 'background.paper' }}>
              <CardContent sx={{ textAlign: 'center', p: 3 }}>
                <Timeline sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  Lap Time Analysis
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Compare fastest laps and gaps to pole position across all drivers
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6} lg={3}>
            <Card sx={{ height: '100%', bgcolor: 'background.paper' }}>
              <CardContent sx={{ textAlign: 'center', p: 3 }}>
                <Speed sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  Speed Profiles
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Analyze speed throughout laps and corner-by-corner performance
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6} lg={3}>
            <Card sx={{ height: '100%', bgcolor: 'background.paper' }}>
              <CardContent sx={{ textAlign: 'center', p: 3 }}>
                <Route sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  Circuit Maps
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Interactive track layouts with numbered corners and start/finish lines
                </Typography>
              </CardContent>
            </Card>
          </Grid>

          <Grid item xs={12} md={6} lg={3}>
            <Card sx={{ height: '100%', bgcolor: 'background.paper' }}>
              <CardContent sx={{ textAlign: 'center', p: 3 }}>
                <Assessment sx={{ fontSize: 48, color: 'primary.main', mb: 2 }} />
                <Typography variant="h6" gutterBottom>
                  Tire Strategy
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Track tire compound usage and pit stop patterns throughout sessions
                </Typography>
              </CardContent>
            </Card>
          </Grid>
        </Grid>

        {/* What Makes This Special */}
        <Paper elevation={2} sx={{ p: 4, mb: 4, bgcolor: 'background.paper' }}>
          <Typography variant="h4" gutterBottom color="primary" align="center">
            Advanced F1 Analytics
          </Typography>
          <Grid container spacing={3}>
            <Grid item xs={12} md={4}>
              <Typography variant="h6" gutterBottom color="secondary">
                📊 Real Telemetry Data
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Access actual F1 car data including speed profiles, throttle/brake usage, and precise lap timing from official sources.
              </Typography>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="h6" gutterBottom color="secondary">
                🎯 Interactive Charts
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Zoom, pan, and hover over charts to explore data in detail. Compare drivers, analyze racing strategies, and spot performance trends.
              </Typography>
            </Grid>
            <Grid item xs={12} md={4}>
              <Typography variant="h6" gutterBottom color="secondary">
                🏎️ Race Strategy Insights
              </Typography>
              <Typography variant="body2" color="text.secondary">
                Understand tire degradation patterns, fuel strategies, and DRS zone performance through comprehensive session analysis.
              </Typography>
            </Grid>
          </Grid>
        </Paper>

        {/* How to Use Section */}
        <Paper elevation={2} sx={{ p: 4, mb: 4, bgcolor: 'background.paper' }}>
          <Typography variant="h4" gutterBottom color="primary" align="center">
            How to Use
          </Typography>
          <Grid container spacing={3} alignItems="center">
            <Grid item xs={12} md={4}>
              <Box textAlign="center">
                <Box sx={{
                  width: 60,
                  height: 60,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 2,
                  mx: 'auto'
                }}>
                  <Typography variant="h5" color="white">1</Typography>
                </Box>
                <Typography variant="h6" gutterBottom>
                  Select Session
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Choose any F1 race weekend and session type from the dropdown menus
                </Typography>
              </Box>
            </Grid>

            <Grid item xs={12} md={4}>
              <Box textAlign="center">
                <Box sx={{
                  width: 60,
                  height: 60,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 2,
                  mx: 'auto'
                }}>
                  <PlayArrow sx={{ color: 'white', fontSize: 30 }} />
                </Box>
                <Typography variant="h6" gutterBottom>
                  Click Go
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Load the telemetry data and watch the interactive charts appear
                </Typography>
              </Box>
            </Grid>

            <Grid item xs={12} md={4}>
              <Box textAlign="center">
                <Box sx={{
                  width: 60,
                  height: 60,
                  borderRadius: '50%',
                  bgcolor: 'primary.main',
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  mb: 2,
                  mx: 'auto'
                }}>
                  <TrendingUp sx={{ color: 'white', fontSize: 30 }} />
                </Box>
                <Typography variant="h6" gutterBottom>
                  Analyze Data
                </Typography>
                <Typography variant="body2" color="text.secondary">
                  Explore lap times, speed profiles, tire strategies, and race insights
                </Typography>
              </Box>
            </Grid>
          </Grid>
        </Paper>

        {/* Session Selector */}
        <Paper elevation={3} sx={{ p: 3, mb: 4 }}>
          <Typography variant="h5" gutterBottom color="primary">
            Select Session
          </Typography>
          <SessionSelector
            onSessionSelect={setSelectedSession}
            loading={loading}
            setLoading={setLoading}
          />
        </Paper>

        {selectedSession && (
          <Box>
            <Typography variant="h5" gutterBottom sx={{ mb: 3 }}>
              {selectedSession.session_info.event_name} - {selectedSession.session_info.session_type.toUpperCase()}
            </Typography>

            <Grid container spacing={3}>
              <Grid item xs={12}>
                <Paper elevation={2} sx={{ p: 2 }}>
                  <CircuitMapChart sessionData={selectedSession} />
                </Paper>
              </Grid>

              <Grid item xs={12}>
                <Paper elevation={2} sx={{ p: 2 }}>
                  <FastestLapsChart sessionData={selectedSession} />
                </Paper>
              </Grid>

              <Grid item xs={12}>
                <Paper elevation={2} sx={{ p: 2 }}>
                  <StartAnalysisChart
                    year={selectedSession.session_info.year}
                    round={selectedSession.session_info.round}
                  />
                </Paper>
              </Grid>

              <Grid item xs={12}>
                <Paper elevation={2} sx={{ p: 2 }}>
                  <TireStrategyChart sessionData={selectedSession} />
                </Paper>
              </Grid>

              <Grid item xs={12}>
                <Paper elevation={2} sx={{ p: 2 }}>
                  <LapDeltasChart sessionData={selectedSession} />
                </Paper>
              </Grid>

              <Grid item xs={12}>
                <Paper elevation={2} sx={{ p: 2 }}>
                  <FullThrottleChart sessionData={selectedSession} />
                </Paper>
              </Grid>

              <Grid item xs={12}>
                <Paper elevation={2} sx={{ p: 2 }}>
                  <PositionChangesChart sessionData={selectedSession} />
                </Paper>
              </Grid>

              <Grid item xs={12}>
                <Paper elevation={2} sx={{ p: 2 }}>
                  <SpeedDistanceChart sessionData={selectedSession} />
                </Paper>
              </Grid>

              <Grid item xs={12}>
                <Paper elevation={2} sx={{ p: 2 }}>
                  <CorneringAnalysisChart sessionData={selectedSession} />
                </Paper>
              </Grid>
            </Grid>
          </Box>
        )}
      </Container>
    </ThemeProvider>
  );
}

export default App;
