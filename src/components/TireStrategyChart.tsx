import React, { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { Typography, Box, CircularProgress, Alert } from '@mui/material';
import axios from 'axios';
import { SessionData, TireStrategy } from '../types';

interface TireStrategyChartProps {
  sessionData: SessionData;
}

const TireStrategyChart: React.FC<TireStrategyChartProps> = ({ sessionData }) => {
  const [tireData, setTireData] = useState<TireStrategy[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const loadTireStrategy = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await axios.get(
          `/api/tire-strategy/${sessionData.session_info.year}/${sessionData.session_info.round}/${sessionData.session_info.session_type}`
        );
        setTireData(response.data.tire_strategy);
      } catch (err) {
        setError('Failed to load tire strategy data');
        console.error('Error loading tire strategy:', err);
      } finally {
        setLoading(false);
      }
    };

    loadTireStrategy();
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

  if (tireData.length === 0) {
    return (
      <Alert severity="info">
        No tire strategy data available for this session.
      </Alert>
    );
  }

  // Prepare data for the chart
  const traces = [];
  const tireColors: { [key: string]: string } = {
    'SOFT': '#FF6B6B',
    'MEDIUM': '#FFD93D',
    'HARD': '#6BCF7F',
    'INTERMEDIATE': '#4ECDC4',
    'WET': '#45B7D1',
    'Unknown': '#95A5A6',
  };

  for (const driver of tireData) {
    if (driver.laps.length === 0) continue;

    const laps = driver.laps.map(lap => lap.lap);
    const compounds = driver.laps.map(lap => lap.compound);

    // Group consecutive laps with the same compound
    const segments = [];
    let currentCompound = compounds[0];
    let startLap = laps[0];
    let endLap = laps[0];

    for (let i = 1; i < laps.length; i++) {
      if (compounds[i] === currentCompound) {
        endLap = laps[i];
      } else {
        segments.push({
          driver: driver.driver,
          name: driver.name,
          team: driver.team,
          compound: currentCompound,
          startLap,
          endLap,
        });
        currentCompound = compounds[i];
        startLap = laps[i];
        endLap = laps[i];
      }
    }

    // Add the last segment
    segments.push({
      driver: driver.driver,
      name: driver.name,
      team: driver.team,
      compound: currentCompound,
      startLap,
      endLap,
    });

    // Create traces for each segment
    for (const segment of segments) {
      traces.push({
        type: 'scatter' as const,
        mode: 'lines+markers' as const,
        name: segment.driver,
        x: [segment.startLap, segment.endLap],
        y: [segment.driver, segment.driver],
        line: {
          color: tireColors[segment.compound.toUpperCase()] || '#95A5A6',
          width: 8,
        },
        marker: {
          size: 0, // Hide markers
        },
        showlegend: false, // Custom legend shown above chart
        hovertemplate:
          '<b>%{customdata[0]}</b><br>' +
          'Laps: %{x}<br>' +
          'Tire: %{customdata[1]}<br>' +
          'Team: %{customdata[2]}<br>' +
          '<extra></extra>',
        customdata: [
          [segment.name, segment.compound, segment.team],
          [segment.name, segment.compound, segment.team]
        ],
      });
    }
  }

  const layout = {
    title: {
      text: 'Tire Strategy Throughout Session',
      font: { size: 16 }
    },
    xaxis: {
      title: 'Lap Number',
      tickmode: 'linear',
      dtick: 1,
    },
    yaxis: {
      title: 'Driver',
      autorange: 'reversed', // Drivers in order they finished
    },
    margin: {
      l: 100,
      r: 50,
      b: 50,
      t: 50,
    },
    height: 500,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: {
      color: '#ffffff'
    },
    hovermode: 'closest',
  };

  const config = {
    displayModeBar: false,
    responsive: true,
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Tire Strategy
      </Typography>

      {/* Legend for tire compounds */}
      <Box display="flex" flexWrap="wrap" gap={2} mb={2}>
        {Object.entries(tireColors).map(([compound, color]) => (
          <Box key={compound} display="flex" alignItems="center" gap={1}>
            <Box
              sx={{
                width: 16,
                height: 16,
                backgroundColor: color,
                borderRadius: 1,
              }}
            />
            <Typography variant="body2">{compound}</Typography>
          </Box>
        ))}
      </Box>

      <Plot
        data={traces}
        layout={layout}
        config={config}
        style={{ width: '100%', height: '500px' }}
      />
    </Box>
  );
};

export default TireStrategyChart;

