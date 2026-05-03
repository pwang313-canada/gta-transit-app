// src/services/DatabaseService.ts
import * as SQLite from 'expo-sqlite';

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

async getStopsByRoute(routeId: string | number, variant?: string, date?: Date): Promise<Stop[]> {
    const db = await this.getDatabase();
    const routeIdStr = this.ensureString(routeId);
    
    try {
      console.log('\n========== GET STOPS BY ROUTE ==========');
      console.log(`Route ID: "${routeIdStr}"`);
      console.log(`Date param: ${date ? date.toDateString() : 'undefined'}`);
      console.log(`Variant: "${variant || 'none'}"`);
      
      // Use current date if date is undefined
      const queryDate = date || new Date();
      const serviceId = this.formatDateToServiceId(queryDate);
      
      console.log(`Using date: ${queryDate.toDateString()}`);
      console.log(`Service ID: ${serviceId}`);
      
      // Get a sample trip for this route/variant on this date
      let sampleTripQuery = `
        SELECT trip_id, route_variant, service_id, direction_id 
        FROM trips 
        WHERE route_id = ?
          AND service_id = ?
      `;
      
      const sampleParams: any[] = [routeIdStr, serviceId];
      
      if (variant && variant.trim() !== '' && variant !== 'none') {
        sampleTripQuery += ` AND route_variant = ?`;
        sampleParams.push(variant);
        console.log(`Filtering by variant: ${variant}`);
      }
      
      sampleTripQuery += ` LIMIT 1`;
      
      console.log(`Query: ${sampleTripQuery}`);
      console.log(`Params: ${JSON.stringify(sampleParams)}`);
      
      const sampleTrip = await db.getAllAsync<any>(sampleTripQuery, sampleParams);
      
      // If no trips found with the variant filter, try without it
      if (sampleTrip.length === 0 && variant && variant.trim() !== '' && variant !== 'none') {
        console.log(`❌ No trips found with variant filter, trying without variant...`);
        
        const fallbackQuery = `
          SELECT trip_id, route_variant, service_id, direction_id
          FROM trips 
          WHERE route_id = ?
            AND service_id = ?
          LIMIT 1
        `;
        
        const fallbackResults = await db.getAllAsync<any>(fallbackQuery, [routeIdStr, serviceId]);
        
        if (fallbackResults.length === 0) {
          console.log(`❌ No trips found for route ${routeIdStr} on ${queryDate.toDateString()}`);
          return [];
        }
        
        console.log(`✅ Found trip without variant filter:`);
        console.log(`   Trip ID: ${fallbackResults[0].trip_id}`);
        console.log(`   Variant: ${fallbackResults[0].route_variant}`);
        console.log(`   Direction ID: ${fallbackResults[0].direction_id}`);
        
        const sampleTripId = fallbackResults[0].trip_id;
        return await this.getStopsForTrip(sampleTripId);
      }
      
      if (sampleTrip.length === 0) {
        console.log(`❌ No trips found for route ${routeIdStr} on ${queryDate.toDateString()}`);
        return [];
      }
      
      console.log(`✅ Found sample trip:`);
      console.log(`   Trip ID: ${sampleTrip[0].trip_id}`);
      console.log(`   Variant: ${sampleTrip[0].route_variant}`);
      console.log(`   Service ID: ${sampleTrip[0].service_id}`);
      console.log(`   Direction ID: ${sampleTrip[0].direction_id}`);
      
      const sampleTripId = sampleTrip[0].trip_id;
      return await this.getStopsForTrip(sampleTripId);
    } catch (error) {
      console.error('❌ Error fetching stops by route:', error);
      return [];
    }
  }

  // Helper method to get stops for a specific trip
// In DatabaseService.ts, update getStopsForTrip method:
// In DatabaseService.ts, update the getStopsForTrip method:
private async getStopsForTrip(tripId: string): Promise<Stop[]> {
    const db = await this.getDatabase();
    
    const stopsQuery = `
      SELECT 
        s.stop_id, 
        s.stop_name,
        s.stop_lat,
        s.stop_lon,
        st.stop_sequence
      FROM stop_times st
      INNER JOIN stops s ON st.stop_id = s.stop_id
      WHERE st.trip_id = ?
      ORDER BY st.stop_sequence ASC
    `;
    
    const stops = await db.getAllAsync<any>(stopsQuery, [tripId]);
    
    console.log(`📊 Found ${stops.length} stops for trip ${tripId}`);
    stops.forEach((stop, index) => {
      console.log(`   ${stop.stop_sequence}. ${stop.stop_name} (${stop.stop_lat}, ${stop.stop_lon})`);
    });
    
    return stops.map(stop => ({
      stop_id: stop.stop_id,
      stop_name: stop.stop_name,
      stop_lat: stop.stop_lat,
      stop_lon: stop.stop_lon,
    })) as Stop[];
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

  // Add this method to DatabaseService.ts
async getShapeForRoute(routeId: string | number, date?: Date, variant?: string): Promise<Array<{latitude: number, longitude: number}>> {
    const db = await this.getDatabase();
    const routeIdStr = this.ensureString(routeId);
    
    try {
      console.log('\n========== GET SHAPE FOR ROUTE ==========');
      console.log(`Route ID: "${routeIdStr}"`);
      
      const queryDate = date || new Date();
      const serviceId = this.formatDateToServiceId(queryDate);
      
      // Get shape_id from a sample trip for this route
      let tripQuery = `
        SELECT DISTINCT t.shape_id
        FROM trips t
        WHERE t.route_id = ?
          AND t.service_id = ?
      `;
      
      const tripParams: any[] = [routeIdStr, serviceId];
      
      if (variant && typeof variant === 'string' && variant.trim() !== '' && variant !== 'none') {
        tripQuery += ` AND t.route_variant = ?`;
        tripParams.push(variant.trim());
      }
      
      tripQuery += ` LIMIT 1`;
      
      const tripResult = await db.getAllAsync<any>(tripQuery, tripParams);
      
      if (tripResult.length === 0 || !tripResult[0].shape_id) {
        console.log('❌ No shape found for this route');
        return [];
      }
      
      const shapeId = tripResult[0].shape_id;
      console.log(`Found shape_id: ${shapeId}`);
      
      // Get shape points ordered by sequence
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
      
      console.log(`✅ Loaded ${shapePoints.length} shape points`);
      
      return shapePoints.map(point => ({
        latitude: point.latitude,
        longitude: point.longitude,
      }));
      
    } catch (error) {
      console.error('❌ Error fetching shape for route:', error);
      return [];
    }
  }
}

export default DatabaseService.getInstance();