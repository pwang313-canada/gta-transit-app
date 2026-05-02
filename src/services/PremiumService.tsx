// src/services/GoTransitService.ts
import * as SQLite from 'expo-sqlite';
import { File, Directory, Paths } from 'expo-file-system';
import { Asset } from 'expo-asset';

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
  departure_time: string;
  stop_name: string;
  headsign: string;
  arrival_time?: string;
}

class GoTransitService {
  private db: SQLite.SQLiteDatabase | null = null;
  private databaseName = 'go_transit.db';
  private dbFile: File;
  private sqliteDir: Directory;

  constructor() {
    // Create references to directories and files (doesn't create them on disk yet)
    this.sqliteDir = new Directory(Paths.document, 'SQLite');
    this.dbFile = new File(this.sqliteDir, this.databaseName);
  }

  // Initialize database - call this once when app starts
  async init(): Promise<void> {
    try {
      // Ensure SQLite directory exists (create if it doesn't)
      if (!this.sqliteDir.exists) {
        this.sqliteDir.create({ intermediates: true });
        console.log('Created SQLite directory');
      }

      // Check if database exists using the new API
      if (!this.dbFile.exists) {
        console.log('Database not found, copying from assets...');
        await this.copyDatabaseFromAsset();
      } else {
        console.log('Database already exists at:', this.dbFile.uri);
      }

      // Open database using the file's URI
      this.db = await SQLite.openDatabaseAsync(this.dbFile.uri);
      console.log('Database opened successfully');
      
      // Verify database has data
      await this.verifyDatabase();
      
    } catch (error) {
      console.error('Error initializing database:', error);
      throw error;
    }
  }

  // Copy database from assets to documents directory using new API
  private async copyDatabaseFromAsset(): Promise<void> {
    try {
      // Load asset
      const asset = Asset.fromModule(require('../../assets/gtfs.db'));
      await asset.downloadAsync();
      
      if (!asset.localUri) {
        throw new Error('Failed to get asset local URI');
      }
      
      // Create source file from asset using new API
      const sourceFile = new File(asset.localUri);
      
      // Copy to destination using new API (this is synchronous in new API)
      sourceFile.copy(this.dbFile);
      
      console.log('Database copied successfully from assets');
    } catch (error) {
      console.error('Error copying database:', error);
      throw error;
    }
  }

  // Verify database has required tables and data
  private async verifyDatabase(): Promise<boolean> {
    if (!this.db) return false;
    
    try {
      // Check if routes table exists
      const tables = await this.db.getAllAsync(
        `SELECT name FROM sqlite_master 
         WHERE type='table' AND name='routes'`
      );
      
      if (tables.length === 0) {
        console.error('Routes table does not exist');
        return false;
      }
      
      // Check if routes have data
      const routes = await this.db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM routes'
      );
      
      const routeCount = routes?.count || 0;
      console.log(`Database verified: ${routeCount} routes found`);
      
      if (routeCount === 0) {
        console.warn('No routes found in database');
        return false;
      }
      
      return true;
    } catch (error) {
      console.error('Error verifying database:', error);
      return false;
    }
  }

  // Reset database - useful for debugging or refreshing data
  async resetDatabase(): Promise<void> {
    try {
      // Close database if open
      if (this.db) {
        await this.db.closeAsync();
        this.db = null;
      }
      
      // Delete existing database file using new API
      if (this.dbFile.exists) {
        this.dbFile.delete();
        console.log('Database deleted');
      }
      
      // Reinitialize (will copy fresh database)
      await this.init();
      console.log('Database reset complete');
    } catch (error) {
      console.error('Error resetting database:', error);
      throw error;
    }
  }

  // Get database info for debugging using new API
  async getDatabaseInfo(): Promise<{
    exists: boolean;
    size?: number;
    path: string;
  }> {
    try {
      return {
        exists: this.dbFile.exists,
        size: this.dbFile.exists ? this.dbFile.size : undefined,
        path: this.dbFile.uri
      };
    } catch (error) {
      console.error('Error getting database info:', error);
      return { exists: false, path: this.dbFile.uri };
    }
  }

  // Check if database is ready
  async isDatabaseReady(): Promise<boolean> {
    try {
      if (!this.db) return false;
      const result = await this.db.getFirstAsync<{ count: number }>(
        'SELECT COUNT(*) as count FROM routes'
      );
      return (result?.count || 0) > 0;
    } catch (error) {
      console.error('Database not ready:', error);
      return false;
    }
  }

  // Get all unique GO routes (no duplicates)
  async getRoutes(): Promise<Route[]> {
    if (!this.db) return [];
    
    try {
      const result = await this.db.getAllAsync<Route>(
        `SELECT 
          MIN(route_id) as route_id,
          route_short_name,
          MIN(route_long_name) as route_long_name,
          MIN(route_color) as route_color
        FROM routes 
        WHERE (agency_id = 'GO' OR route_short_name LIKE '%GO%')
          AND route_short_name IS NOT NULL
          AND route_short_name != ''
        GROUP BY route_short_name
        ORDER BY route_short_name`
      );
      
      // Additional deduplication by short name
      const seen = new Set();
      const uniqueRoutes = (result || []).filter(route => {
        if (seen.has(route.route_short_name)) {
          return false;
        }
        seen.add(route.route_short_name);
        return true;
      });
      
      console.log(`Found ${uniqueRoutes.length} unique routes`);
      return uniqueRoutes;
    } catch (error) {
      console.error('Error getting routes:', error);
      return [];
    }
  }

  // Get stops for a specific route (no duplicates)
  async getStopsByRoute(routeId: string): Promise<Stop[]> {
    if (!this.db) return [];
    
    try {
      // Get route short name first
      const routeInfo = await this.db.getFirstAsync<{ route_short_name: string }>(
        `SELECT route_short_name FROM routes WHERE route_id = ?`,
        [routeId]
      );
      
      if (!routeInfo) return [];
      
      // Get stops for all routes with same short name
      const result = await this.db.getAllAsync<Stop>(
        `SELECT DISTINCT 
          s.stop_id, 
          s.stop_name
        FROM stops s
        JOIN stop_times st ON s.stop_id = st.stop_id
        JOIN trips t ON st.trip_id = t.trip_id
        JOIN routes r ON t.route_id = r.route_id
        WHERE r.route_short_name = ?
          AND s.stop_id IS NOT NULL
          AND s.stop_name IS NOT NULL
        GROUP BY s.stop_id, s.stop_name
        ORDER BY MIN(st.stop_sequence)`,
        [routeInfo.route_short_name]
      );
      
      // Deduplicate by stop name
      const uniqueStops = new Map();
      (result || []).forEach(stop => {
        if (!uniqueStops.has(stop.stop_name)) {
          uniqueStops.set(stop.stop_name, stop);
        }
      });
      
      console.log(`Found ${uniqueStops.size} unique stops for route ${routeInfo.route_short_name}`);
      return Array.from(uniqueStops.values());
    } catch (error) {
      console.error('Error getting stops by route:', error);
      return [];
    }
  }

  // Get schedule for a route and stop (no duplicate times)
  async getSchedule(
    routeId: string,
    stopId: string,
    date: Date = new Date()
  ): Promise<Departure[]> {
    if (!this.db) return [];
    
    try {
      const dayOfWeek = date.getDay();
      const currentTime = date.toTimeString().slice(0, 5);
      const dayColumn = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'][dayOfWeek];
      
      // Get route short name
      const routeInfo = await this.db.getFirstAsync<{ route_short_name: string }>(
        `SELECT route_short_name FROM routes WHERE route_id = ?`,
        [routeId]
      );
      
      if (!routeInfo) return [];
      
      // Get schedules
      const result = await this.db.getAllAsync<any>(
        `SELECT 
          t.trip_id,
          st.departure_time,
          st.arrival_time,
          s.stop_name,
          t.trip_headsign as headsign
        FROM trips t
        JOIN stop_times st ON t.trip_id = st.trip_id
        JOIN stops s ON st.stop_id = s.stop_id
        JOIN routes r ON t.route_id = r.route_id
        JOIN calendar c ON t.service_id = c.service_id
        WHERE r.route_short_name = ?
          AND s.stop_id = ?
          AND c.${dayColumn} = 1
          AND st.departure_time > ?
          AND date('now') BETWEEN c.start_date AND c.end_date
          AND st.departure_time IS NOT NULL
          AND st.departure_time != ''
        GROUP BY t.trip_id, st.departure_time
        ORDER BY st.departure_time
        LIMIT 50`,
        [routeInfo.route_short_name, stopId, currentTime]
      );
      
      if (!result) return [];
      
      // Remove duplicates by rounding to nearest 5 minutes
      const uniqueByTime = new Map<string, Departure>();
      
      for (const item of result) {
        const roundedTime = this.roundToNearestFiveMinutes(item.departure_time);
        const destination = item.headsign || routeInfo.route_short_name;
        const key = `${roundedTime}-${destination}`;
        
        if (!uniqueByTime.has(key)) {
          uniqueByTime.set(key, {
            trip_id: item.trip_id,
            departure_time: roundedTime,
            stop_name: item.stop_name,
            headsign: destination,
            arrival_time: item.arrival_time
          });
        }
      }
      
      const uniqueDepartures = Array.from(uniqueByTime.values());
      console.log(`Found ${uniqueDepartures.length} unique departure times`);
      return uniqueDepartures;
    } catch (error) {
      console.error('Error getting schedule:', error);
      return [];
    }
  }

  // Search stops by name
  async searchStops(query: string): Promise<Stop[]> {
    if (!this.db) return [];
    
    try {
      const result = await this.db.getAllAsync<Stop>(
        `SELECT DISTINCT 
          stop_id, 
          stop_name
        FROM stops
        WHERE stop_name LIKE ?
          AND stop_id IS NOT NULL
        GROUP BY stop_name
        ORDER BY stop_name
        LIMIT 30`,
        [`%${query}%`]
      );
      
      const uniqueStops = new Map();
      (result || []).forEach(stop => {
        if (!uniqueStops.has(stop.stop_name)) {
          uniqueStops.set(stop.stop_name, stop);
        }
      });
      
      return Array.from(uniqueStops.values());
    } catch (error) {
      console.error('Error searching stops:', error);
      return [];
    }
  }

  // Get all stops for a trip
  async getTripStops(tripId: string): Promise<Stop[]> {
    if (!this.db) return [];
    
    try {
      const result = await this.db.getAllAsync<Stop>(
        `SELECT DISTINCT 
          s.stop_id, 
          s.stop_name,
          MIN(st.stop_sequence) as stop_sequence
        FROM stop_times st
        JOIN stops s ON st.stop_id = s.stop_id
        WHERE st.trip_id = ?
          AND s.stop_id IS NOT NULL
        GROUP BY s.stop_name
        ORDER BY MIN(st.stop_sequence)`,
        [tripId]
      );
      
      const uniqueStops = new Map();
      (result || []).forEach(stop => {
        if (!uniqueStops.has(stop.stop_name)) {
          uniqueStops.set(stop.stop_name, stop);
        }
      });
      
      return Array.from(uniqueStops.values());
    } catch (error) {
      console.error('Error getting trip stops:', error);
      return [];
    }
  }

  // Close database connection
  async closeDatabase(): Promise<void> {
    if (this.db) {
      await this.db.closeAsync();
      this.db = null;
      console.log('Database closed');
    }
  }

  // Helper: Round time to nearest 5 minutes
  private roundToNearestFiveMinutes(timeString: string): string {
    if (!timeString) return '';
    
    const [hours, minutes] = timeString.split(':');
    let minutesNum = parseInt(minutes);
    
    const remainder = minutesNum % 5;
    if (remainder >= 3) {
      minutesNum = Math.min(60, minutesNum + (5 - remainder));
      if (minutesNum === 60) {
        return `${String(parseInt(hours) + 1).padStart(2, '0')}:00`;
      }
    } else {
      minutesNum = minutesNum - remainder;
    }
    
    return `${hours.padStart(2, '0')}:${minutesNum.toString().padStart(2, '0')}`;
  }
}

export default new GoTransitService();