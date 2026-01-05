import React, { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { Typography, Box, CircularProgress, Alert } from '@mui/material';
import axios from 'axios';
import { SessionData } from '../types';

interface CornerData {
  corner_number: number;
  distance: number;
  reference_speed: number;
  driver_speeds: {
    driver: string;
    name: string;
    team: string;
    speed: number;
  }[];
}

interface CorneringAnalysisChartProps {
  sessionData: SessionData;
}

const CorneringAnalysisChart: React.FC<CorneringAnalysisChartProps> = ({ sessionData }) => {
  const [cornerData, setCornerData] = useState<CornerData[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const loadCorneringAnalysis = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await axios.get(
          `/api/cornering-analysis/${sessionData.session_info.year}/${sessionData.session_info.round}/${sessionData.session_info.session_type}`
        );
        setCornerData(response.data.corner_analysis);
      } catch (err) {
        setError('Failed to load cornering analysis data');
        console.error('Error loading cornering analysis:', err);
      } finally {
        setLoading(false);
      }
    };

    loadCorneringAnalysis();
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

  if (cornerData.length === 0) {
    return (
      <Alert severity="info">
        Cornering analysis is currently unavailable. This feature will be available in a future update.
      </Alert>
    );
  }

  // Create a scatter plot for each corner
  const traces = cornerData.map((corner, index) => {
    const drivers = corner.driver_speeds.map(d => d.driver);
    const speeds = corner.driver_speeds.map(d => d.speed);
    const teams = corner.driver_speeds.map(d => d.team);

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
      mode: 'markers' as const,
      name: `Corner ${corner.corner_number}`,
      x: drivers,
      y: speeds,
      text: speeds.map(s => s.toFixed(1) + ' km/h'),
      marker: {
        size: 10,
        color: teamColors[teams[0]] || '#666666', // Use first driver's team color
        line: {
          width: 2,
          color: '#ffffff',
        },
      },
      xaxis: `x${index + 1}` as any,
      yaxis: `y${index + 1}` as any,
      hovertemplate:
        '<b>%{x}</b><br>' +
        'Speed: %{y:.1f} km/h<br>' +
        'Team: %{customdata}<br>' +
        '<extra></extra>',
      customdata: teams,
    };
  });

  // Create subplots layout
  const rows = Math.ceil(cornerData.length / 2);
  const cols = Math.min(2, cornerData.length);

  const layout = {
    title: {
      text: 'Cornering Analysis - Speed Through Corners',
      font: { size: 16 }
    },
    showlegend: false,
    margin: {
      l: 50,
      r: 50,
      b: 50,
      t: 80,
    },
    height: rows * 300,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: {
      color: '#ffffff'
    },
    grid: {
      rows: rows,
      columns: cols,
      pattern: 'independent',
    },
  };

  // Add subplot configurations
  for (let i = 0; i < cornerData.length; i++) {
    const row = Math.floor(i / cols) + 1;
    const col = (i % cols) + 1;

    layout[`xaxis${i + 1}`] = {
      title: `Corner ${cornerData[i].corner_number}`,
      tickangle: -45,
      anchor: `y${i + 1}`,
    };

    layout[`yaxis${i + 1}`] = {
      title: 'Speed (km/h)',
      anchor: `x${i + 1}`,
    };
  }

  const config = {
    displayModeBar: false,
    responsive: true,
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Cornering Analysis
      </Typography>
      <Typography variant="body2" color="text.secondary" mb={2}>
        Speed comparison through detected corners (based on significant speed reductions)
      </Typography>
      <Plot
        data={traces}
        layout={layout}
        config={config}
        style={{ width: '100%', height: `${rows * 300}px` }}
      />
    </Box>
  );
};

export default CorneringAnalysisChart;
