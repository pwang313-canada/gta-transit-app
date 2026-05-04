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

    // ✅ IMPORTANT: use DB name only
    this.db = SQLite.openDatabaseSync('go_transit.db');

    // ✅ verify real tables exist
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

  // Execute custom query
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

  // Check if route is valid for a date
  isRouteValidForDate(routeId: string | number, date: Date): boolean {
    const routeIdStr = this.ensureString(routeId);  // Add this line
    const routeIdParts = routeIdStr.split('-');       // Use routeIdStr
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

  // Get stops for a route
// Update the getStopsByRoute method in DatabaseService.ts
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
      // Try without service_id filter
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

// Also update the getStopsForTrip method to ensure coordinates are numbers
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

  // Get shape for a route
  async getShapeForRoute(routeId: string | number, date?: Date, variant?: string): Promise<Array<{latitude: number, longitude: number}>> {
    const db = await this.getDatabase();
    const routeIdStr = this.ensureString(routeId);
    
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
      
      const tripResult = await db.getAllAsync<any>(tripQuery, tripParams);
      
      if (tripResult.length === 0 || !tripResult[0].shape_id) {
        if (variant) {
          const fallbackResult = await db.getAllAsync<any>(
            `SELECT DISTINCT t.shape_id FROM trips t WHERE t.route_id = ? AND t.shape_id IS NOT NULL AND t.shape_id != '' LIMIT 1`,
            [routeIdStr]
          );
          
          if (fallbackResult.length > 0 && fallbackResult[0].shape_id) {
            return await this.getShapePoints(fallbackResult[0].shape_id);
          }
        }
        return [];
      }
      
      return await this.getShapePoints(tripResult[0].shape_id);
    } catch (error) {
      console.error('Error fetching shape for route:', error);
      return [];
    }
  }

  // Get shape points
  private async getShapePoints(shapeId: string): Promise<Array<{latitude: number, longitude: number}>> {
    const db = await this.getDatabase();
    
    const shapeQuery = `
      SELECT 
        shape_pt_lat as latitude,
        shape_pt_lon as longitude,
        shape_pt_sequence
      FROM shapes
      WHERE shape_id = ?
      ORDER BY shape_pt_sequence ASC
    `;
    
    const shapePoints = await db.getAllAsync<any>(shapeQuery, [shapeId]);
    
    return shapePoints.map((point: any) => ({
      latitude: point.latitude,
      longitude: point.longitude,
    }));
  }

  // Get stop times for a trip
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

  // Get stop time for a specific trip and stop
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

  // Check database connection
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

  // Close database connection
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