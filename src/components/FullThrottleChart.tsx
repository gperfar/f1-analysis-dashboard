import React, { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { Typography, Box, CircularProgress, Alert } from '@mui/material';
import axios from 'axios';
import { SessionData } from '../types';

interface ThrottleData {
  driver: string;
  name: string;
  team: string;
  throttle_percentage: number;
  lap_number: number;
}

interface FullThrottleResponse {
  full_throttle_data: ThrottleData[];
  session_info: {
    event_name: string;
    year: number;
    session_name: string;
  };
}

interface FullThrottleChartProps {
  sessionData: SessionData;
}

const FullThrottleChart: React.FC<FullThrottleChartProps> = ({ sessionData }) => {
  const [throttleData, setThrottleData] = useState<FullThrottleResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const loadThrottleData = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await axios.get(
          `/api/full-throttle/${sessionData.session_info.year}/${sessionData.session_info.round}/${sessionData.session_info.session_type}`
        );
        setThrottleData(response.data);
      } catch (err) {
        setError('Failed to load full throttle data');
        console.error('Error loading throttle data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadThrottleData();
  }, [sessionData]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height={400}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !throttleData || throttleData.full_throttle_data.length === 0) {
    return (
      <Alert severity="info">
        Full throttle data not available for this session. Telemetry data may be limited.
      </Alert>
    );
  }

  // Prepare data for the chart
  const drivers = throttleData.full_throttle_data.map(d => d.driver);
  const percentages = throttleData.full_throttle_data.map(d => d.throttle_percentage);

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

  const barColors = throttleData.full_throttle_data.map(d => teamColors[d.team] || '#666666');

  const data = [{
    type: 'bar' as const,
    orientation: 'h' as const,
    x: percentages,
    y: drivers,
    text: percentages.map(p => p.toFixed(1) + '%'),
    textposition: 'auto',
    marker: {
      color: barColors,
    },
    hovertemplate:
      '<b>%{y}</b><br>' +
      'Full Throttle: %{x:.1f}%<br>' +
      'Team: %{customdata}<br>' +
      '<extra></extra>',
    customdata: throttleData.full_throttle_data.map(d => d.team),
  }];

  const layout = {
    title: {
      text: `${throttleData.session_info.event_name} ${throttleData.session_info.year} - ${throttleData.session_info.session_name}`,
      font: { size: 14 }
    },
    xaxis: {
      title: 'Percentage of Lap at Full Throttle',
      gridcolor: 'rgba(255,255,255,0.3)',
      range: [0, 100],
    },
    yaxis: {
      title: 'Driver',
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
      text: '% of lap at full throttle by driver (fastest lap)',
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
        Full Throttle Percentage
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={1}>
        Percentage of fastest lap spent at full throttle (99%+)
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

export default FullThrottleChart;


