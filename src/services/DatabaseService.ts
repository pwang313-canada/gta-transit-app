// src/services/DatabaseService.ts
import * as SQLite from 'expo-sqlite';
import { loadDatabase } from '../utils/databaseLoader';

interface Stop {
  stop_id: string;
  stop_name: string;
  stop_lat?: number;
  stop_lon?: number;
}

interface ScheduleItem {
  trip_id: string;
  destination: string;
  departure_time: number;
  arrival_time?: number;
  stop_sequence: number;
}

interface TripWithArrival {
  trip_id: string;
  departure_time: number;
  arrival_time: number;
  destination: string;
  departure_stop: string;
  arrival_stop: string;
  travel_time_minutes: number;
}

class DatabaseService {
  private static instance: DatabaseService;
  private db: SQLite.SQLiteDatabase | null = null;
  private isInitialized: boolean = false;

  private constructor() {}

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  async initializeDatabase(): Promise<boolean> {
    if (this.isInitialized && this.db) {
      return true;
    }

    try {
      console.log('Initializing database...');

      const loaded = await loadDatabase();
      if (!loaded) {
        throw new Error('Failed to load database');
      }

      this.db = SQLite.openDatabaseSync('go_transit.db');

      const tables = await this.db.getAllAsync<any>(
        "SELECT name FROM sqlite_master WHERE type='table';"
      );

      console.log('Tables:', tables);

      if (!tables || tables.length === 0) {
        throw new Error('Database is empty or not loaded correctly');
      }

      this.isInitialized = true;
      console.log('✅ Database initialized successfully');

      return true;
    } catch (error) {
      console.error('❌ Database initialization failed:', error);
      this.isInitialized = false;
      this.db = null;
      throw error;
    }
  }

  
  
  private async getDatabase(): Promise<SQLite.SQLiteDatabase> {
    if (this.isInitialized && this.db) {
      return this.db;
    }
    
    const success = await this.initializeDatabase();
    if (!success || !this.db) {
      throw new Error('Database not initialized');
    }
    return this.db;
  }

  private ensureString(value: string | number): string {
    return typeof value === 'number' ? value.toString() : value;
  }

  private formatDateToServiceId(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const yyyymmdd = `${year}${month}${day}`;
    return yyyymmdd;
  }

  async executeCustomQuery<T>(query: string, params?: any[]): Promise<T[]> {
    const db = await this.getDatabase();
    try {
      const results = await db.getAllAsync<any>(query, params || []);
      return results as T[];
    } catch (error) {
      console.error('Error executing query:', error);
      throw error;
    }
  }

  isRouteValidForDate(routeId: string | number, date: Date): boolean {
    const routeIdStr = this.ensureString(routeId);
    const routeIdParts = routeIdStr.split('-');
    if (routeIdParts.length < 1) return true;
    
    const dateRangePart = routeIdParts[0];
    
    if (dateRangePart.length >= 8 && /^\d+$/.test(dateRangePart)) {
      const startMMDD = dateRangePart.substring(0, 4);
      const endMMDD = dateRangePart.substring(4, 8);
      
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const currentMMDD = `${month}${day}`;
      
      if (startMMDD <= endMMDD) {
        return currentMMDD >= startMMDD && currentMMDD <= endMMDD;
      } else {
        return currentMMDD >= startMMDD || currentMMDD <= endMMDD;
      }
    }
    
    return true;
  }

  async getStopsByRoute(routeId: string | number, variant?: string, date?: Date): Promise<Stop[]> {
    const db = await this.getDatabase();
    const routeIdStr = this.ensureString(routeId);
    
    try {
      const queryDate = date || new Date();
      const serviceId = this.formatDateToServiceId(queryDate);
      
      let sampleTripQuery = `
        SELECT trip_id, route_variant, service_id, direction_id 
        FROM trips 
        WHERE route_id = ?
          AND service_id = ?
      `;
      
      const sampleParams: any[] = [routeIdStr, serviceId];
      
      if (variant && typeof variant === 'string' && variant.trim() !== '' && variant !== 'none') {
        sampleTripQuery += ` AND route_variant = ?`;
        sampleParams.push(variant.trim());
      }
      
      sampleTripQuery += ` LIMIT 1`;
      
      const sampleTrip = await db.getAllAsync<any>(sampleTripQuery, sampleParams);
      
      if (sampleTrip.length === 0) {
        const fallbackTrip = await db.getAllAsync<any>(
          `SELECT trip_id FROM trips WHERE route_id = ? LIMIT 1`,
          [routeIdStr]
        );
        if (fallbackTrip.length === 0) return [];
        return await this.getStopsForTrip(fallbackTrip[0].trip_id);
      }
      
      return await this.getStopsForTrip(sampleTrip[0].trip_id);
    } catch (error) {
      console.error('Error fetching stops by route:', error);
      return [];
    }
  }

  private async getStopsForTrip(tripId: string): Promise<Stop[]> {
    const db = await this.getDatabase();
    
    const stopsQuery = `
      SELECT 
        s.stop_id, 
        s.stop_name,
        CAST(s.stop_lat AS REAL) as stop_lat,
        CAST(s.stop_lon AS REAL) as stop_lon,
        st.stop_sequence
      FROM stop_times st
      INNER JOIN stops s ON st.stop_id = s.stop_id
      WHERE st.trip_id = ?
      ORDER BY st.stop_sequence ASC
    `;
    
    const stops = await db.getAllAsync<any>(stopsQuery, [tripId]);
    
    return stops.map(stop => ({
      stop_id: stop.stop_id,
      stop_name: stop.stop_name,
      stop_lat: stop.stop_lat,
      stop_lon: stop.stop_lon,
    })) as Stop[];
  }

  async getStopTimesForTripsBatch(tripIds: string[], stopId: string): Promise<Map<string, any>> {
    const db = await this.getDatabase();
    
    if (tripIds.length === 0) return new Map();
    
    const CHUNK_SIZE = 900;
    const results = new Map<string, any>();
    
    for (let i = 0; i < tripIds.length; i += CHUNK_SIZE) {
      const chunk = tripIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      
      const query = `
        SELECT trip_id, stop_id, arrival_time, departure_time, stop_sequence
        FROM stop_times
        WHERE trip_id IN (${placeholders})
          AND stop_id = ?
      `;
      
      const rows = await db.getAllAsync<any>(query, [...chunk, stopId]);
      
      for (const row of rows) {
        results.set(row.trip_id, row);
      }
    }
    
    return results;
  }

  async getStopTimesForTripsBatchTwoStops(
    tripIds: string[], 
    departureStopId: string, 
    arrivalStopId: string
  ): Promise<Map<string, { departure: any; arrival: any }>> {
    const db = await this.getDatabase();
    
    if (tripIds.length === 0) return new Map();
    
    const CHUNK_SIZE = 900;
    const results = new Map<string, { departure: any; arrival: any }>();
    
    for (let i = 0; i < tripIds.length; i += CHUNK_SIZE) {
      const chunk = tripIds.slice(i, i + CHUNK_SIZE);
      const placeholders = chunk.map(() => '?').join(',');
      
      const query = `
        SELECT trip_id, stop_id, arrival_time, departure_time, stop_sequence
        FROM stop_times
        WHERE trip_id IN (${placeholders})
          AND stop_id IN (?, ?)
        ORDER BY trip_id, stop_sequence
      `;
      
      const rows = await db.getAllAsync<any>(query, [...chunk, departureStopId, arrivalStopId]);
      
      for (const row of rows) {
        const existing = results.get(row.trip_id) || { departure: null, arrival: null };
        if (row.stop_id === departureStopId) {
          existing.departure = row;
        } else if (row.stop_id === arrivalStopId) {
          existing.arrival = row;
        }
        results.set(row.trip_id, existing);
      }
    }
    
    return results;
  }

  async getShapeForRoute(routeId: string | number, date?: Date, variant?: string): Promise<Array<{latitude: number, longitude: number}>> {
    const db = await this.getDatabase();
    const routeIdStr = this.ensureString(routeId);
    
    console.log('--- getShapeForRoute called ---');
    console.log('routeIdStr:', routeIdStr);
    console.log('variant:', variant);
    
    try {
      let tripQuery = `
        SELECT DISTINCT t.shape_id, t.route_variant
        FROM trips t
        WHERE t.route_id = ?
          AND t.shape_id IS NOT NULL
          AND t.shape_id != ''
      `;
      
      const tripParams: any[] = [routeIdStr];
      
      if (variant && typeof variant === 'string' && variant.trim() !== '' && variant !== 'none') {
        tripQuery += ` AND t.route_variant = ?`;
        tripParams.push(variant);
      }
      
      tripQuery += ` LIMIT 1`;
      
      console.log('Trip query:', tripQuery.replace(/\s+/g, ' ').trim());
      console.log('Trip params:', tripParams);
      
      const tripResult = await db.getAllAsync<any>(tripQuery, tripParams);
      
      console.log('Trip result count:', tripResult.length);
      if (tripResult.length > 0) {
        console.log('Trip result[0]:', tripResult[0]);
      }
      
      if (tripResult.length === 0 || !tripResult[0].shape_id) {
        console.log('No shape_id found with primary query, trying fallback...');
        if (variant) {
          const fallbackResult = await db.getAllAsync<any>(
            `SELECT DISTINCT t.shape_id FROM trips t WHERE t.route_id = ? AND t.shape_id IS NOT NULL AND t.shape_id != '' LIMIT 1`,
            [routeIdStr]
          );
          
          console.log('Fallback result count:', fallbackResult.length);
          if (fallbackResult.length > 0) {
            console.log('Fallback shape_id:', fallbackResult[0].shape_id);
          }
          
          if (fallbackResult.length > 0 && fallbackResult[0].shape_id) {
            return await this.getShapePoints(fallbackResult[0].shape_id);
          }
        }
        console.log('Returning empty shape array (no shape_id found)');
        return [];
      }
      
      console.log('Using shape_id:', tripResult[0].shape_id);
      return await this.getShapePoints(tripResult[0].shape_id);
    } catch (error) {
      console.error('Error fetching shape for route:', error);
      return [];
    }
  }

  private async getShapePoints(shapeId: string): Promise<Array<{latitude: number, longitude: number}>> {
    const db = await this.getDatabase();
    
    console.log('--- getShapePoints called ---');
    console.log('shapeId:', shapeId);
    
    const shapeQuery = `
      SELECT 
        shape_pt_lat as latitude,
        shape_pt_lon as longitude,
        shape_pt_sequence
      FROM shapes
      WHERE shape_id = ?
      ORDER BY shape_pt_sequence ASC
    `;
    
    console.log('Shape query:', shapeQuery.replace(/\s+/g, ' ').trim());
    
    const shapePoints = await db.getAllAsync<any>(shapeQuery, [shapeId]);
    
    console.log('Shape points count:', shapePoints.length);
    if (shapePoints.length > 0) {
      console.log('First shape point:', shapePoints[0]);
      console.log('Last shape point:', shapePoints[shapePoints.length - 1]);
    } else {
      console.log('⚠️ shapes table returned 0 rows for shape_id:', shapeId);
    }
    
    return shapePoints.map((point: any) => ({
      latitude: point.latitude,
      longitude: point.longitude,
    }));
  }

  async getStopTimesForTrip(tripId: string): Promise<any[]> {
    const db = await this.getDatabase();
    
    const query = `
      SELECT stop_id, arrival_time, departure_time, stop_sequence
      FROM stop_times
      WHERE trip_id = ?
      ORDER BY stop_sequence ASC
    `;
    
    return await db.getAllAsync<any>(query, [tripId]);
  }

  async getStopTime(tripId: string, stopId: string): Promise<any> {
    const db = await this.getDatabase();
    
    const query = `
      SELECT stop_id, arrival_time, departure_time, stop_sequence
      FROM stop_times
      WHERE trip_id = ? AND stop_id = ?
      LIMIT 1
    `;
    
    const results = await db.getAllAsync<any>(query, [tripId, stopId]);
    return results.length > 0 ? results[0] : null;
  }

  async checkConnection(): Promise<boolean> {
    try {
      const db = await this.getDatabase();
      await db.getAllAsync('SELECT 1');
      return true;
    } catch (error) {
      console.error('Database connection check failed:', error);
      return false;
    }
  }

  async closeConnection(): Promise<void> {
    if (this.db) {
      try {
        await this.db.closeAsync();
        this.db = null;
        this.isInitialized = false;
        console.log('Database connection closed');
      } catch (error) {
        console.error('Error closing database:', error);
      }
    }
  }
}

export default DatabaseService.getInstance();