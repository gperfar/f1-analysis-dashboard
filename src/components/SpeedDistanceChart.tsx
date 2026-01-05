import React, { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { Typography, Box, CircularProgress, Alert } from '@mui/material';
import axios from 'axios';
import { SessionData } from '../types';

interface SpeedData {
  driver: string;
  name: string;
  team: string;
  distances: number[];
  speeds: number[];
  lap_number: number;
}

interface SpeedDistanceResponse {
  speed_distance_data: SpeedData[];
  session_info: {
    event_name: string;
    year: number;
    session_name: string;
  };
}

interface SpeedDistanceChartProps {
  sessionData: SessionData;
}

const SpeedDistanceChart: React.FC<SpeedDistanceChartProps> = ({ sessionData }) => {
  const [speedData, setSpeedData] = useState<SpeedDistanceResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const loadSpeedData = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await axios.get(
          `/api/speed-distance/${sessionData.session_info.year}/${sessionData.session_info.round}/${sessionData.session_info.session_type}`
        );
        setSpeedData(response.data);
      } catch (err) {
        setError('Failed to load speed vs distance data');
        console.error('Error loading speed data:', err);
      } finally {
        setLoading(false);
      }
    };

    loadSpeedData();
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

  if (!speedData || speedData.speed_distance_data.length === 0) {
    return (
      <Alert severity="info">
        Speed vs distance data not available for this session. Detailed telemetry may be limited.
      </Alert>
    );
  }

  // Prepare data for the chart - limit to top drivers for readability
  const dataToShow = speedData.speed_distance_data.slice(0, 10); // Show top 10 drivers

  const plotData = dataToShow.map((driverData) => {
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

    const color = teamColors[driverData.team] || '#666666';

    return {
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: driverData.driver,
      x: driverData.distances,
      y: driverData.speeds,
      line: {
        color: color,
        width: 2,
      },
      hovertemplate:
        '<b>%{fullData.name}</b><br>' +
        'Distance: %{x:.0f}m<br>' +
        'Speed: %{y:.1f} km/h<br>' +
        'Team: ' + driverData.team + '<br>' +
        '<extra></extra>',
    };
  });

  const layout = {
    title: {
      text: `${speedData.session_info.event_name} ${speedData.session_info.year} - ${speedData.session_info.session_name}`,
      font: { size: 14 }
    },
    xaxis: {
      title: 'Distance (m)',
      gridcolor: 'rgba(255,255,255,0.3)',
    },
    yaxis: {
      title: 'Speed (km/h)',
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
        Speed vs Distance
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={1}>
        Speed profile for each driver's fastest lap (top 10 drivers shown)
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

export default SpeedDistanceChart;

