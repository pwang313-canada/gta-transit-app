// src/services/DatabaseService.ts
import * as SQLite from 'expo-sqlite';

interface Stop {
  stop_id: string;
  stop_name: string;
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
  private dbPath: string = 'go_transit.db';
  private isInitialized: boolean = false;
  private initializationPromise: Promise<boolean> | null = null;
  private queryQueue: Promise<any> = Promise.resolve();

  private constructor() {}

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  // Initialize database with proper singleton pattern - prevents multiple simultaneous initializations
  async initializeDatabase(): Promise<boolean> {
    // If already initialized, return true
    if (this.isInitialized && this.db) {
      console.log('Database already initialized');
      return true;
    }

    // If initialization is already in progress, wait for it
    if (this.initializationPromise) {
      console.log('Database initialization already in progress, waiting...');
      return this.initializationPromise;
    }

    // Start initialization
    this.initializationPromise = this._initializeDatabase();
    const result = await this.initializationPromise;
    this.initializationPromise = null;
    return result;
  }

  private async _initializeDatabase(): Promise<boolean> {
    try {
      console.log('Initializing database...');
      
      // Close existing connection if any
      if (this.db) {
        try {
          await this.db.closeAsync();
        } catch (e) {
          // Ignore close errors
          console.log('Error closing existing connection:', e);
        }
        this.db = null;
      }
      
      // Open database synchronously
      this.db = SQLite.openDatabaseSync(this.dbPath);
      
      // Test connection with a simple query
      const testResult = await this.db.getAllAsync('SELECT 1');
      console.log('Database connection test successful');
      
      // Verify required tables exist
      const tables = await this.db.getAllAsync<any>(
        `SELECT name FROM sqlite_master WHERE type='table' AND name IN ('routes', 'trips', 'stop_times', 'stops')`
      );
      
      const tableNames = tables.map(t => t.name);
      console.log('Tables found:', tableNames);
      
      const hasRequiredTables = tableNames.includes('routes') && 
                                 tableNames.includes('trips') && 
                                 tableNames.includes('stop_times') && 
                                 tableNames.includes('stops');
      
      if (!hasRequiredTables) {
        console.error('Missing required tables. Found:', tableNames);
        return false;
      }
      
      // Get route count to verify data
      const routeCount = await this.db.getFirstAsync<any>('SELECT COUNT(*) as count FROM routes');
      console.log(`Routes found: ${routeCount?.count || 0}`);
      
      this.isInitialized = true;
      console.log('✅ Database initialized successfully');
      return true;
      
    } catch (error) {
      console.error('❌ Failed to initialize database:', error);
      this.db = null;
      this.isInitialized = false;
      return false;
    }
  }

  private async getDatabase(): Promise<SQLite.SQLiteDatabase> {
    if (!this.db || !this.isInitialized) {
      const success = await this.initializeDatabase();
      if (!success || !this.db) {
        throw new Error('Database not initialized');
      }
    }
    return this.db;
  }

  // Execute query with queue to prevent concurrent access issues
  private async executeQuery<T>(query: string, params: any[] = []): Promise<T[]> {
    return this.queryQueue = this.queryQueue.then(async () => {
      try {
        const db = await this.getDatabase();
        const result = await db.getAllAsync<T>(query, params);
        return result;
      } catch (error) {
        console.error('Query execution failed:', error);
        // Don't throw, return empty array instead
        return [];
      }
    });
  }

  private async executeFirstQuery<T>(query: string, params: any[] = []): Promise<T | null> {
    const results = await this.executeQuery<T>(query, params);
    return results.length > 0 ? results[0] : null;
  }

  private ensureString(value: string | number): string {
    return typeof value === 'number' ? value.toString() : value;
  }

  private formatDateToServiceId(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  isRouteValidForDate(routeId: string, date: Date): boolean {
    console.log(`\n🔍 Checking route: ${routeId} for date: ${date.toDateString()}`);
    
    const routeIdParts = routeId.split('-');
    if (routeIdParts.length < 1) {
      return true;
    }
    
    const dateRangePart = routeIdParts[0];
    console.log(`   Date range part: ${dateRangePart}`);
    
    if (dateRangePart.length >= 8 && /^\d+$/.test(dateRangePart)) {
      const startMMDD = dateRangePart.substring(0, 4);
      const endMMDD = dateRangePart.substring(4, 8);
      
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const currentMMDD = `${month}${day}`;
      
      console.log(`   Start: ${startMMDD}, End: ${endMMDD}, Current: ${currentMMDD}`);
      
      let isValid: boolean;
      if (startMMDD <= endMMDD) {
        isValid = currentMMDD >= startMMDD && currentMMDD <= endMMDD;
      } else {
        isValid = currentMMDD >= startMMDD || currentMMDD <= endMMDD;
      }
      
      console.log(`   ${isValid ? '✅ VALID' : '❌ INVALID'}`);
      return isValid;
    }
    
    console.log(`   No date range pattern, assuming valid`);
    return true;
  }

  // Public methods
  async executeCustomQuery<T>(query: string, params: any[] = []): Promise<T[]> {
    return this.executeQuery<T>(query, params);
  }

  async getStopsByRoute(
    routeId: string | number,
    variant: string,
    date: Date
  ): Promise<Stop[]> {
    try {
      const routeIdStr = this.ensureString(routeId);
      const serviceId = this.formatDateToServiceId(date);
      
      console.log('\n========== GET STOPS BY ROUTE ==========');
      console.log(`Route ID: "${routeIdStr}"`);
      console.log(`Variant: "${variant || 'none'}"`);
      
      let query = `
        SELECT trip_id, route_variant
        FROM trips 
        WHERE route_id = ?
          AND service_id = ?
      `;
      
      const params: any[] = [routeIdStr, serviceId];
      
      if (variant && variant.trim() !== '') {
        query += ` AND route_variant = ?`;
        params.push(variant);
      }
      
      query += ` LIMIT 1`;
      
      const sampleTrip = await this.executeQuery<any>(query, params);
      
      if (sampleTrip.length === 0) {
        console.log(`❌ No trips found`);
        return [];
      }
      
      const sampleTripId = sampleTrip[0].trip_id;
      
      const stopsQuery = `
        SELECT 
          s.stop_id, 
          s.stop_name,
          st.stop_sequence
        FROM stop_times st
        INNER JOIN stops s ON st.stop_id = s.stop_id
        WHERE st.trip_id = ?
        ORDER BY st.stop_sequence ASC
      `;
      
      const stops = await this.executeQuery<any>(stopsQuery, [sampleTripId]);
      
      const orderedStops = stops.map(stop => ({
        stop_id: stop.stop_id,
        stop_name: stop.stop_name,
      }));
      
      console.log(`✅ Returning ${orderedStops.length} stops`);
      return orderedStops as Stop[];
    } catch (error) {
      console.error('❌ Error fetching stops by route:', error);
      return [];
    }
  }

  async getTrips(
    routeId: string,
    serviceId: string,
    directionId: number,
    variant?: string
  ): Promise<any[]> {
    try {
      let query = `
        SELECT trip_id, route_variant, direction_id
        FROM trips 
        WHERE route_id = ?
          AND service_id = ?
          AND direction_id = ?
      `;
      
      const params: any[] = [routeId, serviceId, directionId];
      
      if (variant && variant.trim() !== '') {
        query += ` AND route_variant = ?`;
        params.push(variant);
      }
      
      return await this.executeQuery<any>(query, params);
    } catch (error) {
      console.error('Error getting trips:', error);
      return [];
    }
  }

  async getStopTimesForTrip(tripId: string): Promise<any[]> {
    try {
      const query = `
        SELECT stop_id, stop_sequence, departure_time, arrival_time
        FROM stop_times
        WHERE trip_id = ?
        ORDER BY stop_sequence
      `;
      
      return await this.executeQuery<any>(query, [tripId]);
    } catch (error) {
      console.error('Error getting stop times for trip:', error);
      return [];
    }
  }

  async getStopTime(tripId: string, stopId: string): Promise<any | null> {
    try {
      const query = `
        SELECT departure_time, arrival_time
        FROM stop_times
        WHERE trip_id = ? AND stop_id = ?
        LIMIT 1
      `;
      
      return await this.executeFirstQuery<any>(query, [tripId, stopId]);
    } catch (error) {
      console.error('Error getting stop time:', error);
      return null;
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      await this.executeQuery('SELECT 1', []);
      return true;
    } catch (error) {
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