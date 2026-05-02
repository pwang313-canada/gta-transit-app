// services/exportService.js
import * as FileSystem from 'expo-file-system';
import { shareAsync } from 'expo-sharing';

export async function exportUserData(userId) {
  try {
    const response = await fetch('http://your-server.com/api/export-csv', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ userId }),
    });
    
    if (!response.ok) {
      throw new Error('Export failed');
    }
    
    const blob = await response.blob();
    const fileUri = FileSystem.documentDirectory + `export_${Date.now()}.csv`;
    await FileSystem.writeAsStringAsync(fileUri, blob);
    await shareAsync(fileUri);
    
    return true;
  } catch (error) {
    console.error('Export failed:', error);
    return false;
  }
}