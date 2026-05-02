// src/services/TransitService.ts
import { GO_LINES, getScheduleForStation } from '../data/goTransitData';
import { Station, Departure, RealTimeMessage } from '../types';

// Mock API base URL - in production, use actual GO Transit API
const API_BASE_URL = 'https://api.gotransit.com/v1';

export class TransitService {
  // Get all available lines
  static async getLines() {
    try {
      // In production, fetch from API
      // const response = await fetch(`${API_BASE_URL}/lines`);
      // return response.json();
      
      // Return mock data
      return GO_LINES;
    } catch (error) {
      console.error('Error fetching lines:', error);
      throw error;
    }
  }

  // Get stations for a specific line
  static async getStations(lineId: string): Promise<Station[]> {
    try {
      const line = GO_LINES.find(l => l.id === lineId);
      return line ? line.stations : [];
    } catch (error) {
      console.error('Error fetching stations:', error);
      throw error;
    }
  }

  // Get schedule for a specific station
  static async getSchedule(
    lineId: string,
    stationCode: string,
    date?: Date
  ): Promise<Departure[]> {
    try {
      // In production, fetch from API with date parameter
      // const url = `${API_BASE_URL}/schedules?line=${lineId}&station=${stationCode}&date=${date || ''}`;
      // const response = await fetch(url);
      // return response.json();
      
      // Return mock data
      return getScheduleForStation(lineId, stationCode);
    } catch (error) {
      console.error('Error fetching schedule:', error);
      throw error;
    }
  }

  // Get real-time departures
  static async getRealTimeDepartures(
    lineId: string,
    stationCode: string
  ): Promise<Departure[]> {
    try {
      // In production, fetch from real-time API
      // const response = await fetch(`${API_BASE_URL}/realtime?line=${lineId}&station=${stationCode}`);
      // return response.json();
      
      // Mock real-time data
      const schedule = await this.getSchedule(lineId, stationCode);
      const now = new Date();
      const currentHour = now.getHours();
      const currentMinute = now.getMinutes();
      
      return schedule.filter(departure => {
        const [hour, minute] = departure.time.split(':').map(Number);
        if (hour > currentHour) return true;
        if (hour === currentHour && minute >= currentMinute) return true;
        return false;
      }).slice(0, 5);
    } catch (error) {
      console.error('Error fetching real-time departures:', error);
      throw error;
    }
  }

  // Get real-time messages
  static async getRealTimeMessages(lineId?: string): Promise<RealTimeMessage[]> {
    try {
      // In production, fetch from API
      // const url = lineId 
      //   ? `${API_BASE_URL}/messages?line=${lineId}`
      //   : `${API_BASE_URL}/messages`;
      // const response = await fetch(url);
      // return response.json();
      
      // Mock messages
      const messages: RealTimeMessage[] = [
        {
          id: '1',
          title: 'Service Alert',
          message: 'Lakeshore West line: 15-minute delay due to signal issue at Oakville',
          severity: 'warning',
          timestamp: Date.now(),
          lineId: 'lakeshore-west',
        },
        {
          id: '2',
          title: 'Schedule Update',
          message: 'Kitchener line: Extra trains added for evening rush hour',
          severity: 'info',
          timestamp: Date.now(),
          lineId: 'kitchener',
        },
        {
          id: '3',
          title: 'Weather Advisory',
          message: 'Expect delays across all lines due to winter weather conditions',
          severity: 'critical',
          timestamp: Date.now(),
        },
      ];
      
      if (lineId) {
        return messages.filter(m => !m.lineId || m.lineId === lineId);
      }
      return messages;
    } catch (error) {
      console.error('Error fetching messages:', error);
      throw error;
    }
  }

  // Get travel time between stations
  static async getTravelTime(
    lineId: string,
    startStationId: string,
    endStationId: string
  ): Promise<number> {
    try {
      // In production, fetch from API
      // const response = await fetch(
      //   `${API_BASE_URL}/travel-time?line=${lineId}&from=${startStationId}&to=${endStationId}`
      // );
      // const data = await response.json();
      // return data.travelTime;
      
      // Mock travel time calculation
      const line = GO_LINES.find(l => l.id === lineId);
      if (!line) return 0;
      
      const startIndex = line.stations.findIndex(s => s.id === startStationId);
      const endIndex = line.stations.findIndex(s => s.id === endStationId);
      
      if (startIndex === -1 || endIndex === -1) return 0;
      
      // Assume 3 minutes per stop
      const stops = Math.abs(endIndex - startIndex);
      return stops * 3;
    } catch (error) {
      console.error('Error fetching travel time:', error);
      throw error;
    }
  }

  // Get service alerts
  static async getServiceAlerts(): Promise<RealTimeMessage[]> {
    try {
      const messages = await this.getRealTimeMessages();
      return messages.filter(m => m.severity !== 'info');
    } catch (error) {
      console.error('Error fetching service alerts:', error);
      throw error;
    }
  }

  // Check if service is operating normally
  static async isServiceOperating(lineId: string): Promise<boolean> {
    try {
      const alerts = await this.getServiceAlerts();
      const criticalAlerts = alerts.filter(a => 
        a.severity === 'critical' && (!a.lineId || a.lineId === lineId)
      );
      return criticalAlerts.length === 0;
    } catch (error) {
      console.error('Error checking service status:', error);
      return true;
    }
  }

  // Get next train from station
  static async getNextTrain(
    lineId: string,
    stationCode: string,
    destination?: string
  ): Promise<Departure | null> {
    try {
      const departures = await this.getRealTimeDepartures(lineId, stationCode);
      if (destination) {
        return departures.find(d => d.destination === destination) || null;
      }
      return departures[0] || null;
    } catch (error) {
      console.error('Error getting next train:', error);
      return null;
    }
  }
}