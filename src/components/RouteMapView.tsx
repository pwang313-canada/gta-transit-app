// src/components/RouteMapView.tsx
import React, { useEffect, useState } from 'react';
import { ActivityIndicator, Alert, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import MapView, { Marker, Polyline } from 'react-native-maps';
import DatabaseService from '../services/DatabaseService';
import { getLineData, getStopsFromLineData } from '../services/scheduleService';

interface RouteMapViewProps {
  routeId: string;
  routeShortName: string;
  variant?: string;
  selectedDate?: Date;
  direction?: string;
  visible: boolean;
  onClose: () => void;
  onSelectStop: (stop: any, type: 'departure' | 'arrival') => void;
}

const RouteMapView: React.FC<RouteMapViewProps> = ({
  routeId,
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
  const [hasShape, setHasShape] = useState<boolean>(false);

  const dbService = DatabaseService;

  console.log(`[RouteMapView] Received: variant=${variant}, direction=${direction}, routeShortName=${routeId}`);

  const fetchStopNames = async (stopIds: string[]): Promise<Map<string, string>> => {
    if (stopIds.length === 0) return new Map();
    const placeholders = stopIds.map(() => '?').join(',');
    const sql = `SELECT stop_id, stop_name FROM stops WHERE stop_id IN (${placeholders})`;
    const rows = await dbService.executeCustomQuery<{ stop_id: string; stop_name: string }>(sql, stopIds);
    const map = new Map<string, string>();
    rows.forEach(row => map.set(row.stop_id, row.stop_name));
    return map;
  };

  const loadRouteGeometry = async () => {
    if (!variant) {
      console.warn('RouteMapView: No variant provided');
      setError('Missing route variant');
      setLoading(false);
      return;
    }
    if (!direction) {
      console.warn('RouteMapView: No direction provided');
      setError('Missing direction');
      setLoading(false);
      return;
    }

    try {
      setLoading(true);
      setError(null);

      const date = selectedDate || new Date();
      // Format date as YYYYMMDD for service_id
      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, '0');
      const day = String(date.getDate()).padStart(2, '0');
      const serviceId = `${year}${month}${day}`;
      console.log(`[RouteMapView] Loading: variant=${variant}, direction=${direction}, serviceId=${serviceId}`);

      // 1. Fetch stops from API (same as before)
      const lineData = await getLineData(variant, direction, date);
      if (!lineData || !lineData.Trip || lineData.Trip.length === 0) {
        throw new Error(`No trips found for ${variant} ${direction} on ${date.toDateString()}`);
      }

      const stopsFromApi = getStopsFromLineData(lineData);
      const stopIds = stopsFromApi.map(s => s.stop_id);
      if (stopIds.length === 0) throw new Error('No stops found in API response');

      const nameMap = await fetchStopNames(stopIds);
      const coordsPlaceholders = stopIds.map(() => '?').join(',');
      const coordsQuery = `SELECT stop_id, stop_lat, stop_lon FROM stops WHERE stop_id IN (${coordsPlaceholders})`;
      const coordsRows = await dbService.executeCustomQuery<{ stop_id: string; stop_lat: number; stop_lon: number }>(coordsQuery, stopIds);
      const coordsMap = new Map(coordsRows.map(row => [row.stop_id, { lat: row.stop_lat, lon: row.stop_lon }]));

      const stopsWithCoords = stopsFromApi.map((s) => {
        const coords = coordsMap.get(s.stop_id);
        return {
          stop_id: s.stop_id,
          stop_name: nameMap.get(s.stop_id) || s.stop_id,
          stop_sequence: s.stop_sequence,
          latitude: coords?.lat,
          longitude: coords?.lon,
          hasCoords: !!(coords?.lat && coords?.lon),
        };
      });

      setStops(stopsWithCoords);

      // 2. Get shape_id from trips table using route_variant, direction, and service_id
      const shapeQuery = `
        SELECT DISTINCT shape_id
        FROM trips
        WHERE route_variant = ? AND direction_id = ? AND service_id = ?
          AND shape_id IS NOT NULL AND shape_id != ''
        LIMIT 1
      `;
      const shapeRows = await dbService.executeCustomQuery<{ shape_id: string }>(
        shapeQuery,
        [variant, direction, serviceId]
      );

      let shapeData: Array<{ latitude: number; longitude: number }> = [];
      if (shapeRows.length > 0 && shapeRows[0].shape_id) {
        const shapeId = shapeRows[0].shape_id;
        console.log(`[RouteMapView] Found shape_id: ${shapeId}`);
        const pointsQuery = `
          SELECT shape_pt_lat, shape_pt_lon
          FROM shapes
          WHERE shape_id = ?
          ORDER BY shape_pt_sequence
        `;
        const points = await dbService.executeCustomQuery<{ shape_pt_lat: number; shape_pt_lon: number }>(
          pointsQuery,
          [shapeId]
        );
        shapeData = points.map(p => ({ latitude: p.shape_pt_lat, longitude: p.shape_pt_lon }));
        console.log(`[RouteMapView] Loaded ${shapeData.length} shape points`);
      } else {
        console.warn(`No shape_id found for variant=${variant}, direction=${direction}, serviceId=${serviceId}`);
      }

      if (shapeData.length === 0) {
        setHasShape(false);
        setShapeCoordinates([]);
      } else {
        // Optional: reverse shape if it seems opposite to stop order
        if (stopsWithCoords.length > 1 && stopsWithCoords[0].hasCoords && stopsWithCoords[stopsWithCoords.length - 1].hasCoords && shapeData.length > 0) {
          const firstStop = stopsWithCoords[0];
          const firstShape = shapeData[0];
          const lastShape = shapeData[shapeData.length - 1];
          const distFirstToFirst = Math.hypot(
            firstStop.latitude! - firstShape.latitude,
            firstStop.longitude! - firstShape.longitude
          );
          const distFirstToLast = Math.hypot(
            firstStop.latitude! - lastShape.latitude,
            firstStop.longitude! - lastShape.longitude
          );
          if (distFirstToFirst > distFirstToLast) {
            console.log('Shape appears reversed. Reversing shape coordinates.');
            shapeData = shapeData.reverse();
          }
        }
        setHasShape(true);
        setShapeCoordinates(shapeData);
      }
    } catch (err) {
      console.error('Error loading route geometry:', err);
      setError(err instanceof Error ? err.message : 'Failed to load route stops');
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    if (visible && routeId && variant && direction) {
      loadRouteGeometry();
    }
  }, [visible, routeId, variant, direction, selectedDate]);

  // ========== Render (unchanged) ==========
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

  const getDirectionDescription = (code?: string): string => {
    switch (code) {
      case 'E': return 'Eastbound';
      case 'W': return 'Westbound';
      case 'N': return 'Northbound';
      case 'S': return 'Southbound';
      default: return '';
    }
  };
  const directionText = direction ? ` • ${getDirectionDescription(direction)}` : '';

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>
          {routeId} {variant && variant !== routeId ? `(${variant})` : ''}{directionText}
        </Text>
        <TouchableOpacity onPress={onClose} style={styles.closeButton}>
          <Text style={styles.closeButtonText}>✕</Text>
        </TouchableOpacity>
      </View>

      <MapView style={styles.map} initialRegion={initialRegion}>
        {hasShape && shapeCoordinates.length > 1 && (
          <Polyline
            coordinates={shapeCoordinates}
            strokeColor="#00A1E0"
            strokeWidth={4}
            lineCap="round"
            lineJoin="round"
          />
        )}
        {!hasShape && validStops.length > 1 && (
          <Polyline
            coordinates={validStops.map(s => ({ latitude: s.latitude, longitude: s.longitude }))}
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
              key={`${stop.stop_id}-${index}`}
              coordinate={{ latitude: stop.latitude, longitude: stop.longitude }}
              title={stop.stop_name}
              description={`${isFirst ? 'START' : isLast ? 'END' : `Stop ${index + 1}`} • Tap to select`}
              pinColor={isFirst ? 'green' : isLast ? 'red' : '#00A1E0'}
              onPress={() => {
                Alert.alert(
                  stop.stop_name,
                  `${isFirst ? '🟢 START' : isLast ? '🔴 END' : `Stop ${index + 1}`}${!stop.hasCoords ? '\n⚠️ Approximate location' : ''}\n\nSelect this as your:`,
                  [
                    { text: 'Departure Station', onPress: () => onSelectStop(stop, 'departure') },
                    { text: 'Arrival Station', onPress: () => onSelectStop(stop, 'arrival') },
                    { text: 'Cancel', style: 'cancel' },
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
          {stops.length} stops • {hasShape ? 'Actual route' : 'Approximate route (shape data missing)'}
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
    backgroundColor: '#335B00',
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