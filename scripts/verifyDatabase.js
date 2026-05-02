// scripts/verifyDatabase.js
const sqlite3 = require('better-sqlite3');
const path = require('path');

const dbPath = path.join(__dirname, '../assets/go_transit.db');

console.log('Checking database at:', dbPath);

try {
  const db = new sqlite3(dbPath);
  
  // 检查所有表
  const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
  console.log('Tables in database:', tables.map(t => t.name));
  
  // 检查 routes 表
  const routes = db.prepare('SELECT COUNT(*) as count FROM routes').get();
  console.log('Routes count:', routes.count);
  
  // 显示前几条路线
  const sampleRoutes = db.prepare('SELECT route_id, route_short_name, route_long_name FROM routes LIMIT 5').all();
  console.log('Sample routes:', sampleRoutes);
  
  db.close();
  console.log('\n✅ Database verification passed!');
} catch (error) {
  console.error('❌ Database verification failed:', error.message);
}