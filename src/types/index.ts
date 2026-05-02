// src/types/index.ts
export interface Station {
  id: string;
  name: string;
  code: string;
  zone?: string;
}

export interface Line {
  id: string;
  name: string;
  stations: Station[];
  color: string;
}

export interface Schedule {
  id: string;
  lineId: string;
  stationCode: string;
  departures: Departure[];
}

export interface Departure {
  time: string;
  destination: string;
  platform?: string;
  isExpress?: boolean;
}

export interface Favorite {
  id: string;
  lineId: string;
  lineName: string;
  startStationId: string;
  startStationName: string;
  endStationId: string;
  endStationName: string;
  createdAt: number;
}

export interface RealTimeMessage {
  id: string;
  title: string;
  message: string;
  severity: 'info' | 'warning' | 'critical';
  timestamp: number;
  lineId?: string;
}

export type RootStackParamList = {
  Main: undefined;
  Schedule: {
    lineId: string;
    startStationId: string;
    endStationId: string;
    lineName: string;
    startStationName: string;
    endStationName: string;
  };
};