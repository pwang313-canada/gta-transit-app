// src/services/DatabaseService.ts
import * as SQLite from 'expo-sqlite';
import { loadDatabase } from '../utils/databaseLoader';
import { getLineData, getStopsFromLineData } from './scheduleService';

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

  
  async getStopsByRoute(
    routeId: string,
    variant: string,
    date: Date,
    directionCode: string
  ): Promise<any[]> {
    // 1. Fetch stop order from the API (no stop_times needed)
    const lineData = await getLineData(variant, directionCode, date);
    if (!lineData) return [];

    const stopsFromApi = getStopsFromLineData(lineData);
    if (stopsFromApi.length === 0) return [];

    // 2. Get stop names from the local stops table (only stop_id → stop_name)
    const stopIds = stopsFromApi.map(s => s.stop_id);
    const placeholders = stopIds.map(() => '?').join(',');
    const sql = `SELECT stop_id, stop_name FROM stops WHERE stop_id IN (${placeholders})`;
    const rows = await this.executeCustomQuery<{ stop_id: string; stop_name: string }>(sql, stopIds);

    // 3. Build a map for quick name lookup
    const nameMap = new Map(rows.map(row => [row.stop_id, row.stop_name]));

    // 4. Return stops in the API‑preserved order, with names (fallback to stop_id)
    return stopsFromApi.map(s => ({
      stop_id: s.stop_id,
      stop_name: nameMap.get(s.stop_id) || s.stop_id,
      stop_sequence: s.stop_sequence,
    }));
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