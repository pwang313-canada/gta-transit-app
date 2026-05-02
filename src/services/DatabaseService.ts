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

  private constructor() {}

  static getInstance(): DatabaseService {
    if (!DatabaseService.instance) {
      DatabaseService.instance = new DatabaseService();
    }
    return DatabaseService.instance;
  }

  private async getDatabase(): Promise<SQLite.SQLiteDatabase> {
    if (!this.db) {
      try {
        this.db = SQLite.openDatabaseSync('go_transit.db');
        console.log('Database connected successfully');
      } catch (error) {
        console.error('Failed to open database:', error);
        throw error;
      }
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
    
    // Format as YYYYMMDD
    const yyyymmdd = `${year}${month}${day}`;
    
    console.log(`Formatted service_id: ${yyyymmdd} for date: ${date.toDateString()}`);
    return yyyymmdd;
  }

  // Helper method to check if a route is valid for a given date based on its date range
  private isRouteValidForDate(routeId: string, date: Date): boolean {
    // Extract the date range from route_id if it follows MMDDMMDD pattern
    // Route ID might be like "01260426-21" where "01260426" is MMDDMMDD
    const routeIdParts = routeId.split('-');
    if (routeIdParts.length < 1) return true; // No date range, assume valid
    
    const dateRangePart = routeIdParts[0];
    
    // Check if it has at least 8 digits (MMDDMMDD)
    if (dateRangePart.length >= 8 && /^\d+$/.test(dateRangePart)) {
      const startMMDD = dateRangePart.substring(0, 4);
      const endMMDD = dateRangePart.substring(4, 8);
      
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const currentMMDD = `${month}${day}`;
      
      console.log(`\n📅 Checking route ${routeId} for date ${currentMMDD}`);
      console.log(`   Start range: ${startMMDD}, End range: ${endMMDD}`);
      
      // Compare MMDD strings
      if (startMMDD <= endMMDD) {
        // Normal range (e.g., 0126 to 0426)
        const isValid = currentMMDD >= startMMDD && currentMMDD <= endMMDD;
        console.log(`   Normal range check: ${isValid ? 'VALID ✓' : 'INVALID ✗'}`);
        return isValid;
      } else {
        // Wrap-around range (e.g., 1125 to 0115 - Nov 25 to Jan 15)
        const isValid = currentMMDD >= startMMDD || currentMMDD <= endMMDD;
        console.log(`   Wrap-around range check: ${isValid ? 'VALID ✓' : 'INVALID ✗'}`);
        return isValid;
      }
    }
    
    return true; // No date range pattern found
  }

  // Public method to get all valid routes for a specific date
  async getValidRoutesForDate(date: Date): Promise<string[]> {
    const db = await this.getDatabase();
    
    try {
      // Get all distinct route_ids
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

  async getStopsByRoute(routeId: string | number, variant?: string): Promise<Stop[]> {
    const db = await this.getDatabase();
    const routeIdStr = this.ensureString(routeId);
    
    try {
      console.log('\n========== GET STOPS BY ROUTE ==========');
      console.log(`Route ID: "${routeIdStr}"`);
      console.log(`Variant: "${variant}"`);
      
      // Get a sample trip for this route/variant
      let sampleTripQuery = `
        SELECT trip_id, route_variant, service_id 
        FROM trips 
        WHERE route_id = ?
      `;
      
      const sampleParams: any[] = [routeIdStr];
      
      if (variant && variant.trim() !== '') {
        sampleTripQuery += ` AND route_variant = ?`;
        sampleParams.push(variant);
        console.log(`Filtering by variant: ${variant}`);
      }
      
      sampleTripQuery += ` LIMIT 1`;
      
      const sampleTrip = await db.getAllAsync<any>(sampleTripQuery, sampleParams);
      
      if (sampleTrip.length === 0) {
        console.log(`❌ No trips found for route ${routeIdStr}${variant ? ` variant ${variant}` : ''}`);
        return [];
      }
      
      console.log(`✅ Found sample trip:`);
      console.log(`   Trip ID: ${sampleTrip[0].trip_id}`);
      console.log(`   Variant: ${sampleTrip[0].route_variant}`);
      console.log(`   Service ID: ${sampleTrip[0].service_id}`);
      
      const sampleTripId = sampleTrip[0].trip_id;
      
      // Get all stops from this sample trip - ORDER BY stop_sequence!
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
      
      console.log(`\n📊 Found ${stops.length} stops for trip ${sampleTripId} (sorted by sequence):`);
      stops.forEach((stop, index) => {
        console.log(`   ${stop.stop_sequence}. ${stop.stop_name}`);
      });
      
      // Return stops in sequence order (already sorted by SQL)
      const orderedStops = stops.map(stop => ({
        stop_id: stop.stop_id,
        stop_name: stop.stop_name,
      }));
      
      console.log(`\n✅ Returning ${orderedStops.length} stops in sequence order`);
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
    directionId?: number
  ): Promise<ScheduleItem[]> {
    const db = await this.getDatabase();
    const routeIdStr = this.ensureString(routeId);
    const departureStopIdStr = this.ensureString(departureStopId);
    const queryDate = date || new Date();
    
    // First, check if the route is valid for this date
    if (!this.isRouteValidForDate(routeIdStr, queryDate)) {
      console.log(`❌ Route ${routeIdStr} is not valid for date ${queryDate.toDateString()}`);
      return [];
    }
    
    const serviceId = this.formatDateToServiceId(queryDate);
    const now = new Date();
    const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const isToday = queryDate.toDateString() === now.toDateString();
    
    try {
      console.log('\n========== GET RECENT SCHEDULE ==========');
      console.log(`Route ID: ${routeIdStr}`);
      console.log(`✓ Route is valid for ${queryDate.toDateString()}`);
      console.log(`Service ID: ${serviceId} (date: ${queryDate.toDateString()})`);
      console.log(`Variant: ${variant || 'none'}`);
      console.log(`Direction ID: ${directionId !== undefined ? directionId : 'none'}`);
      console.log(`Departure Stop: ${departureStopIdStr}`);
      console.log(`Is Today: ${isToday}`);
      console.log(`Current Time (seconds): ${currentSeconds}`);
      
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
        console.log(`Filtering by variant: ${variant}`);
      }
      
      if (directionId !== undefined && directionId !== null) {
        query += ` AND t.direction_id = ?`;
        params.push(directionId);
        console.log(`Filtering by direction_id: ${directionId}`);
      }
      
      if (isToday) {
        query += ` AND st.departure_time >= ?`;
        params.push(currentSeconds);
        console.log(`Filtering by departure_time >= ${currentSeconds}`);
      }
      
      query += ` ORDER BY st.departure_time ASC LIMIT 50`;
      
      console.log(`\nExecuting query...`);
      const results = await db.getAllAsync<any>(query, params);
      
      console.log(`\n📊 Found ${results.length} schedules:`);
      results.slice(0, 5).forEach((schedule, index) => {
        console.log(`   ${index + 1}. Trip: ${schedule.trip_id}, Departure: ${schedule.departure_time}, Destination: ${schedule.destination}`);
      });
      if (results.length > 5) {
        console.log(`   ... and ${results.length - 5} more`);
      }
      console.log('==========================================\n');
      
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
    directionId?: number
  ): Promise<ScheduleItem | null> {
    const db = await this.getDatabase();
    const routeIdStr = this.ensureString(routeId);
    const departureStopIdStr = this.ensureString(departureStopId);
    const queryDate = date || new Date();
    
    // First, check if the route is valid for this date
    if (!this.isRouteValidForDate(routeIdStr, queryDate)) {
      console.log(`❌ Route ${routeIdStr} is not valid for date ${queryDate.toDateString()}`);
      return null;
    }
    
    const serviceId = this.formatDateToServiceId(queryDate);
    const now = new Date();
    const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const isToday = queryDate.toDateString() === now.toDateString();
    
    try {
      console.log('\n========== GET NEXT SCHEDULE ==========');
      console.log(`Route ID: ${routeIdStr}`);
      console.log(`✓ Route is valid for ${queryDate.toDateString()}`);
      console.log(`Service ID: ${serviceId}`);
      console.log(`Variant: ${variant || 'none'}`);
      console.log(`Direction ID: ${directionId !== undefined ? directionId : 'none'}`);
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
      
      query += ` ORDER BY st.departure_time ASC LIMIT 1`;
      
      const results = await db.getAllAsync<any>(query, params);
      
      if (results && results.length > 0) {
        console.log(`✅ Next schedule: ${results[0].trip_id} at ${results[0].departure_time}`);
        console.log('==========================================\n');
        return results[0] as ScheduleItem;
      }
      console.log(`❌ No next schedule found`);
      console.log('==========================================\n');
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
    directionId?: number
  ): Promise<TripWithArrival[]> {
    const db = await this.getDatabase();
    const routeIdStr = this.ensureString(routeId);
    const departureStopIdStr = this.ensureString(departureStopId);
    const arrivalStopIdStr = this.ensureString(arrivalStopId);
    
    // First, check if the route is valid for this date
    if (!this.isRouteValidForDate(routeIdStr, date)) {
      console.log(`❌ Route ${routeIdStr} is not valid for date ${date.toDateString()}`);
      return [];
    }
    
    const serviceId = this.formatDateToServiceId(date);
    const now = new Date();
    const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const isToday = date.toDateString() === now.toDateString();
    
    try {
      console.log('\n========== GET SCHEDULE WITH ARRIVAL ==========');
      console.log(`Route ID: ${routeIdStr}`);
      console.log(`✓ Route is valid for ${date.toDateString()}`);
      console.log(`Service ID: ${serviceId} (date: ${date.toDateString()})`);
      console.log(`Variant: ${variant || 'none'}`);
      console.log(`Direction ID: ${directionId !== undefined ? directionId : 'none'}`);
      console.log(`Departure Stop: ${departureStopIdStr}`);
      console.log(`Arrival Stop: ${arrivalStopIdStr}`);
      console.log(`Is Today: ${isToday}`);
      
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
        console.log(`Filtering by variant: ${variant}`);
      }
      
      if (directionId !== undefined && directionId !== null) {
        query += ` AND t.direction_id = ?`;
        params.push(directionId);
        console.log(`Filtering by direction_id: ${directionId}`);
      }
      
      if (isToday) {
        query += ` AND st_departure.departure_time >= ?`;
        params.push(currentSeconds);
        console.log(`Filtering by departure_time >= ${currentSeconds}`);
      }
      
      query += ` ORDER BY st_departure.departure_time ASC LIMIT 50`;
      
      console.log(`\nExecuting query...`);
      const results = await db.getAllAsync<any>(query, params);
      
      console.log(`\n📊 Found ${results.length} trips with arrival:`);
      results.slice(0, 5).forEach((trip, index) => {
        console.log(`   ${index + 1}. Trip: ${trip.trip_id}, Depart: ${trip.departure_time}, Arrive: ${trip.arrival_time}, Travel: ${trip.travel_time_minutes}min, Dest: ${trip.destination}`);
      });
      if (results.length > 5) {
        console.log(`   ... and ${results.length - 5} more`);
      }
      console.log('==========================================\n');
      
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
    directionId?: number
  ): Promise<TripWithArrival | null> {
    const db = await this.getDatabase();
    const routeIdStr = this.ensureString(routeId);
    const departureStopIdStr = this.ensureString(departureStopId);
    const arrivalStopIdStr = this.ensureString(arrivalStopId);
    
    // First, check if the route is valid for this date
    if (!this.isRouteValidForDate(routeIdStr, date)) {
      console.log(`❌ Route ${routeIdStr} is not valid for date ${date.toDateString()}`);
      return null;
    }
    
    const serviceId = this.formatDateToServiceId(date);
    const now = new Date();
    const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    const isToday = date.toDateString() === now.toDateString();
    
    try {
      console.log('\n========== GET NEXT SCHEDULE WITH ARRIVAL ==========');
      console.log(`Route ID: ${routeIdStr}`);
      console.log(`✓ Route is valid for ${date.toDateString()}`);
      console.log(`Service ID: ${serviceId}`);
      console.log(`Variant: ${variant || 'none'}`);
      console.log(`Direction ID: ${directionId !== undefined ? directionId : 'none'}`);
      console.log(`Departure Stop: ${departureStopIdStr}`);
      console.log(`Arrival Stop: ${arrivalStopIdStr}`);
      
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
        console.log(`✅ Next trip: ${results[0].trip_id} at ${results[0].departure_time}`);
        console.log('==========================================\n');
        return {
          ...results[0],
          travel_time_minutes: Math.round(results[0].travel_time_minutes)
        } as TripWithArrival;
      }
      console.log(`❌ No next trip found`);
      console.log('==========================================\n');
      return null;
    } catch (error) {
      console.error('❌ Error fetching next schedule with arrival:', error);
      return null;
    }
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
        console.log('Database connection closed');
      } catch (error) {
        console.error('Error closing database:', error);
      }
    }
  }
}

export default DatabaseService.getInstance();