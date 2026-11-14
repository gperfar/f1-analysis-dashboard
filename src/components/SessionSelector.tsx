import React, { useState, useEffect } from 'react';
import {
  FormControl,
  InputLabel,
  Select,
  MenuItem,
  Box,
  Typography,
  CircularProgress,
  Alert,
  Button
} from '@mui/material';
import axios from 'axios';
import { RaceEvent, SessionData } from '../types';

interface SessionSelectorProps {
  onSessionSelect: (session: SessionData | null) => void;
  loading: boolean;
  setLoading: (loading: boolean) => void;
}

const SessionSelector: React.FC<SessionSelectorProps> = ({
  onSessionSelect,
  loading,
  setLoading
}) => {
  const [year, setYear] = useState<number>(new Date().getFullYear());
  const [selectedEvent, setSelectedEvent] = useState<RaceEvent | null>(null);
  const [sessionType, setSessionType] = useState<string>('R');
  const [events, setEvents] = useState<RaceEvent[]>([]);
  const [error, setError] = useState<string>('');
  const [loadingMessage, setLoadingMessage] = useState<string>('');

  // OpenF1 has free historical data from 2023 onwards
  const FIRST_YEAR = 2023;
  const availableYears = Array.from(
    { length: new Date().getFullYear() - FIRST_YEAR + 1 },
    (_, i) => new Date().getFullYear() - i
  );

  // Sessions of the selected weekend (sprint weekends have SQ/S instead of FP2/FP3)
  const sessionTypes = (selectedEvent?.available_sessions ?? []).map((s) => ({
    value: s.code,
    label: s.name,
  }));

  // Load schedule when year changes
  useEffect(() => {
    const loadSchedule = async () => {
      try {
        setLoading(true);
        setError('');
        setLoadingMessage('Loading race schedule...');
        const response = await axios.get(`/api/schedule/${year}`);
        setEvents(response.data.events);
        setLoadingMessage('Finding most recent session...');

        // Find the most recent completed session
        const now = new Date();
        const currentYear = now.getFullYear();

        // For current year or past years, find the most recent completed race
        if (year <= currentYear) {
          const completedEvents = response.data.events.filter((event: RaceEvent) => {
            if (!event.date) return false;
            const eventDate = new Date(event.date + 'T23:59:59'); // End of event day
            return eventDate < now;
          });

          if (completedEvents.length > 0) {
            // Get the most recent completed event
            const mostRecentEvent = completedEvents.sort((a: RaceEvent, b: RaceEvent) => {
              const dateA = a.date ? new Date(a.date).getTime() : 0;
              const dateB = b.date ? new Date(b.date).getTime() : 0;
              return dateB - dateA;
            })[0];

            setSelectedEvent(mostRecentEvent);
            setSessionType('R'); // Default to race for completed events
          } else if (year === currentYear) {
            // If no completed sessions this year, keep current year but no selection
            setSelectedEvent(null);
            setSessionType('R');
          } else {
            // For past years with no data, just set defaults
            setSelectedEvent(null);
            setSessionType('R');
          }
        }

        onSessionSelect(null);
      } catch (err) {
        setError('Failed to load race schedule');
        console.error('Error loading schedule:', err);
      } finally {
        setLoading(false);
        setLoadingMessage('');
      }
    };

    loadSchedule();
  }, [year]);

  const handleYearChange = (event: any) => {
    setYear(event.target.value);
  };

  const handleEventChange = (event: any) => {
    const eventIndex = event.target.value;
    const newEvent = events[eventIndex] || null;
    setSelectedEvent(newEvent);
    const hasRace = newEvent?.available_sessions?.some((s) => s.code === 'R');
    setSessionType(hasRace ? 'R' : '');
  };

  const handleSessionTypeChange = (event: any) => {
    setSessionType(event.target.value);
  };

  const handleGoClick = async () => {
    if (!selectedEvent || !sessionType) {
      setError('Please select both a race event and session type');
      return;
    }

    try {
      setLoading(true);
      setError('');
      setLoadingMessage('Loading session data...');

      const response = await axios.get(
        `/api/session/${year}/${selectedEvent.round}/${sessionType.toLowerCase()}`
      );

      setLoadingMessage('Processing driver telemetry...');
      await new Promise(resolve => setTimeout(resolve, 500)); // Brief pause for UX

      setLoadingMessage('Generating charts...');
      onSessionSelect(response.data);
    } catch (err) {
      const detail = axios.isAxiosError(err) ? err.response?.data?.detail : undefined;
      setError(typeof detail === 'string' ? detail : 'Failed to load session data');
      console.error('Error loading session:', err);
      onSessionSelect(null);
    } finally {
      setLoading(false);
      setLoadingMessage('');
    }
  };

  return (
    <Box>
      <Typography variant="h6" gutterBottom>
        Select Session
      </Typography>

      {error && (
        <Alert severity="error" sx={{ mb: 2 }}>
          {error}
        </Alert>
      )}

      {loadingMessage && (
        <Box display="flex" alignItems="center" gap={2} sx={{ mb: 2, p: 2, bgcolor: 'background.paper', borderRadius: 1 }}>
          <CircularProgress size={20} />
          <Typography variant="body2" color="text.secondary">
            {loadingMessage}
          </Typography>
        </Box>
      )}

      <Box display="flex" gap={2} flexWrap="wrap" alignItems="center">
        <FormControl sx={{ minWidth: 120 }}>
          <InputLabel>Year</InputLabel>
          <Select value={year} onChange={handleYearChange} disabled={loading}>
            {availableYears.map((y) => (
              <MenuItem key={y} value={y}>
                {y}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl sx={{ minWidth: 200 }} disabled={events.length === 0 || loading}>
          <InputLabel>Race Event</InputLabel>
          <Select
            value={selectedEvent ? events.indexOf(selectedEvent) : ''}
            onChange={handleEventChange}
          >
            {events.map((event, index) => (
              <MenuItem key={event.round} value={index}>
                {event.name} - {event.location}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <FormControl sx={{ minWidth: 150 }} disabled={!selectedEvent || loading}>
          <InputLabel>Session</InputLabel>
          <Select value={sessionType} onChange={handleSessionTypeChange}>
            {sessionTypes.map((session) => (
              <MenuItem key={session.value} value={session.value}>
                {session.label}
              </MenuItem>
            ))}
          </Select>
        </FormControl>

        <Button
          variant="contained"
          color="primary"
          onClick={handleGoClick}
          disabled={!selectedEvent || !sessionType || loading}
          sx={{ minWidth: 80 }}
        >
          {loading ? <CircularProgress size={20} /> : 'Go'}
        </Button>

        {loading && loadingMessage && (
          <Typography variant="body2" color="text.secondary" sx={{ ml: 2 }}>
            {loadingMessage}
          </Typography>
        )}
      </Box>

      {selectedEvent && (
        <Box mt={2}>
          <Typography variant="body2" color="text.secondary">
            {selectedEvent.country} • {selectedEvent.location} • Round {selectedEvent.round}
          </Typography>
        </Box>
      )}
    </Box>
  );
};

export default SessionSelector;
