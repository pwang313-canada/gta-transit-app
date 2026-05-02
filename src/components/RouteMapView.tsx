// src/components/RouteMapView.tsx
import React, { useState, useEffect } from 'react';
import {
  View,
  Text,
  StyleSheet,
  Dimensions,
  ActivityIndicator,
  TouchableOpacity,
  Modal,
  Linking,
  Alert,
  Animated,
} from 'react-native';
import MapView, { Polyline, Marker, Region, Callout } from 'react-native-maps';
import * as Location from 'expo-location';
import * as SQLite from 'expo-sqlite';

interface RouteMapViewProps {
  routeId: string;
  routeShortName: string;
  variant?: string;
  visible: boolean;
  onClose?: () => void;
  onSelectStop?: (stop: any, type: 'departure' | 'arrival') => void;
}

interface Coordinate {
  latitude: number;
  longitude: number;
}

const RouteMapView: React.FC<RouteMapViewProps> = ({
  routeId,
  routeShortName,
  variant,
  visible,
  onClose,
  onSelectStop,
}) => {
  const [loading, setLoading] = useState(true);
  const [shapeCoordinates, setShapeCoordinates] = useState<Coordinate[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [region, setRegion] = useState<Region | null>(null);
  const [hasLocationPermission, setHasLocationPermission] = useState(false);
  const [selectedStop, setSelectedStop] = useState<any>(null);
  const [showStopModal, setShowStopModal] = useState(false);
  const [departureStop, setDepartureStop] = useState<any>(null);
  const [arrivalStop, setArrivalStop] = useState<any>(null);
  const [routeStops, setRouteStops] = useState<any[]>([]);
  const [selectedStopInfo, setSelectedStopInfo] = useState<{ name: string; number: number; stop: any } | null>(null);
  const [fadeAnim] = useState(new Animated.Value(0));

  useEffect(() => {
    if (visible && routeId) {
      loadRouteGeometry();
      requestLocationPermission();
    }
  }, [routeId, variant, visible]);

  const showTemporaryMessage = (stop: any) => {
    setSelectedStopInfo({ 
      name: stop.stop_name, 
      number: stop.stop_sequence,
      stop: stop 
    });
    Animated.sequence([
      Animated.timing(fadeAnim, {
        toValue: 1,
        duration: 300,
        useNativeDriver: true,
      }),
      Animated.delay(5000),
      Animated.timing(fadeAnim, {
        toValue: 0,
        duration: 300,
        useNativeDriver: true,
      }),
    ]).start(() => {
      setSelectedStopInfo(null);
    });
  };

  const handleMessagePress = () => {
    if (selectedStopInfo && selectedStopInfo.stop) {
      console.log('Message badge tapped for:', selectedStopInfo.name);
      setSelectedStop(selectedStopInfo.stop);
      setShowStopModal(true);
    }
  };

  const requestLocationPermission = async () => {
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      setHasLocationPermission(status === 'granted');
    } catch (error) {
      console.error('Error requesting location permission:', error);
    }
  };

// src/components/RouteMapView.tsx - Fix the loadRouteGeometry function

const loadRouteGeometry = async () => {
  setLoading(true);
  setError(null);
  
  try {
    const db = SQLite.openDatabaseSync('go_transit.db');
    
    // First, check what columns exist in trips table
    const tripsColumns = await db.getAllAsync<any>(`PRAGMA table_info(trips)`);
    console.log('Trips columns:', tripsColumns.map(c => c.name));
    
    const hasShapeId = tripsColumns.some(col => col.name === 'shape_id');
    const hasRouteVariant = tripsColumns.some(col => col.name === 'route_variant');
    
    console.log('Has shape_id column:', hasShapeId);
    console.log('Has route_variant column:', hasRouteVariant);
    
    // Build query based on available columns
    let selectColumns = 'trip_id';
    if (hasShapeId) {
      selectColumns += ', shape_id';
    }
    
    let tripQuery = `SELECT ${selectColumns} FROM trips WHERE route_id = ?`;
    let params = [routeId];
    
    // Only use route_variant if the column exists and we have a variant
    if (hasRouteVariant && variant && variant !== routeShortName) {
      tripQuery += ` AND route_variant = ?`;
      params.push(variant);
    }
    
    tripQuery += ` LIMIT 1`;
    
    console.log('Executing trip query:', tripQuery, 'with params:', params);
    
    const tripResult = await db.getAllAsync<any>(tripQuery, params);
    
    if (!tripResult || tripResult.length === 0) {
      console.log('No trips found for route:', routeId);
      // Try without variant filter
      if (hasRouteVariant && variant && variant !== routeShortName) {
        console.log('Trying without variant filter...');
        const fallbackQuery = `SELECT ${selectColumns} FROM trips WHERE route_id = ? LIMIT 1`;
        const fallbackResult = await db.getAllAsync<any>(fallbackQuery, [routeId]);
        if (fallbackResult && fallbackResult.length > 0) {
          tripResult[0] = fallbackResult[0];
        }
      }
      
      if (!tripResult || tripResult.length === 0) {
        setError('No trips found for this route');
        setLoading(false);
        return;
      }
    }
    
    const trip = tripResult[0];
    const tripId = trip.trip_id;
    const shapeId = trip.shape_id;
    
    console.log(`Found trip_id: ${tripId}, shape_id: ${shapeId}`);
    
    // Load shape points if shape_id exists
    if (hasShapeId && shapeId) {
      try {
        // Check if shapes table exists
        const tables = await db.getAllAsync<any>(`SELECT name FROM sqlite_master WHERE type='table'`);
        console.log('Available tables:', tables.map(t => t.name));
        
        const hasShapesTable = tables.some(t => t.name === 'shapes');
        console.log('Has shapes table:', hasShapesTable);
        
        if (hasShapesTable) {
          // First check if shape_id exists in shapes table
          const shapeCheck = await db.getAllAsync<any>(
            `SELECT COUNT(*) as count FROM shapes WHERE shape_id = ?`,
            [shapeId]
          );
          
          console.log(`Shape ${shapeId} exists in shapes table: ${shapeCheck[0].count > 0}`);
          
          if (shapeCheck[0].count > 0) {
            const shapePoints = await db.getAllAsync<any>(`
              SELECT shape_pt_lat, shape_pt_lon, shape_pt_sequence
              FROM shapes
              WHERE shape_id = ?
              ORDER BY shape_pt_sequence ASC
            `, [shapeId]);
            
            if (shapePoints && shapePoints.length > 0) {
              const coordinates = shapePoints.map(point => ({
                latitude: point.shape_pt_lat,
                longitude: point.shape_pt_lon,
              }));
              
              setShapeCoordinates(coordinates);
              console.log(`Loaded ${coordinates.length} shape points`);
              
              // Calculate region
              const lats = coordinates.map(c => c.latitude);
              const lngs = coordinates.map(c => c.longitude);
              
              const minLat = Math.min(...lats);
              const maxLat = Math.max(...lats);
              const minLng = Math.min(...lngs);
              const maxLng = Math.max(...lngs);
              
              const midLat = (minLat + maxLat) / 2;
              const midLng = (minLng + maxLng) / 2;
              
              const latDelta = (maxLat - minLat) * 1.2;
              const lngDelta = (maxLng - minLng) * 1.2;
              
              setRegion({
                latitude: midLat,
                longitude: midLng,
                latitudeDelta: Math.max(latDelta, 0.05),
                longitudeDelta: Math.max(lngDelta, 0.05),
              });
            } else {
              console.log(`No shape points found for shape_id ${shapeId}`);
            }
          } else {
            console.log(`Shape_id ${shapeId} not found in shapes table`);
          }
        } else {
          console.log('Shapes table does not exist');
        }
      } catch (shapeErr) {
        console.error('Error loading shape points:', shapeErr);
      }
    }
    
    // Load stops for this trip
    try {
      const stopTimes = await db.getAllAsync<any>(`
        SELECT 
          st.stop_id,
          st.stop_sequence,
          s.stop_name,
          s.stop_lat,
          s.stop_lon,
          s.stop_url,
          s.wheelchair_boarding
        FROM stop_times st
        INNER JOIN stops s ON st.stop_id = s.stop_id
        WHERE st.trip_id = ?
        ORDER BY st.stop_sequence ASC
      `, [tripId]);
      
      console.log(`Raw stopTimes count: ${stopTimes.length}`);
      
      // Filter stops with valid coordinates
      const validStops = stopTimes.filter(stop => {
        const lat = parseFloat(stop.stop_lat);
        const lon = parseFloat(stop.stop_lon);
        return !isNaN(lat) && !isNaN(lon) && lat !== 0 && lon !== 0;
      }).map(stop => ({
        ...stop,
        stop_lat: parseFloat(stop.stop_lat),
        stop_lon: parseFloat(stop.stop_lon),
      }));
      
      console.log(`Found ${stopTimes.length} stops, ${validStops.length} with valid coordinates`);
      if (validStops.length > 0) {
        console.log('Sample stop:', {
          name: validStops[0].stop_name,
          sequence: validStops[0].stop_sequence,
          lat: validStops[0].stop_lat,
          lon: validStops[0].stop_lon
        });
      }
      
      setRouteStops(validStops);
      
      // If no region was set from shape points, calculate from stops
      if (!region && validStops.length > 0) {
        const lats = validStops.map(s => s.stop_lat);
        const lngs = validStops.map(s => s.stop_lon);
        
        const minLat = Math.min(...lats);
        const maxLat = Math.max(...lats);
        const minLng = Math.min(...lngs);
        const maxLng = Math.max(...lngs);
        
        const midLat = (minLat + maxLat) / 2;
        const midLng = (minLng + maxLng) / 2;
        
        const latDelta = (maxLat - minLat) * 1.5;
        const lngDelta = (maxLng - minLng) * 1.5;
        
        setRegion({
          latitude: midLat,
          longitude: midLng,
          latitudeDelta: Math.max(latDelta, 0.05),
          longitudeDelta: Math.max(lngDelta, 0.05),
        });
      }
      
      if (shapeCoordinates.length === 0 && validStops.length === 0) {
        setError('No route data available');
      } else if (validStops.length > 0) {
        // Success - we have stops at least
        console.log('Route map loaded successfully with stops');
      }
      
    } catch (stopsErr) {
      console.error('Error loading stops:', stopsErr);
      setError('Failed to load stops for this route');
    }
    
  } catch (err) {
    console.error('Error loading route geometry:', err);
    setError('Failed to load route map: ' + (err as Error).message);
  } finally {
    setLoading(false);
  }
};

  const handleStopPress = (stop: any) => {
    console.log('Stop pressed:', stop.stop_name, '#', stop.stop_sequence);
    setSelectedStop(stop);
    setShowStopModal(true);
  };

  const handleMarkerTap = (stop: any) => {
    console.log('Marker tapped - showing callout for:', stop.stop_name, '#', stop.stop_sequence);
    showTemporaryMessage(stop);
  };

  const getWheelchairIcon = (wheelchair: number): string => {
    switch (wheelchair) {
      case 1:
        return '♿ Accessible';
      case 2:
        return '❌ Not Accessible';
      default:
        return '❓ Unknown';
    }
  };

  const getWheelchairColor = (wheelchair: number): string => {
    switch (wheelchair) {
      case 1:
        return '#4CAF50';
      case 2:
        return '#f44336';
      default:
        return '#FF9800';
    }
  };

  const handleOpenUrl = async (url: string) => {
    if (url && url.startsWith('http')) {
      const supported = await Linking.canOpenURL(url);
      if (supported) {
        await Linking.openURL(url);
      } else {
        Alert.alert('Error', 'Cannot open this URL');
      }
    } else {
      Alert.alert('No URL', 'No website available for this station');
    }
  };

  const handleSetAsDeparture = () => {
    if (onSelectStop) {
      onSelectStop(selectedStop, 'departure');
      setDepartureStop(selectedStop);
    }
    setShowStopModal(false);
    Alert.alert('Success', `${selectedStop?.stop_name} set as departure station`);
  };

  const handleSetAsArrival = () => {
    if (onSelectStop) {
      onSelectStop(selectedStop, 'arrival');
      setArrivalStop(selectedStop);
    }
    setShowStopModal(false);
    Alert.alert('Success', `${selectedStop?.stop_name} set as arrival station`);
  };

  const clearStations = () => {
    setDepartureStop(null);
    setArrivalStop(null);
    if (onSelectStop) {
      onSelectStop(null, 'departure');
      onSelectStop(null, 'arrival');
    }
  };

  if (!visible) return null;

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00A1E0" />
        <Text style={styles.loadingText}>Loading route map...</Text>
      </View>
    );
  }

  if (error || !region) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>{error || 'Unable to display route'}</Text>
        <Text style={styles.errorSubText}>Route: {routeId}, Variant: {variant || 'none'}</Text>
        {onClose && (
          <TouchableOpacity style={styles.closeButton} onPress={onClose}>
            <Text style={styles.closeButtonText}>Close</Text>
          </TouchableOpacity>
        )}
      </View>
    );
  }

  const displayTitle = variant && variant !== routeShortName 
    ? `${routeShortName}${variant.replace(routeShortName, '')}` 
    : routeShortName;

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Text style={styles.title}>Route {displayTitle}</Text>
        </View>
        <View style={styles.headerRight}>
          {selectedStopInfo && (
            <TouchableOpacity onPress={handleMessagePress}>
              <Animated.View style={[styles.selectedStopBadge, { opacity: fadeAnim }]}>
                <Text style={styles.selectedStopText}>
                  📍 {selectedStopInfo.name} (#{selectedStopInfo.number})
                </Text>
              </Animated.View>
            </TouchableOpacity>
          )}
          <TouchableOpacity onPress={onClose} style={styles.closeIconButton}>
            <Text style={styles.closeIcon}>✕</Text>
          </TouchableOpacity>
        </View>
      </View>

      {(departureStop || arrivalStop) && (
        <View style={styles.selectedStationsBar}>
          <TouchableOpacity onPress={clearStations} style={styles.clearButton}>
            <Text style={styles.clearButtonText}>Clear All</Text>
          </TouchableOpacity>
          <View style={styles.selectedStations}>
            {departureStop && (
              <View style={styles.selectedStation}>
                <Text style={styles.selectedStationLabel}>🚉 Departure:</Text>
                <Text style={styles.selectedStationName}>{departureStop.stop_name}</Text>
              </View>
            )}
            {arrivalStop && (
              <View style={styles.selectedStation}>
                <Text style={styles.selectedStationLabel}>📍 Arrival:</Text>
                <Text style={styles.selectedStationName}>{arrivalStop.stop_name}</Text>
              </View>
            )}
          </View>
        </View>
      )}
      
      <MapView
        style={styles.map}
        initialRegion={region}
        showsUserLocation={hasLocationPermission}
        showsMyLocationButton={hasLocationPermission}
        userLocationAnnotationTitle="Your Location"
      >
        {shapeCoordinates.length > 0 && (
          <Polyline
            coordinates={shapeCoordinates}
            strokeColor="#00A1E0"
            strokeWidth={4}
          />
        )}
        
        {routeStops.map((stop) => (
          <Marker
            key={stop.stop_id}
            coordinate={{
              latitude: stop.stop_lat,
              longitude: stop.stop_lon,
            }}
            pinColor="#FF0000"
            tracksViewChanges={false}
            onPress={() => handleMarkerTap(stop)}
          >
            <Callout 
              onPress={() => handleStopPress(stop)}
              tooltip={false}
            >
              <View style={styles.customCallout}>
                <Text style={styles.calloutTitle}>{stop.stop_name}</Text>
                <Text style={styles.calloutStopNumber}>Stop #{stop.stop_sequence}</Text>
                <View style={styles.calloutDivider} />
                <Text style={styles.calloutHint}>Tap for more options →</Text>
              </View>
            </Callout>
          </Marker>
        ))}
        
        {shapeCoordinates.length > 0 && (
          <>
            <Marker
              coordinate={shapeCoordinates[0]}
              title="Start of Route"
              pinColor="green"
            />
            <Marker
              coordinate={shapeCoordinates[shapeCoordinates.length - 1]}
              title="End of Route"
              pinColor="red"
            />
          </>
        )}
      </MapView>
      
      <View style={styles.legend}>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: '#00A1E0' }]} />
          <Text style={styles.legendText}>Route Path</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: '#FF0000' }]} />
          <Text style={styles.legendText}>Stations ({routeStops.length})</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: '#4CAF50' }]} />
          <Text style={styles.legendText}>Departure</Text>
        </View>
        <View style={styles.legendItem}>
          <View style={[styles.legendColor, { backgroundColor: '#2196F3' }]} />
          <Text style={styles.legendText}>Arrival</Text>
        </View>
      </View>

      {/* Station Details Modal */}
      <Modal
        visible={showStopModal}
        transparent={true}
        animationType="slide"
        onRequestClose={() => setShowStopModal(false)}
      >
        <View style={styles.modalOverlay}>
          <View style={styles.modalContainer}>
            <View style={styles.modalHeader}>
              <Text style={styles.modalTitle}>Station Details</Text>
              <TouchableOpacity 
                onPress={() => setShowStopModal(false)}
                style={styles.modalCloseButton}
              >
                <Text style={styles.modalCloseText}>✕</Text>
              </TouchableOpacity>
            </View>

            {selectedStop && (
              <>
                <Text style={styles.modalStopName}>{selectedStop.stop_name}</Text>
                
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Stop Number:</Text>
                  <Text style={styles.infoValue}>#{selectedStop.stop_sequence}</Text>
                </View>
                
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Stop ID:</Text>
                  <Text style={styles.infoValue}>{selectedStop.stop_id}</Text>
                </View>
                
                <View style={styles.infoRow}>
                  <Text style={styles.infoLabel}>Accessibility:</Text>
                  <Text style={[styles.infoValue, { color: getWheelchairColor(selectedStop.wheelchair_boarding) }]}>
                    {getWheelchairIcon(selectedStop.wheelchair_boarding)}
                  </Text>
                </View>

                {selectedStop.stop_url ? (
                  <TouchableOpacity 
                    style={styles.urlButton}
                    onPress={() => handleOpenUrl(selectedStop.stop_url)}
                  >
                    <Text style={styles.urlButtonText}>🌐 Visit Station Website</Text>
                  </TouchableOpacity>
                ) : null}

                <View style={styles.divider} />

                <Text style={styles.sectionTitle}>Actions:</Text>
                
                <TouchableOpacity 
                  style={[styles.actionButton, styles.departureButton]}
                  onPress={handleSetAsDeparture}
                >
                  <Text style={styles.actionButtonText}>🚉 Set as Departure Station</Text>
                </TouchableOpacity>

                <TouchableOpacity 
                  style={[styles.actionButton, styles.arrivalButton]}
                  onPress={handleSetAsArrival}
                >
                  <Text style={styles.actionButtonText}>📍 Set as Arrival Station</Text>
                </TouchableOpacity>

                {selectedStop.stop_id === departureStop?.stop_id && (
                  <Text style={styles.selectedHint}>✓ Currently selected as departure</Text>
                )}
                {selectedStop.stop_id === arrivalStop?.stop_id && (
                  <Text style={styles.selectedHint}>✓ Currently selected as arrival</Text>
                )}
              </>
            )}

            <TouchableOpacity 
              style={styles.closeModalButton}
              onPress={() => setShowStopModal(false)}
            >
              <Text style={styles.closeModalButtonText}>Close</Text>
            </TouchableOpacity>
          </View>
        </View>
      </Modal>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: '#fff',
    borderRadius: 12,
    overflow: 'hidden',
    marginVertical: 10,
    elevation: 3,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 15,
    backgroundColor: '#f8f8f8',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  headerLeft: {
    flexDirection: 'row',
    alignItems: 'center',
  },
  headerRight: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  title: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  selectedStopBadge: {
    backgroundColor: '#00A1E0',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    maxWidth: 220,
  },
  selectedStopText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  closeIconButton: {
    padding: 5,
  },
  closeIcon: {
    fontSize: 20,
    color: '#666',
    fontWeight: 'bold',
  },
  selectedStationsBar: {
    padding: 10,
    backgroundColor: '#f0f9ff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
  },
  selectedStations: {
    flex: 1,
  },
  selectedStation: {
    flexDirection: 'row',
    alignItems: 'center',
    marginVertical: 2,
  },
  selectedStationLabel: {
    fontSize: 12,
    fontWeight: '600',
    color: '#666',
    marginRight: 5,
  },
  selectedStationName: {
    fontSize: 12,
    color: '#333',
    flex: 1,
  },
  clearButton: {
    backgroundColor: '#f44336',
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 5,
    marginRight: 10,
  },
  clearButtonText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  map: {
    width: Dimensions.get('window').width - 30,
    height: 300,
  },
  loadingContainer: {
    height: 300,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
  },
  loadingText: {
    marginTop: 10,
    fontSize: 14,
    color: '#666',
  },
  errorContainer: {
    height: 300,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#f5f5f5',
    borderRadius: 12,
    padding: 20,
  },
  errorText: {
    fontSize: 14,
    color: '#f44336',
    textAlign: 'center',
    marginBottom: 15,
  },
  errorSubText: {
    fontSize: 12,
    color: '#999',
    textAlign: 'center',
    marginBottom: 15,
  },
  closeButton: {
    backgroundColor: '#00A1E0',
    paddingHorizontal: 20,
    paddingVertical: 10,
    borderRadius: 8,
  },
  closeButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  legend: {
    flexDirection: 'row',
    justifyContent: 'center',
    padding: 10,
    backgroundColor: '#fff',
    borderTopWidth: 1,
    borderTopColor: '#e0e0e0',
    gap: 15,
  },
  legendItem: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 5,
  },
  legendColor: {
    width: 16,
    height: 16,
    borderRadius: 3,
  },
  legendText: {
    fontSize: 12,
    color: '#666',
  },
  customCallout: {
    backgroundColor: 'white',
    borderRadius: 12,
    padding: 12,
    minWidth: 180,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  calloutTitle: {
    fontSize: 16,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  calloutStopNumber: {
    fontSize: 14,
    color: '#FF0000',
    fontWeight: '600',
    marginBottom: 8,
  },
  calloutDivider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 8,
  },
  calloutHint: {
    fontSize: 12,
    color: '#00A1E0',
    textAlign: 'center',
    fontWeight: '500',
  },
  modalOverlay: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: 'rgba(0, 0, 0, 0.5)',
  },
  modalContainer: {
    backgroundColor: '#fff',
    borderRadius: 20,
    padding: 20,
    width: '85%',
    maxHeight: '80%',
  },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 20,
  },
  modalTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#333',
  },
  modalCloseButton: {
    padding: 5,
  },
  modalCloseText: {
    fontSize: 20,
    color: '#666',
  },
  modalStopName: {
    fontSize: 18,
    fontWeight: '600',
    color: '#00A1E0',
    marginBottom: 15,
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 10,
  },
  infoLabel: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
    width: 120,
  },
  infoValue: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  urlButton: {
    backgroundColor: '#4CAF50',
    padding: 12,
    borderRadius: 8,
    marginBottom: 15,
  },
  urlButtonText: {
    color: '#fff',
    fontWeight: '600',
    textAlign: 'center',
  },
  divider: {
    height: 1,
    backgroundColor: '#e0e0e0',
    marginVertical: 15,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 10,
  },
  actionButton: {
    padding: 12,
    borderRadius: 8,
    marginBottom: 10,
  },
  departureButton: {
    backgroundColor: '#4CAF50',
  },
  arrivalButton: {
    backgroundColor: '#2196F3',
  },
  actionButtonText: {
    color: '#fff',
    fontWeight: '600',
    textAlign: 'center',
  },
  selectedHint: {
    fontSize: 12,
    color: '#4CAF50',
    textAlign: 'center',
    marginTop: 5,
  },
  closeModalButton: {
    backgroundColor: '#f0f0f0',
    padding: 12,
    borderRadius: 8,
    marginTop: 10,
  },
  closeModalButtonText: {
    color: '#666',
    fontWeight: '600',
    textAlign: 'center',
  },
});

export default RouteMapView;