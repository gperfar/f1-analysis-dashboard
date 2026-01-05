import React, { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { Typography, Box, CircularProgress, Alert } from '@mui/material';
import axios from 'axios';
import { SessionData } from '../types';

interface FastestLap {
  driver: string;
  name: string;
  team: string;
  lap_time: number;
  lap_time_str: string;
  delta_to_pole: number;
  lap_number: number;
  tyre?: string;
}

interface FastestLapsResponse {
  fastest_laps: FastestLap[];
  pole_lap: {
    driver: string;
    time_str: string;
  };
  session_info: {
    event_name: string;
    year: number;
    session_name: string;
  };
}

interface FastestLapsChartProps {
  sessionData: SessionData;
}

const FastestLapsChart: React.FC<FastestLapsChartProps> = ({ sessionData }) => {
  const [data, setData] = useState<FastestLapsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const loadFastestLaps = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await axios.get(
          `/api/fastest-laps/${sessionData.session_info.year}/${sessionData.session_info.round}/${sessionData.session_info.session_type}`
        );
        setData(response.data);
      } catch (err) {
        setError('Failed to load fastest laps data');
        console.error('Error loading fastest laps:', err);
      } finally {
        setLoading(false);
      }
    };

    loadFastestLaps();
  }, [sessionData]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height={400}>
        <CircularProgress />
      </Box>
    );
  }

  if (error) {
    return (
      <Alert severity="error">
        {error}
      </Alert>
    );
  }

  if (!data || data.fastest_laps.length === 0) {
    return (
      <Alert severity="info">
        No fastest lap data available for this session.
      </Alert>
    );
  }

  // Prepare data for the horizontal bar chart
  const drivers = data.fastest_laps.map(lap => lap.driver);
  const deltas = data.fastest_laps.map(lap => lap.delta_to_pole);
  const teams = data.fastest_laps.map(lap => lap.team);

  // Create colors based on teams
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

  const barColors = teams.map(team => teamColors[team] || '#666666');

  const plotData = [{
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
    customdata: teams,
  }];

  const layout = {
    title: {
      text: `${data.session_info.event_name} ${data.session_info.year} - ${data.session_info.session_name}`,
      font: { size: 14 }
    },
    xaxis: {
      title: 'Gap (s)',
      gridcolor: 'rgba(255,255,255,0.3)',
    },
    yaxis: {
      title: 'Driver',
      autorange: 'reversed', // Show fastest at the top
    },
    margin: {
      l: 80,
      r: 50,
      b: 80,
      t: 80,
    },
    height: 500,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: {
      color: '#ffffff'
    },
    annotations: [{
      text: `Each driver's fastest lap gap to best.\nBest: ${data.pole_lap.time_str} (${data.pole_lap.driver})`,
      showarrow: false,
      xref: 'paper',
      yref: 'paper',
      x: 0.5,
      y: -0.15,
      xanchor: 'center',
      yanchor: 'top',
      font: {
        size: 11,
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
        Fastest Lap Gaps to Pole
      </Typography>
      <Plot
        data={plotData}
        layout={layout}
        config={config}
        style={{ width: '100%', height: '500px' }}
      />
    </Box>
  );
};

export default FastestLapsChart;

