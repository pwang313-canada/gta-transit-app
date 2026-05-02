// App.tsx
import React, { useEffect, useState } from 'react';
import { NavigationContainer } from '@react-navigation/native';
import { createNativeStackNavigator } from '@react-navigation/native-stack';
import {
  View,
  Text,
  StyleSheet,
  ActivityIndicator,
  TouchableOpacity,
  Alert,
  StatusBar
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import GoTransitService from './src/services/GoTransitService';
import HomeScreen from './src/screens/HomeScreen';
import { RootStackParamList } from './src/types/navigation';

// Create navigator
const Stack = createNativeStackNavigator<RootStackParamList>();

// Loading Screen Component
function LoadingScreen() {
  return (
    <View style={styles.centered}>
      <ActivityIndicator size="large" color="#00A1E0" />
      <Text style={styles.loadingText}>Initializing Database...</Text>
      <Text style={styles.loadingSubText}>First time may take a few seconds</Text>
    </View>
  );
}

// Error Screen Component
function ErrorScreen({ error, onRetry }: { error: string; onRetry: () => void }) {
  return (
    <View style={styles.centered}>
      <Text style={styles.errorIcon}>⚠️</Text>
      <Text style={styles.errorTitle}>Error Loading Database</Text>
      <Text style={styles.errorText}>{error}</Text>
      <TouchableOpacity style={styles.retryButton} onPress={onRetry}>
        <Text style={styles.retryButtonText}>Retry</Text>
      </TouchableOpacity>
    </View>
  );
}

// Main App Component
export default function App() {
  const [isReady, setIsReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    initializeApp();
  }, []);

  const initializeApp = async () => {
    try {
      console.log('Initializing app...');
      
      // Initialize database (only copies on first run)
      await GoTransitService.init();
      
      // Verify database is ready
      const isReady = await GoTransitService.isDatabaseReady();
      
      if (isReady) {
        console.log('App initialized successfully');
        
        // Get database info for debugging
        const dbInfo = await GoTransitService.getDatabaseInfo();
        console.log('Database info:', dbInfo);
        
        setIsReady(true);
      } else {
        setError('Database verification failed');
      }
    } catch (err) {
      console.error('Failed to initialize app:', err);
      setError(err instanceof Error ? err.message : 'Unknown error occurred');
    }
  };

  const handleRetry = () => {
    setError(null);
    setIsReady(false);
    initializeApp();
  };

  if (!isReady && !error) {
    return <LoadingScreen />;
  }

  if (error) {
    return <ErrorScreen error={error} onRetry={handleRetry} />;
  }

  return (
    <NavigationContainer>
      <Stack.Navigator
        screenOptions={{
          headerStyle: {
            backgroundColor: '#00A1E0',
          },
          headerTintColor: '#fff',
          headerTitleStyle: {
            fontWeight: 'bold',
          },
        }}
      >
        <Stack.Screen 
          name="Home" 
          component={HomeScreen} 
          options={{ 
            title: 'GO Transit',
            headerShown: false // Hide header since HomeScreen has its own header
          }}
        />
      </Stack.Navigator>
    </NavigationContainer>
  );
}

// Styles
const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  centered: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
  },
  loadingText: {
    marginTop: 20,
    fontSize: 16,
    color: '#00A1E0',
    fontWeight: '500',
  },
  loadingSubText: {
    marginTop: 8,
    fontSize: 12,
    color: '#666',
  },
  errorIcon: {
    fontSize: 64,
    marginBottom: 20,
  },
  errorTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 10,
  },
  errorText: {
    fontSize: 14,
    color: '#666',
    textAlign: 'center',
    marginHorizontal: 40,
    marginBottom: 20,
  },
  retryButton: {
    backgroundColor: '#00A1E0',
    paddingHorizontal: 30,
    paddingVertical: 12,
    borderRadius: 8,
    marginTop: 10,
  },
  retryButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});