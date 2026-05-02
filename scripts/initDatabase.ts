import * as FileSystem from 'expo-file-system';
import * as SQLite from 'expo-sqlite';
import { Asset } from 'expo-asset';

const DB_NAME = 'go_transit.db';

export async function loadDatabase() {
  const sqliteDir = FileSystem.Paths.document + 'SQLite/';
  const dbPath = sqliteDir + DB_NAME;

  console.log('📂 DB PATH:', dbPath);

  // ensure folder exists
  await FileSystem.makeDirectoryAsync(sqliteDir, {
    intermediates: true,
  });

  // check if DB exists
  const fileInfo = await FileSystem.getInfoAsync(dbPath);

  if (!fileInfo.exists) {
    console.log('📦 COPYING NEW DB FROM ASSETS...');

    const asset = Asset.fromModule(
      require('../../assets/go_transit.db') // 👈 YOUR NEW DB
    );

    await asset.downloadAsync();

    console.log('📦 ASSET READY:', asset.localUri);

    await FileSystem.copyAsync({
      from: asset.localUri!,
      to: dbPath,
    });

    console.log('✅ NEW DB COPIED');
  } else {
    console.log('♻️ USING EXISTING DB');
  }

  const db = SQLite.openDatabaseSync(DB_NAME);

  const tables = await db.getAllAsync(
    "SELECT name FROM sqlite_master WHERE type='table'"
  );

  console.log('🧠 TABLES:', tables);

  const count = await db.getAllAsync(
    "SELECT COUNT(*) as count FROM routes"
  );

  console.log('📊 ROUTES COUNT:', count);

  return db;
}