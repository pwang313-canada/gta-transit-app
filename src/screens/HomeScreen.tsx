// src/screens/HomeScreen.tsx
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
import NearbyStationsMap from '../components/NearbyStationsMap';
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
  isBus?: boolean;  // Add this property
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
  
  // Handle times that go beyond 24:00:00 (e.g., 25:30:00 -> 01:30)
  let adjustedSeconds = seconds;
  if (adjustedSeconds >= 86400) { // 24 hours in seconds
    adjustedSeconds = adjustedSeconds - 86400;
  }
  
  const hours = Math.floor(adjustedSeconds / 3600);
  const minutes = Math.floor((adjustedSeconds % 3600) / 60);
  
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

const formatDate = (date: Date): string => {
  return date.toLocaleDateString('en-CA');
};

// Helper function to determine direction from trip_id
// trip_id format: timestamp-route-number
// Example: 20241201-21-0 (even = inbound/To Union), 20241201-21-1 (odd = outbound/From Union)
const getDirectionFromTripId = (tripId: string): 'inbound' | 'outbound' | null => {
  const parts = tripId.split('-');
  if (parts.length >= 3) {
    const lastPart = parts[parts.length - 1];
    const num = parseInt(lastPart);
    if (!isNaN(num)) {
      // Even number = inbound (To Union), Odd number = outbound (From Union)
      return num % 2 === 0 ? 'inbound' : 'outbound';
    }
  }
  return null;
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
  const [showNearbyMap, setShowNearbyMap] = useState<boolean>(false);
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);

  const flatListRef = useRef<FlatList>(null);
  const dbService = DatabaseService;

  useEffect(() => {
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
    const init = async () => {
      try {
        const ok = await dbService.initializeDatabase();

        await new Promise(res => setTimeout(res, 100));

        if (!ok) {
          throw new Error('Database failed to initialize');
        }

        await loadRoutesWithDirections();

      } catch (e) {
        console.error('INIT FAILED:', e);
        Alert.alert('Database Error', 'Failed to load database');
      }
    };

    init();
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
      
      // Get bus variants including those without letters
      const busVariants = await dbService.executeCustomQuery<any>(`
        SELECT DISTINCT 
          r.route_short_name,
          r.route_long_name,
          t.route_variant
        FROM routes r
        INNER JOIN trips t ON r.route_id = t.route_id
        WHERE t.route_variant IS NOT NULL 
          AND t.route_variant != ''
          AND (
            t.route_variant != r.route_short_name
            OR r.route_short_name = t.route_variant
          )
        ORDER BY t.route_variant
      `);

      const groups: { [key: string]: RouteGroup } = {};

      // Process bus variants
      busVariants.forEach((item: any) => {
        const variant = item.route_variant;
        // Don't skip if it matches the base route number - include it as a separate entry
        if (!groups[variant]) {
          groups[variant] = {
            routeNumber: variant,
            routeLongName: item.route_long_name,
            isBus: true,
            variant: variant
          };
        }
      });

      // Get train routes (exclude all bus variants including the base numbers)
      // Create a set of all bus route numbers to exclude
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
        // Custom sort for bus routes like 21, 21B, 21C
        if (a.isBus !== b.isBus) {
          return a.isBus ? -1 : 1;
        }
        if (a.isBus) {
          const aMatch = a.routeNumber.match(/(\d+)([A-Z]*)/);
          const bMatch = b.routeNumber.match(/(\d+)([A-Z]*)/);
          
          if (aMatch && bMatch) {
            const aNum = parseInt(aMatch[1]);
            const bNum = parseInt(bMatch[1]);
            if (aNum !== bNum) {
              return aNum - bNum;
            }
            // For same number, sort base number (no letter) before letter variants
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
      console.log('Loaded routes:', groupedRoutes.map(r => `${r.routeNumber} (${r.isBus ? 'Bus' : 'Train'})`));
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

  // Get direction filter based on route type and user selection
  const getDirectionFilter = (direction: 'inbound' | 'outbound', isBus: boolean): number => {
    if (isBus) {
      // For buses: inbound (To Union) = 0, outbound (From Union) = 1
      return direction === 'inbound' ? 0 : 1;
    } else {
      // For trains: inbound (To Union) = 1, outbound (From Union) = 0
      return direction === 'inbound' ? 1 : 0;
    }
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
      
      // Parse route number correctly
      const routeNumberMatch = selectedRouteGroup.routeNumber.match(/^(\d+)([A-Z]*)$/);
      const baseRouteNumber = routeNumberMatch ? routeNumberMatch[1] : selectedRouteGroup.routeNumber;
      const routeLetter = routeNumberMatch ? routeNumberMatch[2] : '';
      
      // Get the correct direction_id based on route type
      const directionId = getDirectionFilter(direction, selectedRouteGroup.isBus);
      
      let routeQuery: string;
      let queryParams: (string | number)[];
      
      if (selectedRouteGroup.isBus) {
        // For buses, we need to match the exact variant including base numbers
        if (routeLetter === '') {
          // This is a base route like "21" (no letter)
          routeQuery = `
            SELECT DISTINCT r.route_id, r.route_short_name, r.route_long_name, t.route_variant
            FROM routes r
            INNER JOIN trips t ON r.route_id = t.route_id
            WHERE r.route_short_name = ?
              AND t.route_variant = ?
              AND t.service_id = ?
              AND t.direction_id = ?
            ORDER BY r.route_id DESC
          `;
          queryParams = [baseRouteNumber, selectedRouteGroup.routeNumber, serviceId, directionId];
        } else {
          // This is a variant like "21B" or "21C"
          routeQuery = `
            SELECT DISTINCT r.route_id, r.route_short_name, r.route_long_name, t.route_variant
            FROM routes r
            INNER JOIN trips t ON r.route_id = t.route_id
            WHERE r.route_short_name = ?
              AND t.route_variant = ?
              AND t.service_id = ?
              AND t.direction_id = ?
            ORDER BY r.route_id DESC
          `;
          queryParams = [baseRouteNumber, selectedRouteGroup.routeNumber, serviceId, directionId];
        }
      } else {
        // For trains
        routeQuery = `
          SELECT DISTINCT r.route_id, r.route_short_name, r.route_long_name
          FROM routes r
          INNER JOIN trips t ON r.route_id = t.route_id
          WHERE r.route_short_name = ?
            AND t.service_id = ?
            AND t.direction_id = ?
          ORDER BY r.route_id DESC
        `;
        queryParams = [baseRouteNumber, serviceId, directionId];
      }
      
      const availableRoutes = await dbService.executeCustomQuery<any>(routeQuery, queryParams);
      
      if (availableRoutes.length === 0) {
        Alert.alert('No Service', `No ${direction} service for ${selectedRouteGroup.routeNumber} on ${selectedDate.toDateString()}`);
        setSelectedDirection(null);
        return;
      }
      
      let selectedRouteData = null;
      if (selectedRouteGroup.isBus) {
        for (const route of availableRoutes) {
          const isValid = dbService.isRouteValidForDate(route.route_id, selectedDate);
          if (isValid) {
            selectedRouteData = route;
            break;
          }
        }
      } else {
        selectedRouteData = availableRoutes[0];
      }
      
      if (!selectedRouteData) {
        Alert.alert('No Valid Route', `No valid route found for ${selectedRouteGroup.routeNumber} on ${formatDate(selectedDate)}`);
        return;
      }
      
      const selectedRouteObj: Route = {
        route_id: selectedRouteData.route_id,
        route_short_name: selectedRouteData.route_short_name,
        route_long_name: selectedRouteData.route_long_name,
        direction_id: directionId,
        variant: selectedRouteGroup.variant,
        isBus: selectedRouteGroup.isBus  // Add isBus property
      };
      
      setSelectedRoute(selectedRouteObj);
      
      console.log(`=== Direction Selection ===`);
      console.log(`Route: ${selectedRouteObj.route_short_name}`);
      console.log(`Type: ${selectedRouteGroup.isBus ? 'Bus' : 'Train'}`);
      console.log(`Direction: ${direction}`);
      console.log(`Direction ID used in query: ${directionId}`);
      console.log(`Date: ${selectedDate.toDateString()}`);
      console.log(`Service ID: ${serviceId}`);
      
      let variantParam: string = '';
      if (selectedRouteGroup.isBus && selectedRouteGroup.variant) {
        variantParam = selectedRouteGroup.variant;
      }
      
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
        setArrivalStop(unionStop || null);
        setDepartureStop(null);
        console.log(`Inbound: Set arrival stop to Union Station`);
      } else {
        setDepartureStop(unionStop || null);
        setArrivalStop(null);
        console.log(`Outbound: Set departure stop to Union Station`);
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

  const handleNearbyRouteSelect = (route: {
    routeId: string;
    routeShortName: string;
    variant?: string;
    direction?: 'inbound' | 'outbound';
  }) => {
    console.log('Selected route from map:', route);
    
    // Find the route group
    const routeGroup = routeGroups.find(rg => rg.routeNumber === route.routeShortName);
    if (routeGroup) {
      setSelectedRouteGroup(routeGroup);
      setSelectedDirection(route.direction || null);
      
      // Small delay to ensure state updates
      setTimeout(() => {
        if (route.direction) {
          handleDirectionSelect(route.direction);
        }
      }, 100);
    } else {
      Alert.alert('Route Not Found', `Could not find route ${route.routeShortName} in the list`);
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
      
      console.log(`\n=== Loading Schedule ===`);
      console.log(`Selected Date: ${queryDate.toDateString()}`);
      console.log(`Service ID: ${serviceId}`);
      console.log(`Route ID: ${selectedRoute.route_id}`);
      console.log(`Route Type: ${selectedRoute.isBus ? 'Bus' : 'Train'}`);
      console.log(`User selected direction: ${selectedDirection}`);
      console.log(`Direction ID stored: ${selectedRoute.direction_id}`);
      console.log(`Departure Stop: ${departureStop.stop_name} (${departureStop.stop_id})`);
      if (arrivalStop) {
        console.log(`Arrival Stop: ${arrivalStop.stop_name} (${arrivalStop.stop_id})`);
      }
      
      // Query trips with the direction_id
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
      
      console.log(`Query params: route_id=${selectedRoute.route_id}, service_id=${serviceId}, direction_id=${selectedRoute.direction_id}`);
      
      let trips = await dbService.executeCustomQuery<any>(tripsQuery, queryParams);
      
      // For trains, also verify direction from trip_id to ensure correctness
      if (selectedRoute.isBus === false && trips.length > 0) {
        console.log(`Verifying train directions from trip_id...`);
        const verifiedTrips = trips.filter(trip => {
          const tripDirection = getDirectionFromTripId(trip.trip_id);
          console.log(`Trip ${trip.trip_id}: direction from trip_id = ${tripDirection}, expected = ${selectedDirection}`);
          return tripDirection === selectedDirection;
        });
        
        if (verifiedTrips.length > 0) {
          console.log(`After verification: ${verifiedTrips.length} trips match the expected direction`);
          trips = verifiedTrips;
        } else {
          console.log(`Warning: No trips matched the expected direction after verification`);
        }
      }
      
      console.log(`Found ${trips.length} trips for ${selectedDirection} direction`);
      
      if (trips.length === 0) {
        setLoadingSchedule(false);
        Alert.alert('No Schedule', `No ${selectedDirection} trips found for this date`);
        return;
      }
      
      const tripIds = [...new Set(trips.map(t => t.trip_id).filter(id => id && id !== ''))];
      console.log(`Trip IDs (${tripIds.length}):`, tripIds.slice(0, 5));
      
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
              }
              if (stop.stop_id === arrivalStop.stop_id) {
                arrivalStopInfo = stop;
                arrivalSeq = stop.stop_sequence;
              }
            }
            
            if (!departureStopInfo || !arrivalStopInfo) continue;
            
            let departureTime: number;
            let arrivalTime: number;
            
            if (departureSeq < arrivalSeq) {
              departureTime = departureStopInfo.departure_time;
              arrivalTime = arrivalStopInfo.arrival_time;
            } else {
              departureTime = arrivalStopInfo.departure_time;
              arrivalTime = departureStopInfo.arrival_time;
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
          } catch (err) {
            console.error(`Error processing trip ${tripId}:`, err);
          }
        }
        
        allSchedules.sort((a, b) => a.departure_time - b.departure_time);
        
        const currentSeconds = queryDate.getHours() * 3600 + queryDate.getMinutes() * 60 + queryDate.getSeconds();
        
        let finalSchedules = allSchedules;
        if (isToday) {
          finalSchedules = allSchedules.filter(r => r.departure_time >= currentSeconds);
          console.log(`Filtered for today: ${finalSchedules.length} remaining from ${allSchedules.length}`);
        }
        
        console.log(`${selectedDirection} schedules found: ${finalSchedules.length}`);
        if (finalSchedules.length > 0) {
          console.log(`First ${selectedDirection} departure: ${secondsToTimeString(finalSchedules[0].departure_time)}`);
        }
        
        setSchedulesWithArrival(finalSchedules);
        setNextSchedule(finalSchedules.length > 0 ? finalSchedules[0] : null);
      } else {
        setShowArrivalTime(false);
        const allSchedules: ScheduleItem[] = [];
        
        for (const tripId of tripIds) {
          try {
            const stopTime = await dbService.getStopTime(tripId, departureStop.stop_id);
            if (!stopTime || !stopTime.departure_time) continue;
            
            allSchedules.push({
              trip_id: tripId,
              departure_time: stopTime.departure_time,
              destination: selectedRoute.route_short_name,
              stop_sequence: 0
            });
          } catch (err) {
            console.error(`Error processing trip ${tripId}:`, err);
          }
        }
        
        allSchedules.sort((a, b) => a.departure_time - b.departure_time);
        
        const currentSeconds = queryDate.getHours() * 3600 + queryDate.getMinutes() * 60 + queryDate.getSeconds();
        
        let finalSchedules = allSchedules;
        if (isToday) {
          finalSchedules = allSchedules.filter(r => r.departure_time >= currentSeconds);
          console.log(`Filtered for today: ${finalSchedules.length} remaining from ${allSchedules.length}`);
        }
        
        console.log(`${selectedDirection} schedules found: ${finalSchedules.length}`);
        if (finalSchedules.length > 0) {
          console.log(`First ${selectedDirection} departure: ${secondsToTimeString(finalSchedules[0].departure_time)}`);
        }
        
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

  const onRefresh = async (): Promise<void> => {
    setRefreshing(true);
    await loadRoutesWithDirections();
    if (selectedRoute && departureStop) await loadRecentSchedule();
    setRefreshing(false);
  };

  const getFormattedRouteLabel = (routeGroup: RouteGroup): string => {
    const routeType = routeGroup.isBus ? '🚌 Bus' : '🚆 Train';
    let displayNumber = routeGroup.routeNumber;
    
    if (!routeGroup.isBus) {
      displayNumber = routeGroup.routeNumber;
    }
    
    return `${displayNumber} - ${routeGroup.routeLongName.substring(0, 40)} (${routeType})`;
  };

  const routeItems = routeGroups.map((rg: RouteGroup) => ({
    label: getFormattedRouteLabel(rg),
    value: rg.routeNumber,
  }));

  const stopItems = stops.map((s: Stop) => ({ label: s.stop_name, value: s.stop_id }));

  const calculateWaitTime = (departureTime: number): string => {
    if (!departureTime && departureTime !== 0) return 'N/A';
    const now = new Date();
    let currentSeconds = now.getHours() * 3600 + now.getMinutes() * 60 + now.getSeconds();
    
    let adjustedDepartureTime = departureTime;
    if (adjustedDepartureTime >= 86400) {
      adjustedDepartureTime = adjustedDepartureTime - 86400;
    }
    
    let waitSeconds = adjustedDepartureTime - currentSeconds;
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
          <TouchableOpacity 
            style={styles.searchMapButton}
            onPress={() => setShowNearbyMap(true)}
          >
            <Text style={styles.searchMapButtonText}>🗺️ Nearby</Text>
          </TouchableOpacity>
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
        </View>
      ),
    });

    if (selectedRouteGroup) {
      sections.push({
        key: 'directionToggle',
        component: (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Direction</Text>
            <View style={styles.toggleContainer}>
              <TouchableOpacity
                style={[
                  styles.toggleButton, 
                  selectedDirection === 'inbound' && styles.toggleButtonActive
                ]}
                onPress={() => handleDirectionSelect('inbound')}
              >
                <Text style={[
                  styles.toggleButtonText, 
                  selectedDirection === 'inbound' && styles.toggleButtonTextActive
                ]}>
                  ⬇️ To Union
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[
                  styles.toggleButton, 
                  selectedDirection === 'outbound' && styles.toggleButtonActive
                ]}
                onPress={() => handleDirectionSelect('outbound')}
              >
                <Text style={[
                  styles.toggleButtonText, 
                  selectedDirection === 'outbound' && styles.toggleButtonTextActive
                ]}>
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
        key: 'mapControls',
        component: (
          <View style={styles.mapToggleContainer}>
            <TouchableOpacity 
              style={[styles.mapToggleButton, showMap && styles.mapToggleButtonActive]} 
              onPress={() => setShowMap(!showMap)}
            >
              <Text style={[styles.mapToggleText, showMap && styles.mapToggleTextActive]}>
                {showMap ? '📋 Hide Map' : '🗺️ Show Route Map'}
              </Text>
            </TouchableOpacity>
            {showMap && (
              <RouteMapView
                routeId={selectedRoute.route_id}
                routeShortName={selectedRoute.route_short_name}
                variant={selectedRouteGroup?.variant}
                selectedDate={selectedDate}
                direction={selectedDirection || undefined}
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
    flexDirection: 'row',
    justifyContent: 'space-between',
  },
  title: { fontSize: 24, fontWeight: 'bold', color: '#fff' },
  searchMapButton: {
    backgroundColor: 'rgba(255,255,255,0.2)',
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    marginLeft: 10,
  },
  searchMapButtonText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: '600',
  },
  section: { backgroundColor: '#fff', margin: 15, padding: 15, borderRadius: 10, elevation: 2, shadowColor: '#000', shadowOffset: { width: 0, height: 1 }, shadowOpacity: 0.1, shadowRadius: 2 },
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
});