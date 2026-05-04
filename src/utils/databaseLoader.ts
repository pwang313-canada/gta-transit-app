// src/utils/databaseLoader.ts
import { Asset } from 'expo-asset';
import { Directory, File, Paths } from 'expo-file-system';

export async function loadDatabase(): Promise<boolean> {
  const dbName = 'go_transit.db';

  try {
    // 📁 SQLite directory
    const sqliteDir = new Directory(Paths.document, 'SQLite');

    if (!sqliteDir.exists) {
      sqliteDir.create({ intermediates: true });
      console.log('📁 Created SQLite directory');
    }

    const dbFile = new File(sqliteDir, dbName);

    if (!dbFile.exists) {
      console.log('📦 Copying database from assets...');

      const asset = Asset.fromModule(
        require('../../assets/database/go_transit.db')
      );

      await asset.downloadAsync();

      if (!asset.localUri) {
        throw new Error('Asset has no localUri');
      }

      // 🔥 KEY FIX: use binary copy (NOT text)
      const source = new File(asset.localUri);

      source.copy(dbFile);   // ✅ correct binary copy

      console.log('✅ Database copied to:', dbFile.uri);
    } else {
      console.log('📁 Database already exists at:', dbFile.uri);
    }

    return true;
  } catch (error) {
    console.error('❌ Failed to load database:', error);
    return false;
  }
}