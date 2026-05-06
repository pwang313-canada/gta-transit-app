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
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import NearbyStationsMap from '../components/NearbyStationsMap';
import RouteMapView from '../components/RouteMapView';
import SearchablePicker from '../components/SearchableRoutePicker';
import DatabaseService from '../services/DatabaseService';

// ========== Type Definitions ==========
interface Route {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  direction_id?: number;
  direction?: string;
  variant?: string;
  isBus?: boolean;
}

interface Stop {
  stop_id: string;
  stop_name: string;
}

interface ScheduleItem {
  trip_id: string;
  destination: string;
  departure_time: number;
  arrival_time?: number;
  stop_sequence: number;
}

interface TripWithArrival {
  trip_id: string;
  departure_time: number;
  arrival_time: number;
  destination: string;
  departure_stop: string;
  arrival_stop: string;
  travel_time_minutes: number;
}

interface RouteGroup {
  routeNumber: string;
  routeLongName: string;
  isBus: boolean;
  variant: string;
}

interface Favorite {
  id: string;
  routeShortName: string;
  variant: string;
  isBus: boolean;
  direction: 'inbound' | 'outbound';
  departureStop: Stop;
  arrivalStop: Stop;
  routeLongName: string;
}

const STORAGE_KEY = 'go_transit_favorites';

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

const getDirectionFromTripId = (tripId: string): 'inbound' | 'outbound' | null => {
  const parts = tripId.split('-');
  if (parts.length >= 3) {
    const lastPart = parts[parts.length - 1];
    const num = parseInt(lastPart);
    if (!isNaN(num)) return num % 2 === 0 ? 'inbound' : 'outbound';
  }
  return null;
};

export default function HomeScreen() {
  // ========== State ==========
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [routeGroups, setRouteGroups] = useState<RouteGroup[]>([]);
  const [selectedRouteGroup, setSelectedRouteGroup] = useState<RouteGroup | null>(null);
  const [selectedDirection, setSelectedDirection] = useState<'inbound' | 'outbound' | null>(null);
  const [selectedRoute, setSelectedRoute] = useState<Route | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [departureStop, setDepartureStop] = useState<Stop | null>(null);
  const [arrivalStop, setArrivalStop] = useState<Stop | null>(null);
  const [schedule, setSchedule] = useState<ScheduleItem[]>([]);
  const [schedulesWithArrival, setSchedulesWithArrival] = useState<TripWithArrival[]>([]);
  const [nextSchedule, setNextSchedule] = useState<ScheduleItem | TripWithArrival | null>(null);
  const [loadingSchedule, setLoadingSchedule] = useState<boolean>(false);
  const [showArrivalTime, setShowArrivalTime] = useState<boolean>(false);
  const [showMap, setShowMap] = useState<boolean>(false);
  const [showNearbyMap, setShowNearbyMap] = useState<boolean>(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [favorites, setFavorites] = useState<Favorite[]>([]);

  const flatListRef = useRef<FlatList>(null);
  const dbService = DatabaseService;

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
    if (!selectedRouteGroup || !selectedDirection || !departureStop || !arrivalStop) {
      Alert.alert('Cannot Save', 'Please select a route, direction, departure and arrival stops first.');
      return;
    }
    if (favorites.length >= 4) {
      Alert.alert('Limit Reached', 'You can only save up to 4 favorites. Delete one first.');
      return;
    }
    const newFavorite: Favorite = {
      id: Date.now().toString(),
      routeShortName: selectedRouteGroup.routeNumber,
      variant: selectedRouteGroup.variant,
      isBus: selectedRouteGroup.isBus,
      direction: selectedDirection,
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
      rg => rg.routeNumber === fav.routeShortName && rg.variant === fav.variant
    );
    if (!routeGroup) {
      Alert.alert('Route Not Found', `Route ${fav.routeShortName} (${fav.variant}) is not available.`);
      return;
    }
    // Explicitly set the selected route group before loading direction
    setSelectedRouteGroup(routeGroup);
    const unionNameLower = 'union';
    const isDepartureNonUnion = !fav.departureStop.stop_name.toLowerCase().includes(unionNameLower);
    const selectedStop = isDepartureNonUnion ? fav.departureStop : fav.arrivalStop;
    await handleDirectionSelect(fav.direction, routeGroup, selectedStop);
  };

  // ========== Core Functions ==========
  const handleRouteGroupSelect = (routeGroup: RouteGroup): void => {
    setSelectedRouteGroup(routeGroup);
    setSelectedDirection(null);
    setSelectedRoute(null);
    setDepartureStop(null);
    setArrivalStop(null);
    setSchedule([]);
    setSchedulesWithArrival([]);
    setNextSchedule(null);
    setShowArrivalTime(false);
    setShowMap(false);
    setStops([]);
  };

  const findUnionStation = (stopsList: Stop[]): Stop | null =>
    stopsList.find(stop =>
      stop.stop_name.toLowerCase().includes('union station') ||
      stop.stop_name.toLowerCase().includes('union go') ||
      stop.stop_name.toLowerCase() === 'union'
    ) || null;

  const getDirectionFilter = (direction: 'inbound' | 'outbound', isBus: boolean): number =>
    isBus ? (direction === 'inbound' ? 0 : 1) : (direction === 'inbound' ? 1 : 0);

  const handleDirectionSelect = async (
    direction: 'inbound' | 'outbound',
    routeGroup?: RouteGroup,
    selectedStop?: Stop
  ): Promise<void> => {
    const effectiveRouteGroup = routeGroup || selectedRouteGroup;
    if (!effectiveRouteGroup) return;

    setSelectedDirection(direction);
    setSelectedRoute(null);
    setSchedule([]);
    setSchedulesWithArrival([]);
    setNextSchedule(null);
    setShowArrivalTime(false);
    setShowMap(false);
    setStops([]);
    setDepartureStop(null);
    setArrivalStop(null);

    try {
      const serviceId = formatDate(selectedDate).replace(/-/g, '');
      const routeNumberMatch = effectiveRouteGroup.routeNumber.match(/^(\d+)([A-Z]*)$/);
      const baseRouteNumber = routeNumberMatch ? routeNumberMatch[1] : effectiveRouteGroup.routeNumber;
      const directionId = getDirectionFilter(direction, effectiveRouteGroup.isBus);

      let routeQuery: string;
      let queryParams: (string | number)[];
      if (effectiveRouteGroup.isBus) {
        routeQuery = `
          SELECT DISTINCT r.route_id, r.route_short_name, r.route_long_name, t.route_variant
          FROM routes r
          INNER JOIN trips t ON r.route_id = t.route_id
          WHERE r.route_short_name = ? AND t.route_variant = ? AND t.service_id = ? AND t.direction_id = ?
          ORDER BY r.route_id DESC
        `;
        queryParams = [baseRouteNumber, effectiveRouteGroup.routeNumber, serviceId, directionId];
      } else {
        routeQuery = `
          SELECT DISTINCT r.route_id, r.route_short_name, r.route_long_name
          FROM routes r
          INNER JOIN trips t ON r.route_id = t.route_id
          WHERE r.route_short_name = ? AND t.service_id = ? AND t.direction_id = ?
          ORDER BY r.route_id DESC
        `;
        queryParams = [baseRouteNumber, serviceId, directionId];
      }

      const availableRoutes = await dbService.executeCustomQuery<any>(routeQuery, queryParams);
      if (availableRoutes.length === 0) {
        Alert.alert('No Service', `No ${direction} service for ${effectiveRouteGroup.routeNumber} on ${selectedDate.toDateString()}`);
        setSelectedDirection(null);
        return;
      }

      let selectedRouteData = null;
      if (effectiveRouteGroup.isBus) {
        for (const route of availableRoutes) {
          if (dbService.isRouteValidForDate(route.route_id, selectedDate)) {
            selectedRouteData = route;
            break;
          }
        }
      } else {
        selectedRouteData = availableRoutes[0];
      }

      if (!selectedRouteData) {
        Alert.alert('No Valid Route', `No valid route found for ${effectiveRouteGroup.routeNumber} on ${formatDate(selectedDate)}`);
        return;
      }

      const selectedRouteObj: Route = {
        route_id: selectedRouteData.route_id,
        route_short_name: selectedRouteData.route_short_name,
        route_long_name: selectedRouteData.route_long_name,
        direction_id: directionId,
        variant: effectiveRouteGroup.isBus ? effectiveRouteGroup.variant : undefined,
        isBus: effectiveRouteGroup.isBus
      };
      setSelectedRoute(selectedRouteObj);

      const variantParam = effectiveRouteGroup.isBus ? effectiveRouteGroup.variant : '';
      const stopsList = await dbService.getStopsByRoute(
        selectedRouteData.route_id,
        variantParam,
        selectedDate
      );
      const typedStops: Stop[] = stopsList.map((stop: any) => ({
        stop_id: stop.stop_id,
        stop_name: stop.stop_name,
      }));
      setStops(typedStops);

      const unionStop = findUnionStation(typedStops);

      if (direction === 'inbound') {
        setArrivalStop(unionStop);
        if (selectedStop) {
          const found = typedStops.find(s => s.stop_id === selectedStop.stop_id);
          setDepartureStop(found || null);
          if (!found) console.warn(`Selected stop ${selectedStop.stop_name} not found in stops list`);
        } else {
          setDepartureStop(null);
        }
      } else {
        setDepartureStop(unionStop);
        if (selectedStop) {
          const found = typedStops.find(s => s.stop_id === selectedStop.stop_id);
          setArrivalStop(found || null);
          if (!found) console.warn(`Selected stop ${selectedStop.stop_name} not found in stops list`);
        } else {
          setArrivalStop(null);
        }
      }
    } catch (error) {
      console.error('Failed to load stops:', error);
      Alert.alert('Error', 'Failed to load stops. Please try again.');
    }
  };

  const handleMapStopSelect = (stop: any, type: 'departure' | 'arrival') => {
    if (type === 'departure') {
      setDepartureStop(stop ? { stop_id: stop.stop_id, stop_name: stop.stop_name } : null);
    } else {
      setArrivalStop(stop ? { stop_id: stop.stop_id, stop_name: stop.stop_name } : null);
    }
  };

  const handleNearbyRouteSelect = (route: {
    routeId: string;
    routeShortName: string;
    variant?: string;
    direction?: 'inbound' | 'outbound';
    stopId?: string;
    stopName?: string;
  }) => {
    const routeGroup = routeGroups.find(rg => rg.routeNumber === route.routeShortName);
    if (!routeGroup) {
      Alert.alert('Route Not Found', `Could not find route ${route.routeShortName}`);
      return;
    }
    setSelectedRouteGroup(routeGroup);
    setSelectedDirection(route.direction || null);
    const selectedStop = route.stopId ? { stop_id: route.stopId, stop_name: route.stopName || '' } : undefined;
    handleDirectionSelect(route.direction!, routeGroup, selectedStop);
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (selectedDate) {
      setSelectedDate(selectedDate);
      setSelectedDirection(null);
      setSelectedRoute(null);
      setDepartureStop(null);
      setArrivalStop(null);
      setSchedule([]);
      setSchedulesWithArrival([]);
      setNextSchedule(null);
      setStops([]);
    }
  };

  const loadRecentSchedule = async (): Promise<void> => {
    if (!selectedRoute || !departureStop) return;
    setLoadingSchedule(true);
    try {
      const queryDate = selectedDate;
      const today = new Date();
      const isToday = queryDate.toDateString() === today.toDateString();
      const serviceId = formatDate(queryDate).replace(/-/g, '');

      let tripsQuery = `
        SELECT trip_id, route_variant, direction_id
        FROM trips 
        WHERE route_id = ? AND service_id = ? AND direction_id = ?
      `;
      const queryParams: (string | number)[] = [
        selectedRoute.route_id, serviceId, selectedRoute.direction_id ?? 0
      ];
      if (selectedRoute.variant && selectedRoute.variant !== selectedRoute.route_short_name && selectedRouteGroup?.isBus) {
        tripsQuery += ` AND route_variant = ?`;
        queryParams.push(selectedRoute.variant);
      }

      let trips = await dbService.executeCustomQuery<any>(tripsQuery, queryParams);

      if (!selectedRoute.isBus && trips.length > 0) {
        trips = trips.filter(trip => getDirectionFromTripId(trip.trip_id) === selectedDirection);
      }

      if (trips.length === 0) {
        setLoadingSchedule(false);
        Alert.alert('No Schedule', `No ${selectedDirection} trips found for this date`);
        return;
      }

      const tripIds = [...new Set(trips.map(t => t.trip_id).filter(id => id && id !== ''))];

      if (arrivalStop) {
        setShowArrivalTime(true);
        const stopTimesMap = await dbService.getStopTimesForTripsBatchTwoStops(
          tripIds, departureStop.stop_id, arrivalStop.stop_id
        );
        const allSchedules: TripWithArrival[] = [];
        for (const [tripId, stops] of stopTimesMap.entries()) {
          if (!stops.departure || !stops.arrival) continue;
          let departureTime: number, arrivalTime: number;
          if (stops.departure.stop_sequence < stops.arrival.stop_sequence) {
            departureTime = stops.departure.departure_time;
            arrivalTime = stops.arrival.arrival_time;
          } else {
            departureTime = stops.arrival.departure_time;
            arrivalTime = stops.departure.arrival_time;
          }
          if (!departureTime || !arrivalTime) continue;
          const travelMinutes = Math.round((arrivalTime - departureTime) / 60);
          if (travelMinutes <= 0) continue;
          allSchedules.push({
            trip_id: tripId,
            departure_time: departureTime,
            arrival_time: arrivalTime,
            destination: selectedRoute.route_short_name,
            departure_stop: departureStop.stop_id,
            arrival_stop: arrivalStop.stop_id,
            travel_time_minutes: travelMinutes
          });
        }
        allSchedules.sort((a, b) => a.departure_time - b.departure_time);
        const currentSeconds = queryDate.getHours() * 3600 + queryDate.getMinutes() * 60 + queryDate.getSeconds();
        const finalSchedules = isToday ? allSchedules.filter(r => r.departure_time >= currentSeconds) : allSchedules;
        setSchedulesWithArrival(finalSchedules);
        setNextSchedule(finalSchedules.length > 0 ? finalSchedules[0] : null);
      } else {
        setShowArrivalTime(false);
        const stopTimesMap = await dbService.getStopTimesForTripsBatch(tripIds, departureStop.stop_id);
        const allSchedules: ScheduleItem[] = [];
        for (const [tripId, stopTime] of stopTimesMap.entries()) {
          if (!stopTime || !stopTime.departure_time) continue;
          allSchedules.push({
            trip_id: tripId,
            departure_time: stopTime.departure_time,
            destination: selectedRoute.route_short_name,
            stop_sequence: stopTime.stop_sequence || 0
          });
        }
        allSchedules.sort((a, b) => a.departure_time - b.departure_time);
        const currentSeconds = queryDate.getHours() * 3600 + queryDate.getMinutes() * 60 + queryDate.getSeconds();
        const finalSchedules = isToday ? allSchedules.filter(r => r.departure_time >= currentSeconds) : allSchedules;
        setSchedule(finalSchedules);
        setNextSchedule(finalSchedules.length > 0 ? finalSchedules[0] : null);
      }
    } catch (error) {
      console.error('Failed to load schedule:', error);
      Alert.alert('Error', 'Failed to load schedule. Please try again.');
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
      const busVariants = await dbService.executeCustomQuery<any>(`
        SELECT DISTINCT 
          r.route_short_name,
          r.route_long_name,
          t.route_variant
        FROM routes r
        INNER JOIN trips t ON r.route_id = t.route_id
        WHERE t.route_variant IS NOT NULL 
          AND t.route_variant != ''
          AND (t.route_variant != r.route_short_name OR r.route_short_name = t.route_variant)
        ORDER BY t.route_variant
      `);

      const groups: { [key: string]: RouteGroup } = {};
      busVariants.forEach((item: any) => {
        const variant = item.route_variant;
        if (!groups[variant]) {
          groups[variant] = {
            routeNumber: variant,
            routeLongName: item.route_long_name,
            isBus: true,
            variant: variant
          };
        }
      });

      const busRouteNumbers = new Set(Object.keys(groups));
      const trainRoutes = await dbService.executeCustomQuery<any>(`
        SELECT DISTINCT 
          r.route_short_name,
          r.route_long_name
        FROM routes r
        WHERE r.route_short_name NOT IN (
          SELECT DISTINCT t.route_variant 
          FROM trips t 
          WHERE t.route_variant IS NOT NULL 
            AND t.route_variant != ''
        )
        AND r.route_short_name IS NOT NULL
        AND r.route_short_name != ''
        AND r.route_short_name NOT IN (${Array.from(busRouteNumbers).map(() => '?').join(',')})
        ORDER BY r.route_short_name
      `, Array.from(busRouteNumbers));

      trainRoutes.forEach((route: any) => {
        const routeNumber = route.route_short_name;
        if (!groups[routeNumber]) {
          groups[routeNumber] = {
            routeNumber: routeNumber,
            routeLongName: route.route_long_name,
            isBus: false,
            variant: routeNumber
          };
        }
      });

      const groupedRoutes = Object.values(groups);
      groupedRoutes.sort((a, b) => {
        if (a.isBus !== b.isBus) return a.isBus ? -1 : 1;
        if (a.isBus) {
          const aMatch = a.routeNumber.match(/(\d+)([A-Z]*)/);
          const bMatch = b.routeNumber.match(/(\d+)([A-Z]*)/);
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
          return a.routeNumber.localeCompare(b.routeNumber);
        }
        return a.routeNumber.localeCompare(b.routeNumber);
      });

      setRouteGroups(groupedRoutes);
    } catch (error) {
      console.error('Failed to load routes:', error);
      Alert.alert('Error', 'Failed to load transit data');
    } finally {
      setLoading(false);
    }
  };

  // Initial database initialization
  useEffect(() => {
    const init = async () => {
      try {
        const ok = await dbService.initializeDatabase();
        await new Promise(res => setTimeout(res, 100));
        if (!ok) throw new Error('Database failed to initialize');
        await loadRoutesWithDirections();
      } catch (e) {
        console.error('INIT FAILED:', e);
        Alert.alert('Database Error', 'Failed to load database');
      }
    };
    init();
  }, []);

  useEffect(() => {
    if (selectedRoute && departureStop) loadRecentSchedule();
  }, [selectedRoute, departureStop, arrivalStop, selectedDate]);

  // ========== UI Helpers ==========
  const getFormattedRouteLabel = (routeGroup: RouteGroup): string => {
    const routeType = routeGroup.isBus ? '🚌 Bus' : '🚆 Train';
    return `${routeGroup.routeNumber} - ${routeGroup.routeLongName.substring(0, 40)} (${routeType})`;
  };

  const routeItems = routeGroups.map(rg => ({ label: getFormattedRouteLabel(rg), value: rg.routeNumber }));
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

    // Header
    sections.push({
      key: 'header',
      component: (
        <View style={styles.header}>
          <Text style={styles.title}>GO Transit Schedules</Text>
        </View>
      ),
    });

    // Favorites section (always visible)
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
            <ScrollView horizontal showsHorizontalScrollIndicator={false} style={styles.favoritesScroll}>
              {favorites.map(fav => (
                <View key={fav.id} style={styles.favoriteCard}>
                  <TouchableOpacity style={styles.favoriteContent} onPress={() => loadFavorite(fav)}>
                    <Text style={styles.favoriteRoute}>{fav.routeShortName}</Text>
                    <Text style={styles.favoriteStops} numberOfLines={1}>
                      {fav.direction === 'inbound'
                        ? `${fav.departureStop.stop_name} → Union`
                        : `Union → ${fav.arrivalStop.stop_name}`}
                    </Text>
                  </TouchableOpacity>
                  <TouchableOpacity style={styles.deleteFavorite} onPress={() => deleteFavorite(fav.id)}>
                    <Text style={styles.deleteFavoriteText}>✕</Text>
                  </TouchableOpacity>
                </View>
              ))}
            </ScrollView>
          ) : (
            <Text style={styles.emptyFavoritesText}>No favorites saved yet. Save one below.</Text>
          )}
        </View>
      ),
    });

    // Route selection
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
            key={selectedRouteGroup?.routeNumber || 'no-route'}
            items={routeItems}
            placeholder="Search GO line..."
            onValueChange={(value: string) => {
              const selected = routeGroups.find(rg => rg.routeNumber === value);
              if (selected) handleRouteGroupSelect(selected);
            }}
            value={selectedRouteGroup?.routeNumber}
          />
        </View>
      ),
    });

    // Direction toggle
    if (selectedRouteGroup) {
      sections.push({
        key: 'directionToggle',
        component: (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Direction</Text>
            <View style={styles.toggleContainer}>
              <TouchableOpacity
                style={[styles.toggleButton, selectedDirection === 'inbound' && styles.toggleButtonActive]}
                onPress={() => handleDirectionSelect('inbound')}
              >
                <Text style={[styles.toggleButtonText, selectedDirection === 'inbound' && styles.toggleButtonTextActive]}>⬇️ To Union</Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggleButton, selectedDirection === 'outbound' && styles.toggleButtonActive]}
                onPress={() => handleDirectionSelect('outbound')}
              >
                <Text style={[styles.toggleButtonText, selectedDirection === 'outbound' && styles.toggleButtonTextActive]}>⬆️ Leave Union</Text>
              </TouchableOpacity>
            </View>
          </View>
        ),
      });
    }

    // Map toggle
    if (selectedRoute && selectedDirection) {
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
                routeShortName={selectedRoute.route_short_name}
                variant={selectedRoute.variant}
                selectedDate={selectedDate}
                direction={selectedDirection}
                visible={showMap}
                onClose={() => setShowMap(false)}
                onSelectStop={handleMapStopSelect}
              />
            )}
          </View>
        ),
      });
    }

    // Departure / Arrival stops
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

    // Save as Favorite button
    if (selectedRouteGroup && selectedDirection && departureStop && arrivalStop && favorites.length < 4) {
      const alreadySaved = favorites.some(
        fav => fav.routeShortName === selectedRouteGroup.routeNumber &&
               fav.direction === selectedDirection &&
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

    // Loading indicator
    if (loadingSchedule) {
      sections.push({
        key: 'loading',
        component: (
          <View style={styles.loaderContainer}>
            <ActivityIndicator size="large" color="#00A1E0" />
            <Text style={styles.loadingText}>Loading schedule...</Text>
          </View>
        ),
      });
    }

    // Next schedule card
    if (nextSchedule && !loadingSchedule) {
      sections.push({
        key: 'nextSchedule',
        component: (
          <View style={styles.nextScheduleCard}>
            {showArrivalTime ? (
              <>
                <View style={styles.nextScheduleTimeContainer}>
                  <View style={styles.nextTimeColumn}>
                    <Text style={styles.nextTimeLabel}>Depart</Text>
                    <Text style={styles.nextScheduleTime}>{secondsToTimeString((nextSchedule as TripWithArrival).departure_time)}</Text>
                  </View>
                  <Text style={styles.nextArrowSymbol}>→</Text>
                  <View style={styles.nextTimeColumn}>
                    <Text style={styles.nextTimeLabel}>Arrive</Text>
                    <Text style={styles.nextScheduleTime}>{secondsToTimeString((nextSchedule as TripWithArrival).arrival_time)}</Text>
                  </View>
                </View>
                <Text style={styles.travelTimeInfo}>{(nextSchedule as TripWithArrival).travel_time_minutes} min</Text>
              </>
            ) : (
              <>
                <Text style={styles.nextScheduleTime}>{secondsToTimeString((nextSchedule as ScheduleItem).departure_time)}</Text>
                {isToday && <Text style={styles.nextScheduleWait}>{calculateWaitTime((nextSchedule as ScheduleItem).departure_time)}</Text>}
              </>
            )}
            <Text style={styles.nextScheduleDestination}>→ {nextSchedule.destination || 'Final Stop'}</Text>
          </View>
        ),
      });
    }

    // Full schedule lists
    if (!loadingSchedule && showArrivalTime && schedulesWithArrival.length > 0) {
      sections.push({
        key: 'scheduleWithArrival',
        component: (
          <View style={styles.scheduleSection}>
            {schedulesWithArrival.map((item, idx) => (
              <View key={idx} style={styles.scheduleItem}>
                <View style={styles.timeContainer}>
                  <Text style={styles.scheduleTime}>{secondsToTimeString(item.departure_time)}</Text>
                  <Text style={styles.arrowSymbol}>→</Text>
                  <Text style={styles.arrivalTime}>{secondsToTimeString(item.arrival_time)}</Text>
                </View>
                <Text style={styles.scheduleDestination}>{item.destination}</Text>
              </View>
            ))}
          </View>
        ),
      });
    }

    if (!loadingSchedule && !showArrivalTime && schedule.length > 0) {
      sections.push({
        key: 'schedule',
        component: (
          <View style={styles.scheduleSection}>
            {schedule.map((item, idx) => (
              <View key={idx} style={styles.scheduleItem}>
                <View style={styles.timeContainer}>
                  <Text style={styles.scheduleTime}>{secondsToTimeString(item.departure_time)}</Text>
                  {isToday && <Text style={styles.waitTime}>{calculateWaitTime(item.departure_time)}</Text>}
                </View>
                <Text style={styles.scheduleDestination}>{item.destination || 'Final Stop'}</Text>
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
        <ActivityIndicator size="large" color="#00A1E0" />
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
    </>
  );
}

const styles = StyleSheet.create({
  flatListContent: { paddingBottom: 20 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5', padding: 20 },
  loadingText: { marginTop: 20, fontSize: 16, color: '#666' },
  loaderContainer: { marginTop: 20, alignItems: 'center', padding: 20 },
  header: {
    backgroundColor: '#00A1E0',
    padding: 20,
    alignItems: 'center',
    justifyContent: 'center',
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  favoritesSection: { marginHorizontal: 15, marginTop: 10, marginBottom: 5 },
  favoritesScroll: { flexDirection: 'row', marginTop: 8 },
  favoriteCard: {
    backgroundColor: '#f0f8ff',
    borderRadius: 12,
    padding: 10,
    marginRight: 12,
    minWidth: 160,
    flexDirection: 'row',
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  favoriteContent: { flex: 1 },
  favoriteRoute: { fontSize: 16, fontWeight: 'bold', color: '#00A1E0' },
  favoriteStops: { fontSize: 12, color: '#555', marginTop: 4 },
  deleteFavorite: { marginLeft: 8, padding: 4 },
  deleteFavoriteText: { fontSize: 16, color: '#ff4444', fontWeight: 'bold' },
  nearbyButton: {
    backgroundColor: '#00A1E0',
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
  dateButtonText: { fontSize: 14, color: '#00A1E0', fontWeight: '600' },
  toggleContainer: { flexDirection: 'row', backgroundColor: '#f0f0f0', borderRadius: 30, padding: 4 },
  toggleButton: { flex: 1, paddingVertical: 12, borderRadius: 25, alignItems: 'center', backgroundColor: 'transparent' },
  toggleButtonActive: { backgroundColor: '#00A1E0' },
  toggleButtonText: { fontSize: 14, fontWeight: '600', color: '#666' },
  toggleButtonTextActive: { color: '#fff' },
  mapToggleContainer: { marginHorizontal: 15, marginBottom: 10 },
  mapToggleButton: { backgroundColor: '#f0f0f0', paddingVertical: 10, borderRadius: 25, alignItems: 'center', borderWidth: 1, borderColor: '#ddd' },
  mapToggleButtonActive: { backgroundColor: '#00A1E0', borderColor: '#00A1E0' },
  mapToggleText: { fontSize: 14, fontWeight: '600', color: '#666' },
  mapToggleTextActive: { color: '#fff' },
  saveFavoriteContainer: { marginHorizontal: 15, marginBottom: 10 },
  saveFavoriteButton: { backgroundColor: '#FFC107', paddingVertical: 12, borderRadius: 25, alignItems: 'center' },
  saveFavoriteText: { fontSize: 16, fontWeight: 'bold', color: '#333' },
  nextScheduleCard: { backgroundColor: '#00A1E0', margin: 15, padding: 20, borderRadius: 15, alignItems: 'center', elevation: 4 },
  nextScheduleTime: { color: '#fff', fontSize: 36, fontWeight: 'bold' },
  nextScheduleTimeContainer: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20, marginVertical: 10 },
  nextTimeColumn: { alignItems: 'center' },
  nextTimeLabel: { color: '#fff', fontSize: 12, opacity: 0.8, marginBottom: 5 },
  nextArrowSymbol: { color: '#fff', fontSize: 20, fontWeight: 'bold' },
  nextScheduleWait: { color: '#fff', fontSize: 16, marginTop: 8, opacity: 0.9 },
  nextScheduleDestination: { color: '#fff', fontSize: 14, marginTop: 8, opacity: 0.8 },
  travelTimeInfo: { color: '#fff', fontSize: 14, marginTop: 8, opacity: 0.9 },
  scheduleSection: { backgroundColor: '#fff', margin: 15, padding: 15, borderRadius: 10 },
  scheduleItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  timeContainer: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  scheduleTime: { fontSize: 16, fontWeight: 'bold', color: '#00A1E0' },
  arrowSymbol: { fontSize: 14, color: '#666' },
  arrivalTime: { fontSize: 16, fontWeight: '600', color: '#2E7D32' },
  waitTime: { fontSize: 12, color: '#666' },
  scheduleDestination: { fontSize: 14, color: '#333', textAlign: 'right', flex: 1, marginLeft: 12 },
});