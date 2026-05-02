// src/screens/HomeScreen.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ActivityIndicator,
  Alert,
  RefreshControl,
  FlatList,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import * as SQLite from 'expo-sqlite';
import SearchablePicker from '../components/SearchableRoutePicker';
import DatabaseService from '../services/DatabaseService';
import GoTransitService from '../services/GoTransitService';
import RouteMapView from '../components/RouteMapView';

interface Route {
  route_id: string;
  route_short_name: string;
  route_long_name: string;
  direction_id?: number;
  direction?: string;
  variant?: string;
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
  inbound?: Route;
  outbound?: Route;
  variant?: string;
}

const secondsToTimeString = (seconds: number): string => {
  if (!seconds && seconds !== 0) return '';
  const hours = Math.floor(seconds / 3600);
  const minutes = Math.floor((seconds % 3600) / 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

const formatDate = (date: Date): string => {
  return date.toLocaleDateString('en-CA');
};

export default function HomeScreen() {
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
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);

  const flatListRef = useRef<FlatList>(null);

  useEffect(() => {
    loadRoutesWithDirections();
  }, []);

  useEffect(() => {
    const loadSchedule = async () => {
      if (selectedRoute && departureStop) {
        await loadRecentSchedule();
      }
    };
    loadSchedule();
  }, [selectedRoute, departureStop, arrivalStop, selectedDate]);

  const loadRoutesWithDirections = async (): Promise<void> => {
    try {
      setLoading(true);
      const db = SQLite.openDatabaseSync('go_transit.db');

      const routeList = await db.getAllAsync<any>(`
        SELECT DISTINCT
          r.route_id,
          r.route_short_name,
          r.route_long_name,
          t.direction_id,
          t.route_variant as variant
        FROM routes r
        INNER JOIN trips t ON r.route_id = t.route_id
        WHERE t.direction_id IS NOT NULL
        ORDER BY r.route_short_name, t.route_variant, t.direction_id
      `);

      const groups: { [key: string]: RouteGroup } = {};

      routeList.forEach((route: any) => {
        const isBus = /^\d/.test(route.route_short_name);
        let routeNumber = route.route_short_name;

        if (isBus && route.variant && route.variant !== route.route_short_name) {
          routeNumber = route.variant;
        }

        const groupKey = isBus ? `${route.route_short_name}_${route.variant || ''}` : route.route_short_name;

        if (!groups[groupKey]) {
          groups[groupKey] = {
            routeNumber: routeNumber,
            routeLongName: route.route_long_name,
            isBus: isBus,
            variant: isBus ? route.variant : undefined,
          };
        }

        if (route.direction_id === 0) {
          groups[groupKey].inbound = {
            route_id: route.route_id,
            route_short_name: route.route_short_name,
            route_long_name: route.route_long_name,
            direction_id: route.direction_id,
            variant: route.variant
          };
        } else if (route.direction_id === 1) {
          groups[groupKey].outbound = {
            route_id: route.route_id,
            route_short_name: route.route_short_name,
            route_long_name: route.route_long_name,
            direction_id: route.direction_id,
            variant: route.variant
          };
        }
      });

      const groupedRoutes = Object.values(groups);
      groupedRoutes.sort((a, b) => {
        if (a.isBus !== b.isBus) {
          return a.isBus ? -1 : 1;
        }
        if (a.isBus) {
          const aNum = parseInt(a.routeNumber);
          const bNum = parseInt(b.routeNumber);
          if (!isNaN(aNum) && !isNaN(bNum) && aNum !== bNum) {
            return aNum - bNum;
          }
          return a.routeNumber.localeCompare(b.routeNumber);
        }
        return a.routeNumber.localeCompare(b.routeNumber);
      });

      setRouteGroups(groupedRoutes);
      console.log(`Loaded ${groupedRoutes.length} route groups`);
    } catch (error) {
      console.error('Failed to load routes:', error);
      Alert.alert('Error', 'Failed to load transit data');
    } finally {
      setLoading(false);
    }
  };

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
  };

  const findUnionStation = (stopsList: Stop[]): Stop | null => {
    return stopsList.find(stop => 
      stop.stop_name.toLowerCase().includes('union station') ||
      stop.stop_name.toLowerCase().includes('union go') ||
      stop.stop_name.toLowerCase() === 'union'
    ) || null;
  };

  const handleDirectionSelect = async (direction: 'inbound' | 'outbound'): Promise<void> => {
    if (!selectedRouteGroup) return;

    const route = direction === 'inbound' ? selectedRouteGroup.inbound : selectedRouteGroup.outbound;

    if (!route) {
      Alert.alert('Not Available', `No ${direction} route data available`);
      return;
    }

    setSelectedDirection(direction);
    setSelectedRoute(route);
    setSchedule([]);
    setSchedulesWithArrival([]);
    setNextSchedule(null);
    setShowArrivalTime(false);
    setShowMap(false);

    try {
      const variant = selectedRouteGroup.isBus ? selectedRouteGroup.variant : undefined;
      const stopsList = await DatabaseService.getStopsByRoute(route.route_id, variant);
      const typedStops: Stop[] = stopsList.map((stop: any) => ({
        stop_id: stop.stop_id,
        stop_name: stop.stop_name,
      }));
      setStops(typedStops);
      
      const unionStop = findUnionStation(typedStops);
      
      if (direction === 'inbound') {
        setArrivalStop(unionStop || null);
        setDepartureStop(null);
        if (unionStop) {
          console.log(`Default arrival set to: ${unionStop.stop_name}`);
        }
      } else if (direction === 'outbound') {
        setDepartureStop(unionStop || null);
        setArrivalStop(null);
        if (unionStop) {
          console.log(`Default departure set to: ${unionStop.stop_name}`);
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
    } else if (type === 'arrival') {
      setArrivalStop(stop ? { stop_id: stop.stop_id, stop_name: stop.stop_name } : null);
    }
  };

  const onDateChange = (event: any, selectedDate?: Date) => {
    if (Platform.OS === 'android') {
      setShowDatePicker(false);
    }
    if (selectedDate) {
      setSelectedDate(selectedDate);
      setDepartureStop(null);
      setArrivalStop(null);
      setSchedule([]);
      setSchedulesWithArrival([]);
      setNextSchedule(null);
    }
  };

  const loadRecentSchedule = async (): Promise<void> => {
    if (!selectedRoute || !departureStop) return;

    setLoadingSchedule(true);
    try {
      const queryDate = selectedDate;
      const today = new Date();
      const isToday = queryDate.toDateString() === today.toDateString();
      const variant = selectedRouteGroup?.isBus ? selectedRouteGroup?.variant : undefined;
      const directionId = selectedRoute?.direction_id;

      if (arrivalStop) {
        setShowArrivalTime(true);
        const schedules = await DatabaseService.getScheduleWithArrival(
          selectedRoute.route_id,
          departureStop.stop_id,
          arrivalStop.stop_id,
          queryDate,
          variant,
          directionId
        );
        
        const uniqueSchedules = [];
        const seenTripIds = new Set();
        for (const schedule of schedules) {
          if (!seenTripIds.has(schedule.trip_id)) {
            seenTripIds.add(schedule.trip_id);
            uniqueSchedules.push(schedule);
          }
        }
        
        setSchedulesWithArrival(uniqueSchedules);

        let next = null;
        if (!isToday) {
          next = uniqueSchedules.length > 0 ? uniqueSchedules[0] : null;
        } else {
          next = await DatabaseService.getNextScheduleWithArrival(
            selectedRoute.route_id,
            departureStop.stop_id,
            arrivalStop.stop_id,
            queryDate,
            variant,
            directionId
          );
        }
        setNextSchedule(next);
      } else {
        setShowArrivalTime(false);
        const recentSchedule = await DatabaseService.getRecentSchedule(
          selectedRoute.route_id,
          departureStop.stop_id,
          undefined,
          queryDate,
          variant,
          directionId
        );
        
        const uniqueSchedule = [];
        const seenTripIds = new Set();
        for (const schedule of recentSchedule) {
          if (!seenTripIds.has(schedule.trip_id)) {
            seenTripIds.add(schedule.trip_id);
            uniqueSchedule.push(schedule);
          }
        }
        
        setSchedule(uniqueSchedule);

        let next = null;
        if (!isToday) {
          next = uniqueSchedule.length > 0 ? uniqueSchedule[0] : null;
        } else {
          next = await DatabaseService.getNextSchedule(
            selectedRoute.route_id,
            departureStop.stop_id,
            undefined,
            queryDate,
            variant,
            directionId
          );
        }
        setNextSchedule(next);
      }
    } catch (error) {
      console.error('Failed to load schedule:', error);
      Alert.alert('Error', 'Failed to load schedule');
    } finally {
      setLoadingSchedule(false);
    }
  };

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await loadRoutesWithDirections();
    if (selectedRoute && departureStop) await loadRecentSchedule();
    setRefreshing(false);
  };

  const resetDatabase = async (): Promise<void> => {
    Alert.alert('Reset Database', 'This will delete the current database and load the new one.', [
      { text: 'Cancel', style: 'cancel' },
      {
        text: 'Reset',
        style: 'destructive',
        onPress: async () => {
          try {
            setLoading(true);
            const goTransitService = GoTransitService;
            await goTransitService.resetAndLoadNewDatabase();
            await loadRoutesWithDirections();
            setSelectedRouteGroup(null);
            setSelectedDirection(null);
            setSelectedRoute(null);
            setDepartureStop(null);
            setArrivalStop(null);
            setSchedule([]);
            setSchedulesWithArrival([]);
            setNextSchedule(null);
            setSelectedDate(new Date());
            setShowMap(false);
            Alert.alert('Success', 'Database has been reset with new data');
          } catch (error) {
            console.error('Reset failed:', error);
            Alert.alert('Error', 'Failed to reset database.');
          } finally {
            setLoading(false);
          }
        }
      }
    ]);
  };

  const getFormattedRouteLabel = (routeGroup: RouteGroup): string => {
    const routeType = routeGroup.isBus ? '🚌 Bus' : '🚆 Train';
    return `${routeGroup.routeNumber} - ${routeGroup.routeLongName.substring(0, 40)} (${routeType})`;
  };

  const routeItems = routeGroups.map((rg: RouteGroup) => ({
    label: getFormattedRouteLabel(rg),
    value: rg.routeNumber,
  }));

  const stopItems = stops
    .sort((a, b) => a.stop_name.localeCompare(b.stop_name))
    .map((s: Stop) => ({ label: s.stop_name, value: s.stop_id }));

  const calculateWaitTime = (departureTime: number): string => {
    if (!departureTime && departureTime !== 0) return 'N/A';
    const now = new Date();
    const currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    let waitSeconds = departureTime - currentSeconds;
    if (waitSeconds < 0) waitSeconds += 24 * 3600;
    const waitMinutes = Math.floor(waitSeconds / 60);
    if (waitMinutes < 1) return 'Now';
    if (waitMinutes < 60) return `${waitMinutes} min`;
    const hoursLeft = Math.floor(waitMinutes / 60);
    const minsLeft = waitMinutes % 60;
    return `${hoursLeft}h ${minsLeft}m`;
  };

  const debugAllRoutes = async (): Promise<void> => {
    try {
      const db = SQLite.openDatabaseSync('go_transit.db');
      const routeCount = await db.getAllAsync<any>(`SELECT COUNT(DISTINCT route_id) as count FROM routes`);
      Alert.alert('Database Stats', `Routes: ${routeCount[0]?.count || 0}\nRoute Groups: ${routeGroups.length}`);
    } catch (error) {
      Alert.alert('Error', 'Failed to get database stats');
    }
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
          <Text style={styles.subtitle}>Real-time Departures</Text>
          <View style={styles.headerButtons}>
            <TouchableOpacity onPress={debugAllRoutes} style={styles.debugButton}>
              <Text style={styles.debugButtonText}>📊 Stats</Text>
            </TouchableOpacity>
            <TouchableOpacity onPress={resetDatabase} style={styles.resetButton}>
              <Text style={styles.resetButtonText}>🔄 Reset DB</Text>
            </TouchableOpacity>
          </View>
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
              const selected = routeGroups.find(rg => rg.routeNumber === value);
              if (selected) handleRouteGroupSelect(selected);
            }}
            value={selectedRouteGroup?.routeNumber}
          />
          {selectedRouteGroup && (
            <View style={styles.routeTypeBadge}>
              <Text style={[styles.routeTypeText, selectedRouteGroup.isBus ? styles.busText : styles.trainText]}>
                {selectedRouteGroup.isBus ? '🚌 Bus Service' : '🚆 Train Service'}
              </Text>
            </View>
          )}
        </View>
      ),
    });

    if (selectedRouteGroup && !selectedRoute) {
      sections.push({
        key: 'directionSelection',
        component: (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Direction</Text>
            <View style={styles.toggleContainer}>
              <TouchableOpacity
                style={[styles.toggleButton, selectedDirection === 'inbound' && styles.toggleButtonActive]}
                onPress={() => handleDirectionSelect('inbound')}
              >
                <Text style={[styles.toggleButtonText, selectedDirection === 'inbound' && styles.toggleButtonTextActive]}>
                  ⬇️ To Union
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.toggleButton, selectedDirection === 'outbound' && styles.toggleButtonActive]}
                onPress={() => handleDirectionSelect('outbound')}
              >
                <Text style={[styles.toggleButtonText, selectedDirection === 'outbound' && styles.toggleButtonTextActive]}>
                  ⬆️ Leave Union
                </Text>
              </TouchableOpacity>
            </View>
          </View>
        ),
      });
    }

    if (selectedRoute && selectedDirection) {
      sections.push({
        key: 'routeControls',
        component: (
          <>
            <View style={styles.selectedDirectionIndicator}>
              <Text style={styles.selectedDirectionText}>
                {selectedDirection === 'inbound' ? '⬇️ To Union Station' : '⬆️ Away from Union Station'}
              </Text>
              <TouchableOpacity style={styles.changeDirectionButton} onPress={() => { 
                setSelectedDirection(null); 
                setSelectedRoute(null); 
                setDepartureStop(null); 
                setArrivalStop(null); 
                setStops([]); 
                setShowMap(false); 
              }}>
                <Text style={styles.changeDirectionText}>Change</Text>
              </TouchableOpacity>
            </View>
            <View style={styles.mapToggleContainer}>
              <TouchableOpacity style={[styles.mapToggleButton, showMap && styles.mapToggleButtonActive]} onPress={() => setShowMap(!showMap)}>
                <Text style={[styles.mapToggleText, showMap && styles.mapToggleTextActive]}>
                  {showMap ? '📋 Hide Map' : '🗺️ Show Route Map'}
                </Text>
              </TouchableOpacity>
            </View>
            {showMap && selectedRoute && (
              <RouteMapView
                routeId={selectedRoute.route_id}
                routeShortName={selectedRoute.route_short_name}
                variant={selectedRouteGroup?.variant}
                visible={showMap}
                onClose={() => setShowMap(false)}
                onSelectStop={handleMapStopSelect}
              />
            )}
          </>
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
              onValueChange={(stopId: string) => {
                const stop = stops.find((s) => s.stop_id === stopId);
                setDepartureStop(stop || null);
              }}
              value={departureStop?.stop_id}
            />
            {selectedDirection === 'outbound' && departureStop?.stop_name?.toLowerCase().includes('union') && (
              <Text style={styles.defaultBadge}>✓ Default: Union Station</Text>
            )}
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
              onValueChange={(stopId: string) => {
                const stop = stops.find((s) => s.stop_id === stopId);
                setArrivalStop(stop || null);
              }}
              value={arrivalStop?.stop_id}
            />
            {selectedDirection === 'inbound' && arrivalStop?.stop_name?.toLowerCase().includes('union') && (
              <Text style={styles.defaultBadge}>✓ Default: Union Station</Text>
            )}
          </View>
        ),
      });
    }

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
                    <Text style={styles.nextScheduleTime}>
                      {secondsToTimeString((nextSchedule as TripWithArrival).departure_time)}
                    </Text>
                  </View>
                  <Text style={styles.nextArrowSymbol}>→</Text>
                  <View style={styles.nextTimeColumn}>
                    <Text style={styles.nextTimeLabel}>Arrive</Text>
                    <Text style={styles.nextScheduleTime}>
                      {secondsToTimeString((nextSchedule as TripWithArrival).arrival_time)}
                    </Text>
                  </View>
                </View>
                <Text style={styles.travelTimeInfo}>
                  {(nextSchedule as TripWithArrival).travel_time_minutes} min
                </Text>
              </>
            ) : (
              <>
                <Text style={styles.nextScheduleTime}>
                  {secondsToTimeString((nextSchedule as ScheduleItem).departure_time)}
                </Text>
                {isToday && (
                  <Text style={styles.nextScheduleWait}>
                    {calculateWaitTime((nextSchedule as ScheduleItem).departure_time)}
                  </Text>
                )}
              </>
            )}
            <Text style={styles.nextScheduleDestination}>
              → {nextSchedule.destination || 'Final Stop'}
            </Text>
          </View>
        ),
      });
    }

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
    </>
  );
}

const styles = StyleSheet.create({
  flatListContent: { paddingBottom: 20 },
  loadingContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#f5f5f5', padding: 20 },
  loadingText: { marginTop: 20, fontSize: 16, color: '#666' },
  loaderContainer: { marginTop: 20, alignItems: 'center', padding: 20 },
  header: { backgroundColor: '#00A1E0', padding: 20, alignItems: 'center' },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  subtitle: { fontSize: 14, color: '#fff', marginTop: 5 },
  headerButtons: { flexDirection: 'row', marginTop: 10, gap: 8 },
  debugButton: { backgroundColor: 'rgba(255,255,255,0.3)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  debugButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  resetButton: { backgroundColor: 'rgba(255,255,255,0.3)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 20 },
  resetButtonText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  section: { backgroundColor: '#fff', margin: 15, padding: 15, borderRadius: 10, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2 },
  sectionHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 },
  sectionTitle: { fontSize: 16, fontWeight: '600', color: '#333' },
  dateButton: { backgroundColor: '#f0f0f0', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 8 },
  dateButtonText: { fontSize: 14, color: '#00A1E0', fontWeight: '600' },
  routeTypeBadge: { marginTop: 10, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 20, alignSelf: 'flex-start', backgroundColor: '#f5f5f5' },
  routeTypeText: { fontSize: 14, fontWeight: '600' },
  trainText: { color: '#00A1E0' },
  busText: { color: '#FF6B35' },
  toggleContainer: { flexDirection: 'row', backgroundColor: '#f0f0f0', borderRadius: 30, padding: 4 },
  toggleButton: { flex: 1, paddingVertical: 12, borderRadius: 25, alignItems: 'center', backgroundColor: 'transparent' },
  toggleButtonActive: { backgroundColor: '#00A1E0' },
  toggleButtonText: { fontSize: 14, fontWeight: '600', color: '#666' },
  toggleButtonTextActive: { color: '#fff' },
  selectedDirectionIndicator: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#00A1E0', marginHorizontal: 15, marginTop: 5, padding: 12, borderRadius: 8 },
  selectedDirectionText: { color: '#fff', fontSize: 14, fontWeight: '600' },
  changeDirectionButton: { backgroundColor: 'rgba(255,255,255,0.3)', paddingHorizontal: 12, paddingVertical: 6, borderRadius: 6 },
  changeDirectionText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  mapToggleContainer: { marginHorizontal: 15, marginTop: 5, marginBottom: 10 },
  mapToggleButton: { backgroundColor: '#f0f0f0', paddingVertical: 10, paddingHorizontal: 20, borderRadius: 25, alignItems: 'center', borderWidth: 1, borderColor: '#ddd' },
  mapToggleButtonActive: { backgroundColor: '#00A1E0', borderColor: '#00A1E0' },
  mapToggleText: { fontSize: 14, fontWeight: '600', color: '#666' },
  mapToggleTextActive: { color: '#fff' },
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
  defaultBadge: { fontSize: 11, color: '#2E7D32', marginTop: 8, textAlign: 'center' },
});