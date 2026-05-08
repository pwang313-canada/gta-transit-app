import AsyncStorage from '@react-native-async-storage/async-storage';
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';

// Update this version number when you need to upgrade the database
const DB_VERSION = 1;

export async function loadDatabase(): Promise<boolean> {
  const dbName = 'go_transit.db';

  try {
    const sqliteDir = new Directory(Paths.document, 'SQLite');

    if (!sqliteDir.exists) {
      sqliteDir.create({ intermediates: true });
      console.log('📁 Created SQLite directory');
    }

    const dbFile = new File(sqliteDir, dbName);

    const storedVersion = await AsyncStorage.getItem('db_version');
    const currentVersion = storedVersion ? parseInt(storedVersion, 10) : 0;

    const needsCopy = !dbFile.exists || currentVersion < DB_VERSION;

    if (!needsCopy) {
      console.log('✅ Database up to date');
      return true;
    }

    console.log(`📦 Copying DB v${DB_VERSION}`);

    const asset = Asset.fromModule(
      require('../../assets/database/go_transit.db')
    );

    await asset.downloadAsync();

    if (!asset.localUri) {
      throw new Error('Asset has no localUri');
    }

    const source = new File(asset.localUri);

    // delete old DB
    if (dbFile.exists) {
      dbFile.delete();
      console.log('🗑️ Old DB deleted');
    }

    // copy new DB
    source.copy(dbFile);

    if (!dbFile.exists) {
      throw new Error('DB copy failed');
    }

    await AsyncStorage.setItem('db_version', DB_VERSION.toString());

    console.log('✅ DB ready');

    return true;
  } catch (error) {
    console.error('❌ Failed to load database:', error);
    return false;
  }
}