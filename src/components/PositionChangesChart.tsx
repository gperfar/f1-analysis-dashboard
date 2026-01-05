import React, { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { Typography, Box, CircularProgress, Alert } from '@mui/material';
import axios from 'axios';
import { SessionData } from '../types';

interface PositionData {
  driver: string;
  name: string;
  team: string;
  lap_numbers: number[];
  positions: number[];
}

interface PositionChangesResponse {
  position_changes: PositionData[];
  session_info: {
    event_name: string;
    year: number;
    session_name: string;
  };
}

interface PositionChangesChartProps {
  sessionData: SessionData;
}

const PositionChangesChart: React.FC<PositionChangesChartProps> = ({ sessionData }) => {
  const [positionData, setPositionData] = useState<PositionChangesResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const loadPositionData = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await axios.get(
          `/api/position-changes/${sessionData.session_info.year}/${sessionData.session_info.round}/${sessionData.session_info.session_type}`
        );
        setPositionData(response.data);
      } catch (err) {
        setError('Failed to load position changes data');
        console.error('Error loading position data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadPositionData();
  }, [sessionData]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height={400}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !positionData || positionData.position_changes.length === 0) {
    return (
      <Alert severity="info">
        Position changes data not available for this session.
      </Alert>
    );
  }

  // Prepare data for the chart
  const data = positionData.position_changes.map((driverData) => {
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

    return {
      type: 'scatter' as const,
      mode: 'lines+markers' as const,
      name: driverData.driver,
      x: driverData.lap_numbers,
      y: driverData.positions,
      line: {
        color: teamColors[driverData.team] || '#666666',
        width: 2,
      },
      marker: {
        size: 4,
        color: teamColors[driverData.team] || '#666666',
      },
      hovertemplate:
        '<b>%{fullData.name}</b><br>' +
        'Position: %{y}<br>' +
        'Lap: %{x}<br>' +
        'Team: ' + driverData.team + '<br>' +
        '<extra></extra>',
    };
  });

  const layout = {
    title: {
      text: `${positionData.session_info.event_name} ${positionData.session_info.year} - ${positionData.session_info.session_name}`,
      font: { size: 14 }
    },
    xaxis: {
      title: 'Lap Number',
      gridcolor: 'rgba(255,255,255,0.3)',
      tickmode: 'linear',
      dtick: 1,
    },
    yaxis: {
      title: 'Position',
      autorange: 'reversed', // Position 1 at top
      range: [20.5, 0.5],
      tickvals: [1, 5, 10, 15, 20],
      gridcolor: 'rgba(255,255,255,0.3)',
    },
    margin: {
      l: 60,
      r: 150, // Extra space for legend
      b: 50,
      t: 80,
    },
    height: 500,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: {
      color: '#ffffff'
    },
    showlegend: true,
    legend: {
      x: 1.02,
      y: 1,
      bgcolor: 'rgba(0,0,0,0.5)',
      bordercolor: 'rgba(255,255,255,0.3)',
      borderwidth: 1,
    },
  };

  const config = {
    displayModeBar: false,
    responsive: true,
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Position Changes Throughout Session
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={1}>
        How each driver's position changed over the course of the session
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

export default PositionChangesChart;


