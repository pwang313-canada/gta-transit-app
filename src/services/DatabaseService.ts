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

const formatDate = (date: Date): string => date.toLocaleDateString('en-CA');

class DatabaseService {
  private static instance: DatabaseService;
  private db: SQLite.SQLiteDatabase | null = null;
  private isInitialized: boolean = true;

  private constructor() {}

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  async initializeDatabase(): Promise<boolean> {
    if (this.isInitialized && this.db) {
      console.log('Database already initialized, reusing connection');
      return true;
    }

    try {
      console.log('Initializing database...');

      const loaded = await loadDatabase();
      if (!loaded) {
        throw new Error('Failed to load database');
      }

      this.db = SQLite.openDatabaseSync('go_transit.db');
      console.log('Database opened synchronously');

      // Check tables
      const tables = await this.db.getAllAsync<any>(
        "SELECT name FROM sqlite_master WHERE type='table';"
      );

      console.log('Tables in database:', tables.map(t => t.name).join(', '));

      // Specifically check for stop_routes
      const stopRoutesExists = tables.some(t => t.name === 'stop_routes');
      console.log(`Table 'stop_routes' exists: ${stopRoutesExists}`);

      if (!stopRoutesExists) {
        console.warn('⚠️ stop_routes table is missing! Make sure the database was created with the Python script that includes this table.');
      }

      // Check for other essential tables
      const requiredTables = ['stops', 'routes', 'trips', 'stop_routes'];
      for (const table of requiredTables) {
        const exists = tables.some(t => t.name === table);
        console.log(`Table '${table}' exists: ${exists}`);
        if (!exists && table !== 'stop_routes') {
          console.error(`Missing required table: ${table}`);
        }
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
    
    console.log('Database not initialized, initializing now...');
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
    const queryStr = query.replace(/\s+/g, ' ').trim();
    console.log(`Executing custom query: ${queryStr.substring(0, 200)}`);
    if (params) console.log(`Params: ${JSON.stringify(params)}`);
    try {
      const results = await db.getAllAsync<any>(query, params || []);
      console.log(`Query returned ${results.length} rows`);
      return results as T[];
    } catch (error) {
      console.error('Error executing query:', error);
      console.error('Query was:', queryStr);
      if (params) console.error('Params were:', params);
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

  // NEW: Method to test stop_routes query
  async testStopRoutes(): Promise<void> {
    const db = await this.getDatabase();
    console.log('--- Testing stop_routes table ---');
    try {
      const countResult = await db.getAllAsync<any>('SELECT COUNT(*) as count FROM stop_routes');
      console.log(`stop_routes row count: ${countResult[0]?.count || 0}`);
      
      const sample = await db.getAllAsync<any>('SELECT * FROM stop_routes LIMIT 5');
      console.log('Sample stop_routes rows:', sample);
      
      // Test a nearby stops query with stop_routes
      const testQuery = `
        SELECT 
          s.stop_id, s.stop_name,
          GROUP_CONCAT(DISTINCT sr.route_short_name) as routes
        FROM stops s
        LEFT JOIN stop_routes sr ON s.stop_id = sr.stop_id
        WHERE s.stop_lat BETWEEN 43.5 AND 43.7
          AND s.stop_lon BETWEEN -79.5 AND -79.3
        GROUP BY s.stop_id
        LIMIT 5
      `;
      const testResult = await db.getAllAsync<any>(testQuery);
      console.log(`Test query returned ${testResult.length} stops with routes`);
      if (testResult.length > 0) {
        console.log('First result:', testResult[0]);
      }
    } catch (error) {
      console.error('Error testing stop_routes:', error);
    }
  }

  
async getStopsByRoute(routeId: string, variant: string, date: Date, directionCode: string): Promise<any[]> {
  const serviceId = formatDate(date).replace(/-/g, '');
  let sql = `
    SELECT DISTINCT s.stop_id, s.stop_name
    FROM stops s
    JOIN stop_times st ON s.stop_id = st.stop_id
    JOIN trips t ON st.trip_id = t.trip_id
    WHERE t.route_id = ? AND t.service_id = ? AND t.direction_id = ?
  `;
  const params = [routeId, serviceId, directionCode];
  if (variant) {
    sql += ` AND t.route_variant = ?`;
    params.push(variant);
  }
  sql += ` ORDER BY st.stop_sequence`;
  return this.executeCustomQuery(sql, params);
}

  private async getStopsForTrip(tripId: string): Promise<Stop[]> {
    const db = await this.getDatabase();
    console.log(`getStopsForTrip: tripId = ${tripId}`);
    
    // Note: This uses 'trip_stops' table which might not exist. If you are using stop_times, adjust.
    const stopsQuery = `
      SELECT 
        s.stop_id, 
        s.stop_name,
        CAST(s.stop_lat AS REAL) as stop_lat,
        CAST(s.stop_lon AS REAL) as stop_lon,
        sr.stop_sequence
      FROM stop_routes sr
      INNER JOIN stops s ON sr.stop_id = s.stop_id
      WHERE sr.trip_id = ?
      ORDER BY sr.stop_sequence ASC
    `;
    
    try {
      const stops = await db.getAllAsync<any>(stopsQuery, [tripId]);
      console.log(`Found ${stops.length} stops for trip ${tripId}`);
      return stops.map(stop => ({
        stop_id: stop.stop_id,
        stop_name: stop.stop_name,
        stop_lat: stop.stop_lat,
        stop_lon: stop.stop_lon,
      })) as Stop[];
    } catch (error) {
      console.error(`Error in getStopsForTrip for trip ${tripId}:`, error);
      // If 'trip_stops' doesn't exist, fallback to stop_times
      console.log('Attempting fallback using stop_times...');
      const fallbackQuery = `
        SELECT DISTINCT
          s.stop_id, 
          s.stop_name,
          CAST(s.stop_lat AS REAL) as stop_lat,
          CAST(s.stop_lon AS REAL) as stop_lon
        FROM stop_times st
        JOIN stops s ON st.stop_id = s.stop_id
        WHERE st.trip_id = ?
        ORDER BY st.stop_sequence ASC
      `;
      const stops = await db.getAllAsync<any>(fallbackQuery, [tripId]);
      console.log(`Fallback: found ${stops.length} stops via stop_times`);
      return stops.map(stop => ({
        stop_id: stop.stop_id,
        stop_name: stop.stop_name,
        stop_lat: stop.stop_lat,
        stop_lon: stop.stop_lon,
      })) as Stop[];
    }
  }

  async getStopTimesForTripsBatch(tripIds: string[], stopId: string): Promise<Map<string, any>> {
    const db = await this.getDatabase();
    console.log(`getStopTimesForTripsBatch: ${tripIds.length} trips, stopId=${stopId}`);
    
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
      
      console.log(`Executing chunk ${i/CHUNK_SIZE + 1}: ${chunk.length} trips`);
      const rows = await db.getAllAsync<any>(query, [...chunk, stopId]);
      
      for (const row of rows) {
        results.set(row.trip_id, row);
      }
    }
    
    console.log(`Found ${results.size} trips with stop times for stop ${stopId}`);
    return results;
  }

  async getStopTimesForTripsBatchTwoStops(
    tripIds: string[], 
    departureStopId: string, 
    arrivalStopId: string
  ): Promise<Map<string, { departure: any; arrival: any }>> {
    const db = await this.getDatabase();
    console.log(`getStopTimesForTripsBatchTwoStops: ${tripIds.length} trips, departure=${departureStopId}, arrival=${arrivalStopId}`);
    
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
    console.log(`getStopTimesForTrip: tripId=${tripId}`);
    
    const query = `
      SELECT stop_id, arrival_time, departure_time, stop_sequence
      FROM stop_times
      WHERE trip_id = ?
      ORDER BY stop_sequence ASC
    `;
    
    const results = await db.getAllAsync<any>(query, [tripId]);
    console.log(`Found ${results.length} stop times for trip ${tripId}`);
    return results;
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
      console.log('Connection check passed');
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