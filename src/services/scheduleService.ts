// src/services/scheduleService.ts
import AsyncStorage from '@react-native-async-storage/async-storage';

export interface Trip {
  trip_id: string;
  departure_time: number;
  destination: string;
  stop_sequence?: number;
}

export interface TripWithArrival extends Trip {
  arrival_time?: number;
  arrival_stop_sequence?: number;
  travel_time_minutes?: number;
}

interface ApiStop {
  Code: string;
  Order: number;
  Time: string;
  sortingTime: string | null;
  IsMajor: boolean;
}

interface ApiTrip {
  Number: string;
  Display: string;
  Stops: ApiStop[];
}

interface ApiLine {
  Code: string;
  Direction: string;
  Type: string;
  Trip: ApiTrip[];
}

interface ApiResponse {
  Lines: { Line: ApiLine[] };
}

/**
 * Converts a time string (HH:MM:SS) or datetime string (YYYY-MM-DD HH:MM:SS) to seconds since midnight.
 * Handles both formats gracefully.
 */
const timeStringToSeconds = (timeOrDatetimeStr: string): number => {
  if (!timeOrDatetimeStr) return 0;
  let timePart = timeOrDatetimeStr;
  // If it contains a space, assume it's "YYYY-MM-DD HH:MM:SS" and extract the time part
  if (timeOrDatetimeStr.includes(' ')) {
    timePart = timeOrDatetimeStr.split(' ')[1];
  }
  const parts = timePart.split(':');
  if (parts.length < 2) return 0;
  const hours = parseInt(parts[0], 10);
  const minutes = parseInt(parts[1], 10);
  const seconds = parts.length > 2 ? parseInt(parts[2], 10) : 0;
  return (isNaN(hours) ? 0 : hours) * 3600 +
         (isNaN(minutes) ? 0 : minutes) * 60 +
         (isNaN(seconds) ? 0 : seconds);
};

const buildTripId = (dateStr: string, variant: string, tripNumber: string): string => {
  return `${dateStr}_${variant}_${tripNumber}`;
};

const fetchTripsForLineDirectionRaw = async (
  lineCode: string,
  directionCode: string,
  dateStr: string
): Promise<ApiLine | null> => {
  const url = `https://transit-backend-production-34b5.up.railway.app/api/schedule/date-line-direction?date=${dateStr}&line=${encodeURIComponent(lineCode)}&direction=${directionCode}`;
  console.log(`📡 Fetching trips from: ${url}`);

  try {
    const response = await fetch(url);
    if (!response.ok) throw new Error(`HTTP error! status: ${response.status}`);
    const data = (await response.json()) as ApiResponse;
    const lineData = data.Lines?.Line;
    
    // Check if response has data. It could be an array or a single object (common in XML-to-JSON conversions)
    if (!lineData) {
      console.warn(`⚠️ No Lines.Line data in response for ${lineCode} ${directionCode}`);
      return null;
    }

    // If it's an array, return the first item; if it's an object, return it directly
    const line = Array.isArray(lineData) ? lineData[0] : lineData;

    return line;
  } catch (error) {
    console.error('❌ Failed to fetch trips:', error);
    throw error;
  }
};

const getCachedLineData = async (
  lineCode: string,
  directionCode: string,
  dateStr: string,
  forceRefresh = false
): Promise<ApiLine | null> => {
  const cacheKey = `line_${lineCode}_${directionCode}_${dateStr}`;
  if (!forceRefresh) {
    const cached = await AsyncStorage.getItem(cacheKey);
    if (cached) {
      console.log(`📦 Using cached line data for ${lineCode} ${directionCode} ${dateStr}`);
      return JSON.parse(cached) as ApiLine;
    }
  }
  console.log(`🌍 Fetching fresh line data for ${lineCode} ${directionCode} ${dateStr}`);
  const lineData = await fetchTripsForLineDirectionRaw(lineCode, directionCode, dateStr);
  if (lineData) {
    await AsyncStorage.setItem(cacheKey, JSON.stringify(lineData));
    console.log(`💾 Cached line data for ${lineCode} ${directionCode} ${dateStr}`);
  }
  return lineData;
};

/**
 * Get trips for a specific route, variant, direction, and departure stop.
 * If arrivalStopId is provided, also returns arrival time and travel time.
 */
export const getTripsForStop = async (
  routeShortName: string,
  variantCode: string,
  directionCode: string,
  departureStopId: string,
  date: Date,
  arrivalStopId?: string
): Promise<TripWithArrival[]> => {
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  console.log(`🔍 getTripsForStop: variant=${variantCode}, dir=${directionCode}, depStop=${departureStopId}, arrStop=${arrivalStopId}, date=${dateStr}`);

  try {
    // Use variantCode as the line identifier (matches your backend)
    const lineData = await getCachedLineData(variantCode, directionCode, dateStr);
    console.log(`📊 Line data for ${variantCode} ${directionCode} has ${lineData} trips`);
    if (!lineData || !lineData.Trip) {
      console.log(`⚠️ No trips found for ${variantCode} ${directionCode} on ${dateStr}`);
      return [];
    }

    const trips: TripWithArrival[] = [];

    for (const apiTrip of lineData.Trip) {
      const departureStop = apiTrip.Stops.find(s => s.Code === departureStopId);
      if (!departureStop) continue;

      const departureSeconds = timeStringToSeconds(departureStop.Time);
      // Skip trips with invalid departure time
      if (departureSeconds === 0 && departureStop.Time !== '00:00:00') {
        console.warn(`⚠️ Invalid departure time for trip ${apiTrip.Number}: ${departureStop.Time}`);
        continue;
      }

      const tripId = buildTripId(dateStr, variantCode, apiTrip.Number);

      let arrivalSeconds: number | undefined;
      let arrivalSequence: number | undefined;
      let travelMinutes: number | undefined;

      if (arrivalStopId) {
        const arrivalStop = apiTrip.Stops.find(s => s.Code === arrivalStopId);
        if (arrivalStop && arrivalStop.Order > departureStop.Order) {
          arrivalSeconds = timeStringToSeconds(arrivalStop.Time);
          arrivalSequence = arrivalStop.Order;
          const diffSeconds = arrivalSeconds - departureSeconds;
          travelMinutes = diffSeconds > 0 ? Math.round(diffSeconds / 60) : 0;
        } else {
          // Arrival stop not found or earlier than departure → skip this trip
          continue;
        }
      }

      trips.push({
        trip_id: tripId,
        departure_time: departureSeconds,
        destination: apiTrip.Display || 'Final Stop',
        stop_sequence: departureStop.Order,
        arrival_time: arrivalSeconds,
        arrival_stop_sequence: arrivalSequence,
        travel_time_minutes: travelMinutes,
      });
    }

    trips.sort((a, b) => a.departure_time - b.departure_time);
    console.log(`✅ Found ${trips.length} trips for stop ${departureStopId}${arrivalStopId ? ` (with arrival ${arrivalStopId})` : ''}`);
    return trips;
  } catch (error) {
    console.error('Failed to get trips for stop:', error);
    return [];
  }
};

// Legacy functions remain unchanged...
export const fetchSchedule = async (date: string): Promise<any> => {
  console.warn('fetchSchedule is deprecated.');
  return { AllLines: { Line: [] } };
};
export const getScheduleData = async (date: string, forceRefresh = false): Promise<any> => {
  console.warn('getScheduleData is deprecated.');
  return { AllLines: { Line: [] } };
};
export const getTripsForRoute = async (routeCode: string, date: string): Promise<any[]> => {
  console.warn('getTripsForRoute is deprecated.');
  return [];
};

// Add these new functions to scheduleService.ts (after existing imports)

/**
 * Fetch line data for a specific variant, direction, and date.
 * Returns the full ApiLine object or null if not found.
 */
export const getLineData = async (
  variantCode: string,
  directionCode: string,
  date: Date
): Promise<ApiLine | null> => {
  const dateStr = `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  return getCachedLineData(variantCode, directionCode, dateStr);
};

/**
 * Get available directions for a variant on a given date by trying common direction codes.
 * Returns an array of direction codes that have trips.
 */
export const getAvailableDirections = async (
  variantCode: string,
  date: Date
): Promise<string[]> => {
  const possibleDirections = ['E', 'W', 'N', 'S'];
  const available: string[] = [];
  for (const dir of possibleDirections) {
    const lineData = await getLineData(variantCode, dir, date);
    if (lineData && lineData.Trip && lineData.Trip.length > 0) {
      available.push(dir);
    }
  }
  return available;
};

/**
 * Extract unique stops from line data, preserving the order based on stop_sequence.
 * Returns an array of Stop objects with stop_id and stop_name.
 */
export const getStopsFromLineData = (lineData: ApiLine): { stop_id: string; stop_name: string; stop_sequence: number }[] => {
  const stopsMap = new Map<number, { stop_id: string; stop_name: string; stop_sequence: number }>();
  for (const trip of lineData.Trip) {
    for (const stop of trip.Stops) {
      if (!stopsMap.has(stop.Order)) {
        // Use stop.Code as stop_id and stop.Code as stop_name (or add a mapping if needed)
        // Note: The API only provides Code, not a friendly name. You may need to map codes to names.
        // For now, we'll use the Code as both id and name. Later you can enhance with a local mapping.
        stopsMap.set(stop.Order, {
          stop_id: stop.Code,
          stop_name: stop.Code, // TODO: map to real stop names if available
          stop_sequence: stop.Order,
        });
      }
    }
  }

  
  // Sort by stop_sequence and return array
  const stops = Array.from(stopsMap.values());
  stops.sort((a, b) => a.stop_sequence - b.stop_sequence);
  return stops;
};

export const getStopsByRouteFromApi = async (
  variant: string,
  directionCode: string,
  date: Date
): Promise<{ stop_id: string; stop_name: string; stop_sequence: number }[]> => {
  const lineData = await getLineData(variant, directionCode, date);
  if (!lineData) return [];
  const stopsList = getStopsFromLineData(lineData);
  // Name resolution would need access to the stops cache – pass it as a parameter or use a global module.
  return stopsList;
};