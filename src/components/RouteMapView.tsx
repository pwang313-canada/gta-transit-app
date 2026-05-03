// src/components/RouteMapView.tsx (Fixed version)
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker } from 'react-native-maps';
import DatabaseService from '../services/DatabaseService';

interface RouteMapViewProps {
  routeId: string;
  routeShortName: string;
  variant?: string;
  selectedDate?: Date; // Add selected date prop
  visible: boolean;
  onClose: () => void;
  onSelectStop: (stop: any, type: 'departure' | 'arrival') => void;
}

const RouteMapView: React.FC<RouteMapViewProps> = ({
  routeId,
  routeShortName,
  variant,
  selectedDate,
  visible,
  onClose,
  onSelectStop,
}) => {
  const [stops, setStops] = useState<any[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (visible && routeId) {
      loadRouteGeometry();
    }
  }, [visible, routeId, variant, selectedDate]);

const loadRouteGeometry = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const dbService = DatabaseService;
      const date = selectedDate;
      
      console.log('Loading route geometry...');
      console.log('Route ID:', routeId);
      console.log('Date:', date);
      console.log('Variant:', variant);
      
      // FIX: Match the working pattern from your first log
      // The working call was: getStopsByRoute(routeId, variant, date)
      // Keep the same parameter order that was working before
      const stopsList = await dbService.getStopsByRoute(
        routeId,
        variant || 'none',  // Pass variant or 'none' like the working call
        date                 // Pass date as the third parameter
      );
      
      if (stopsList && stopsList.length > 0) {
        setStops(stopsList);
        console.log(`✅ Loaded ${stopsList.length} stops for route ${routeId}`);
      } else {
        console.log('❌ No stops found');
        setError('No stops found for this route on selected date');
      }
    } catch (err) {
      console.error('Error loading route geometry:', err);
      setError('Failed to load route stops');
    } finally {
      setLoading(false);
    }
  };

  // Get coordinates for each stop (you'll need to add these to your stops table or use geocoding)
  const getStopCoordinates = (stop: any) => {
    // If your stops have lat/lng in the database, use those
    if (stop.stop_lat && stop.stop_lon) {
      return {
        latitude: stop.stop_lat,
        longitude: stop.stop_lon,
      };
    }
    
    // Otherwise, you might need to add coordinates to your stops table
    // For now, returning a default (you should add stop_lat and stop_lon to your stops table)
    return {
      latitude: 43.645,
      longitude: -79.38,
    };
  };

  if (!visible) return null;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00A1E0" />
        <Text style={styles.loadingText}>Loading route stops...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={loadRouteGeometry}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeButtonText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (stops.length === 0) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>No stops found for this route</Text>
        <TouchableOpacity style={styles.closeButton} onPress={onClose}>
          <Text style={styles.closeButtonText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Calculate initial region based on first stop with coordinates
  const firstStopCoords = getStopCoordinates(stops[0]);
  const initialRegion = {
    latitude: firstStopCoords.latitude,
    longitude: firstStopCoords.longitude,
    latitudeDelta: 0.1,
    longitudeDelta: 0.1,
  };

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>
          Route {routeShortName} {variant ? `(${variant})` : ''}
        </Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
      </View>
      
      <MapView
        style={styles.map}
        initialRegion={initialRegion}
      >
        {stops.map((stop, index) => {
          const coords = getStopCoordinates(stop);
          return (
            <Marker
              key={stop.stop_id}
              coordinate={coords}
              title={stop.stop_name}
              description={`Stop ${index + 1}`}
              onPress={() => {
                // Show alert to choose departure or arrival
                Alert.alert(
                  stop.stop_name,
                  'Select stop type:',
                  [
                    {
                      text: 'Set as Departure',
                      onPress: () => onSelectStop(stop, 'departure'),
                    },
                    {
                      text: 'Set as Arrival',
                      onPress: () => onSelectStop(stop, 'arrival'),
                    },
                    {
                      text: 'Cancel',
                      style: 'cancel',
                    },
                  ]
                );
              }}
            />
          );
        })}
      </MapView>
      
      <View style={styles.legend}>
        <Text style={styles.legendText}>
          {stops.length} stops on this route • Tap a stop to select
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 400,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    marginVertical: 10,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#00A1E0',
  },
  title: {
    color: '#fff',
    fontSize: 16,
    fontWeight: 'bold',
  },
  closeButton: {
    padding: 8,
  },
  closeButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  map: {
    flex: 1,
  },
  legend: {
    padding: 8,
    backgroundColor: 'rgba(255,255,255,0.9)',
    alignItems: 'center',
  },
  legendText: {
    fontSize: 12,
    color: '#333',
  },
  loadingContainer: {
    height: 400,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    marginVertical: 10,
  },
  loadingText: {
    marginTop: 10,
    color: '#666',
  },
  errorContainer: {
    height: 400,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    padding: 20,
    borderRadius: 12,
    marginVertical: 10,
  },
  errorText: {
    color: 'red',
    marginBottom: 20,
    textAlign: 'center',
  },
  retryButton: {
    backgroundColor: '#00A1E0',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
    marginBottom: 10,
  },
  retryButtonText: {
    color: '#fff',
    fontWeight: 'bold',
  },
});

export default RouteMapView;