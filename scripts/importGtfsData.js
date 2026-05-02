// scripts/importGtfsData.js
const fs = require('fs');
const path = require('path');
const https = require('https');
const sqlite3 = require('better-sqlite3');
const AdmZip = require('adm-zip');

const DB_PATH = path.join(__dirname, '../assets/gtfs.db');
const ASSETS_DIR = path.join(__dirname, '../assets');
const TEMP_ZIP_PATH = path.join(ASSETS_DIR, 'go_gtfs_temp.zip');

// GTFS 数据源 URL（使用已知有效的 GO Transit GTFS 数据源）
const GTFS_URLS = [
  'https://assets.metrolinx.com/raw/upload/v1683228856/Documents/Metrolinx/Open Data/GO-GTFS.zip',
  'https://www.gotransit.com/static_files/gotransit/assets/Files/GO_GTFS.zip'
];

// 下载文件
async function downloadFile(url, outputPath) {
  return new Promise((resolve, reject) => {
    console.log(`📥 Downloading from: ${url}`);
    
    const file = fs.createWriteStream(outputPath);
    const request = https.get(url, (response) => {
      if (response.statusCode === 302 || response.statusCode === 301) {
        const redirectUrl = response.headers.location;
        console.log(`↪️ Redirecting to: ${redirectUrl}`);
        return downloadFile(redirectUrl, outputPath).then(resolve).catch(reject);
      }
      
      if (response.statusCode !== 200) {
        reject(new Error(`Download failed: HTTP ${response.statusCode}`));
        return;
      }
      
      const totalSize = parseInt(response.headers['content-length'], 10);
      let downloadedSize = 0;
      
      response.on('data', (chunk) => {
        downloadedSize += chunk.length;
        if (totalSize) {
          const percent = ((downloadedSize / totalSize) * 100).toFixed(1);
          process.stdout.write(`\r    Progress: ${percent}%`);
        }
      });
      
      response.pipe(file);
      
      file.on('finish', () => {
        file.close();
        console.log('\n✅ Downloaded successfully');
        resolve(outputPath);
      });
      
      file.on('error', (err) => {
        fs.unlink(outputPath, () => {});
        reject(err);
      });
    });
    
    request.on('error', reject);
    request.setTimeout(60000, () => {
      request.destroy();
      reject(new Error('Download timeout'));
    });
  });
}

// 解析 CSV 行（处理引号内的逗号）
function parseCSVLine(line) {
  const result = [];
  let inQuotes = false;
  let currentValue = '';
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    
    if (char === '"') {
      inQuotes = !inQuotes;
    } else if (char === ',' && !inQuotes) {
      result.push(currentValue.trim());
      currentValue = '';
    } else {
      currentValue += char;
    }
  }
  
  result.push(currentValue.trim());
  return result;
}

// 获取字段值
function getValue(values, headers, fieldName) {
  const index = headers.indexOf(fieldName);
  if (index === -1 || index >= values.length) return null;
  const value = values[index];
  return value === '' ? null : value;
}

async function importGTFS() {
  console.log('🚆 GO Transit GTFS Data Importer (Reliable Batch Insert)\n');
  
  // 确保 assets 目录存在
  if (!fs.existsSync(ASSETS_DIR)) {
    fs.mkdirSync(ASSETS_DIR, { recursive: true });
  }
  
  let zipPath = null;
  let downloaded = false;
  
  // 尝试下载
  for (const url of GTFS_URLS) {
    try {
      zipPath = TEMP_ZIP_PATH;
      await downloadFile(url, zipPath);
      
      // 验证文件大小
      const stats = fs.statSync(zipPath);
      if (stats.size < 1000) {
        throw new Error('Downloaded file too small, likely an error page');
      }
      
      downloaded = true;
      console.log(`✅ Successfully downloaded from: ${url}\n`);
      break;
    } catch (error) {
      console.log(`⚠️ Failed to download from ${url}: ${error.message}`);
      if (fs.existsSync(zipPath)) {
        fs.unlinkSync(zipPath);
      }
    }
  }
  
  if (!downloaded) {
    console.error('❌ Failed to download GTFS data from all sources');
    console.log('\n💡 Manual download option:');
    console.log('1. Visit: https://www.gotransit.com/en/developer-resources');
    console.log('2. Download the GTFS zip file manually');
    console.log('3. Place it in the assets folder as "go_gtfs.zip"');
    console.log('4. Update the script to use local file');
    return;
  }
  
  // 创建数据库
  console.log('📊 Creating database...');
  if (fs.existsSync(DB_PATH)) fs.unlinkSync(DB_PATH);
  const db = new sqlite3(DB_PATH);
  
  // 优化数据库性能
  db.pragma('synchronous = OFF');
  db.pragma('journal_mode = MEMORY');
  db.pragma('temp_store = MEMORY');
  db.pragma('cache_size = -65536');
  
  // 创建表
  db.exec(`
    CREATE TABLE IF NOT EXISTS routes (
      route_id TEXT PRIMARY KEY,
      agency_id TEXT,
      route_short_name TEXT,
      route_long_name TEXT,
      route_type INTEGER,
      route_color TEXT,
      route_text_color TEXT
    );
    
    CREATE TABLE IF NOT EXISTS trips (
      trip_id TEXT PRIMARY KEY,
      route_id TEXT,
      service_id TEXT,
      trip_headsign TEXT,
      direction_id INTEGER,
      shape_id TEXT
    );
    
    CREATE TABLE IF NOT EXISTS stop_times (
      trip_id TEXT,
      arrival_time TEXT,
      departure_time TEXT,
      stop_id TEXT,
      stop_sequence INTEGER,
      pickup_type INTEGER,
      drop_off_type INTEGER,
      PRIMARY KEY (trip_id, stop_sequence)
    );
    
    CREATE TABLE IF NOT EXISTS stops (
      stop_id TEXT PRIMARY KEY,
      stop_name TEXT,
      stop_lat REAL,
      stop_lon REAL,
      zone_id TEXT,
      parent_station TEXT
    );
    
    CREATE TABLE IF NOT EXISTS calendar (
      service_id TEXT PRIMARY KEY,
      monday INTEGER,
      tuesday INTEGER,
      wednesday INTEGER,
      thursday INTEGER,
      friday INTEGER,
      saturday INTEGER,
      sunday INTEGER,
      start_date TEXT,
      end_date TEXT
    );
    
    CREATE INDEX IF NOT EXISTS idx_trips_route ON trips(route_id);
    CREATE INDEX IF NOT EXISTS idx_stop_times_trip ON stop_times(trip_id);
    CREATE INDEX IF NOT EXISTS idx_stop_times_stop ON stop_times(stop_id);
    CREATE INDEX IF NOT EXISTS idx_schedule_lookup ON stop_times(stop_id, departure_time);
  `);
  
  console.log('📄 Parsing CSV files...\n');
  
  const zip = new AdmZip(zipPath);
  const zipEntries = zip.getEntries();
  
  // 准备 prepared statements
  const insertRoute = db.prepare(`INSERT OR REPLACE INTO routes VALUES (?, ?, ?, ?, ?, ?, ?)`);
  const insertTrip = db.prepare(`INSERT OR REPLACE INTO trips VALUES (?, ?, ?, ?, ?, ?)`);
  const insertStop = db.prepare(`INSERT OR REPLACE INTO stops VALUES (?, ?, ?, ?, ?, ?)`);
  const insertCalendar = db.prepare(`INSERT OR REPLACE INTO calendar VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
  const insertStopTime = db.prepare(`INSERT OR REPLACE INTO stop_times VALUES (?, ?, ?, ?, ?, ?, ?)`);
  
  let stopTimesProcessed = 0;
  const BATCH_SIZE = 5000;
  let stopTimesBatch = [];
  
  for (const entry of zipEntries) {
    const fileName = entry.entryName;
    if (!fileName.endsWith('.txt')) continue;
    
    console.log(`  Processing ${fileName}...`);
    const content = entry.getData().toString('utf-8');
    const lines = content.split('\n');
    if (lines.length < 2) continue;
    
    const headers = lines[0].split(',').map(h => h.trim().replace(/^"|"$/g, ''));
    const recordCount = lines.length - 1;
    console.log(`    Found ${recordCount.toLocaleString()} records`);
    
    if (fileName === 'stop_times.txt') {
      // 使用事务批量处理 stop_times
      const insertBatch = db.transaction((batch) => {
        for (const row of batch) {
          insertStopTime.run(...row);
        }
      });
      
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        
        const values = parseCSVLine(lines[i]);
        stopTimesBatch.push([
          getValue(values, headers, 'trip_id'),
          getValue(values, headers, 'arrival_time'),
          getValue(values, headers, 'departure_time'),
          getValue(values, headers, 'stop_id'),
          parseInt(getValue(values, headers, 'stop_sequence')) || 0,
          parseInt(getValue(values, headers, 'pickup_type')) || 0,
          parseInt(getValue(values, headers, 'drop_off_type')) || 0
        ]);
        
        if (stopTimesBatch.length >= BATCH_SIZE) {
          insertBatch(stopTimesBatch);
          stopTimesProcessed += stopTimesBatch.length;
          console.log(`      Processed ${stopTimesProcessed.toLocaleString()} / ${recordCount.toLocaleString()} records...`);
          stopTimesBatch = [];
        }
      }
      
      // 插入剩余数据
      if (stopTimesBatch.length > 0) {
        insertBatch(stopTimesBatch);
        stopTimesProcessed += stopTimesBatch.length;
        console.log(`      ✅ Finished! Total: ${stopTimesProcessed.toLocaleString()} records.`);
        stopTimesBatch = [];
      }
      
    } else if (fileName === 'agency.txt') {
      // agency.txt 只是元数据，不需要插入主表
      console.log(`    ✅ Skipped (metadata)`);
      
    } else if (fileName === 'routes.txt') {
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = parseCSVLine(lines[i]);
        insertRoute.run(
          getValue(values, headers, 'route_id'),
          getValue(values, headers, 'agency_id'),
          getValue(values, headers, 'route_short_name'),
          getValue(values, headers, 'route_long_name'),
          parseInt(getValue(values, headers, 'route_type')) || 0,
          getValue(values, headers, 'route_color'),
          getValue(values, headers, 'route_text_color')
        );
      }
      console.log(`    ✅ Inserted ${recordCount} routes`);
      
    } else if (fileName === 'trips.txt') {
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = parseCSVLine(lines[i]);
        insertTrip.run(
          getValue(values, headers, 'trip_id'),
          getValue(values, headers, 'route_id'),
          getValue(values, headers, 'service_id'),
          getValue(values, headers, 'trip_headsign'),
          parseInt(getValue(values, headers, 'direction_id')) || 0,
          getValue(values, headers, 'shape_id')
        );
      }
      console.log(`    ✅ Inserted ${recordCount} trips`);
      
    } else if (fileName === 'stops.txt') {
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = parseCSVLine(lines[i]);
        insertStop.run(
          getValue(values, headers, 'stop_id'),
          getValue(values, headers, 'stop_name'),
          parseFloat(getValue(values, headers, 'stop_lat')) || 0,
          parseFloat(getValue(values, headers, 'stop_lon')) || 0,
          getValue(values, headers, 'zone_id'),
          getValue(values, headers, 'parent_station')
        );
      }
      console.log(`    ✅ Inserted ${recordCount} stops`);
      
    } else if (fileName === 'calendar.txt') {
      for (let i = 1; i < lines.length; i++) {
        if (!lines[i].trim()) continue;
        const values = parseCSVLine(lines[i]);
        insertCalendar.run(
          getValue(values, headers, 'service_id'),
          parseInt(getValue(values, headers, 'monday')) || 0,
          parseInt(getValue(values, headers, 'tuesday')) || 0,
          parseInt(getValue(values, headers, 'wednesday')) || 0,
          parseInt(getValue(values, headers, 'thursday')) || 0,
          parseInt(getValue(values, headers, 'friday')) || 0,
          parseInt(getValue(values, headers, 'saturday')) || 0,
          parseInt(getValue(values, headers, 'sunday')) || 0,
          getValue(values, headers, 'start_date'),
          getValue(values, headers, 'end_date')
        );
      }
      console.log(`    ✅ Inserted ${recordCount} calendar entries`);
    }
  }
  
  // 创建额外索引
  console.log('\n📊 Creating indexes...');
  db.exec(`CREATE INDEX IF NOT EXISTS idx_trip_route ON trips(route_id, trip_id);`);
  db.exec('ANALYZE');
  
  // 压缩数据库
  console.log('📦 Vacuuming database...');
  db.exec('VACUUM');
  
  // 清理临时文件
  if (fs.existsSync(zipPath)) {
    fs.unlinkSync(zipPath);
  }
  
  console.log('\n✅ GTFS data imported successfully!');
  
  // 显示统计信息
  const routeCount = db.prepare('SELECT COUNT(*) as count FROM routes').get();
  const stopCount = db.prepare('SELECT COUNT(*) as count FROM stops').get();
  const tripCount = db.prepare('SELECT COUNT(*) as count FROM trips').get();
  const stopTimeCount = db.prepare('SELECT COUNT(*) as count FROM stop_times').get();
  const calendarCount = db.prepare('SELECT COUNT(*) as count FROM calendar').get();
  
  console.log(`\n📊 Database Statistics:`);
  console.log(`   Routes: ${routeCount.count.toLocaleString()}`);
  console.log(`   Stops: ${stopCount.count.toLocaleString()}`);
  console.log(`   Trips: ${tripCount.count.toLocaleString()}`);
  console.log(`   Stop Times: ${stopTimeCount.count.toLocaleString()}`);
  console.log(`   Calendar: ${calendarCount.count.toLocaleString()}`);
  
  const stats = fs.statSync(DB_PATH);
  console.log(`\n📁 Database size: ${(stats.size / 1024 / 1024).toFixed(2)} MB`);
  console.log(`📍 Database location: ${DB_PATH}`);
  
  db.close();
}

// 运行导入
importGTFS().catch((error) => {
  console.error('\n❌ Fatal error:', error.message);
  console.error(error.stack);
  process.exit(1);
});