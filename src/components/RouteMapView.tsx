// src/components/RouteMapView.tsx
import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polyline, Region } from 'react-native-maps';
import DatabaseService from '../services/DatabaseService';

interface RouteMapViewProps {
  routeId: string;
  routeShortName: string;
  variant?: string;
  selectedDate?: Date;
  direction?: 'inbound' | 'outbound'; // Add direction prop
  visible: boolean;
  onClose: () => void;
  onSelectStop: (stop: any, type: 'departure' | 'arrival') => void;
}

const RouteMapView: React.FC<RouteMapViewProps> = ({
  routeId,
  routeShortName,
  variant,
  selectedDate,
  direction,
  visible,
  onClose,
  onSelectStop,
}) => {
  const [stops, setStops] = useState<any[]>([]);
  const [shapeCoordinates, setShapeCoordinates] = useState<Array<{latitude: number, longitude: number}>>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const mapRef = useRef<MapView>(null);

  useEffect(() => {
    if (visible && routeId) {
      loadRouteGeometry();
    }
  }, [visible, routeId, variant, selectedDate, direction]);

  const loadRouteGeometry = async () => {
    try {
      setLoading(true);
      setError(null);
      
      const dbService = DatabaseService;
      const date = selectedDate || new Date();
      
      console.log('Loading route geometry...');
      console.log('Route ID:', routeId);
      console.log('Date:', date.toDateString());
      console.log('Variant:', variant);
      console.log('Direction:', direction);
      
      // First, get stops for the route
      let stopsList = await dbService.getStopsByRoute(routeId, variant || undefined, date);
      
      // If no stops found with variant, try without variant
      if (!stopsList || stopsList.length === 0) {
        console.log('No stops found with variant, trying without variant...');
        stopsList = await dbService.getStopsByRoute(routeId, undefined, date);
      }
      
      // Get shape data for the route
      let shapeData = await dbService.getShapeForRoute(routeId, date, variant || undefined);
      
      // If no shape data with variant, try without variant
      if (!shapeData || shapeData.length === 0) {
        console.log('No shape data with variant, trying without variant...');
        shapeData = await dbService.getShapeForRoute(routeId, date, undefined);
      }
      
      // Set shape coordinates
      if (shapeData && shapeData.length > 0) {
        setShapeCoordinates(shapeData);
        console.log(`✅ Loaded ${shapeData.length} shape points`);
      } else {
        console.log('⚠️ No shape data found, will use straight lines between stops');
        setShapeCoordinates([]);
      }
      
      if (stopsList && stopsList.length > 0) {
        // Filter out stops without coordinates and log warnings
        const stopsWithCoords = stopsList.map((stop: any) => {
          // Check if stop has valid coordinates from database
          const lat = stop.stop_lat ? parseFloat(stop.stop_lat) : null;
          const lon = stop.stop_lon ? parseFloat(stop.stop_lon) : null;
          
          if (lat && lon && !isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0) {
            return {
              ...stop,
              latitude: lat,
              longitude: lon,
              hasCoords: true
            };
          } else {
            // Log missing coordinates
            console.warn(`Missing coordinates for stop: ${stop.stop_name} (${stop.stop_id})`);
            return null; // Filter out stops without coordinates
          }
        }).filter(stop => stop !== null);
        
        if (stopsWithCoords.length === 0) {
          setError('No stops with valid coordinates found for this route');
          setStops([]);
        } else {
          // For outbound direction, reverse the stops order so first stop is departure (Union)
          let orderedStops = stopsWithCoords;
          if (direction === 'outbound') {
            // Reverse the stops to show departure (Union) first
            orderedStops = [...stopsWithCoords].reverse();
            console.log('Outbound route: Reversed stops order for display');
            console.log(`First stop (departure): ${orderedStops[0].stop_name}`);
            console.log(`Last stop (arrival): ${orderedStops[orderedStops.length - 1].stop_name}`);
          } else {
            console.log(`Inbound route: Stops in original order`);
            console.log(`First stop (departure): ${orderedStops[0].stop_name}`);
            console.log(`Last stop (arrival): ${orderedStops[orderedStops.length - 1].stop_name}`);
          }
          
          setStops(orderedStops);
          console.log(`✅ Loaded ${orderedStops.length} stops with valid coordinates`);
        }
      } else {
        console.log('❌ No stops found');
        setError('No stops found for this route on selected date');
        setStops([]);
      }
    } catch (err) {
      console.error('Error loading route geometry:', err);
      setError(err instanceof Error ? err.message : 'Failed to load route stops');
    } finally {
      setLoading(false);
    }
  };

  // Fit map to show all stops and shape
  const fitMapToBounds = () => {
    if (!mapRef.current) return;
    
    const allPoints = [...shapeCoordinates];
    stops.forEach(stop => {
      if (stop.latitude && stop.longitude) {
        allPoints.push({ latitude: stop.latitude, longitude: stop.longitude });
      }
    });
    
    if (allPoints.length === 0) return;
    
    const lats = allPoints.map(p => p.latitude);
    const lngs = allPoints.map(p => p.longitude);
    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);
    
    const latitude = (minLat + maxLat) / 2;
    const longitude = (minLng + maxLng) / 2;
    const latitudeDelta = Math.max((maxLat - minLat) * 1.2, 0.02);
    const longitudeDelta = Math.max((maxLng - minLng) * 1.2, 0.02);
    
    mapRef.current.animateToRegion({
      latitude,
      longitude,
      latitudeDelta,
      longitudeDelta,
    }, 500);
  };

  useEffect(() => {
    if (!loading && (stops.length > 0 || shapeCoordinates.length > 0)) {
      // Small delay to ensure map is rendered
      setTimeout(() => {
        fitMapToBounds();
      }, 100);
    }
  }, [loading, stops, shapeCoordinates]);

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
        <TouchableOpacity style={styles.closeButtonModal} onPress={onClose}>
          <Text style={styles.closeButtonText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  if (stops.length === 0) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>No stops found for this route</Text>
        <TouchableOpacity style={styles.closeButtonModal} onPress={onClose}>
          <Text style={styles.closeButtonText}>Close</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Calculate initial region (fallback if map doesn't auto-fit)
  let initialRegion: Region;
  if (stops.length > 0) {
    const lats = stops.map(s => s.latitude);
    const lngs = stops.map(s => s.longitude);
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

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>
          Route {routeShortName} {variant && variant !== 'none' ? `(${variant})` : ''}
          {direction === 'inbound' ? ' → Towards Union' : direction === 'outbound' ? ' ← From Union' : ''}
        </Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
      </View>
      
      <MapView
        ref={mapRef}
        style={styles.map}
        initialRegion={initialRegion}
        showsUserLocation={false}
        showsMyLocationButton={false}
      >
        {/* Draw the actual route shape from GTFS data */}
        {shapeCoordinates.length > 1 && (
          <Polyline
            coordinates={shapeCoordinates}
            strokeColor="#00A1E0"
            strokeWidth={4}
            lineCap="round"
            lineJoin="round"
          />
        )}
        
        {/* Fallback: Draw straight lines between stops if no shape data */}
        {shapeCoordinates.length === 0 && stops.length > 1 && (
          <Polyline
            coordinates={stops.map(s => ({
              latitude: s.latitude,
              longitude: s.longitude,
            }))}
            strokeColor="#FF6600"
            strokeWidth={3}
            lineDashPattern={[10, 5]}
          />
        )}
        
        {/* Station markers - first and last are start/end based on direction */}
        {stops.map((stop, index) => {
          const isFirst = index === 0;
          const isLast = index === stops.length - 1;
          
          // For inbound: first stop is departure (green), last stop is Union (red)
          // For outbound: first stop is Union (green), last stop is destination (red)
          // This is already handled by reversing the stops array for outbound
            
          return (
            <Marker
              key={stop.stop_id}
              coordinate={{
                latitude: stop.latitude,
                longitude: stop.longitude,
              }}
              title={stop.stop_name}
              description={`${isFirst ? 'Start of journey' : isLast ? 'End of journey' : `Stop ${index + 1}`} • Tap to select`}
              pinColor={isFirst ? 'green' : isLast ? 'red' : '#00A1E0'}
              onPress={() => {
                Alert.alert(
                  stop.stop_name,
                  `Stop ${index + 1} of ${stops.length}\n\nSelect this as your:`,
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
          <Text style={styles.legendText}>
            {direction === 'outbound' ? 'Departure (Union)' : 'Departure Station'}
          </Text>
          <View style={[styles.legendDot, { backgroundColor: 'red' }]} />
          <Text style={styles.legendText}>
            {direction === 'outbound' ? 'Destination' : 'Arrival (Union)'}
          </Text>
          <View style={[styles.legendDot, { backgroundColor: '#00A1E0' }]} />
          <Text style={styles.legendText}>Intermediate</Text>
        </View>
        <Text style={styles.legendInfo}>
          {stops.length} stops • {shapeCoordinates.length > 0 ? 'Actual route' : 'Approximate route'}
          {direction === 'inbound' ? ' • Towards Union Station' : ' • From Union Station'}
        </Text>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    height: 450,
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    marginVertical: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
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
    flex: 1,
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
    flexWrap: 'wrap',
  },
  legendDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
    marginHorizontal: 4,
  },
  legendText: {
    fontSize: 11,
    color: '#333',
    marginRight: 12,
  },
  legendInfo: {
    fontSize: 11,
    color: '#666',
    textAlign: 'center',
  },
  loadingContainer: {
    height: 450,
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
    height: 450,
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
  closeButtonModal: {
    backgroundColor: '#666',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
});

export default RouteMapView;