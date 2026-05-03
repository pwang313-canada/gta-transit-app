// App.tsx
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, SafeAreaView, StyleSheet, Text, View } from 'react-native';
import DatabaseService from './src/services/DatabaseService';

// Import your actual screen components here
// import BusScheduleScreen from './src/screens/BusScheduleScreen';

export default function App() {
  const [isDbReady, setIsDbReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // In App.tsx, initialize database before rendering HomeScreen
  useEffect(() => {
    const init = async () => {
      await DatabaseService.initializeDatabase();
    };
    init();
  }, []);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      console.log('Starting app initialization...');
      
      // Initialize database
      const dbService = DatabaseService;
      const success = await dbService.initializeDatabase();
      
      if (success) {
        console.log('✅ Database initialized successfully');
        
        // Test connection
        const isConnected = await dbService.checkConnection();
        if (isConnected) {
          console.log('✅ Database connection verified');
          setIsDbReady(true);
        } else {
          throw new Error('Database connection test failed');
        }
      } else {
        throw new Error('Database initialization failed');
      }
    } catch (err) {
      const errorMessage = err instanceof Error ? err.message : 'Unknown error';
      console.error('❌ App initialization failed:', errorMessage);
      setError(errorMessage);
      Alert.alert(
        'Initialization Error',
        `Failed to initialize database: ${errorMessage}\n\nPlease restart the app.`,
        [{ text: 'OK', onPress: () => console.log('Error acknowledged') }]
      );
    }
  };

  if (error) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <Text style={styles.errorTitle}>Initialization Error</Text>
          <Text style={styles.errorMessage}>{error}</Text>
        </View>
      </SafeAreaView>
    );
  }

  if (!isDbReady) {
    return (
      <SafeAreaView style={styles.container}>
        <View style={styles.centered}>
          <ActivityIndicator size="large" color="#0066CC" />
          <Text style={styles.loadingText}>Initializing Database...</Text>
          <Text style={styles.loadingSubtext}>Please wait</Text>
        </View>
      </SafeAreaView>
    );
  }

  // Once database is ready, render your actual app
  return (
    <SafeAreaView style={styles.container}>
      {/* Replace with your actual screen component */}
      <View style={styles.content}>
        <Text style={styles.title}>GO Transit Schedules</Text>
        <Text style={styles.subtitle}>Database Ready ✓</Text>
        {/* Your actual screen component here */}
        {/* <BusScheduleScreen /> */}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    padding: 20,
  },
  content: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#0066CC',
    marginBottom: 10,
  },
  subtitle: {
    fontSize: 16,
    color: '#4CAF50',
    marginBottom: 20,
  },
  loadingText: {
    fontSize: 18,
    marginTop: 20,
    color: '#0066CC',
  },
  loadingSubtext: {
    fontSize: 14,
    marginTop: 10,
    color: '#666',
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#FF3B30',
    marginBottom: 10,
  },
  errorMessage: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
  },
});