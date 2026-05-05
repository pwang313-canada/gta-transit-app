// src/components/RouteMapView.tsx
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import DatabaseService from '../services/DatabaseService';

interface RouteMapViewProps {
  routeId: string;
  routeShortName: string;
  variant?: string;
  selectedDate?: Date;
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
  const [shapeCoordinates, setShapeCoordinates] = useState<Array<{latitude: number, longitude: number}>>([]);
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
      const date = selectedDate || new Date();
      
      const effectiveVariant = variant && variant !== routeShortName ? variant : undefined;
      
      console.log('Loading route geometry...');
      console.log('Route ID:', routeId);
      console.log('Date:', date);
      console.log('Variant prop:', variant);
      console.log('Effective Variant:', effectiveVariant);
      
      // Load stops and shape data in parallel
      const [stopsList, shapeData] = await Promise.all([
        dbService.getStopsByRoute(routeId, effectiveVariant, date),
        dbService.getShapeForRoute(routeId, date, effectiveVariant)
      ]);
      
      // Log what came back from the shape query
      console.log('Shape data returned:', shapeData ? `${shapeData.length} points` : 'null/undefined');
      if (shapeData && shapeData.length > 0) {
        console.log('First shape point:', shapeData[0]);
        console.log('Last shape point:', shapeData[shapeData.length - 1]);
        setShapeCoordinates(shapeData);
      } else {
        console.log('⚠️ No shape data found, will use straight lines between stops');
        setShapeCoordinates([]);
      }
      
      if (stopsList && stopsList.length > 0) {
        const stopsWithCoords = stopsList.map((stop: any) => {
          if (stop.stop_lat && stop.stop_lon && stop.stop_lat !== 0 && stop.stop_lon !== 0) {
            return {
              ...stop,
              latitude: stop.stop_lat,
              longitude: stop.stop_lon,
              hasCoords: true
            };
          } else {
            console.warn(`Missing coordinates for: ${stop.stop_name}, using approximate location`);
            return {
              ...stop,
              latitude: 43.645 + (Math.random() - 0.5) * 0.1,
              longitude: -79.38 + (Math.random() - 0.5) * 0.1,
              hasCoords: false
            };
          }
        });
        
        setStops(stopsWithCoords);
        console.log(`✅ Loaded ${stopsWithCoords.length} stops for route ${routeId}`);
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

  if (!visible) return null;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00A1E0" />
        <Text style={styles.loadingText}>Loading route...</Text>
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

  const validStops = stops.filter(s => s.latitude && s.longitude);
  
  let initialRegion;
  if (validStops.length > 0) {
    const lats = validStops.map(s => s.latitude);
    const lngs = validStops.map(s => s.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    
    initialRegion = {
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) * 1.5, 0.05),
      longitudeDelta: Math.max((maxLng - minLng) * 1.5, 0.05),
    };
  } else {
    initialRegion = {
      latitude: 43.645,
      longitude: -79.38,
      latitudeDelta: 0.5,
      longitudeDelta: 0.5,
    };
  }

  const displayVariant = variant && variant !== routeShortName ? variant : undefined;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>
          Route {routeShortName} {displayVariant ? `(${displayVariant})` : ''}
        </Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
      </View>
      
      <MapView
        style={styles.map}
        initialRegion={initialRegion}
      >
        {shapeCoordinates.length > 1 && (
          <Polyline
            coordinates={shapeCoordinates}
            strokeColor="#00A1E0"
            strokeWidth={3}
            lineCap="round"
            lineJoin="round"
          />
        )}
        
        {shapeCoordinates.length === 0 && validStops.length > 1 && (
          <Polyline
            coordinates={validStops.map(s => ({
              latitude: s.latitude,
              longitude: s.longitude,
            }))}
            strokeColor="#FF6600"
            strokeWidth={2}
            lineDashPattern={[10, 5]}
          />
        )}
        
        {stops.map((stop, index) => {
          if (!stop.latitude || !stop.longitude) return null;
          
          const isFirst = index === 0;
          const isLast = index === stops.length - 1;
          
          return (
            <Marker
              key={stop.stop_id}
              coordinate={{
                latitude: stop.latitude,
                longitude: stop.longitude,
              }}
              title={stop.stop_name}
              description={`${isFirst ? 'Start' : isLast ? 'End' : `Stop ${index + 1}`} • Tap to select`}
              pinColor={isFirst ? 'green' : isLast ? 'red' : '#00A1E0'}
              onPress={() => {
                Alert.alert(
                  stop.stop_name,
                  `Stop ${index + 1} of ${stops.length}${!stop.hasCoords ? '\n⚠️ Approximate location' : ''}\n\nSelect this as your:`,
                  [
                    {
                      text: 'Departure Station',
                      onPress: () => onSelectStop(stop, 'departure'),
                    },
                    {
                      text: 'Arrival Station',
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
        <View style={styles.legendRow}>
          <View style={[styles.legendDot, { backgroundColor: 'green' }]} />
          <Text style={styles.legendText}>Start</Text>
          <View style={[styles.legendDot, { backgroundColor: 'red' }]} />
          <Text style={styles.legendText}>End</Text>
          <View style={[styles.legendDot, { backgroundColor: '#00A1E0' }]} />
          <Text style={styles.legendText}>Station</Text>
        </View>
        <Text style={styles.legendInfo}>
          {stops.length} stops • {shapeCoordinates.length > 0 ? 'Actual route' : 'Approximate route'}
          {stops.some(s => !s.hasCoords) ? ' • Some locations approximate' : ''}
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
    padding: 10,
    backgroundColor: 'rgba(255,255,255,0.95)',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
  },
  legendRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 4,
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginHorizontal: 4,
  },
  legendText: {
    fontSize: 12,
    color: '#333',
    marginRight: 12,
  },
  legendInfo: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
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