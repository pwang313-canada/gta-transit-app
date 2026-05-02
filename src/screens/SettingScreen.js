// screens/SettingsScreen.js
import React from 'react';
import { View, Button, Alert } from 'react-native';
import * as FileSystem from 'expo-file-system';
import { shareAsync } from 'expo-sharing';

export default function SettingsScreen() {
  const exportToCSV = async () => {
    try {
      // 获取当前用户
      const currentUser = { id: 1 }; // 从你的状态管理获取
      
      const response = await fetch('http://your-server.com/api/export-csv', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          userId: currentUser.id
        })
      });
      
      const blob = await response.blob();
      const fileUri = FileSystem.documentDirectory + 'export.csv';
      await FileSystem.writeAsStringAsync(fileUri, blob);
      await shareAsync(fileUri);
      
      Alert.alert('成功', '数据已导出');
    } catch (error) {
      console.error('Export failed:', error);
      Alert.alert('错误', '导出失败');
    }
  };

  return (
    <View>
      <Button title="导出数据" onPress={exportToCSV} />
    </View>
  );
}