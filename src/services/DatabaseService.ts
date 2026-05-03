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
  private isInitialized: boolean = false;
  private dbPath: string = 'go_transit.db';

  private constructor() {}

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  // Initialize database with connection test
  async initializeDatabase(): Promise<boolean> {
    try {
      console.log('Initializing database...');
      
      // Check if database file exists (without using FileSystem)
      const dbExists = await this.checkDatabaseExists();
      console.log(`Database file exists: ${dbExists}`);
      
      // Get database connection
      const db = await this.getDatabase();
      
      // Test connection with simple query
      const result = await db.getAllAsync<any>('SELECT COUNT(*) as count FROM sqlite_master WHERE type="table"');
      console.log(`Database initialized with ${result[0]?.count} tables`);
      
      // Verify main tables exist
      const tables = ['trips', 'stop_times', 'stops', 'routes', 'calendar'];
      for (const table of tables) {
        const tableCheck = await db.getAllAsync<any>(
          `SELECT COUNT(*) as count FROM sqlite_master WHERE type="table" AND name=?`,
          [table]
        );
        console.log(`Table ${table}: ${tableCheck[0]?.count > 0 ? '✓ exists' : '✗ missing'}`);
      }
      
      // Get count of trips
      const tripsCount = await db.getAllAsync<any>('SELECT COUNT(*) as count FROM trips');
      console.log(`Trips table has ${tripsCount[0]?.count} records`);
      
      this.isInitialized = true;
      console.log('✅ Database initialization complete');
      return true;
      
    } catch (error) {
      console.error('❌ Failed to initialize database:', error);
      this.db = null;
      this.isInitialized = false;
      return false;
    }
  }

  private async checkDatabaseExists(): Promise<boolean> {
    try {
      // Try to open the database - if it fails, it doesn't exist
      const db = SQLite.openDatabaseSync(this.dbPath);
      await db.getAllAsync('SELECT 1');
      return true;
    } catch (error) {
      console.log('Database file check failed (might not exist yet):', error);
      return false;
    }
  }

  private async getDatabase(): Promise<SQLite.SQLiteDatabase> {
    if (!this.db) {
      try {
        console.log('Opening database connection...');
        this.db = SQLite.openDatabaseSync(this.dbPath);
        console.log('Database connected successfully');
      } catch (error) {
        console.error('Failed to open database:', error);
        throw error;
      }
    }
    return this.db;
  }

  private async ensureDatabaseReady(): Promise<SQLite.SQLiteDatabase> {
    // If not initialized, initialize first
    if (!this.isInitialized) {
      await this.initializeDatabase();
    }
    
    const db = await this.getDatabase();
    
    // Verify connection is alive
    try {
      await db.getAllAsync('SELECT 1');
      return db;
    } catch (error) {
      console.error('Database connection lost, reconnecting...');
      this.db = null;
      this.isInitialized = false;
      const newDb = await this.getDatabase();
      await this.initializeDatabase();
      return newDb;
    }
  }

  private ensureString(value: string | number): string {
    return typeof value === 'number' ? value.toString() : value;
  }

  private formatDateToServiceId(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const yyyymmdd = `${year}${month}${day}`;
    console.log(`Formatted service_id: ${yyyymmdd} for date: ${date.toDateString()}`);
    return yyyymmdd;
  }

  private isRouteValidForDate(routeId: string, date: Date): boolean {
    const routeIdParts = routeId.split('-');
    if (routeIdParts.length < 1) return true;
    
    const dateRangePart = routeIdParts[0];
    
    if (dateRangePart.length >= 8 && /^\d+$/.test(dateRangePart)) {
      const startMMDD = dateRangePart.substring(0, 4);
      const endMMDD = dateRangePart.substring(4, 8);
      
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const currentMMDD = `${month}${day}`;
      
      console.log(`\n📅 Checking route ${routeId} for date ${currentMMDD}`);
      console.log(`   Start range: ${startMMDD}, End range: ${endMMDD}`);
      
      if (startMMDD <= endMMDD) {
        const isValid = currentMMDD >= startMMDD && currentMMDD <= endMMDD;
        console.log(`   Normal range check: ${isValid ? 'VALID ✓' : 'INVALID ✗'}`);
        return isValid;
      } else {
        const isValid = currentMMDD >= startMMDD || currentMMDD <= endMMDD;
        console.log(`   Wrap-around range check: ${isValid ? 'VALID ✓' : 'INVALID ✗'}`);
        return isValid;
      }
    }
    
    return true;
  }

  private getDirectionId(direction: string): number | undefined {
    if (!direction) return undefined;
    
    const directionLower = direction.toLowerCase().trim();
    
    switch (directionLower) {
      case 'inbound':
        return 1; // Towards Union Station
      case 'outbound':
        return 0; // Away from Union Station
      default:
        return undefined;
    }
  }

  async getValidRoutesForDate(date: Date): Promise<string[]> {
    try {
      const db = await this.ensureDatabaseReady();
      
      const routes = await db.getAllAsync<any>('SELECT DISTINCT route_id FROM trips');
      
      const validRoutes = routes
        .map(r => r.route_id)
        .filter(routeId => this.isRouteValidForDate(routeId, date));
      
      console.log(`\n========== VALID ROUTES FOR ${date.toDateString()} ==========`);
      console.log(`Total routes: ${routes.length}`);
      console.log(`Valid routes: ${validRoutes.length}`);
      validRoutes.slice(0, 10).forEach(route => {
        console.log(`  ✓ ${route}`);
      });
      if (validRoutes.length > 10) {
        console.log(`  ... and ${validRoutes.length - 10} more`);
      }
      console.log('==========================================\n');
      
      return validRoutes;
    } catch (error) {
      console.error('Error getting valid routes for date:', error);
      return [];
    }
  }

  async getStopsByRoute(
    routeId: string | number,
    variant: string,
    date: Date
  ): Promise<Stop[]> {
    try {
      const db = await this.ensureDatabaseReady();
      const routeIdStr = this.ensureString(routeId);
      const serviceId = this.formatDateToServiceId(date);
      
      console.log('\n========== GET STOPS BY ROUTE ==========');
      console.log(`Route ID: "${routeIdStr}"`);
      console.log(`Variant: "${variant}"`);
      console.log(`Date: ${date.toDateString()} -> service_id: ${serviceId}`);
      
      // Find trip matching route, variant, and service_id
      const sampleTripQuery = `
        SELECT trip_id, route_variant, service_id, direction_id
        FROM trips 
        WHERE route_id = ?
          AND service_id = ?
          AND route_variant = ?
        LIMIT 1
      `;
      
      const sampleParams: any[] = [routeIdStr, serviceId, variant];
      
      console.log(`Query: ${sampleTripQuery}`);
      console.log(`Params: ${JSON.stringify(sampleParams)}`);
      
      const sampleTrip = await db.getAllAsync<any>(sampleTripQuery, sampleParams);
      
      if (sampleTrip.length === 0) {
        console.log(`❌ No trips found for route ${routeIdStr}, variant ${variant}, service_id ${serviceId}`);
        
        // Try to find any trip for this route to help debug
        const anyTrip = await db.getAllAsync<any>(
          `SELECT service_id, route_variant, direction_id FROM trips WHERE route_id = ? LIMIT 3`,
          [routeIdStr]
        );
        if (anyTrip.length > 0) {
          console.log(`💡 Available trips for this route:`);
          anyTrip.forEach(trip => {
            console.log(`   service_id: ${trip.service_id}, variant: ${trip.route_variant}, direction: ${trip.direction_id}`);
          });
        }
        return [];
      }
      
      console.log(`✅ Found sample trip:`);
      console.log(`   Trip ID: ${sampleTrip[0].trip_id}`);
      console.log(`   Direction ID: ${sampleTrip[0].direction_id} ${sampleTrip[0].direction_id === 1 ? '(inbound to Union)' : '(outbound from Union)'}`);
      console.log(`   Variant: ${sampleTrip[0].route_variant}`);
      console.log(`   Service ID: ${sampleTrip[0].service_id}`);
      
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
      
      const stops = await db.getAllAsync<any>(stopsQuery, [sampleTripId]);
      
      console.log(`\n📊 Found ${stops.length} stops for trip ${sampleTripId}:`);
      stops.forEach((stop, index) => {
        console.log(`   ${stop.stop_sequence}. ${stop.stop_name}`);
      });
      
      const orderedStops = stops.map(stop => ({
        stop_id: stop.stop_id,
        stop_name: stop.stop_name,
      }));
      
      console.log(`\n✅ Returning ${orderedStops.length} stops`);
      console.log('==========================================\n');
      
      return orderedStops as Stop[];
    } catch (error) {
      console.error('❌ Error fetching stops by route:', error);
      return [];
    }
  }

  async getRecentSchedule(
    routeId: string | number,
    departureStopId: string | number,
    arrivalStopId?: string | number,
    date?: Date,
    variant?: string,
    direction?: string
  ): Promise<ScheduleItem[]> {
    try {
      const db = await this.ensureDatabaseReady();
      const routeIdStr = this.ensureString(routeId);
      const departureStopIdStr = this.ensureString(departureStopId);
      const queryDate = date || new Date();
      const directionId = this.getDirectionId(direction || '');
      
      if (!this.isRouteValidForDate(routeIdStr, queryDate)) {
        console.log(`❌ Route ${routeIdStr} is not valid for date ${queryDate.toDateString()}`);
        return [];
      }
      
      const serviceId = this.formatDateToServiceId(queryDate);
      const now = new Date();
      const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      const isToday = queryDate.toDateString() === now.toDateString();
      
      console.log('\n========== GET RECENT SCHEDULE ==========');
      console.log(`Route ID: ${routeIdStr}`);
      console.log(`Service ID: ${serviceId}`);
      console.log(`Variant: ${variant || 'none'}`);
      console.log(`Direction: ${direction || 'none'}`);
      console.log(`Departure Stop: ${departureStopIdStr}`);
      
      let query = `
        SELECT 
          t.trip_id,
          t.trip_headsign as destination,
          st.departure_time,
          st.stop_sequence
        FROM trips t
        INNER JOIN stop_times st ON t.trip_id = st.trip_id
        WHERE t.route_id = ?
          AND t.service_id = ?
          AND st.stop_id = ?
      `;
      
      const params: any[] = [routeIdStr, serviceId, departureStopIdStr];
      
      if (variant && variant.trim() !== '') {
        query += ` AND t.route_variant = ?`;
        params.push(variant);
      }
      
      if (directionId !== undefined && directionId !== null) {
        query += ` AND t.direction_id = ?`;
        params.push(directionId);
      }
      
      if (isToday) {
        query += ` AND st.departure_time >= ?`;
        params.push(currentSeconds);
      }
      
      query += ` ORDER BY st.departure_time ASC LIMIT 50`;
      
      const results = await db.getAllAsync<any>(query, params);
      
      console.log(`Found ${results.length} schedules`);
      return results as ScheduleItem[];
    } catch (error) {
      console.error('❌ Error fetching schedule:', error);
      return [];
    }
  }

  async getNextSchedule(
    routeId: string | number,
    departureStopId: string | number,
    arrivalStopId?: string | number,
    date?: Date,
    variant?: string,
    direction?: string
  ): Promise<ScheduleItem | null> {
    try {
      const db = await this.ensureDatabaseReady();
      const routeIdStr = this.ensureString(routeId);
      const departureStopIdStr = this.ensureString(departureStopId);
      const queryDate = date || new Date();
      const directionId = this.getDirectionId(direction || '');
      
      if (!this.isRouteValidForDate(routeIdStr, queryDate)) {
        console.log(`❌ Route ${routeIdStr} is not valid for date ${queryDate.toDateString()}`);
        return null;
      }
      
      const serviceId = this.formatDateToServiceId(queryDate);
      const now = new Date();
      const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      const isToday = queryDate.toDateString() === now.toDateString();
      
      let query = `
        SELECT 
          t.trip_id,
          t.trip_headsign as destination,
          st.departure_time,
          st.stop_sequence
        FROM trips t
        INNER JOIN stop_times st ON t.trip_id = st.trip_id
        WHERE t.route_id = ?
          AND t.service_id = ?
          AND st.stop_id = ?
      `;
      
      const params: any[] = [routeIdStr, serviceId, departureStopIdStr];
      
      if (variant && variant.trim() !== '') {
        query += ` AND t.route_variant = ?`;
        params.push(variant);
      }
      
      if (directionId !== undefined && directionId !== null) {
        query += ` AND t.direction_id = ?`;
        params.push(directionId);
      }
      
      if (isToday) {
        query += ` AND st.departure_time >= ?`;
        params.push(currentSeconds);
      }
      
      query += ` ORDER BY st.departure_time ASC LIMIT 1`;
      
      const results = await db.getAllAsync<any>(query, params);
      
      if (results && results.length > 0) {
        return results[0] as ScheduleItem;
      }
      return null;
    } catch (error) {
      console.error('❌ Error fetching next schedule:', error);
      return null;
    }
  }

  async getScheduleWithArrival(
    routeId: string | number,
    departureStopId: string | number,
    arrivalStopId: string | number,
    date: Date,
    variant?: string,
    direction?: string
  ): Promise<TripWithArrival[]> {
    try {
      const db = await this.ensureDatabaseReady();
      const routeIdStr = this.ensureString(routeId);
      const departureStopIdStr = this.ensureString(departureStopId);
      const arrivalStopIdStr = this.ensureString(arrivalStopId);
      const directionId = this.getDirectionId(direction || '');
      
      if (!this.isRouteValidForDate(routeIdStr, date)) {
        console.log(`❌ Route ${routeIdStr} is not valid for date ${date.toDateString()}`);
        return [];
      }
      
      const serviceId = this.formatDateToServiceId(date);
      const now = new Date();
      const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      const isToday = date.toDateString() === now.toDateString();
      
      let query = `
        SELECT 
          t.trip_id,
          t.trip_headsign as destination,
          st_departure.departure_time,
          st_arrival.arrival_time,
          (st_arrival.arrival_time - st_departure.departure_time) / 60 as travel_time_minutes
        FROM trips t
        INNER JOIN stop_times st_departure ON t.trip_id = st_departure.trip_id
        INNER JOIN stop_times st_arrival ON t.trip_id = st_arrival.trip_id
        WHERE t.route_id = ?
          AND t.service_id = ?
          AND st_departure.stop_id = ?
          AND st_arrival.stop_id = ?
          AND st_arrival.arrival_time > st_departure.departure_time
          AND st_departure.stop_sequence < st_arrival.stop_sequence
      `;
      
      const params: any[] = [routeIdStr, serviceId, departureStopIdStr, arrivalStopIdStr];
      
      if (variant && variant.trim() !== '') {
        query += ` AND t.route_variant = ?`;
        params.push(variant);
      }
      
      if (directionId !== undefined && directionId !== null) {
        query += ` AND t.direction_id = ?`;
        params.push(directionId);
      }
      
      if (isToday) {
        query += ` AND st_departure.departure_time >= ?`;
        params.push(currentSeconds);
      }
      
      query += ` ORDER BY st_departure.departure_time ASC LIMIT 50`;
      
      const results = await db.getAllAsync<any>(query, params);
      
      return results.map(r => ({
        ...r,
        travel_time_minutes: Math.round(r.travel_time_minutes)
      })) as TripWithArrival[];
    } catch (error) {
      console.error('❌ Error fetching schedule with arrival:', error);
      return [];
    }
  }

  async getNextScheduleWithArrival(
    routeId: string | number,
    departureStopId: string | number,
    arrivalStopId: string | number,
    date: Date,
    variant?: string,
    direction?: string
  ): Promise<TripWithArrival | null> {
    try {
      const db = await this.ensureDatabaseReady();
      const routeIdStr = this.ensureString(routeId);
      const departureStopIdStr = this.ensureString(departureStopId);
      const arrivalStopIdStr = this.ensureString(arrivalStopId);
      const directionId = this.getDirectionId(direction || '');
      
      if (!this.isRouteValidForDate(routeIdStr, date)) {
        console.log(`❌ Route ${routeIdStr} is not valid for date ${date.toDateString()}`);
        return null;
      }
      
      const serviceId = this.formatDateToServiceId(date);
      const now = new Date();
      const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
      const isToday = date.toDateString() === now.toDateString();
      
      let query = `
        SELECT 
          t.trip_id,
          t.trip_headsign as destination,
          st_departure.departure_time,
          st_arrival.arrival_time,
          (st_arrival.arrival_time - st_departure.departure_time) / 60 as travel_time_minutes
        FROM trips t
        INNER JOIN stop_times st_departure ON t.trip_id = st_departure.trip_id
        INNER JOIN stop_times st_arrival ON t.trip_id = st_arrival.trip_id
        WHERE t.route_id = ?
          AND t.service_id = ?
          AND st_departure.stop_id = ?
          AND st_arrival.stop_id = ?
          AND st_arrival.arrival_time > st_departure.departure_time
          AND st_departure.stop_sequence < st_arrival.stop_sequence
      `;
      
      const params: any[] = [routeIdStr, serviceId, departureStopIdStr, arrivalStopIdStr];
      
      if (variant && variant.trim() !== '') {
        query += ` AND t.route_variant = ?`;
        params.push(variant);
      }
      
      if (directionId !== undefined && directionId !== null) {
        query += ` AND t.direction_id = ?`;
        params.push(directionId);
      }
      
      if (isToday) {
        query += ` AND st_departure.departure_time >= ?`;
        params.push(currentSeconds);
      }
      
      query += ` ORDER BY st_departure.departure_time ASC LIMIT 1`;
      
      const results = await db.getAllAsync<any>(query, params);
      
      if (results && results.length > 0) {
        return {
          ...results[0],
          travel_time_minutes: Math.round(results[0].travel_time_minutes)
        } as TripWithArrival;
      }
      return null;
    } catch (error) {
      console.error('❌ Error fetching next schedule with arrival:', error);
      return null;
    }
  }

  async checkConnection(): Promise<boolean> {
    try {
      const db = await this.ensureDatabaseReady();
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