// src/screens/ScheduleScreen.tsx
import DateTimePicker from '@react-native-community/datetimepicker';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  Platform,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getScheduleData } from '../services/scheduleService'; // only need getScheduleData

// ========== Types ==========
interface Trip {
  trip_id: string;
  departure_time: number;
  destination: string;
  stop_sequence?: number;
}

interface Variant {
  Code: string;
  Display: string;
  Direction: string;
  Trips?: Trip[];
}

interface Line {
  Name: string;
  Code: string;
  IsBus: boolean;
  IsTrain: boolean;
  Variant: Variant[];
}

interface ScheduleResponse {
  Metadata: { TimeStamp: string; ErrorCode: string; ErrorMessage: string };
  AllLines: { Line: Line[] };
}

// ========== Helper ==========
const secondsToTimeString = (seconds: number): string => {
  if (!seconds && seconds !== 0) return '--:--';
  let adj = seconds;
  if (adj >= 86400) adj -= 86400;
  const hours = Math.floor(adj / 3600);
  const minutes = Math.floor((adj % 3600) / 60);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}`;
};

const formatDateForApi = (date: Date): string => {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}${month}${day}`;
};

const formatDateDisplay = (date: Date): string => date.toLocaleDateString('en-CA');

export default function ScheduleScreen() {
  const [selectedDate, setSelectedDate] = useState<Date>(new Date());
  const [showDatePicker, setShowDatePicker] = useState<boolean>(false);
  const [loading, setLoading] = useState<boolean>(true);
  const [refreshing, setRefreshing] = useState<boolean>(false);
  const [scheduleData, setScheduleData] = useState<ScheduleResponse | null>(null);
  const [selectedLine, setSelectedLine] = useState<Line | null>(null);
  const [selectedVariant, setSelectedVariant] = useState<Variant | null>(null);
  const [trips, setTrips] = useState<Trip[]>([]);
  const [error, setError] = useState<string | null>(null);

  const fetchSchedule = async (date: Date, forceRefresh = false) => {
    setLoading(true);
    setError(null);
    try {
      const dateStr = formatDateForApi(date);
      const data = await getScheduleData(dateStr, forceRefresh);
      setScheduleData(data);
      setSelectedLine(null);
      setSelectedVariant(null);
      setTrips([]);
    } catch (err: any) {
      setError(err.message || 'Failed to load schedule');
      console.error(err);
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  };

  const onDateChange = (event: any, date?: Date) => {
    if (Platform.OS === 'android') setShowDatePicker(false);
    if (date) {
      setSelectedDate(date);
      fetchSchedule(date);
    }
  };

  const handleLineSelect = (line: Line) => {
    setSelectedLine(line);
    setSelectedVariant(null);
    setTrips([]);
  };

  // When a variant is selected, extract trips from the already loaded schedule data
  const handleVariantSelect = (variant: Variant) => {
    if (!selectedLine) return;
    setSelectedVariant(variant);
    // Find the variant in the current line to get trips
    const line = scheduleData?.AllLines.Line.find(l => l.Code === selectedLine.Code);
    const foundVariant = line?.Variant.find(v => v.Code === variant.Code);
    setTrips(foundVariant?.Trips || []);
  };

  const onRefresh = () => {
    setRefreshing(true);
    fetchSchedule(selectedDate, true);
  };

  
  useEffect(() => {
    fetchSchedule(selectedDate);
  }, []);

  if (loading && !scheduleData) {
    return (
      <View style={styles.centerContainer}>
        <ActivityIndicator size="large" color="#00A1E0" />
        <Text style={styles.loadingText}>Loading schedule...</Text>
      </View>
    );
  }

  if (error) {
    return (
      <View style={styles.centerContainer}>
        <Text style={styles.errorText}>Error: {error}</Text>
        <TouchableOpacity style={styles.retryButton} onPress={() => fetchSchedule(selectedDate, true)}>
          <Text style={styles.retryButtonText}>Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.dateButton} onPress={() => setShowDatePicker(true)}>
          <Text style={styles.dateButtonText}>📅 {formatDateDisplay(selectedDate)}</Text>
        </TouchableOpacity>
        <TouchableOpacity style={styles.refreshButton} onPress={onRefresh}>
          <Text style={styles.refreshButtonText}>⟳ Refresh</Text>
        </TouchableOpacity>
      </View>

      {showDatePicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onDateChange}
        />
      )}

      <View style={styles.content}>
        {/* Left: Routes list */}
        <View style={styles.linesContainer}>
          <Text style={styles.sectionTitle}>Routes</Text>
          <FlatList
            data={scheduleData?.AllLines.Line || []}
            keyExtractor={(item) => item.Code}
            renderItem={({ item }) => (
              <TouchableOpacity
                style={[styles.lineItem, selectedLine?.Code === item.Code && styles.lineItemActive]}
                onPress={() => handleLineSelect(item)}
              >
                <Text style={[styles.lineCode, selectedLine?.Code === item.Code && styles.lineCodeActive]}>
                  {item.Code}
                </Text>
                <Text style={styles.lineName} numberOfLines={1}>
                  {item.Name}
                </Text>
                <Text style={styles.lineType}>{item.IsBus ? '🚌' : '🚆'}</Text>
              </TouchableOpacity>
            )}
            refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
          />
        </View>

        {/* Right: Variants and trips */}
        <View style={styles.detailsContainer}>
          {selectedLine ? (
            <>
              <Text style={styles.sectionTitle}>
                {selectedLine.Code} - {selectedLine.Name}
              </Text>
              <ScrollView horizontal style={styles.variantsScroll}>
                {selectedLine.Variant.map((variant) => (
                  <TouchableOpacity
                    key={variant.Code}
                    style={[styles.variantChip, selectedVariant?.Code === variant.Code && styles.variantChipActive]}
                    onPress={() => handleVariantSelect(variant)}
                  >
                    <Text style={[styles.variantText, selectedVariant?.Code === variant.Code && styles.variantTextActive]}>
                      {variant.Display} ({variant.Direction})
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>

              {selectedVariant ? (
                <FlatList
                  data={trips}
                  keyExtractor={(item) => item.trip_id}
                  renderItem={({ item }) => (
                    <View style={styles.tripItem}>
                      <Text style={styles.tripTime}>{secondsToTimeString(item.departure_time)}</Text>
                      <Text style={styles.tripDestination}>{item.destination}</Text>
                    </View>
                  )}
                  ListEmptyComponent={<Text style={styles.emptyText}>No trips available for this variant.</Text>}
                  refreshControl={<RefreshControl refreshing={refreshing} onRefresh={onRefresh} />}
                />
              ) : (
                <Text style={styles.promptText}>Select a direction to see departure times.</Text>
              )}
            </>
          ) : (
            <View style={styles.selectPrompt}>
              <Text style={styles.promptText}>Select a route from the left to view schedule.</Text>
            </View>
          )}
        </View>
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#f5f5f5' },
  centerContainer: { flex: 1, justifyContent: 'center', alignItems: 'center', padding: 20 },
  loadingText: { marginTop: 12, fontSize: 16, color: '#666' },
  errorText: { color: 'red', fontSize: 16, textAlign: 'center', marginBottom: 16 },
  retryButton: { backgroundColor: '#00A1E0', paddingHorizontal: 20, paddingVertical: 10, borderRadius: 8 },
  retryButtonText: { color: '#fff', fontWeight: 'bold' },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  dateButton: { backgroundColor: '#f0f0f0', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  dateButtonText: { fontSize: 14, color: '#00A1E0', fontWeight: '600' },
  refreshButton: { backgroundColor: '#00A1E0', paddingHorizontal: 12, paddingVertical: 8, borderRadius: 8 },
  refreshButtonText: { color: '#fff', fontWeight: '600' },
  content: { flex: 1, flexDirection: 'row' },
  linesContainer: { width: '35%', backgroundColor: '#fff', borderRightWidth: 1, borderRightColor: '#e0e0e0', padding: 8 },
  sectionTitle: { fontSize: 16, fontWeight: 'bold', marginBottom: 12, color: '#333', paddingHorizontal: 8 },
  lineItem: { flexDirection: 'row', alignItems: 'center', paddingVertical: 12, paddingHorizontal: 8, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  lineItemActive: { backgroundColor: '#e6f7ff' },
  lineCode: { fontSize: 16, fontWeight: 'bold', width: 50, color: '#00A1E0' },
  lineCodeActive: { color: '#0077b3' },
  lineName: { flex: 1, fontSize: 14, color: '#333', marginLeft: 8 },
  lineType: { fontSize: 16, marginLeft: 8 },
  detailsContainer: { flex: 1, padding: 16 },
  variantsScroll: { flexDirection: 'row', marginBottom: 16 },
  variantChip: { backgroundColor: '#f0f0f0', paddingHorizontal: 16, paddingVertical: 8, borderRadius: 20, marginRight: 10 },
  variantChipActive: { backgroundColor: '#00A1E0' },
  variantText: { fontSize: 14, color: '#333' },
  variantTextActive: { color: '#fff' },
  tripItem: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', paddingVertical: 12, borderBottomWidth: 1, borderBottomColor: '#f0f0f0' },
  tripTime: { fontSize: 16, fontWeight: 'bold', color: '#00A1E0' },
  tripDestination: { fontSize: 14, color: '#555', flex: 1, textAlign: 'right', marginLeft: 16 },
  selectPrompt: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  promptText: { fontSize: 16, color: '#888', textAlign: 'center' },
  emptyText: { textAlign: 'center', color: '#888', marginTop: 20 },
});