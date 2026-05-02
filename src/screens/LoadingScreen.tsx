// src/screens/LoadingScreen.tsx
import React, { useEffect, useState } from 'react';
import { View, Text, ActivityIndicator, ProgressBarAndroid, Platform } from 'react-native';
import DatabaseService from '../services/DatabaseService';

export default function LoadingScreen({ onComplete }: { onComplete: () => void }) {
  const [progress, setProgress] = useState(0);
  const [status, setStatus] = useState('Checking database...');

  useEffect(() => {
    downloadDatabase();
  }, []);

  const downloadDatabase = async () => {
    try {
      setStatus('Downloading GO Transit schedules...');
      await DatabaseService.init();
      
      setStatus('Database ready!');
      setTimeout(onComplete, 1000);
    } catch (error) {
      setStatus('Download failed. Please check your connection.');
    }
  };

  return (
    <View style={{ flex: 1, justifyContent: 'center', padding: 20 }}>
      <Text style={{ fontSize: 24, textAlign: 'center', marginBottom: 20 }}>
        🚆 GTA Transit
      </Text>
      <Text style={{ textAlign: 'center', marginBottom: 10 }}>{status}</Text>
      
      {Platform.OS === 'android' && (
        <ProgressBarAndroid styleAttr="Horizontal" indeterminate={false} progress={progress} />
      )}
      <ActivityIndicator size="large" color="#00A1E0" style={{ marginTop: 20 }} />
    </View>
  );
}