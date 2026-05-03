// src/screens/HomeScreen.tsx - Complete version using only DatabaseService
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Platform,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import RouteMapView from '../components/RouteMapView';
import SearchablePicker from '../components/SearchableRoutePicker';
import DatabaseService from '../services/DatabaseService';

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
  variant: string;
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
  const dbService = DatabaseService;

  useEffect(() => {
    // Reset all schedule-related state when route group changes
    setSelectedDirection(null);
    setSelectedRoute(null);
    setDepartureStop(null);
    setArrivalStop(null);
    setSchedule([]);
    setSchedulesWithArrival([]);
    setNextSchedule(null);
    setStops([]);
    setShowMap(false);
  }, [selectedRouteGroup]);

  useEffect(() => {
    loadRoutesWithDirections();
    // Initialize database
    dbService.initializeDatabase();
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
      
      // Get all bus variants (routes that have route_variant different from route_short_name)
      const busVariants = await dbService.executeCustomQuery<any>(`
        SELECT DISTINCT 
          r.route_short_name,
          r.route_long_name,
          t.route_variant
        FROM routes r
        INNER JOIN trips t ON r.route_id = t.route_id
        WHERE t.route_variant IS NOT NULL 
          AND t.route_variant != ''
          AND t.route_variant != r.route_short_name
        ORDER BY t.route_variant
      `);

      const groups: { [key: string]: RouteGroup } = {};

      // Add bus variants
      busVariants.forEach((item: any) => {
        const variant = item.route_variant;
        groups[variant] = {
          routeNumber: variant,
          routeLongName: item.route_long_name,
          isBus: true,
          variant: variant
        };
      });

      // Get all train routes (routes without variants)
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
        ORDER BY r.route_short_name
      `);

      // Add train routes
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
        // Put buses first
        if (a.isBus !== b.isBus) {
          return a.isBus ? -1 : 1;
        }
        // For buses, sort by number then letter
        if (a.isBus) {
          const aMatch = a.routeNumber.match(/(\d+)([A-Z]*)/);
          const bMatch = b.routeNumber.match(/(\d+)([A-Z]*)/);
          
          if (aMatch && bMatch) {
            const aNum = parseInt(aMatch[1]);
            const bNum = parseInt(bMatch[1]);
            if (aNum !== bNum) {
              return aNum - bNum;
            }
            const aLetter = aMatch[2] || '';
            const bLetter = bMatch[2] || '';
            return aLetter.localeCompare(bLetter);
          }
          return a.routeNumber.localeCompare(b.routeNumber);
        }
        // For trains, sort alphabetically
        return a.routeNumber.localeCompare(b.routeNumber);
      });

      setRouteGroups(groupedRoutes);
      console.log(`\n✅ Loaded ${groupedRoutes.length} route groups`);
      console.log('Bus routes:', groupedRoutes.filter(r => r.isBus).map(r => r.routeNumber).join(', '));
      console.log('Train routes:', groupedRoutes.filter(r => !r.isBus).map(r => r.routeNumber).join(', '));
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
    setStops([]);
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

    setSelectedDirection(direction);
    setSelectedRoute(null);
    setSchedule([]);
    setSchedulesWithArrival([]);
    setNextSchedule(null);
    setShowArrivalTime(false);
    setShowMap(false);
    setStops([]);

    try {
      const serviceId = formatDate(selectedDate).replace(/-/g, '');
      
      // For trains, use the route short name directly (e.g., "MI")
      // For buses, get the base number (e.g., "21" from "21B")
      const routeNumber = selectedRouteGroup.isBus 
        ? (selectedRouteGroup.routeNumber.match(/\d+/)?.[0] || selectedRouteGroup.routeNumber)
        : selectedRouteGroup.routeNumber;
      
      console.log(`\n🔍 Looking for routes: ${routeNumber}, service: ${serviceId}, direction: ${direction === 'inbound' ? 1 : 0}`);
      
      // Find routes with matching route_short_name, ordered by route_id DESC (most recent first)
      const routeQuery = `
        SELECT DISTINCT r.route_id, r.route_short_name, r.route_long_name
        FROM routes r
        INNER JOIN trips t ON r.route_id = t.route_id
        WHERE r.route_short_name = ?
          AND t.service_id = ?
          AND t.direction_id = ?
        ORDER BY r.route_id DESC
      `;
      
      const queryParams: (string | number)[] = [routeNumber, serviceId, direction === 'inbound' ? 1 : 0];
      const availableRoutes = await dbService.executeCustomQuery<any>(routeQuery, queryParams);
      
      console.log(`Found ${availableRoutes.length} routes`);
      availableRoutes.forEach(r => console.log(`  - ${r.route_id}`));
      
      if (availableRoutes.length === 0) {
        Alert.alert('No Routes', `No routes available for ${selectedRouteGroup.routeNumber} on ${formatDate(selectedDate)}`);
        return;
      }
      
      // Find which route is valid for this date (for buses with date ranges)
      let selectedRouteData = null;
      if (selectedRouteGroup.isBus) {
        for (const route of availableRoutes) {
          const isValid = dbService.isRouteValidForDate(route.route_id, selectedDate);
          console.log(`  ${route.route_id}: ${isValid ? 'VALID' : 'INVALID'}`);
          if (isValid) {
            selectedRouteData = route;
            break;
          }
        }
      } else {
        // For trains, take the first one (most recent)
        selectedRouteData = availableRoutes[0];
        console.log(`  Selected train route: ${selectedRouteData.route_id}`);
      }
      
      if (!selectedRouteData) {
        Alert.alert('No Valid Route', `No valid route found for ${selectedRouteGroup.routeNumber} on ${formatDate(selectedDate)}`);
        return;
      }
      
      const selectedRouteObj = {
        route_id: selectedRouteData.route_id,
        route_short_name: selectedRouteData.route_short_name,
        route_long_name: selectedRouteData.route_long_name,
        direction_id: direction === 'inbound' ? 1 : 0,
        variant: selectedRouteGroup.variant
      };
      
      setSelectedRoute(selectedRouteObj);
      
      // Load stops for this route
      let variantParam: string = '';
      if (selectedRouteGroup.isBus && selectedRouteGroup.variant) {
        variantParam = selectedRouteGroup.variant;
      }
      console.log(`Loading stops for route: ${selectedRouteData.route_id}, variant: ${variantParam || 'none'}`);
      
      const stopsList = await dbService.getStopsByRoute(
        selectedRouteData.route_id, 
        variantParam,
        selectedDate
      );
      
      console.log(`Found ${stopsList.length} stops`);
      
      const typedStops: Stop[] = stopsList.map((stop: any) => ({
        stop_id: stop.stop_id,
        stop_name: stop.stop_name,
      }));
      setStops(typedStops);
      
      // Find Union Station
      const unionStop = findUnionStation(typedStops);
      
      // For inbound: depart from somewhere, arrive at Union
      // For outbound: depart from Union, arrive somewhere
      if (direction === 'inbound') {
        setArrivalStop(unionStop || null);
        setDepartureStop(null);
        console.log(`Inbound: Arrival set to Union Station (${unionStop?.stop_name || 'not found'})`);
      } else {
        setDepartureStop(unionStop || null);
        setArrivalStop(null);
        console.log(`Outbound: Departure set to Union Station (${unionStop?.stop_name || 'not found'})`);
      }
      
      if (typedStops.length === 0) {
        Alert.alert('No Stops', `No stops found for ${selectedRouteGroup.routeNumber} on this date.`);
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
      
      console.log(`\n${'='.repeat(60)}`);
      console.log(`LOADING SCHEDULE`);
      console.log(`Route ID: ${selectedRoute.route_id}`);
      console.log(`Variant: ${selectedRoute.variant || 'none'}`);
      console.log(`Service ID: ${serviceId}`);
      console.log(`Direction: ${selectedRoute.direction_id === 1 ? 'Inbound' : 'Outbound'}`);
      console.log(`Departure Stop: ${departureStop.stop_id}`);
      console.log(`Arrival Stop: ${arrivalStop?.stop_id || 'none'}`);
      
      // Get trips
      let tripsQuery = `
        SELECT trip_id, route_variant, direction_id
        FROM trips 
        WHERE route_id = ? 
          AND service_id = ?
          AND direction_id = ?
      `;
      
      const queryParams: (string | number)[] = [
        selectedRoute.route_id, 
        serviceId, 
        selectedRoute.direction_id !== undefined ? selectedRoute.direction_id : 0
      ];
      
      if (selectedRoute.variant && selectedRoute.variant !== selectedRoute.route_short_name && selectedRouteGroup?.isBus) {
        tripsQuery += ` AND route_variant = ?`;
        queryParams.push(selectedRoute.variant);
      }
      
      console.log(`\n🔍 SQL QUERY (Find Trips):`);
      console.log(tripsQuery);
      console.log(`Parameters:`, queryParams);
      
      const trips = await dbService.executeCustomQuery<any>(tripsQuery, queryParams);
      console.log(`✅ Found ${trips.length} trips`);
      
      if (trips.length === 0) {
        setLoadingSchedule(false);
        Alert.alert('No Schedule', `No trips found`);
        return;
      }
      
      const tripIds = [...new Set(trips.map(t => t.trip_id).filter(id => id && id !== ''))];
      console.log(`Unique trip IDs: ${tripIds.length}`);
      
      if (arrivalStop) {
        setShowArrivalTime(true);
        const allSchedules: TripWithArrival[] = [];
        
        for (const tripId of tripIds) {
          try {
            const stopTimes = await dbService.getStopTimesForTrip(tripId);
            
            if (stopTimes.length === 0) continue;
            
            let departureStopInfo = null;
            let arrivalStopInfo = null;
            let departureSeq = -1;
            let arrivalSeq = -1;
            
            for (const stop of stopTimes) {
              if (stop.stop_id === departureStop.stop_id) {
                departureStopInfo = stop;
                departureSeq = stop.stop_sequence;
                console.log(`  Departure stop found: ${stop.stop_id} at sequence ${stop.stop_sequence}`);
              }
              if (stop.stop_id === arrivalStop.stop_id) {
                arrivalStopInfo = stop;
                arrivalSeq = stop.stop_sequence;
                console.log(`  Arrival stop found: ${stop.stop_id} at sequence ${stop.stop_sequence}`);
              }
            }
            
            if (!departureStopInfo) {
              console.log(`  ❌ Departure stop ${departureStop.stop_id} not found`);
              continue;
            }
            
            if (!arrivalStopInfo) {
              console.log(`  ❌ Arrival stop ${arrivalStop.stop_id} not found`);
              continue;
            }
            
            let departureTime: number;
            let arrivalTime: number;
            
            if (departureSeq < arrivalSeq) {
              departureTime = departureStopInfo.departure_time;
              arrivalTime = arrivalStopInfo.arrival_time;
              console.log(`  → Departure (seq ${departureSeq}) before Arrival (seq ${arrivalSeq})`);
            } else {
              console.log(`  ⚠️ Warning: Departure (seq ${departureSeq}) after Arrival (seq ${arrivalSeq}) - swapping`);
              departureTime = arrivalStopInfo.departure_time;
              arrivalTime = departureStopInfo.arrival_time;
            }
            
            if (!departureTime || departureTime === 0) {
              console.log(`  ❌ No departure time`);
              continue;
            }
            
            if (!arrivalTime || arrivalTime === 0) {
              console.log(`  ❌ No arrival time`);
              continue;
            }
            
            const travelMinutes = Math.round((arrivalTime - departureTime) / 60);
            
            if (travelMinutes <= 0) {
              console.log(`  ❌ Invalid travel time: ${travelMinutes} minutes`);
              continue;
            }
            
            allSchedules.push({
              trip_id: tripId,
              departure_time: departureTime,
              arrival_time: arrivalTime,
              destination: selectedRoute.route_short_name,
              departure_stop: departureStop.stop_id,
              arrival_stop: arrivalStop.stop_id,
              travel_time_minutes: travelMinutes
            });
            
            console.log(`  ✅ Valid schedule: Depart ${secondsToTimeString(departureTime)} -> Arrive ${secondsToTimeString(arrivalTime)} (${travelMinutes} min)`);
            
          } catch (err) {
            console.error(`Error processing trip ${tripId}:`, err);
          }
        }
        
        console.log(`\n📊 Found ${allSchedules.length} valid schedules out of ${tripIds.length} trips`);
        
        allSchedules.sort((a, b) => a.departure_time - b.departure_time);
        
        const currentSeconds = queryDate.getHours() * 3600 + queryDate.getMinutes() * 60 + queryDate.getSeconds();
        let finalSchedules = allSchedules;
        if (isToday) {
          finalSchedules = allSchedules.filter(r => r.departure_time >= currentSeconds);
          console.log(`⏰ Filtered for today: ${allSchedules.length} -> ${finalSchedules.length}`);
        }
        
        setSchedulesWithArrival(finalSchedules);
        setNextSchedule(finalSchedules.length > 0 ? finalSchedules[0] : null);
        
      } else {
        setShowArrivalTime(false);
        const allSchedules: ScheduleItem[] = [];
        
        for (const tripId of tripIds) {
          try {
            const stopTime = await dbService.getStopTime(tripId, departureStop.stop_id);
            
            if (!stopTime || !stopTime.departure_time) {
              console.log(`  ❌ No departure time for trip ${tripId}`);
              continue;
            }
            
            allSchedules.push({
              trip_id: tripId,
              departure_time: stopTime.departure_time,
              destination: selectedRoute.route_short_name,
              stop_sequence: 0
            });
            
            console.log(`  ✅ Departure time: ${secondsToTimeString(stopTime.departure_time)}`);
            
          } catch (err) {
            console.error(`Error processing trip ${tripId}:`, err);
          }
        }
        
        console.log(`\n📊 Found ${allSchedules.length} departure schedules`);
        
        allSchedules.sort((a, b) => a.departure_time - b.departure_time);
        
        const currentSeconds = queryDate.getHours() * 3600 + queryDate.getMinutes() * 60 + queryDate.getSeconds();
        let finalSchedules = allSchedules;
        if (isToday) {
          finalSchedules = allSchedules.filter(r => r.departure_time >= currentSeconds);
          console.log(`⏰ Filtered for today: ${allSchedules.length} -> ${finalSchedules.length}`);
        }
        
        setSchedule(finalSchedules);
        setNextSchedule(finalSchedules.length > 0 ? finalSchedules[0] : null);
      }
      
      console.log(`${'='.repeat(60)}\n`);
      
    } catch (error) {
      console.error('Failed to load schedule:', error);
      Alert.alert('Error', 'Failed to load schedule. Please try again.');
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

  const getFormattedRouteLabel = (routeGroup: RouteGroup): string => {
    const routeType = routeGroup.isBus ? '🚌 Bus' : '🚆 Train';
    return `${routeGroup.routeNumber} - ${routeGroup.routeLongName.substring(0, 40)} (${routeType})`;
  };

  const routeItems = routeGroups.map((rg: RouteGroup) => ({
    label: getFormattedRouteLabel(rg),
    value: rg.routeNumber,
  }));

  const stopItems = stops.map((s: Stop) => ({ label: s.stop_name, value: s.stop_id }));

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
              <Text style={styles.routeIdText}>
                {selectedRoute.variant || selectedRoute.route_short_name}
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
  routeIdText: { color: '#fff', fontSize: 12, opacity: 0.8 },
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