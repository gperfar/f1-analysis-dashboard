import React, { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { Typography, Box, CircularProgress, Alert } from '@mui/material';
import axios from 'axios';
import { StartAnalysis } from '../types';

interface StartAnalysisChartProps {
  year: number;
  round: number;
}

const StartAnalysisChart: React.FC<StartAnalysisChartProps> = ({ year, round }) => {
  const [startData, setStartData] = useState<StartAnalysis[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const loadStartAnalysis = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await axios.get(`/api/start-analysis/${year}/${round}`);
        setStartData(response.data.start_analysis);
      } catch (err) {
        setError('Failed to load start analysis data');
        console.error('Error loading start analysis:', err);
      } finally {
        setLoading(false);
      }
    };

    loadStartAnalysis();
  }, [year, round]);

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

  if (startData.length === 0) {
    return (
      <Alert severity="info">
        No start analysis data available for this race.
      </Alert>
    );
  }

  // Show all drivers, even with partial data
  const drivers = startData.map(d => d.driver);
  const timeTo100 = startData.map(d => d.time_to_100);
  const timeTo200 = startData.map(d => d.time_to_200);
  const teams = startData.map(d => d.team);

  // Create colors based on teams (simplified team colors)
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

  const data = [
    {
      type: 'bar' as const,
      name: 'Time to 100 km/h',
      x: drivers,
      y: timeTo100,
      text: timeTo100.map(t => t !== null ? t.toFixed(2) + 's' : 'No data'),
      textposition: 'auto',
      marker: {
        color: barColors.map(color => color + '80'), // Add transparency
      },
      hovertemplate:
        '<b>%{x}</b><br>' +
        'Time to 100 km/h: %{y:.2f}s<br>' +
        'Team: %{customdata}<br>' +
        '<extra></extra>',
      customdata: teams,
    },
    {
      type: 'bar' as const,
      name: 'Time to 200 km/h',
      x: drivers,
      y: timeTo200,
      text: timeTo200.map(t => t !== null ? t.toFixed(2) + 's' : 'No data'),
      textposition: 'auto',
      marker: {
        color: barColors,
      },
      hovertemplate:
        '<b>%{x}</b><br>' +
        'Time to 200 km/h: %{y:.2f}s<br>' +
        'Team: %{customdata}<br>' +
        '<extra></extra>',
      customdata: teams,
    }
  ];

  const layout = {
    title: {
      text: 'Start Analysis - Acceleration Times',
      font: { size: 16 }
    },
    xaxis: {
      title: 'Driver',
      tickangle: -45,
    },
    yaxis: {
      title: 'Time (seconds)',
      autorange: 'reversed', // Faster times at the top
    },
    barmode: 'group',
    margin: {
      l: 50,
      r: 50,
      b: 100,
      t: 50,
    },
    height: 400,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: {
      color: '#ffffff'
    },
    showlegend: true,
    legend: {
      x: 0,
      y: 1,
      bgcolor: 'rgba(0,0,0,0.5)',
    },
  };

  const config = {
    displayModeBar: false,
    responsive: true,
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Start Analysis
      </Typography>
      <Plot
        data={data}
        layout={layout}
        config={config}
        style={{ width: '100%', height: '400px' }}
      />
    </Box>
  );
};

export default StartAnalysisChart;

