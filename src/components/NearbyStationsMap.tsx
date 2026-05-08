// src/components/NearbyStationsMap.tsx
import * as Location from 'expo-location';
import React, { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Dimensions,
  Modal,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import DatabaseService from '../services/DatabaseService';

interface NearbyStationsMapProps {
  visible: boolean;
  onClose: () => void;
  onSelectRoute: (route: {
    routeId: string;
    routeShortName: string;
    variant?: string;
    direction?: 'inbound' | 'outbound';
    stopId?: string;      // new
    stopName?: string;    // new
  }) => void;
}

interface Station {
  stop_id: string;
  stop_name: string;
  stop_lat: number;
  stop_lon: number;
  routes: Set<string>;
  routeDetails: Map<string, { routeId: string; variant?: string }>;
  distance?: number;
}

const { height: SCREEN_HEIGHT } = Dimensions.get('window');

const DEFAULT_REGION = {
  latitude: 43.6532,
  longitude: -79.3832,
  latitudeDelta: 0.5,
  longitudeDelta: 0.5,
};

// Pre-computed: 1 degree lat ≈ 111km, 1 degree lon ≈ 78km at Toronto's latitude
const KM_PER_DEGREE_LAT = 111.0;
const KM_PER_DEGREE_LON_AT_43N = 78.7;

// Fast approximate distance (no trig needed) - good enough for filtering
const fastDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const dLat = (lat2 - lat1) * KM_PER_DEGREE_LAT;
  const dLon = (lon2 - lon1) * KM_PER_DEGREE_LON_AT_43N;
  return Math.sqrt(dLat * dLat + dLon * dLon);
};

// Accurate Haversine for display
const accurateDistanceKm = (lat1: number, lon1: number, lat2: number, lon2: number): number => {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 +
    Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
    Math.sin(dLon / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
};

// 🎯 CONFIG: Max distance and max stations
const MAX_DISTANCE_KM = 3;
const MAX_STATIONS = 5;

const NearbyStationsMap: React.FC<NearbyStationsMapProps> = ({
  visible,
  onClose,
  onSelectRoute,
}) => {
  const [loading, setLoading] = useState(true);
  const [stations, setStations] = useState<Station[]>([]);
  const [userLocation, setUserLocation] = useState<{ latitude: number; longitude: number } | null>(null);
  const [selectedStation, setSelectedStation] = useState<Station | null>(null);
  const [routesForStation, setRoutesForStation] = useState<any[]>([]);
  const [loadingRoutes, setLoadingRoutes] = useState(false);
  const [selectedRouteOnMap, setSelectedRouteOnMap] = useState<any>(null);
  const mapRef = useRef<MapView>(null);
  const dbService = DatabaseService;

  // Use a ref to prevent duplicate loads
  const isLoadingRef = useRef(false);

  useEffect(() => {
    if (visible && !isLoadingRef.current) {
      loadNearbyStations();
    } else if (!visible) {
      setSelectedStation(null);
      setSelectedRouteOnMap(null);
      setRoutesForStation([]);
    }
  }, [visible]);

  const fitMapToStations = useCallback(() => {
    if (!mapRef.current || stations.length === 0) return;

    const lats = stations.map(s => s.stop_lat);
    const lngs = stations.map(s => s.stop_lon);

    if (userLocation) {
      lats.push(userLocation.latitude);
      lngs.push(userLocation.longitude);
    }

    const minLat = Math.min(...lats);
    const maxLat = Math.max(...lats);
    const minLng = Math.min(...lngs);
    const maxLng = Math.max(...lngs);

    // Add padding so markers aren't at the edge
    const latPadding = Math.max((maxLat - minLat) * 0.3, 0.01);
    const lngPadding = Math.max((maxLng - minLng) * 0.3, 0.01);

    mapRef.current.animateToRegion({
      latitude: (minLat + maxLat) / 2,
      longitude: (minLng + maxLng) / 2,
      latitudeDelta: Math.max((maxLat - minLat) + latPadding, 0.03),
      longitudeDelta: Math.max((maxLng - minLng) + lngPadding, 0.03),
    }, 500);
  }, [stations, userLocation]);

  useEffect(() => {
    if (!loading && stations.length > 0) {
      const timer = setTimeout(fitMapToStations, 300);
      return () => clearTimeout(timer);
    }
  }, [loading, stations, fitMapToStations]);

  const loadNearbyStations = async () => {
    if (isLoadingRef.current) return;
    isLoadingRef.current = true;
    setLoading(true);

    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      let centerLat = DEFAULT_REGION.latitude;
      let centerLon = DEFAULT_REGION.longitude;

      if (status === 'granted') {
        const location = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.Balanced,
        });
        centerLat = location.coords.latitude;
        centerLon = location.coords.longitude;
        setUserLocation({ latitude: centerLat, longitude: centerLon });
      } else {
        setUserLocation(DEFAULT_REGION);
        Alert.alert('Location Access Denied', 'Showing default GTA area instead');
      }

      await loadStationsInRegion(centerLat, centerLon);

    } catch (error) {
      console.error('Error loading nearby stations:', error);
      setUserLocation(DEFAULT_REGION);
      await loadStationsInRegion(DEFAULT_REGION.latitude, DEFAULT_REGION.longitude);
    } finally {
      setLoading(false);
      isLoadingRef.current = false;
    }
  };

  const loadStationsInRegion = async (lat: number, lon: number) => {
    try {
      // Use fast approximate distance for SQL bounds (slightly larger to be safe)
      const deltaLat = MAX_DISTANCE_KM / KM_PER_DEGREE_LAT;
      const deltaLon = MAX_DISTANCE_KM / KM_PER_DEGREE_LON_AT_43N;

      const minLat = lat - deltaLat;
      const maxLat = lat + deltaLat;
      const minLon = lon - deltaLon;
      const maxLon = lon + deltaLon;

      // 🎯 SINGLE QUERY: Gets stops + all their routes in one shot
      const query = `
        SELECT 
          s.stop_id,
          s.stop_name,
          CAST(s.stop_lat AS REAL) as stop_lat,
          CAST(s.stop_lon AS REAL) as stop_lon,
          GROUP_CONCAT(DISTINCT sr.route_id || '|' || sr.route_short_name || '|' || COALESCE(sr.route_variant, '')) as route_data
        FROM stops s
        LEFT JOIN stop_routes sr ON s.stop_id = sr.stop_id
        WHERE s.stop_lat BETWEEN ? AND ?
          AND s.stop_lon BETWEEN ? AND ?
          AND s.stop_lat != 0
          AND s.stop_lon != 0
        GROUP BY s.stop_id, s.stop_name, s.stop_lat, s.stop_lon
        LIMIT 100
      `;

      const results = await dbService.executeCustomQuery<any>(query, [
        minLat, maxLat, minLon, maxLon
      ]);

      // Process all results in one pass (no async/await in loop!)
      const nearbyStations: Station[] = [];
      
      for (const row of results) {
        // Fast filter: skip if >3km away
        const fastDist = fastDistanceKm(lat, lon, row.stop_lat, row.stop_lon);
        if (fastDist > MAX_DISTANCE_KM) continue;

        // Parse aggregated route data
        const routes = new Set<string>();
        const routeDetails = new Map<string, { routeId: string; variant?: string }>();

        if (row.route_data) {
          const routeEntries = row.route_data.split(',');
          for (const entry of routeEntries) {
            const [routeId, routeShortName, variant] = entry.split('|');
            if (routeShortName) {
              routes.add(routeShortName);
              routeDetails.set(routeShortName, {
                routeId,
                variant: variant || undefined,
              });
            }
          }
        }

        nearbyStations.push({
          stop_id: row.stop_id,
          stop_name: row.stop_name,
          stop_lat: row.stop_lat,
          stop_lon: row.stop_lon,
          routes,
          routeDetails,
          distance: accurateDistanceKm(lat, lon, row.stop_lat, row.stop_lon),
        });
      }

      // Sort by distance and take only top 5
      nearbyStations.sort((a, b) => (a.distance || 999) - (b.distance || 999));
      const topStations = nearbyStations.slice(0, MAX_STATIONS);

      setStations(topStations);
      console.log(`Loaded ${topStations.length} stations within ${MAX_DISTANCE_KM}km`);

    } catch (error) {
      console.error('Error loading stations in region:', error);
    }
  };

  const handleStationPress = (station: Station) => {
    setSelectedStation(station);
    setLoadingRoutes(true);

    const routes = Array.from(station.routes).map(routeShortName => {
      const details = station.routeDetails.get(routeShortName);
      return {
        route_id: details?.routeId || '',
        route_short_name: routeShortName,
        route_long_name: '',
        route_variant: details?.variant,
      };
    });

    setRoutesForStation(routes);
    setLoadingRoutes(false);
  };

  const enrichRoutesWithNames = async (station: Station) => {
    if (station.routes.size === 0) return;
    
    const routeShortNames = Array.from(station.routes).map(name => `'${name}'`).join(',');
    
    const query = `
      SELECT DISTINCT r.route_short_name, r.route_long_name
      FROM routes r
      WHERE r.route_short_name IN (${routeShortNames})
    `;
    
    try {
      const names = await dbService.executeCustomQuery<any>(query);
      const nameMap = new Map(names.map(n => [n.route_short_name, n.route_long_name]));
      
      setRoutesForStation(prev => prev.map(r => ({
        ...r,
        route_long_name: nameMap.get(r.route_short_name) || r.route_long_name,
      })));
    } catch (e) {
      console.error('Error fetching route names:', e);
    }
  };

  useEffect(() => {
    if (selectedStation) {
      enrichRoutesWithNames(selectedStation);
    }
  }, [selectedStation]);

  const handleRouteSelect = async (route: any, direction: 'inbound' | 'outbound') => {
    try {
      const shape = await dbService.getShapeForRoute(
        route.route_id,
        new Date(),
        route.route_variant
      );

      setSelectedRouteOnMap({
        ...route,
        direction,
        shape,
        selectedStation: selectedStation,
      });

      if (shape && shape.length > 0 && mapRef.current) {
        const lats = shape.map(p => p.latitude);
        const lngs = shape.map(p => p.longitude);

        mapRef.current.animateToRegion({
          latitude: (Math.min(...lats) + Math.max(...lats)) / 2,
          longitude: (Math.min(...lngs) + Math.max(...lngs)) / 2,
          latitudeDelta: Math.max((Math.max(...lats) - Math.min(...lats)) * 1.2, 0.05),
          longitudeDelta: Math.max((Math.max(...lngs) - Math.min(...lngs)) * 1.2, 0.05),
        }, 500);
      }
    } catch (error) {
      console.error('Error loading route shape:', error);
    }
  };

  const confirmRouteSelection = () => {
    if (selectedRouteOnMap) {
      onSelectRoute({
        routeId: selectedRouteOnMap.route_id,
        routeShortName: selectedRouteOnMap.route_short_name,
        variant: selectedRouteOnMap.route_variant,
        direction: selectedRouteOnMap.direction,
        stopId: selectedStation?.stop_id,      // pass the station
        stopName: selectedStation?.stop_name,  // pass the station name
      });
      onClose();
    }
  };

  if (!visible) return null;

  return (
    <Modal
      visible={visible}
      animationType="slide"
      presentationStyle="fullScreen"
    >
      <View style={styles.container}>
        <View style={styles.header}>
          <Text style={styles.headerTitle}>
            Nearby Stations ({MAX_DISTANCE_KM}km)
          </Text>
          <TouchableOpacity onPress={onClose} style={styles.closeButton}>
            <Text style={styles.closeButtonText}>✕</Text>
          </TouchableOpacity>
        </View>

        {loading ? (
          <View style={styles.loadingContainer}>
            <ActivityIndicator size="large" color="#00A1E0" />
            <Text style={styles.loadingText}>Finding nearby stations...</Text>
          </View>
        ) : (
          <>
            <MapView
              ref={mapRef}
              style={styles.map}
              showsUserLocation={true}
              showsMyLocationButton={true}
              initialRegion={userLocation ? {
                latitude: userLocation.latitude,
                longitude: userLocation.longitude,
                latitudeDelta: 0.06,
                longitudeDelta: 0.06,
              } : DEFAULT_REGION}
            >
              {stations.map((station) => (
                <Marker
                  key={station.stop_id}
                  coordinate={{
                    latitude: station.stop_lat,
                    longitude: station.stop_lon,
                  }}
                  title={station.stop_name}
                  description={`${station.routes.size} route(s) • ${station.distance?.toFixed(1)}km`}
                  pinColor={station.stop_name.toLowerCase().includes('union') ? '#FF6B6B' : '#00A1E0'}
                  onPress={() => handleStationPress(station)}
                />
              ))}

              {selectedRouteOnMap?.shape?.length > 0 && (
                <Polyline
                  coordinates={selectedRouteOnMap.shape}
                  strokeColor="#FF6B6B"
                  strokeWidth={4}
                  lineCap="round"
                  lineJoin="round"
                />
              )}
            </MapView>

            {/* Station counter badge */}
            {!selectedStation && !selectedRouteOnMap && stations.length > 0 && (
              <View style={styles.stationCounter}>
                <Text style={styles.stationCounterText}>
                  {stations.length} station{stations.length !== 1 ? 's' : ''} within {MAX_DISTANCE_KM}km
                </Text>
              </View>
            )}

            {selectedStation && !selectedRouteOnMap && (
              <View style={styles.infoPanel}>
                <View style={styles.infoHeader}>
                  <Text style={styles.infoTitle}>{selectedStation.stop_name}</Text>
                  <Text style={styles.infoDistance}>
                    {selectedStation.distance?.toFixed(1)}km away
                  </Text>
                  <TouchableOpacity
                    onPress={() => setSelectedStation(null)}
                    style={styles.infoCloseButton}
                  >
                    <Text style={styles.infoCloseText}>✕</Text>
                  </TouchableOpacity>
                </View>

                {loadingRoutes ? (
                  <ActivityIndicator size="small" color="#00A1E0" />
                ) : (
                  <>
                    <Text style={styles.routesLabel}>Available Routes:</Text>
                    {routesForStation.map((route, idx) => (
                      <View key={idx} style={styles.routeItem}>
                        <View style={styles.routeHeader}>
                          <Text style={styles.routeNumber}>
                            Route {route.route_short_name}
                            {route.route_variant && route.route_variant !== route.route_short_name &&
                              ` (${route.route_variant})`}
                          </Text>
                          {route.route_long_name ? (
                            <Text style={styles.routeName}>{route.route_long_name}</Text>
                          ) : null}
                        </View>
                        <View style={styles.directionButtons}>
                          <TouchableOpacity
                            style={[styles.directionButton, styles.inboundButton]}
                            onPress={() => handleRouteSelect(route, 'inbound')}
                          >
                            <Text style={styles.directionButtonText}>⬇️ To Union</Text>
                          </TouchableOpacity>
                          <TouchableOpacity
                            style={[styles.directionButton, styles.outboundButton]}
                            onPress={() => handleRouteSelect(route, 'outbound')}
                          >
                            <Text style={styles.directionButtonText}>⬆️ From Union</Text>
                          </TouchableOpacity>
                        </View>
                      </View>
                    ))}
                    {routesForStation.length === 0 && (
                      <Text style={styles.noRoutesText}>No routes found for this station</Text>
                    )}
                  </>
                )}
              </View>
            )}

            {selectedRouteOnMap && (
              <View style={styles.previewPanel}>
                <Text style={styles.previewTitle}>
                  Route {selectedRouteOnMap.route_short_name}
                  {selectedRouteOnMap.route_variant !== selectedRouteOnMap.route_short_name &&
                    ` (${selectedRouteOnMap.route_variant})`}
                </Text>
                <Text style={styles.previewDirection}>
                  {selectedRouteOnMap.direction === 'inbound'
                    ? `→ From ${selectedRouteOnMap.selectedStation?.stop_name || 'your station'} to Union Station`
                    : `← From Union Station to ${selectedRouteOnMap.selectedStation?.stop_name || 'your station'}`}
                </Text>
                <View style={styles.previewButtons}>
                  <TouchableOpacity
                    style={styles.confirmButton}
                    onPress={confirmRouteSelection}
                  >
                    <Text style={styles.confirmButtonText}>Select This Route</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.cancelPreviewButton}
                    onPress={() => setSelectedRouteOnMap(null)}
                  >
                    <Text style={styles.cancelPreviewText}>Cancel</Text>
                  </TouchableOpacity>
                </View>
              </View>
            )}

            {!selectedStation && !selectedRouteOnMap && stations.length > 0 && (
              <View style={styles.instructions}>
                <Text style={styles.instructionsText}>
                  📍 Tap on any station to see available routes
                </Text>
              </View>
            )}

            {!selectedStation && !selectedRouteOnMap && stations.length === 0 && (
              <View style={styles.instructions}>
                <Text style={styles.instructionsText}>
                  🗺️ No stations found within {MAX_DISTANCE_KM}km
                </Text>
                <Text style={styles.instructionsSubtext}>
                  Try moving to a different location
                </Text>
              </View>
            )}
          </>
        )}
      </View>
    </Modal>
  );
};

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#fff' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#00A1E0',
    paddingTop: 48,
  },
  headerTitle: { color: '#fff', fontSize: 18, fontWeight: 'bold' },
  closeButton: { padding: 8 },
  closeButtonText: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  map: { flex: 1 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  loadingText: { marginTop: 10, color: '#666' },
  stationCounter: {
    position: 'absolute',
    top: 80,
    alignSelf: 'center',
    backgroundColor: 'rgba(0, 161, 224, 0.9)',
    paddingHorizontal: 16,
    paddingVertical: 6,
    borderRadius: 20,
  },
  stationCounterText: {
    color: '#fff',
    fontSize: 13,
    fontWeight: '600',
  },
  infoPanel: {
    position: 'absolute',
    bottom: 0,
    left: 0,
    right: 0,
    backgroundColor: '#fff',
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    padding: 16,
    maxHeight: SCREEN_HEIGHT * 0.5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
  },
  infoHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 12,
  },
  infoTitle: { fontSize: 18, fontWeight: 'bold', color: '#333', flex: 1 },
  infoDistance: {
    fontSize: 14,
    color: '#00A1E0',
    fontWeight: '600',
    marginRight: 12,
  },
  infoCloseButton: { padding: 4 },
  infoCloseText: { fontSize: 18, color: '#666' },
  routesLabel: { fontSize: 14, fontWeight: '600', color: '#666', marginBottom: 8 },
  routeItem: {
    backgroundColor: '#f5f5f5',
    borderRadius: 10,
    padding: 12,
    marginBottom: 8,
  },
  routeHeader: { marginBottom: 8 },
  routeNumber: { fontSize: 16, fontWeight: 'bold', color: '#00A1E0' },
  routeName: { fontSize: 12, color: '#666', marginTop: 2 },
  directionButtons: { flexDirection: 'row', gap: 8 },
  directionButton: { flex: 1, paddingVertical: 8, borderRadius: 6, alignItems: 'center' },
  inboundButton: { backgroundColor: '#4CAF50' },
  outboundButton: { backgroundColor: '#FF9800' },
  directionButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  noRoutesText: { textAlign: 'center', color: '#999', padding: 20 },
  previewPanel: {
    position: 'absolute',
    bottom: 20,
    left: 20,
    right: 20,
    backgroundColor: '#fff',
    borderRadius: 12,
    padding: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
  },
  previewTitle: { fontSize: 16, fontWeight: 'bold', color: '#333', textAlign: 'center' },
  previewDirection: { fontSize: 14, color: '#666', textAlign: 'center', marginTop: 4, marginBottom: 12 },
  previewButtons: { flexDirection: 'row', gap: 8 },
  confirmButton: { flex: 1, backgroundColor: '#00A1E0', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  confirmButtonText: { color: '#fff', fontWeight: 'bold' },
  cancelPreviewButton: { flex: 1, backgroundColor: '#f0f0f0', paddingVertical: 10, borderRadius: 8, alignItems: 'center' },
  cancelPreviewText: { color: '#666' },
  instructions: {
    position: 'absolute',
    top: 120,
    left: 20,
    right: 20,
    backgroundColor: 'rgba(0,0,0,0.7)',
    borderRadius: 8,
    padding: 12,
  },
  instructionsText: { color: '#fff', textAlign: 'center', fontSize: 14, fontWeight: 'bold' },
  instructionsSubtext: { color: '#ddd', textAlign: 'center', fontSize: 12, marginTop: 4 },
});

export default NearbyStationsMap;