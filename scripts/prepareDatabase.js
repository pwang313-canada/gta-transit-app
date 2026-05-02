// scripts/prepareDatabase.js
const sqlite3 = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const AdmZip = require('adm-zip');

async function prepareDatabase() {
  console.log('📦 Preparing GO Transit database for mobile...');
  
  // Open GTFS zip
  const zip = new AdmZip('./GO_GTFS.zip');
  
  // Create optimized database
  const db = new sqlite3('go_transit_mobile.db');
  
  // Create tables with only necessary columns
  db.exec(`
    CREATE TABLE routes (
      route_id TEXT PRIMARY KEY,
      route_short_name TEXT,
      route_long_name TEXT,
      route_color TEXT
    );
    
    CREATE TABLE stops (
      stop_id TEXT PRIMARY KEY,
      stop_name TEXT,
      stop_lat REAL,
      stop_lon REAL
    );
    
    CREATE TABLE schedules (
      route_id TEXT,
      stop_id TEXT,
      departure_time TEXT,
      destination TEXT,
      FOREIGN KEY(route_id) REFERENCES routes(route_id),
      FOREIGN KEY(stop_id) REFERENCES stops(stop_id)
    );
    
    CREATE INDEX idx_schedules_route_stop ON schedules(route_id, stop_id);
    CREATE INDEX idx_schedules_time ON schedules(departure_time);
  `);
  
  // Insert data (simplified - full implementation would parse all GTFS files)
  
  // Vacuum and analyze
  db.exec('VACUUM');
  db.exec('ANALYZE');
  
  // Get size
  const stats = fs.statSync('go_transit_mobile.db');
  console.log(`📊 Database size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  
  // Optionally compress
  const gzip = require('zlib');
  const compressed = gzip.gzipSync(fs.readFileSync('go_transit_mobile.db'));
  fs.writeFileSync('go_transit_mobile.db.gz', compressed);
  console.log(`📦 Compressed size: ${(compressed.length / 1024 / 1024).toFixed(2)} MB`);
  
  db.close();
}

prepareDatabase();