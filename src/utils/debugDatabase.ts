// src/utils/debugDatabase.ts
import * as SQLite from 'expo-sqlite';

export async function debugDatabase() {
  const db = SQLite.openDatabaseSync('gta_transit.db');
  
  try {
    // 检查所有表
    const tables = await db.getAllAsync(`
      SELECT name FROM sqlite_master 
      WHERE type='table' 
      ORDER BY name
    `);
    console.log('Tables in database:', tables);
    
    // 检查 routes 表中的所有数据
    const allRoutes = await db.getAllAsync('SELECT * FROM routes');
    console.log('All routes in database:', allRoutes);
    console.log('Number of routes:', allRoutes.length);
    
    // 检查 stops 表
    const allStops = await db.getAllAsync('SELECT * FROM stops');
    console.log('Number of stops:', allStops.length);
    
    // 检查 trips 表
    const allTrips = await db.getAllAsync('SELECT * FROM trips');
    console.log('Number of trips:', allTrips.length);
    
    // 检查 stop_times 表
    const allStopTimes = await db.getAllAsync('SELECT * FROM stop_times');
    console.log('Number of stop_times:', allStopTimes.length);
    
    return {
      routes: allRoutes,
      stops: allStops,
      trips: allTrips,
      stopTimes: allStopTimes
    };
  } catch (error) {
    console.error('Debug error:', error);
    return null;
  }
}