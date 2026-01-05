export interface Driver {
  number: string;
  name: string;
  abbreviation: string;
  team: string;
  team_color?: string;
}

export interface SessionInfo {
  year: number;
  round: number;
  session_type: string;
  event_name: string;
  track_name: string;
  weather?: {
    air_temp: number | null;
    track_temp: number | null;
    humidity: number | null;
  };
}

export interface SessionData {
  session_info: SessionInfo;
  drivers: Driver[];
}

export interface FastestLap {
  driver: string;
  name: string;
  team: string;
  lap_time: number;
  lap_time_str: string;
  delta_to_pole: number;
  lap_number: number;
  tyre?: string;
}

export interface StartAnalysis {
  driver: string;
  name: string;
  team: string;
  time_to_100: number | null;
  time_to_200: number | null;
}

export interface TireLap {
  lap: number;
  compound: string;
  tyre_life: number | null;
  lap_time: number | null;
}

export interface TireStrategy {
  driver: string;
  name: string;
  team: string;
  laps: TireLap[];
}

export interface RaceEvent {
  round: number;
  name: string;
  country: string;
  location: string;
  date: string | null;
  sessions: {
    fp1: string | null;
    fp2: string | null;
    fp3: string | null;
    qualifying: string | null;
    race: string | null;
  };
}

