// src/services/GoTransitService.ts
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';
import * as SQLite from 'expo-sqlite';

export interface Route {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  route_color: string;
}

export interface Stop {
  stop_id: string;
  stop_name: string;
}

export interface Departure {
  trip_id: string;
  departure_time: number; // seconds from midnight
  stop_name: string;
  headsign: string;
  arrival_time?: number; // seconds from midnight
}

export interface TripWithArrival {
  trip_id: string;
  departure_time: number; // seconds from midnight
  arrival_time: number; // seconds from midnight
  destination: string;
  departure_stop: string;
  arrival_stop: string;
  travel_time_minutes: number;
}

interface TableInfo {
  name: string;
}

interface CountResult {
  count: number;
}

class GoTransitService {
  private db: SQLite.SQLiteDatabase | null = null;
  private databaseName = 'go_transit.db';
  private dbFile: File;
  private sqliteDir: Directory;

  constructor() {
    this.sqliteDir = new Directory(Paths.document, 'SQLite');
    this.dbFile = new File(this.sqliteDir, this.databaseName);
  }

  // Initialize database - call this once when app starts
  async init(): Promise<void> {
    try {
      // Ensure SQLite directory exists
      if (!this.sqliteDir.exists) {
        this.sqliteDir.create({ intermediates: true });
        console.log('Created SQLite directory');
      }

      // ALWAYS copy database from assets (force fresh copy every time)
      console.log('Copying database from assets (forced)...');
      await this.copyDatabaseFromAsset();
      
      // Verify copy was successful
      if (!this.dbFile.exists) {
        throw new Error('Database file does not exist after copy');
      }
      
      console.log('Database file size:', this.dbFile.size, 'bytes');

      // Open database
      this.db = await SQLite.openDatabaseAsync(this.dbFile.uri);
      console.log('Database opened successfully');

      // Verify database has data
      const isValid = await this.verifyDatabase();
      if (!isValid) {
        console.log('Database verification failed');
        throw new Error('Database verification failed');
      }
      
      console.log('Database initialized successfully');
    } catch (error) {
      console.error('Error initializing database:', error);
      throw error;
    }
  }

  // Copy database from assets to app's document directory
  private async copyDatabaseFromAsset(): Promise<void> {
    try {
      // First, delete existing database if it exists
      if (this.dbFile.exists) {
        this.dbFile.delete();
        console.log('Deleted existing database file');
      }
      
      // Also delete any other .db files in the directory
      if (this.sqliteDir.exists) {
        const files = this.sqliteDir.list();
        for (const file of files) {
          if (file.name.endsWith('.db')) {
            const fileToDelete = new File(this.sqliteDir, file.name);
            fileToDelete.delete();
            console.log(`Deleted ${file.name}`);
          }
        }
      }
      
      // Try multiple possible database file locations
      let asset: Asset | null = null;
      const possiblePaths = [
        require('../../assets/go_transit.db')
      ];
      
      for (const path of possiblePaths) {
        try {
          console.log('Trying to load database from:', path);
          const testAsset = Asset.fromModule(path);
          await testAsset.downloadAsync();
          if (testAsset.localUri) {
            asset = testAsset;
            console.log('Found database at asset, localUri:', testAsset.localUri);
            break;
          }
        } catch (e) {
          console.log('Not found at path:', e);
          continue;
        }
      }

      if (!asset || !asset.localUri) {
        throw new Error('No database file found in assets. Please add go_transit.db to assets folder');
      }

      const sourceFile = new File(asset.localUri);
      console.log('Source file exists:', sourceFile.exists);
      console.log('Source file size:', sourceFile.size, 'bytes');
      console.log('Source file URI:', asset.localUri);
      
      // Copy the file using new API
      sourceFile.copy(this.dbFile);
      
      // Verify copy was successful
      if (this.dbFile.exists) {
        console.log('Database copied successfully from assets. Size:', this.dbFile.size, 'bytes');
      } else {
        throw new Error('Failed to copy database file - file does not exist after copy');
      }
    } catch (error) {
      console.error('Error copying database from assets:', error);
      throw error;
    }
  }

  // Reset database and load new one from assets
  async resetAndLoadNewDatabase(): Promise<void> {
    try {
      console.log('Resetting database...');
      
      // Close existing database connection
      if (this.db) {
        await this.db.closeAsync();
        this.db = null;
      }
      
      // Force copy database from assets
      await this.copyDatabaseFromAsset();
      
      // Re-open the database
      this.db = await SQLite.openDatabaseAsync(this.dbFile.uri);
      console.log('New database opened successfully');
      
      // Verify the new database
      await this.verifyDatabase();
      
      console.log('Database reset and reloaded successfully');
    } catch (error) {
      console.error('Failed to reset database:', error);
      throw error;
    }
  }

  // Reset database - simple version
  async resetDatabase(): Promise<void> {
    await this.resetAndLoadNewDatabase();
  }

  // Force delete and recreate database
  async forceRecreateDatabase(): Promise<void> {
    await this.resetAndLoadNewDatabase();
  }

  // Verify database has required tables and data
  private async verifyDatabase(): Promise<boolean> {
    if (!this.db) return false;

    try {
      // Check if routes table exists
      const tables = await this.db.getAllAsync<TableInfo>(
        `SELECT name FROM sqlite_master 
         WHERE type='table' AND name IN ('routes', 'trips', 'stop_times', 'stops')`
      );

      const tableNames = tables.map((t: TableInfo) => t.name);
      console.log('Tables found in database:', tableNames);

      const hasRoutes = tableNames.includes('routes');
      const hasTrips = tableNames.includes('trips');
      const hasStopTimes = tableNames.includes('stop_times');
      const hasStops = tableNames.includes('stops');

      if (!hasRoutes || !hasTrips || !hasStopTimes || !hasStops) {
        console.error('Missing required tables. Found:', tableNames);
        return false;
      }

      // Check if there are routes
      const routes = await this.db.getFirstAsync<CountResult>(
        'SELECT COUNT(*) as count FROM routes'
      );

      const routeCount = routes?.count || 0;
      console.log(`Database verified: ${routeCount} routes found`);

      if (routeCount === 0) {
        console.warn('No routes found in database');
        return false;
      }

      // Check trips table columns
      const columns = await this.db.getAllAsync<any>(`PRAGMA table_info(trips)`);
      const columnNames = columns.map((c: any) => c.name);
      console.log('Trips table columns:', columnNames);
      
      return true;
    } catch (error) {
      console.error('Error verifying database:', error);
      return false;
    }
  }

  // Get all database files in the SQLite directory
  async getDatabaseFiles(): Promise<string[]> {
    try {
      const files: string[] = [];
      if (this.sqliteDir.exists) {
        const fileList = this.sqliteDir.list();
        for (const file of fileList) {
          files.push(file.name);
        }
      }
      return files;
    } catch (error) {
      console.error('Error listing database files:', error);
      return [];
    }
  }

  // Check database schema
  async checkDatabaseSchema(): Promise<{
    hasRoutes: boolean;
    hasTrips: boolean;
    hasStopTimes: boolean;
    hasStops: boolean;
    tableNames: string[];
  }> {
    const result = {
      hasRoutes: false,
      hasTrips: false,
      hasStopTimes: false,
      hasStops: false,
      tableNames: [] as string[]
    };

    try {
      if (!this.db) {
        console.log('Database not open');
        return result;
      }

      const tables = await this.db.getAllAsync<TableInfo>(
        `SELECT name FROM sqlite_master WHERE type='table'`
      );
      
      result.tableNames = tables.map((t: TableInfo) => t.name);
      console.log('Tables in database:', result.tableNames);
      
      result.hasRoutes = result.tableNames.includes('routes');
      result.hasTrips = result.tableNames.includes('trips');
      result.hasStopTimes = result.tableNames.includes('stop_times');
      result.hasStops = result.tableNames.includes('stops');
      
      return result;
    } catch (error) {
      console.error('Error checking schema:', error);
      return result;
    }
  }

  // Get database file info
  async getDatabaseFileInfo(): Promise<{
    uri: string;
    exists: boolean;
    size: number;
    directoryExists: boolean;
    filesInDirectory: string[];
  }> {
    const filesInDirectory: string[] = [];
    
    try {
      if (this.sqliteDir.exists) {
        const fileList = this.sqliteDir.list();
        for (const file of fileList) {
          filesInDirectory.push(file.name);
        }
      }
      
      return {
        uri: this.dbFile.uri,
        exists: this.dbFile.exists,
        size: this.dbFile.exists ? this.dbFile.size : 0,
        directoryExists: this.sqliteDir.exists,
        filesInDirectory
      };
    } catch (error) {
      console.error('Error getting file info:', error);
      return {
        uri: this.dbFile.uri,
        exists: false,
        size: 0,
        directoryExists: false,
        filesInDirectory: []
      };
    }
  }

  // Get database info
  async getDatabaseInfo(): Promise<{
    exists: boolean;
    size?: number;
    uri: string;
  }> {
    return {
      exists: this.dbFile.exists,
      size: this.dbFile.exists ? this.dbFile.size : undefined,
      uri: this.dbFile.uri,
    };
  }

  // Check if database is ready
  async isDatabaseReady(): Promise<boolean> {
    try {
      if (!this.db) return false;
      const result = await this.db.getFirstAsync<CountResult>(
        'SELECT COUNT(*) as count FROM routes'
      );
      return (result?.count || 0) > 0;
    } catch (error) {
      console.error('Database not ready:', error);
      return false;
    }
  }

  // PUBLIC METHOD: Check if a route is valid for a given date based on its date range
// In GoTransitService.ts, update the isRouteValidForDate method:

public isRouteValidForDate(routeId: string, date: Date): boolean {
  console.log(`\n🔍 Checking route: ${routeId} for date: ${date.toDateString()}`);
  
  // Extract the date range from route_id if it follows MMDDMMDD pattern
  // Route ID might be like "01260426-21", "04260626-21", "01011231-21A" etc.
  const routeIdParts = routeId.split('-');
  if (routeIdParts.length < 1) {
    console.log(`   No dash found, assuming valid`);
    return true;
  }
  
  const dateRangePart = routeIdParts[0];
  console.log(`   Date range part: ${dateRangePart}`);
  
  // Check if it has at least 8 digits (MMDDMMDD)
  if (dateRangePart.length >= 8 && /^\d+$/.test(dateRangePart)) {
    const startMMDD = dateRangePart.substring(0, 4);
    const endMMDD = dateRangePart.substring(4, 8);
    
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    const currentMMDD = `${month}${day}`;
    
    console.log(`   Start: ${startMMDD}, End: ${endMMDD}, Current: ${currentMMDD}`);
    
    // Compare MMDD strings
    if (startMMDD <= endMMDD) {
      // Normal range (e.g., 0126 to 0426)
      const isValid = currentMMDD >= startMMDD && currentMMDD <= endMMDD;
      console.log(`   Normal range: ${isValid ? '✅ VALID' : '❌ INVALID'}`);
      return isValid;
    } else {
      // Wrap-around range (e.g., 1125 to 0115 - Nov 25 to Jan 15)
      const isValid = currentMMDD >= startMMDD || currentMMDD <= endMMDD;
      console.log(`   Wrap-around: ${isValid ? '✅ VALID' : '❌ INVALID'}`);
      return isValid;
    }
  }
  
  console.log(`   No valid date range pattern found, assuming valid`);
  return true; // No date range pattern found
}

  // Get valid routes for a specific date
  async getValidRoutesForDate(routes: Route[], date: Date): Promise<Route[]> {
    const validRoutes = routes.filter(route => 
      this.isRouteValidForDate(route.route_id, date)
    );
    
    console.log(`\n========== VALID ROUTES FOR ${date.toDateString()} ==========`);
    console.log(`Total routes: ${routes.length}`);
    console.log(`Valid routes: ${validRoutes.length}`);
    validRoutes.forEach(route => {
      console.log(`  ✓ ${route.route_id} - ${route.route_short_name}`);
    });
    console.log('==========================================\n');
    
    return validRoutes;
  }

  // Get all unique GO routes (modified to return all routes including date-specific ones)
  async getRoutes(includeAllVariants: boolean = true): Promise<Route[]> {
    if (!this.db) return [];

    try {
      let query = `
        SELECT 
          route_id,
          route_short_name,
          route_long_name,
          route_color
        FROM routes 
        WHERE route_short_name IS NOT NULL
          AND route_short_name != ''
      `;
      
      if (!includeAllVariants) {
        query += ` GROUP BY route_short_name`;
      }
      
      query += ` ORDER BY route_short_name`;
      
      const result = await this.db.getAllAsync<Route>(query);
      return result || [];
    } catch (error) {
      console.error('Error getting routes:', error);
      return [];
    }
  }

  // Get stops for a specific route
  async getStopsByRoute(routeId: string): Promise<Stop[]> {
    if (!this.db) return [];

    try {
      const result = await this.db.getAllAsync<Stop>(
        `SELECT DISTINCT 
          s.stop_id, 
          s.stop_name
        FROM stops s
        JOIN stop_times st ON s.stop_id = st.stop_id
        JOIN trips t ON st.trip_id = t.trip_id
        WHERE t.route_id = ?
          AND s.stop_id IS NOT NULL
          AND s.stop_name IS NOT NULL
        GROUP BY s.stop_id, s.stop_name
        ORDER BY MIN(st.stop_sequence)`,
        [routeId]
      );

      return result || [];
    } catch (error) {
      console.error('Error getting stops by route:', error);
      return [];
    }
  }

  // Get schedule for a route (simple version) - with date validation
  async getRecentSchedule(
    routeId: string,
    startStopId: string,
    endStopId?: string,
    date: Date = new Date()
  ): Promise<Departure[]> {
    if (!this.db) return [];

    // First, check if the route is valid for this date
    if (!this.isRouteValidForDate(routeId, date)) {
      console.log(`❌ Route ${routeId} is not valid for date ${date.toDateString()}`);
      return [];
    }

    try {
      // Format date to service_id (YYYYMMDD)
      const serviceId = this.formatDateToServiceId(date);
      
      // Get current time in seconds from midnight
      const currentSeconds = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
      const isToday = date.toDateString() === new Date().toDateString();

      let query = `
        SELECT 
          t.trip_id,
          st.departure_time,
          st.arrival_time,
          s.stop_name,
          t.trip_headsign as headsign
        FROM trips t
        JOIN stop_times st ON t.trip_id = st.trip_id
        JOIN stops s ON st.stop_id = s.stop_id
        WHERE t.route_id = ?
          AND t.service_id = ?
          AND s.stop_id = ?
          AND st.departure_time IS NOT NULL
      `;
      
      const params: any[] = [routeId, serviceId, startStopId];
      
      if (isToday) {
        query += ` AND st.departure_time > ?`;
        params.push(currentSeconds);
      }
      
      query += ` GROUP BY t.trip_id, st.departure_time
        ORDER BY st.departure_time
        LIMIT 30`;

      const result = await this.db.getAllAsync<any>(query, params);

      const uniqueDepartures = new Map<string, Departure>();
      for (const item of result || []) {
        const key = `${item.departure_time}-${item.headsign}`;
        if (!uniqueDepartures.has(key)) {
          uniqueDepartures.set(key, {
            trip_id: item.trip_id,
            departure_time: item.departure_time,
            stop_name: item.stop_name,
            headsign: item.headsign || 'Unknown',
            arrival_time: item.arrival_time,
          });
        }
      }

      return Array.from(uniqueDepartures.values());
    } catch (error) {
      console.error('Error getting recent schedule:', error);
      return [];
    }
  }

  // Get schedule with arrival times between two stops - with date validation
  async getScheduleWithArrival(
    routeId: string,
    startStopId: string,
    endStopId: string,
    date: Date = new Date()
  ): Promise<TripWithArrival[]> {
    if (!this.db) return [];

    // First, check if the route is valid for this date
    if (!this.isRouteValidForDate(routeId, date)) {
      console.log(`❌ Route ${routeId} is not valid for date ${date.toDateString()}`);
      return [];
    }

    try {
      // Format date to service_id (YYYYMMDD)
      const serviceId = this.formatDateToServiceId(date);
      
      // Get current time in seconds from midnight
      const currentSeconds = date.getHours() * 3600 + date.getMinutes() * 60 + date.getSeconds();
      const isToday = date.toDateString() === new Date().toDateString();

      let query = `
        SELECT 
          t.trip_id,
          st_start.departure_time,
          st_end.arrival_time,
          t.trip_headsign as destination,
          st_start.stop_id as departure_stop,
          st_end.stop_id as arrival_stop,
          (st_end.arrival_time - st_start.departure_time) / 60 as travel_time_minutes
        FROM trips t
        JOIN stop_times st_start ON t.trip_id = st_start.trip_id
        JOIN stop_times st_end ON t.trip_id = st_end.trip_id
        WHERE t.route_id = ?
          AND t.service_id = ?
          AND st_start.stop_id = ?
          AND st_end.stop_id = ?
          AND st_start.stop_sequence < st_end.stop_sequence
          AND st_start.departure_time IS NOT NULL
          AND st_end.arrival_time IS NOT NULL
      `;
      
      const params: any[] = [routeId, serviceId, startStopId, endStopId];
      
      if (isToday) {
        query += ` AND st_start.departure_time > ?`;
        params.push(currentSeconds);
      }
      
      query += ` GROUP BY t.trip_id
        ORDER BY st_start.departure_time
        LIMIT 30`;

      const result = await this.db.getAllAsync<any>(query, params);

      return (result || []).map((item: any) => ({
        trip_id: item.trip_id,
        departure_time: item.departure_time,
        arrival_time: item.arrival_time,
        destination: item.destination,
        departure_stop: item.departure_stop,
        arrival_stop: item.arrival_stop,
        travel_time_minutes: Math.round(item.travel_time_minutes)
      }));
    } catch (error) {
      console.error('Error getting schedule with arrival:', error);
      return [];
    }
  }

  // Get next schedule with arrival time - with date validation
  async getNextScheduleWithArrival(
    routeId: string,
    startStopId: string,
    endStopId: string,
    date: Date = new Date()
  ): Promise<TripWithArrival | null> {
    const schedules = await this.getScheduleWithArrival(routeId, startStopId, endStopId, date);
    return schedules.length > 0 ? schedules[0] : null;
  }

  // Get next schedule (simple version) - with date validation
  async getNextSchedule(
    routeId: string,
    startStopId: string,
    endStopId?: string,
    date: Date = new Date()
  ): Promise<Departure | null> {
    const schedules = await this.getRecentSchedule(routeId, startStopId, endStopId, date);
    return schedules.length > 0 ? schedules[0] : null;
  }

  // Helper method to format date to service_id (YYYYMMDD)
  private formatDateToServiceId(date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, '0');
    const day = String(date.getDate()).padStart(2, '0');
    return `${year}${month}${day}`;
  }

  // Close database connection
  async closeDatabase(): Promise<void> {
    if (this.db) {
      await this.db.closeAsync();
      this.db = null;
      console.log('Database closed');
    }
  }
}

export default new GoTransitService();