import React, { useState, useEffect } from 'react';
import Plot from 'react-plotly.js';
import { Typography, Box, CircularProgress, Alert } from '@mui/material';
import axios from 'axios';
import { SessionData } from '../types';

interface Corner {
  number: number;
  letter: string;
  label: string;
  track_x: number;
  track_y: number;
  text_x: number;
  text_y: number;
}

interface CircuitMapData {
  track_name: string;
  track_coordinates: number[][];
  start_finish: {
    x: number[];
    y: number[];
  };
  corners: Corner[];
  rotation_angle: number;
}

interface CircuitMapChartProps {
  sessionData: SessionData;
}

const CircuitMapChart: React.FC<CircuitMapChartProps> = ({ sessionData }) => {
  const [circuitData, setCircuitData] = useState<CircuitMapData | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string>('');

  useEffect(() => {
    const loadCircuitMap = async () => {
      try {
        setLoading(true);
        setError('');
        const response = await axios.get(
          `/api/circuit-map/${sessionData.session_info.year}/${sessionData.session_info.round}/${sessionData.session_info.session_type}`
        );

        if (response.data.error) {
          setError(response.data.error);
        } else {
          setCircuitData(response.data);
        }
      } catch (err) {
        setError('Failed to load circuit map data');
        console.error('Error loading circuit map:', err);
      } finally {
        setLoading(false);
      }
    };

    loadCircuitMap();
  }, [sessionData]);

  if (loading) {
    return (
      <Box display="flex" justifyContent="center" alignItems="center" height={600}>
        <CircularProgress />
      </Box>
    );
  }

  if (error || !circuitData) {
    return (
      <Alert severity="info">
        Circuit map not available for this session. This may be due to limited telemetry data.
      </Alert>
    );
  }

  // Prepare track coordinates
  const trackX = circuitData.track_coordinates.map(coord => coord[0]);
  const trackY = circuitData.track_coordinates.map(coord => coord[1]);

  // Prepare data for Plotly
  const data = [
    // Track outline
    {
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: 'Track',
      x: trackX,
      y: trackY,
      line: {
        color: '#1f77b4',
        width: 4,
      },
      showlegend: false,
    },
    // Start/Finish line
    {
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: 'Start/Finish',
      x: circuitData.start_finish.x,
      y: circuitData.start_finish.y,
      line: {
        color: 'white',
        width: 8,
      },
      showlegend: false,
    },
  ];

  // Add corner markers and labels
  circuitData.corners.forEach((corner) => {
    // Add connecting line from track to label
    data.push({
      type: 'scatter' as const,
      mode: 'lines' as const,
      name: `Corner ${corner.label}`,
      x: [corner.track_x, corner.text_x],
      y: [corner.track_y, corner.text_y],
      line: {
        color: 'grey',
        width: 1,
      },
      showlegend: false,
    });

    // Add corner marker (circle)
    data.push({
      type: 'scatter' as const,
      mode: 'markers',
      name: `Corner ${corner.label}`,
      x: [corner.text_x],
      y: [corner.text_y],
      marker: {
        color: 'grey',
        size: 15,
      },
      showlegend: false,
    });

    // Add corner label text
    data.push({
      type: 'scatter' as const,
      mode: 'text',
      name: `Corner ${corner.label}`,
      x: [corner.text_x],
      y: [corner.text_y],
      text: [corner.label],
      textposition: 'middle center',
      textfont: {
        color: 'white',
        size: 10,
        weight: 'bold',
      },
      showlegend: false,
    });
  });

  // Add direction arrow at start
  if (circuitData.track_coordinates.length >= 2) {
    const startX = circuitData.track_coordinates[0][0];
    const startY = circuitData.track_coordinates[0][1];
    const nextX = circuitData.track_coordinates[1][0];
    const nextY = circuitData.track_coordinates[1][1];

    // Calculate angle for arrow
    const angle = Math.atan2(nextY - startY, nextX - startX) * (180 / Math.PI);

    data.push({
      type: 'scatter' as const,
      mode: 'text',
      name: 'Direction',
      x: [startX],
      y: [startY],
      text: ['→'],
      textposition: 'middle center',
      textfont: {
        color: 'grey',
        size: 20,
        weight: 'bold',
      },
      showlegend: false,
    });
  }

  const layout = {
    title: {
      text: `${circuitData.track_name} Circuit Map`,
      font: { size: 16 }
    },
    xaxis: {
      showticklabels: false,
      showgrid: false,
      zeroline: false,
    },
    yaxis: {
      showticklabels: false,
      showgrid: false,
      zeroline: false,
      scaleanchor: 'x',
      scaleratio: 1,
    },
    margin: {
      l: 20,
      r: 20,
      b: 20,
      t: 50,
    },
    height: 600,
    paper_bgcolor: 'rgba(0,0,0,0)',
    plot_bgcolor: 'rgba(0,0,0,0)',
    font: {
      color: '#ffffff'
    },
    showlegend: false,
  };

  const config = {
    displayModeBar: false,
    responsive: true,
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Circuit Map
      </Typography>
      <Plot
        data={data}
        layout={layout}
        config={config}
        style={{ width: '100%', height: '600px' }}
      />
    </Box>
  );
};

export default CircuitMapChart;

