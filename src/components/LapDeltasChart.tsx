import React, { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { Typography, Box, CircularProgress, Alert } from '@mui/material';
import axios from 'axios';
import { SessionData } from '../types';

interface LapDelta {
  driver: string;
  name: string;
  team: string;
  lap_time: number;
  delta_to_pole: number;
  lap_number: number;
}

interface LapDeltasData {
  lap_deltas: LapDelta[];
  pole_lap: {
    driver: string;
    time: number;
    time_formatted: string;
  };
  session_info: {
    event_name: string;
    year: number;
    session_name: string;
  };
}

interface LapDeltasChartProps {
  sessionData: SessionData;
}

const LapDeltasChart: React.FC<LapDeltasChartProps> = ({ sessionData }) => {
  const [lapDeltasData, setLapDeltasData] = useState<LapDeltasData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const loadLapDeltas = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await axios.get(
          `/api/lap-deltas/${sessionData.session_info.year}/${sessionData.session_info.round}/${sessionData.session_info.session_type}`
        );
        setLapDeltasData(response.data);
      } catch (err) {
        setError('Failed to load lap deltas data');
        console.error('Error loading lap deltas:', err);
      } finally {
        setLoading(false);
      }
    };

    loadLapDeltas();
  }, [sessionData]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height={400}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !lapDeltasData || lapDeltasData.lap_deltas.length === 0) {
    return (
      <Alert severity="info">
        Lap deltas data not available for this session.
      </Alert>
    );
  }

  // Prepare data for the chart
  const drivers = lapDeltasData.lap_deltas.map(d => d.driver);
  const deltas = lapDeltasData.lap_deltas.map(d => d.delta_to_pole);

  // Team colors
  const teamColors: { [key: string]: string } = {
    'Mercedes': '#00D2BE',
    'Red Bull': '#1E41FF',
    'Ferrari': '#DC0000',
    'McLaren': '#FF8700',
    'Alpine': '#0090FF',
    'Aston Martin': '#006F62',
    'Williams': '#005AFF',
    'Alfa Romeo': '#900000',
    'Haas F1 Team': '#FFFFFF',
    'AlphaTauri': '#2B4562',
  };

  const barColors = lapDeltasData.lap_deltas.map(d => teamColors[d.team] || '#666666');

  const data = [{
    type: 'bar' as const,
    orientation: 'h' as const,
    x: deltas,
    y: drivers,
    text: deltas.map(d => d.toFixed(3) + 's'),
    textposition: 'auto',
    marker: {
      color: barColors,
    },
    hovertemplate:
      '<b>%{y}</b><br>' +
      'Gap to pole: %{x:.3f}s<br>' +
      'Team: %{customdata}<br>' +
      '<extra></extra>',
    customdata: lapDeltasData.lap_deltas.map(d => d.team),
  }];

  const layout = {
    title: {
      text: `${lapDeltasData.session_info.event_name} ${lapDeltasData.session_info.year} - ${lapDeltasData.session_info.session_name}`,
      font: { size: 14 }
    },
    xaxis: {
      title: 'Gap to Pole (seconds)',
      gridcolor: 'rgba(255,255,255,0.3)',
    },
    yaxis: {
      title: 'Driver',
      autorange: 'reversed', // Fastest at top
    },
    margin: {
      l: 80,
      r: 50,
      b: 50,
      t: 80,
    },
    height: 500,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: {
      color: '#ffffff'
    },
    annotations: [{
      text: `Pole: ${lapDeltasData.pole_lap.time_formatted} (${lapDeltasData.pole_lap.driver})`,
      showarrow: false,
      xref: 'paper',
      yref: 'paper',
      x: 0.5,
      y: -0.1,
      xanchor: 'center',
      yanchor: 'top',
      font: {
        size: 12,
        color: '#cccccc'
      }
    }]
  };

  const config = {
    displayModeBar: false,
    responsive: true,
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Lap Time Gaps to Pole
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={1}>
        Each driver's fastest lap gap to the session's pole position
      </Typography>
      <Plot
        data={data}
        layout={layout}
        config={config}
        style={{ width: '100%', height: '500px' }}
      />
    </Box>
  );
};

export default LapDeltasChart;


