// src/screens/HomeScreen.tsx
import DateTimePicker from '@react-native-community/datetimepicker';
import * as SecureStore from 'expo-secure-store';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  Modal as RNModal,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View
} from 'react-native';
import NearbyStationsMap from '../components/NearbyStationsMap';
import RouteMapView from '../components/RouteMapView';
import SearchablePicker from '../components/SearchableRoutePicker';
import DatabaseService from '../services/DatabaseService';
import {
  getAvailableDirections,
  getLineData,
  getStopsFromLineData,
  getTripsForStop,
  TripWithArrival,
} from '../services/scheduleService';

// ========== Type Definitions ==========
interface Route {
  route_id: string;
  route_long_name: string;
  direction_id?: string;
  variant?: string;
  isBus?: boolean;
}

interface Stop {
  stop_id: string;
  stop_name: string;
  stop_sequence?: number;
}

interface RouteGroup {
  routeId: string;
  routeLongName: string;
  isBus: boolean;
  variant: string;
}

interface Favorite {
  id: string;
  routeId: string;
  variant: string;
  isBus: boolean;
  directionCode: string;
  departureStop: Stop;
  arrivalStop: Stop;
  routeLongName: string;
}

interface ServiceAlert {
  Code: string;
  PostedDateTime: string;
  SubjectEnglish: string;
  BodyEnglish: string;
  Category?: string;
  SubCategory?: string;
}

const STORAGE_KEY = 'go_transit_favorites_v2';

// ========== Helper Functions ==========
const secondsToTimeString = (seconds: number): string => {
  if (!seconds && seconds !== 0) return '';
  let adjustedSeconds = seconds;
  if (adjustedSeconds >= 86400) adjustedSeconds -= 86400;
  const hours = Math.floor(adjustedSeconds / 3600);
  const minutes = Math.floor((adjustedSeconds % 3600) / 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

const formatDate = (date: Date): string => date.toLocaleDateString('en-CA');

const getDirectionDisplayName = (code: string): string => {
  switch (code) {
    case 'E': return 'Eastbound';
    case 'W': return 'Westbound';
    case 'N': return 'Northbound';
    case 'S': return 'Southbound';
    default: return code;
  }
};

const isTrainRoute = (routeShortName: string): boolean => {
  return /^[^0-9]{2}$/.test(routeShortName);
};

export default function HomeScreen() {
  // ========== State ==========
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [routeGroups, setRouteGroups] = useState<RouteGroup[]>([]);
  const [selectedRouteGroup, setSelectedRouteGroup] = useState<RouteGroup | null>(null);
  const [availableDirections, setAvailableDirections] = useState<{ code: string; name: string }[]>([]);
  const [selectedDirectionCode, setSelectedDirectionCode] = useState<string | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [departureStop, setDepartureStop] = useState<Stop | null>(null);
  const [arrivalStop, setArrivalStop] = useState<Stop | null>(null);
  const [schedule, setSchedule] = useState<TripWithArrival[]>([]);
  const [nextSchedule, setNextSchedule] = useState<TripWithArrival | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState<boolean>(false);
  const [showMap, setShowMap] = useState<boolean>(false);
  const [showNearbyMap, setShowNearbyMap] = useState<boolean>(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [favorites, setFavorites] = useState<Favorite[]>([]);

  // Service alert state
  const [alerts, setAlerts] = useState<ServiceAlert[]>([]);
  const [unreadAlertIds, setUnreadAlertIds] = useState<Set<string>>(new Set());
  const [showAlertModal, setShowAlertModal] = useState(false);
  const [selectedAlert, setSelectedAlert] = useState<ServiceAlert | null>(null);
  const intervalRef = useRef<number | null>(null);

  // Cache for stops (stop_id -> stop_name, later lat/lon)
  const stopsMapRef = useRef<Map<string, { name: string; lat?: number; lon?: number }>>(new Map());
  const flatListRef = useRef<FlatList>(null);
  const dbService = DatabaseService;

  // Ref to always hold the latest selected date (solves stale closure issues)
  const selectedDateRef = useRef(selectedDate);
  useEffect(() => {
    selectedDateRef.current = selectedDate;
  }, [selectedDate]);

  // ========== Favorites Persistence ==========
  useEffect(() => {
    loadFavorites();
  }, []);

  const loadFavorites = async () => {
    try {
      const stored = await SecureStore.getItemAsync(STORAGE_KEY);
      if (stored) {
        setFavorites(JSON.parse(stored));
      }
    } catch (error) {
      console.error('Load favorites error:', error);
      setFavorites([]);
    }
  };

  const saveFavorites = async (newFavorites: Favorite[]) => {
    try {
      await SecureStore.setItemAsync(STORAGE_KEY, JSON.stringify(newFavorites));
      setFavorites(newFavorites);
    } catch (error) {
      console.error('Save favorites error:', error);
      Alert.alert('Error', 'Unable to save favorite. Please try again.');
    }
  };

  const addFavorite = () => {
    if (!selectedRouteGroup || !selectedDirectionCode || !departureStop || !arrivalStop) {
      Alert.alert('Cannot Save', 'Please select a route, direction, departure and arrival stops first.');
      return;
    }
    if (favorites.length >= 4) {
      Alert.alert('Limit Reached', 'You can only save up to 4 favorites. Delete one first.');
      return;
    }
    const newFavorite: Favorite = {
      id: Date.now().toString(),
      routeId: selectedRouteGroup.routeId,
      variant: selectedRouteGroup.variant,
      isBus: selectedRouteGroup.isBus,
      directionCode: selectedDirectionCode,
      departureStop,
      arrivalStop,
      routeLongName: selectedRouteGroup.routeLongName,
    };
    const newFavorites = [...favorites, newFavorite];
    saveFavorites(newFavorites);
    Alert.alert('Saved', 'Route saved to favorites.');
  };

  const deleteFavorite = (id: string) => {
    const newFavorites = favorites.filter(f => f.id !== id);
    saveFavorites(newFavorites);
  };

  const loadFavorite = async (fav: Favorite) => {
    const routeGroup = routeGroups.find(
      rg => rg.routeId === fav.routeId && rg.variant === fav.variant
    );
    if (!routeGroup) {
      Alert.alert('Route Not Found', `Route ${fav.routeId} (${fav.variant}) is not available.`);
      return;
    }
    setSelectedRouteGroup(routeGroup);
    setSelectedDirectionCode(fav.directionCode);
    setDepartureStop(fav.departureStop);
    setArrivalStop(fav.arrivalStop);
    await handleDirectionSelectByCode(fav.directionCode, routeGroup, fav.departureStop, fav.arrivalStop);
  };

  // ========== Load stops cache from database ==========
  const loadStopsCache = async () => {
    try {
      const rows = await dbService.executeCustomQuery<{ stop_id: string; stop_name: string; stop_lat?: number; stop_lon?: number }>(
        `SELECT stop_id, stop_name, stop_lat, stop_lon FROM stops`
      );
      for (const row of rows) {
        stopsMapRef.current.set(row.stop_id, {
          name: row.stop_name,
          lat: row.stop_lat,
          lon: row.stop_lon,
        });
      }
      console.log(`📦 Loaded ${stopsMapRef.current.size} stops into cache`);
    } catch (error) {
      console.error('Failed to load stops cache:', error);
      // Continue without names (fallback to stop_id)
    }
  };

  // Helper to get stop name from cache
  const getStopName = (stopId: string): string => {
    const cached = stopsMapRef.current.get(stopId);
    return cached?.name || stopId;
  };

  // ========== Core Functions ==========
  const handleRouteGroupSelect = (routeGroup: RouteGroup): void => {
    setSelectedRouteGroup(routeGroup);
    setSelectedDirectionCode(null);
    setAvailableDirections([]);
    setSelectedRoute(null);
    setDepartureStop(null);
    setArrivalStop(null);
    setSchedule([]);
    setNextSchedule(null);
    setShowMap(false);
    setStops([]);
    // Reload directions immediately using current selectedDate
    loadAvailableDirectionsForRoute(routeGroup, selectedDate);
  };

  // Accepts an explicit date to avoid stale closure
  const loadAvailableDirectionsForRoute = async (routeGroup: RouteGroup, date: Date) => {
    try {
      console.log(`[loadAvailableDirections] variant=${routeGroup.variant}, date=${formatDate(date)}`);
      const directions = await getAvailableDirections(routeGroup.variant, date);
      const directionsWithNames = directions.map(code => ({
        code,
        name: getDirectionDisplayName(code)
      }));
      setAvailableDirections(directionsWithNames);
      setSelectedDirectionCode(null);
      if (directionsWithNames.length === 0) {
        Alert.alert('No Service', `No ${routeGroup.routeId} service on ${formatDate(date)}`);
      }
    } catch (error) {
      console.error('Failed to load directions from API:', error);
      setAvailableDirections([]);
      setSelectedDirectionCode(null);
    }
  };

  // When date changes, reload directions for the current route group (if any)
  useEffect(() => {
    if (selectedRouteGroup) {
      loadAvailableDirectionsForRoute(selectedRouteGroup, selectedDate);
    }
  }, [selectedDate, selectedRouteGroup]);

  const handleDirectionSelectByCode = async (
    directionCode: string,
    routeGroup?: RouteGroup,
    preselectedDepartureStop?: Stop,
    preselectedArrivalStop?: Stop
  ): Promise<void> => {
    const effectiveRouteGroup = routeGroup || selectedRouteGroup;
    if (!effectiveRouteGroup) return;

    setSelectedDirectionCode(directionCode);
    setSelectedRoute(null);
    setSchedule([]);
    setNextSchedule(null);
    setShowMap(false);
    setStops([]);
    setDepartureStop(null);
    setArrivalStop(null);

    try {
      console.log(`[DEBUG] Loading line data for variant=${effectiveRouteGroup.variant}, direction=${directionCode}, date=${formatDate(selectedDate)}`);
      const lineData = await getLineData(effectiveRouteGroup.variant, directionCode, selectedDate);
      if (!lineData || !lineData.Trip || lineData.Trip.length === 0) {
        Alert.alert('No Schedule', `No trips found for ${effectiveRouteGroup.routeId} ${directionCode} on ${formatDate(selectedDate)}`);
        setSelectedDirectionCode(null);
        return;
      }

      const selectedRouteObj: Route = {
        route_id: effectiveRouteGroup.routeId,
        route_long_name: effectiveRouteGroup.routeLongName,
        direction_id: directionCode,
        variant: effectiveRouteGroup.variant,
        isBus: effectiveRouteGroup.isBus,
      };
      setSelectedRoute(selectedRouteObj);
      console.log(`[DEBUG] selectedRoute set: variant=${selectedRouteObj.variant}, route_short_name=${selectedRouteObj.route_id}, direction=${directionCode}`);

      const stopsList = getStopsFromLineData(lineData);
      const typedStops: Stop[] = stopsList.map(s => ({
        stop_id: s.stop_id,
        stop_name: getStopName(s.stop_id),
        stop_sequence: s.stop_sequence,
      }));

      setStops(typedStops);

      if (preselectedDepartureStop && preselectedArrivalStop) {
        const depStop = { ...preselectedDepartureStop, stop_name: getStopName(preselectedDepartureStop.stop_id) };
        const arrStop = { ...preselectedArrivalStop, stop_name: getStopName(preselectedArrivalStop.stop_id) };
        setDepartureStop(depStop);
        setArrivalStop(arrStop);
      } else if (preselectedDepartureStop) {
        const depStop = { ...preselectedDepartureStop, stop_name: getStopName(preselectedDepartureStop.stop_id) };
        setDepartureStop(depStop);
        setArrivalStop(null);
      } else {
        const firstStop = typedStops[0];
        const lastStop = typedStops[typedStops.length - 1];
        setDepartureStop(firstStop);
        setArrivalStop(lastStop);
      }
    } catch (error) {
      console.error('Failed to load stops from API:', error);
      Alert.alert('Error', 'Failed to load stops. Please try again.');
    }
  };

  const handleMapStopSelect = (stop: any, type: 'departure' | 'arrival') => {
    if (!stop) return;
    const resolvedStop = {
      stop_id: stop.stop_id,
      stop_name: getStopName(stop.stop_id),
    };
    if (type === 'departure') {
      setDepartureStop(resolvedStop);
    } else {
      setArrivalStop(resolvedStop);
    }
  };

  const handleNearbyRouteSelect = (route: {
    routeId: string;
    variant?: string;
    direction?: string;
    stopId?: string;
    stopName?: string;
  }) => {
    const routeGroup = routeGroups.find(rg => rg.routeId === route.routeId);
    if (!routeGroup) {
      Alert.alert('Route Not Found', `Could not find route ${route.routeId}`);
      return;
    }
    setSelectedRouteGroup(routeGroup);
    const selectedStop = route.stopId ? { stop_id: route.stopId, stop_name: route.stopName || getStopName(route.stopId) } : undefined;
    handleDirectionSelectByCode(route.direction!, routeGroup, selectedStop);
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selectedDate) {
      setSelectedDate(selectedDate);
      // Clear all dependent selections
      setSelectedDirectionCode(null);
      setSelectedRoute(null);
      setDepartureStop(null);
      setArrivalStop(null);
      setSchedule([]);
      setNextSchedule(null);
      setStops([]);
      setShowMap(false);
      // Directions will be reloaded automatically by the useEffect that watches selectedDate/selectedRouteGroup
    }
  };

  const loadRecentSchedule = async (): Promise<void> => {
    if (!selectedRoute || !departureStop || !selectedDirectionCode) return;
    setLoadingSchedule(true);
    try {
      // Use the ref to get the latest date, avoiding stale closures
      const queryDate = selectedDateRef.current;
      const isToday = queryDate.toDateString() === new Date().toDateString();
      const variant = selectedRoute.variant || selectedRoute.route_id;
      const directionCode = selectedDirectionCode;

      console.log(`[loadRecentSchedule] Using date: ${formatDate(queryDate)}`);

      const trips = await getTripsForStop(
        selectedRoute.route_id,
        variant,
        directionCode,
        departureStop.stop_id,
        queryDate,
        arrivalStop?.stop_id
      );

      if (!trips.length) {
        Alert.alert('No Schedule', `No trips found for ${variant} on ${formatDate(queryDate)}`);
        setSchedule([]);
        setNextSchedule(null);
        setLoadingSchedule(false);
        return;
      }

      let futureTrips = trips;
      if (isToday) {
        const now = new Date();
        const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
        futureTrips = trips.filter(t => {
          let departure = t.departure_time;
          if (departure < currentSeconds && departure < 4 * 3600) {
            departure += 86400;
          }
          return departure >= currentSeconds;
        });
      }

      setSchedule(futureTrips);
      setNextSchedule(futureTrips.length > 0 ? futureTrips[0] : null);
    } catch (error) {
      console.error('Failed to load schedule via API:', error);
      Alert.alert('Error', 'Could not fetch schedule from API. Please try again.');
    } finally {
      setLoadingSchedule(false);
    }
  };

  const onRefresh = async () => {
    setRefreshing(true);
    if (selectedRoute && departureStop) await loadRecentSchedule();
    setRefreshing(false);
  };

  const loadRoutesWithDirections = async (): Promise<void> => {
    try {
      setLoading(true);
      const rows = await dbService.executeCustomQuery<any>(`
        SELECT DISTINCT
          t.route_variant,
          r.route_id AS route_short_name,
          r.route_long_name
        FROM trips t
        JOIN routes r ON t.route_id = r.route_id
        WHERE t.route_variant IS NOT NULL AND t.route_variant != ''
        ORDER BY t.route_variant
      `);

      const groupsMap = new Map<string, RouteGroup>();
      for (const row of rows) {
        const variant = row.route_variant;
        if (!groupsMap.has(variant)) {
          const isTrain = isTrainRoute(row.route_short_name);
          groupsMap.set(variant, {
            routeId: variant,
            routeLongName: row.route_long_name,
            isBus: !isTrain,
            variant: variant
          });
        }
      }

      const groupedRoutes = Array.from(groupsMap.values());
      groupedRoutes.sort((a, b) => {
        if (a.isBus !== b.isBus) return a.isBus ? -1 : 1;
        if (a.isBus) {
          const aMatch = a.routeId.match(/(\d+)([A-Z]*)/);
          const bMatch = b.routeId.match(/(\d+)([A-Z]*)/);
          if (aMatch && bMatch) {
            const aNum = parseInt(aMatch[1]);
            const bNum = parseInt(bMatch[1]);
            if (aNum !== bNum) return aNum - bNum;
            const aLetter = aMatch[2] || '';
            const bLetter = bMatch[2] || '';
            if (aLetter === '' && bLetter !== '') return -1;
            if (aLetter !== '' && bLetter === '') return 1;
            return aLetter.localeCompare(bLetter);
          }
          return a.routeId.localeCompare(b.routeId);
        } else {
          return a.routeId.localeCompare(b.routeId);
        }
      });

      setRouteGroups(groupedRoutes);
    } catch (error) {
      console.error('Failed to load routes:', error);
      Alert.alert('Error', 'Failed to load transit data');
    } finally {
      setLoading(false);
    }
  };

  // ========== Service Alert Functions ==========
const fetchAlerts = async () => {
  try {
    // For production, use today's date: new Date().toISOString().split('T')[0]
    // For testing with the provided example, use "2026-01-01"
    const targetDate = new Date().toISOString().split('T')[0]; // Change to "2026-05-16" or today as needed
    const urls = [
      'https://transit-backend-production-34b5.up.railway.app/api/serviceUpdate/serviceAlert',
      'https://transit-backend-production-34b5.up.railway.app/api/serviceUpdate/informationAlert'
    ];
    const allAlerts: ServiceAlert[] = [];

    for (const url of urls) {
      const response = await fetch(url);
      const data = await response.json();
      // Handle the actual response structure
      let messages: any[] = [];
      if (data && data.Messages && Array.isArray(data.Messages.Message)) {
        messages = data.Messages.Message;
      } else if (Array.isArray(data)) {
        messages = data;
      } else if (data && Array.isArray(data.Messages)) {
        messages = data.Messages;
      }
      // Map to our ServiceAlert format
      for (const msg of messages) {
        allAlerts.push({
          Code: msg.Code,
          PostedDateTime: msg.PostedDateTime,
          SubjectEnglish: msg.SubjectEnglish,
          BodyEnglish: msg.BodyEnglish,
          Category: msg.Category,
          SubCategory: msg.SubCategory,
        });
      }
    }

    // Filter alerts where PostedDateTime starts with targetDate
    const filtered = allAlerts.filter(alert =>
      alert.PostedDateTime && alert.PostedDateTime.startsWith(targetDate)
    );

    console.log(`[Alerts] Found ${filtered.length} alerts for ${targetDate}`);

    // Detect new alerts (those not already in unread set and not already in alerts list)
    const newAlertIds = filtered
      .map(a => a.Code)
      .filter(code => !unreadAlertIds.has(code) && !alerts.some(a => a.Code === code));

    if (newAlertIds.length > 0) {
      setUnreadAlertIds(prev => {
        const updated = new Set(prev);
        newAlertIds.forEach(id => updated.add(id));
        return updated;
      });
    }

    setAlerts(filtered);
  } catch (error) {
    console.error('Error fetching service alerts:', error);
  }
};

  // Initial alert fetch and interval (every 30 seconds)
  useEffect(() => {
    fetchAlerts();
    intervalRef.current = setInterval(fetchAlerts, 30000);
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const markAlertAsRead = (code: string) => {
    setUnreadAlertIds(prev => {
      const updated = new Set(prev);
      updated.delete(code);
      return updated;
    });
  };

  const markAllAsRead = () => {
    setUnreadAlertIds(new Set());
  };

  // Initialization
  useEffect(() => {
    const init = async () => {
      try {
        const ok = await dbService.initializeDatabase();
        await new Promise(res => setTimeout(res, 100));
        if (!ok) throw new Error('Database failed to initialize');
        await loadStopsCache();
        await loadRoutesWithDirections();
      } catch (e) {
        console.error('INIT FAILED:', e);
        Alert.alert('Database Error', 'Failed to load database');
      }
    };
    init();
  }, []);

  // Reload schedule when dependencies change – uses ref for latest date
  useEffect(() => {
    if (selectedRoute && departureStop && selectedDirectionCode) {
      loadRecentSchedule();
    }
  }, [selectedRoute, departureStop, arrivalStop, selectedDate, selectedDirectionCode]);

  // ========== UI Helpers ==========
  const getFormattedRouteLabel = (routeGroup: RouteGroup): string => {
    const routeType = routeGroup.isBus ? '🚌 Bus' : '🚆 Train';
    return `${routeGroup.routeId} - ${routeGroup.routeLongName.substring(0, 40)} (${routeType})`;
  };

  const routeItems = routeGroups.map(rg => ({ label: getFormattedRouteLabel(rg), value: rg.routeId }));
  const stopItems = stops.map(s => ({ label: s.stop_name, value: s.stop_id }));

  const calculateWaitTime = (departureTime: number): string => {
    if (!departureTime && departureTime !== 0) return 'N/A';
    const now = new Date();
    let currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    let adjusted = departureTime;
    if (adjusted >= 86400) adjusted -= 86400;
    let wait = adjusted - currentSeconds;
    if (wait < 0) wait += 86400;
    const minutes = Math.floor(wait / 60);
    if (minutes < 1) return 'Now';
    if (minutes < 60) return `${minutes} min`;
    return `${Math.floor(minutes / 60)}h ${minutes % 60}m`;
  };

  const renderSection = ({ item }: { item: any }) => item.component;

  const getSections = () => {
    const sections: any[] = [];
    const today = new Date();
    const isToday = selectedDate.toDateString() === today.toDateString();

    sections.push({
      key: 'header',
      component: (
        <View style={styles.header}>
          <Text style={styles.title}>GO Transit Schedules</Text>
        </View>
      ),
    });

    sections.push({
      key: 'favorites',
      component: (
        <View style={styles.favoritesSection}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>⭐ Favorites ({favorites.length}/4)</Text>
            <TouchableOpacity style={styles.nearbyButton} onPress={() => setShowNearbyMap(true)}>
              <Text style={styles.nearbyButtonText}>🗺️ Nearby</Text>
            </TouchableOpacity>
          </View>
          {favorites.length > 0 ? (
            <View style={styles.favoritesGrid}>
              {favorites.map(fav => (
                <View key={fav.id} style={styles.favoriteCard}>
                  <TouchableOpacity style={styles.favoriteContent} onPress={() => loadFavorite(fav)}>
                    <Text style={styles.favoriteRoute}>{fav.routeId}</Text>
                    <Text style={styles.favoriteStops} numberOfLines={2}>
                      {getDirectionDisplayName(fav.directionCode)}: {getStopName(fav.departureStop.stop_id)} → {getStopName(fav.arrivalStop.stop_id)}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.deleteFavorite} onPress={() => deleteFavorite(fav.id)}>
                    <Text style={styles.deleteFavoriteText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </View>
          ) : (
            <Text style={styles.emptyFavoritesText}>No favorites saved yet. Save one below.</Text>
          )}
        </View>
      ),
    });

    sections.push({
      key: 'routeSelection',
      component: (
        <View style={styles.section}>
          <View style={styles.sectionHeader}>
            <Text style={styles.sectionTitle}>Select GO Line</Text>
            <TouchableOpacity style={styles.dateButton} onPress={() => setShowDatePicker(true)}>
              <Text style={styles.dateButtonText}>📅 {formatDate(selectedDate)}{!isToday && " 🔮"}</Text>
            </TouchableOpacity>
          </View>
          <SearchablePicker
            items={routeItems}
            placeholder="Search GO line..."
            onValueChange={(value: string) => {
              const selected = routeGroups.find(rg => rg.routeId === value);
              if (selected) handleRouteGroupSelect(selected);
            }}
            value={selectedRouteGroup?.routeId}
          />
        </View>
      ),
    });

    if (selectedRouteGroup && availableDirections.length > 0) {
      sections.push({
        key: 'directionSelector',
        component: (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Direction</Text>
            <View style={styles.directionButtonsContainer}>
              {availableDirections.map(dir => (
                <TouchableOpacity
                  key={dir.code}
                  style={[
                    styles.directionButton,
                    selectedDirectionCode === dir.code && styles.directionButtonActive
                  ]}
                  onPress={() => handleDirectionSelectByCode(dir.code)}
                >
                  <Text style={[
                    styles.directionButtonText,
                    selectedDirectionCode === dir.code && styles.directionButtonTextActive
                  ]}>
                    {dir.name}
                  </Text>
                </TouchableOpacity>
              ))}
            </View>
          </View>
        ),
      });
    }

    if (selectedRoute && selectedDirectionCode) {
      const variantForMap = selectedRoute.variant || selectedRoute.route_id;
      sections.push({
        key: 'mapControls',
        component: (
          <View style={styles.mapToggleContainer}>
            <TouchableOpacity style={[styles.mapToggleButton, showMap && styles.mapToggleButtonActive]} onPress={() => setShowMap(!showMap)}>
              <Text style={[styles.mapToggleText, showMap && styles.mapToggleTextActive]}>{showMap ? '📋 Hide Map' : '🗺️ Show Route Map'}</Text>
            </TouchableOpacity>
            {showMap && (
              <RouteMapView
                routeId={selectedRoute.route_id}
                routeShortName={selectedRoute.route_id}
                variant={variantForMap}
                selectedDate={selectedDate}
                direction={selectedDirectionCode}
                visible={showMap}
                onClose={() => setShowMap(false)}
                onSelectStop={handleMapStopSelect}
              />
            )}
          </View>
        ),
      });
    }

    if (selectedRoute && stops.length > 0) {
      sections.push({
        key: 'departureStop',
        component: (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Departure Station</Text>
            <SearchablePicker
              items={stopItems}
              placeholder="Search for departure station..."
              onValueChange={(stopId: string) => setDepartureStop(stops.find(s => s.stop_id === stopId) || null)}
              value={departureStop?.stop_id}
            />
          </View>
        ),
      });
      sections.push({
        key: 'arrivalStop',
        component: (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Arrival Station</Text>
            <SearchablePicker
              items={stopItems}
              placeholder="Search for arrival station..."
              onValueChange={(stopId: string) => setArrivalStop(stops.find(s => s.stop_id === stopId) || null)}
              value={arrivalStop?.stop_id}
            />
          </View>
        ),
      });
    }

    if (selectedRouteGroup && selectedDirectionCode && departureStop && arrivalStop && favorites.length < 4) {
      const alreadySaved = favorites.some(
        fav => fav.routeId === selectedRouteGroup.routeId &&
               fav.directionCode === selectedDirectionCode &&
               fav.departureStop.stop_id === departureStop.stop_id &&
               fav.arrivalStop.stop_id === arrivalStop.stop_id
      );
      if (!alreadySaved) {
        sections.push({
          key: 'saveFavorite',
          component: (
            <View style={styles.saveFavoriteContainer}>
              <TouchableOpacity style={styles.saveFavoriteButton} onPress={addFavorite}>
                <Text style={styles.saveFavoriteText}>⭐ Save as Favorite</Text>
              </TouchableOpacity>
            </View>
          ),
        });
      }
    }

    if (loadingSchedule) {
      sections.push({
        key: 'loading',
        component: (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color="#335B00" />
            <Text style={styles.loadingText}>Loading schedule...</Text>
          </View>
        ),
      });
    }

    if (nextSchedule && !loadingSchedule) {
      sections.push({
        key: 'nextSchedule',
        component: (
          <View style={styles.nextScheduleCard}>
            {departureStop && arrivalStop ? (
              <>
                <View style={styles.nextScheduleTimeContainer}>
                  <View style={styles.nextTimeColumn}>
                    <Text style={styles.nextTimeLabel}>Depart</Text>
                    <Text style={styles.nextScheduleTime}>{departureStop.stop_name}</Text>
                  </View>
                  <Text style={styles.nextArrowSymbol}>→</Text>
                  <View style={styles.nextTimeColumn}>
                    <Text style={styles.nextTimeLabel}>Arrive</Text>
                    <Text style={styles.nextScheduleTime}>{arrivalStop.stop_name}</Text>
                  </View>
                </View>
                {nextSchedule.travel_time_minutes && (
                  <Text style={styles.travelTimeInfo}>{nextSchedule.travel_time_minutes} min travel time</Text>
                )}
              </>
            ) : (
              <>
                <Text style={styles.nextScheduleTime}>{secondsToTimeString(nextSchedule.departure_time)}</Text>
                {isToday && <Text style={styles.nextScheduleWait}>{calculateWaitTime(nextSchedule.departure_time)}</Text>}
                {isToday && (
                  <TouchableOpacity style={styles.refreshButton} onPress={loadRecentSchedule}>
                    <Text style={styles.refreshButtonText}>⟳ Refresh</Text>
                  </TouchableOpacity>
                )}
              </>
            )}
          </View>
        ),
      });
    }

    if (!loadingSchedule && schedule.length > 0) {
      sections.push({
        key: 'schedule',
        component: (
          <View style={styles.scheduleSection}>
            {schedule.map((item, idx) => (
              <View key={idx} style={styles.scheduleItem}>
                <View style={styles.timeContainer}>
                  <Text style={styles.scheduleTime}>
                    {secondsToTimeString(item.departure_time) || '--:--'}
                  </Text>
                  {item.arrival_time != null && (
                    <View style={{ flexDirection: 'row', alignItems: 'center' }}>
                      <Text style={styles.arrowSymbol}> → </Text>
                      <Text style={styles.arrivalTime}>
                        {secondsToTimeString(item.arrival_time) || '--:--'}
                      </Text>
                    </View>
                  )}
                  {isToday && item.arrival_time == null && (
                    <Text style={styles.waitTime}>
                      {calculateWaitTime(item.departure_time)}
                    </Text>
                  )}
                </View>
                {item.arrival_time != null && item.travel_time_minutes != null && (
                  <Text style={styles.travelTimeSmall}>
                    {item.travel_time_minutes} min
                  </Text>
                )}
              </View>
            ))}
          </View>
        ),
      });
    }

    return sections;
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#335B00" />
        <Text style={styles.loadingText}>Loading routes...</Text>
      </View>
    );
  }

  return (
    <>
      <FlatList
        ref={flatListRef}
        data={getSections()}
        renderItem={renderSection}
        keyExtractor={(item) => item.key}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
        contentContainerStyle={styles.flatListContent}
      />
      {showDatePicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onDateChange}
        />
      )}
      <NearbyStationsMap
        visible={showNearbyMap}
        onClose={() => setShowNearbyMap(false)}
        onSelectRoute={handleNearbyRouteSelect}
      />

      {/* Floating Alert Button */}
      {alerts.length > 0 && (
        <TouchableOpacity
          style={styles.floatingAlertButton}
          onPress={() => setShowAlertModal(true)}
          activeOpacity={0.8}
        >
          <Text style={styles.bellIcon}>🔔</Text>
          {unreadAlertIds.size > 0 && (
            <View style={styles.badge}>
              <Text style={styles.badgeText}>{unreadAlertIds.size}</Text>
            </View>
          )}
        </TouchableOpacity>
      )}

      {/* Alert Modal */}
      <RNModal
        visible={showAlertModal}
        animationType="slide"
        transparent={false}
        onRequestClose={() => setShowAlertModal(false)}
      >
        <View style={styles.modalContainer}>
          <View style={styles.modalHeader}>
            <Text style={styles.modalTitle}>Service Alerts</Text>
            <TouchableOpacity onPress={() => setShowAlertModal(false)} style={styles.modalCloseButton}>
              <Text style={styles.modalCloseText}>✕</Text>
            </TouchableOpacity>
          </View>
          {selectedAlert ? (
            <View style={styles.alertDetailContainer}>
              <TouchableOpacity onPress={() => setSelectedAlert(null)} style={styles.backButton}>
                <Text style={styles.backButtonText}>← Back to list</Text>
              </TouchableOpacity>
              <Text style={styles.alertDetailTitle}>{selectedAlert.SubjectEnglish}</Text>
              <ScrollView style={styles.alertDetailBody}>
                <Text style={styles.alertDetailText}>{selectedAlert.BodyEnglish}</Text>
              </ScrollView>
            </View>
          ) : (
            <ScrollView style={styles.alertList}>
              {alerts.length === 0 ? (
                <Text style={styles.noAlertsText}>No alerts for today.</Text>
              ) : (
                alerts.map(alert => {
                  const isUnread = unreadAlertIds.has(alert.Code);
                  return (
                    <TouchableOpacity
                      key={alert.Code}
                      style={[styles.alertItem, isUnread && styles.unreadAlertItem]}
                      onPress={() => {
                        markAlertAsRead(alert.Code);
                        setSelectedAlert(alert);
                      }}
                    >
                      <View style={styles.alertItemContent}>
                        <Text style={styles.alertSubject}>{alert.SubjectEnglish}</Text>
                        {isUnread && <View style={styles.unreadDot} />}
                      </View>
                      <Text style={styles.alertCategory}>{alert.Category}</Text>
                    </TouchableOpacity>
                  );
                })
              )}
              {alerts.length > 0 && (
                <TouchableOpacity onPress={markAllAsRead} style={styles.markReadButton}>
                  <Text style={styles.markReadButtonText}>Mark all as read</Text>
                </TouchableOpacity>
              )}
            </ScrollView>
          )}
        </View>
      </RNModal>
    </>
  );
}

const styles = StyleSheet.create({
  flatListContent: { paddingBottom: 20 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5', padding: 20 },
  loadingText: { marginTop: 20, fontSize: 16, color: '#666' },
  loaderContainer: { marginTop: 20, alignItems: 'center', padding: 20 },
  header: {
    backgroundColor: '#335B00',
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  favoritesSection: { marginHorizontal: 15, marginTop: 10, marginBottom: 5 },
  favoritesGrid: {
    flexDirection: 'row',
    flexWrap: 'wrap',
    justifyContent: 'space-between',
    marginTop: 8,
  },
  favoriteCard: {
    backgroundColor: '#f0f8ff',
    borderRadius: 12,
    padding: 10,
    width: '48%',
    marginBottom: 12,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  favoriteContent: { flex: 1 },
  favoriteRoute: { fontSize: 16, fontWeight: 'bold', color: '#335B00' },
  favoriteStops: { fontSize: 12, color: '#555', marginTop: 4 },
  deleteFavorite: { marginLeft: 8, padding: 4 },
  deleteFavoriteText: { fontSize: 16, color: '#ff4444', fontWeight: 'bold' },
  nearbyButton: {
    backgroundColor: '#335B00',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
  },
  nearbyButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  emptyFavoritesText: {
    textAlign: 'center',
    color: '#888',
    fontSize: 14,
    marginVertical: 10,
  },
  section: { backgroundColor: '#fff', margin: 15, padding: 15, borderRadius: 10, elevation: 2 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333' },
  dateButton: { backgroundColor: '#f0f0f0', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  dateButtonText: { fontSize: 14, color: '#335B00', fontWeight: '600' },
  directionButtonsContainer: { flexDirection: 'row', flexWrap: 'wrap', gap: 10, marginTop: 5 },
  directionButton: {
    paddingVertical: 8,
    paddingHorizontal: 16,
    borderRadius: 25,
    backgroundColor: '#f0f0f0',
    borderWidth: 1,
    borderColor: '#ddd',
  },
  directionButtonActive: {
    backgroundColor: '#335B00',
    borderColor: '#335B00',
  },
  directionButtonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#666',
  },
  directionButtonTextActive: {
    color: '#fff',
  },
  mapToggleContainer: { marginHorizontal: 15, marginBottom: 10 },
  mapToggleButton: { backgroundColor: '#f0f0f0', paddingVertical: 10, borderRadius: 25, alignItems: 'center', borderWidth: 1, borderColor: '#ddd' },
  mapToggleButtonActive: { backgroundColor: '#335B00', borderColor: '#335B00' },
  mapToggleText: { fontSize: 14, fontWeight: '600', color: '#666' },
  mapToggleTextActive: { color: '#fff' },
  saveFavoriteContainer: { marginHorizontal: 15, marginBottom: 10 },
  saveFavoriteButton: { backgroundColor: '#FFC107', paddingVertical: 12, borderRadius: 25, alignItems: 'center' },
  saveFavoriteText: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  nextScheduleCard: { backgroundColor: '#335B00', margin: 15, padding: 20, borderRadius: 15, alignItems: 'center', elevation: 4 },
  nextScheduleTime: { color: '#fff', fontSize: 15, fontWeight: 'bold', textAlign: 'center' },
  nextScheduleTimeContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginVertical: 10 },
  nextTimeColumn: { alignItems: 'center', flex: 1 },
  nextTimeLabel: { color: '#fff', fontSize: 12, opacity: 0.8, marginBottom: 5 },
  nextArrowSymbol: { color: '#fff', fontSize: 20, fontWeight: 'bold', alignSelf: 'center' },
  nextScheduleWait: { color: '#fff', fontSize: 16, marginTop: 8, opacity: 0.9 },
  nextScheduleDestination: { color: '#fff', fontSize: 14, marginTop: 8, opacity: 0.8 },
  travelTimeInfo: { color: '#fff', fontSize: 14, marginTop: 8, opacity: 0.9 },
  refreshButton: { marginTop: 12, backgroundColor: '#fff', paddingVertical: 8, paddingHorizontal: 16, borderRadius: 20, borderWidth: 1, borderColor: '#335B00' },
  refreshButtonText: { color: '#335B00', fontWeight: '600' },
  scheduleSection: { backgroundColor: '#fff', margin: 15, padding: 15, borderRadius: 10 },
  scheduleItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  timeContainer: { flexDirection: 'row', alignItems: 'center', gap: 8, flex: 2 },
  scheduleTime: { fontSize: 16, fontWeight: 'bold', color: '#335B00' },
  arrowSymbol: { fontSize: 14, color: '#666' },
  arrivalTime: { fontSize: 16, fontWeight: '600', color: '#2E7D32' },
  waitTime: { fontSize: 12, color: '#666' },
  travelTimeSmall: { fontSize: 14, color: '#333', textAlign: 'right', flex: 1, marginLeft: 12 },
  // ========== Alert Styles ==========
  floatingAlertButton: {
    position: 'absolute',
    bottom: 20,
    right: 20,
    backgroundColor: '#335B00',
    width: 56,
    height: 56,
    borderRadius: 28,
    justifyContent: 'center',
    alignItems: 'center',
    elevation: 5,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
  },
  bellIcon: { fontSize: 28, color: '#fff' },
  badge: {
    position: 'absolute',
    top: -5,
    right: -5,
    backgroundColor: '#ff4444',
    borderRadius: 12,
    minWidth: 22,
    height: 22,
    justifyContent: 'center',
    alignItems: 'center',
    paddingHorizontal: 5,
  },
  badgeText: { color: '#fff', fontSize: 12, fontWeight: 'bold' },
  modalContainer: { flex: 1, backgroundColor: '#f5f5f5' },
  modalHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#335B00',
    paddingTop: Platform.OS === 'ios' ? 50 : 16,
  },
  modalTitle: { fontSize: 18, fontWeight: 'bold', color: '#fff' },
  modalCloseButton: { padding: 8 },
  modalCloseText: { fontSize: 20, color: '#fff', fontWeight: 'bold' },
  alertList: { flex: 1, padding: 16 },
  alertItem: {
    backgroundColor: '#fff',
    borderRadius: 8,
    padding: 16,
    marginBottom: 12,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.05,
    shadowRadius: 2,
    elevation: 1,
  },
  unreadAlertItem: {
    backgroundColor: '#fff9e6',
    borderLeftWidth: 4,
    borderLeftColor: '#FFC107',
  },
  alertItemContent: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  alertSubject: { fontSize: 16, fontWeight: '600', color: '#333', flex: 1 },
  unreadDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: '#FFC107', marginLeft: 8 },
  alertCategory: { fontSize: 12, color: '#888', marginTop: 8 },
  noAlertsText: { textAlign: 'center', marginTop: 40, fontSize: 16, color: '#666' },
  markReadButton: {
    backgroundColor: '#f0f0f0',
    padding: 12,
    borderRadius: 8,
    alignItems: 'center',
    marginTop: 16,
    marginBottom: 30,
  },
  markReadButtonText: { color: '#335B00', fontWeight: '600' },
  alertDetailContainer: { flex: 1, padding: 16 },
  backButton: { marginBottom: 16 },
  backButtonText: { color: '#335B00', fontSize: 16, fontWeight: '600' },
  alertDetailTitle: { fontSize: 20, fontWeight: 'bold', color: '#333', marginBottom: 16 },
  alertDetailBody: { flex: 1 },
  alertDetailText: { fontSize: 15, lineHeight: 22, color: '#444' },
});