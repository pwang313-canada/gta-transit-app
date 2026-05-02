// src/screens/TripPlannerScreen.tsx
import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  SafeAreaView,
  StatusBar,
  ActivityIndicator,
  FlatList,
  ScrollView,
  Platform,
} from 'react-native';
import DateTimePicker from '@react-native-community/datetimepicker';
import { Picker } from '@react-native-picker/picker';
import DatabaseService, { 
  RouteDisplay, 
  Direction, 
  Stop, 
  TripOption 
} from '../services/DatabaseService';

interface TripPlannerScreenProps {
  route: RouteDisplay;
  onBack: () => void;
}

const TripPlannerScreen: React.FC<TripPlannerScreenProps> = ({ route, onBack }) => {
  const [loading, setLoading] = useState(false);
  const [directions, setDirections] = useState<Direction[]>([]);
  const [selectedDirection, setSelectedDirection] = useState<Direction | null>(null);
  const [stops, setStops] = useState<Stop[]>([]);
  const [originStop, setOriginStop] = useState<Stop | null>(null);
  const [destinationStop, setDestinationStop] = useState<Stop | null>(null);
  const [trips, setTrips] = useState<TripOption[]>([]);
  const [selectedDate, setSelectedDate] = useState(() => {
    const now = new Date();
    now.setMinutes(now.getMinutes() + 30); // Default to 30 minutes from now
    return now;
  });
  const [showDatePicker, setShowDatePicker] = useState(false);
  const [showTimePicker, setShowTimePicker] = useState(false);
  const [showResults, setShowResults] = useState(false);

  // Load directions when component mounts
  useEffect(() => {
    loadDirections();
  }, []);

  const loadDirections = async () => {
    setLoading(true);
    try {
      const dirs = await DatabaseService.getRouteDirections(route.route_short_name);
      setDirections(dirs);
      if (dirs.length > 0) {
        setSelectedDirection(dirs[0]);
      }
    } catch (error) {
      console.error('Error loading directions:', error);
    } finally {
      setLoading(false);
    }
  };

  // Load stops when direction changes
  useEffect(() => {
    if (selectedDirection) {
      loadStops();
    }
  }, [selectedDirection]);

  const loadStops = async () => {
    if (!selectedDirection) return;
    
    setLoading(true);
    try {
      const stopsList = await DatabaseService.getStopsByDirection(selectedDirection.route_id);
      setStops(stopsList);
      setOriginStop(null);
      setDestinationStop(null);
      setShowResults(false);
      setTrips([]);
    } catch (error) {
      console.error('Error loading stops:', error);
    } finally {
      setLoading(false);
    }
  };

  const handleFindTrips = async () => {
    if (!selectedDirection || !originStop || !destinationStop) {
      return;
    }
    
    setLoading(true);
    setShowResults(true);
    try {
      const tripsFound = await DatabaseService.findTripsBetweenStops(
        selectedDirection.route_id,
        originStop.stop_id,
        destinationStop.stop_id,
        selectedDate
      );
      setTrips(tripsFound);
    } catch (error) {
      console.error('Error finding trips:', error);
    } finally {
      setLoading(false);
    }
  };

  const onDateChange = async (event: any, date?: Date) => {
    setShowDatePicker(false);
    if (date) {
      const newDate = new Date(date);
      newDate.setHours(selectedDate.getHours());
      newDate.setMinutes(selectedDate.getMinutes());
      setSelectedDate(newDate);
    }
  };

  const onTimeChange = async (event: any, time?: Date) => {
    setShowTimePicker(false);
    if (time) {
      const newDate = new Date(selectedDate);
      newDate.setHours(time.getHours());
      newDate.setMinutes(time.getMinutes());
      setSelectedDate(newDate);
    }
  };

  const formatTime = (time: string) => {
    if (!time) return '--:--';
    return time.substring(0, 5);
  };

  const formatDate = (date: Date) => {
    return date.toLocaleDateString('en-US', {
      weekday: 'long',
      year: 'numeric',
      month: 'long',
      day: 'numeric',
    });
  };

  const formatTimeDisplay = (date: Date) => {
    return date.toLocaleTimeString('en-US', {
      hour: '2-digit',
      minute: '2-digit',
    });
  };

  const getServiceTypeColor = () => {
    return route.service_type === 'Train' ? '#ff6b6b' : '#4ecdc4';
  };

  const renderTripItem = ({ item }: { item: TripOption }) => (
    <View style={styles.tripItem}>
      <View style={styles.tripTimeContainer}>
        <View style={styles.timeBlock}>
          <Text style={styles.timeLabel}>Depart</Text>
          <Text style={styles.timeValue}>{formatTime(item.departure_time)}</Text>
        </View>
        <View style={styles.timeArrow}>
          <Text style={styles.arrowText}>→</Text>
          <Text style={styles.durationText}>{item.duration}</Text>
        </View>
        <View style={styles.timeBlock}>
          <Text style={styles.timeLabel}>Arrive</Text>
          <Text style={styles.timeValue}>{formatTime(item.arrival_time)}</Text>
        </View>
      </View>
      <Text style={styles.tripHeadsign}>{item.trip_headsign}</Text>
    </View>
  );

  return (
    <SafeAreaView style={styles.container}>
      <StatusBar barStyle="dark-content" backgroundColor="#f5f5f5" />
      
      <View style={styles.header}>
        <TouchableOpacity onPress={onBack} style={styles.backButton}>
          <Text style={styles.backButtonText}>← Back</Text>
        </TouchableOpacity>
        <Text style={styles.headerTitle}>Plan Trip</Text>
        <View style={{ width: 50 }} />
      </View>

      <ScrollView style={styles.content} showsVerticalScrollIndicator={false}>
        {/* Route Info */}
        <View style={[styles.routeCard, { borderLeftColor: getServiceTypeColor() }]}>
          <Text style={styles.routeNumber}>{route.route_short_name}</Text>
          <Text style={styles.routeName}>{route.route_long_name}</Text>
          <View style={[styles.serviceBadge, { backgroundColor: getServiceTypeColor() }]}>
            <Text style={styles.serviceBadgeText}>{route.service_type}</Text>
          </View>
        </View>

        {/* Direction Selection */}
        <View style={styles.section}>
          <Text style={styles.sectionTitle}>1. Select Direction</Text>
          <View style={styles.pickerContainer}>
            <Picker
              selectedValue={selectedDirection?.route_id}
              onValueChange={(itemValue) => {
                const direction = directions.find(d => d.route_id === itemValue);
                setSelectedDirection(direction || null);
              }}
              style={styles.picker}
            >
              {directions.map((dir) => (
                <Picker.Item 
                  key={dir.route_id} 
                  label={dir.direction_name} 
                  value={dir.route_id} 
                />
              ))}
            </Picker>
          </View>
        </View>

        {/* Stop Selection */}
        {selectedDirection && stops.length > 0 && (
          <>
            <View style={styles.section}>
              <Text style={styles.sectionTitle}>2. Select Origin Station</Text>
              <View style={styles.pickerContainer}>
                <Picker
                  selectedValue={originStop?.stop_id}
                  onValueChange={(itemValue) => {
                    const stop = stops.find(s => s.stop_id === itemValue);
                    setOriginStop(stop || null);
                    setDestinationStop(null); // Reset destination when origin changes
                    setShowResults(false);
                  }}
                  style={styles.picker}
                >
                  <Picker.Item label="Select origin station..." value={null} />
                  {stops.map((stop) => (
                    <Picker.Item 
                      key={stop.stop_id} 
                      label={stop.stop_name} 
                      value={stop.stop_id} 
                    />
                  ))}
                </Picker>
              </View>
            </View>

            {originStop && (
              <View style={styles.section}>
                <Text style={styles.sectionTitle}>3. Select Destination Station</Text>
                <View style={styles.pickerContainer}>
                  <Picker
                    selectedValue={destinationStop?.stop_id}
                    onValueChange={(itemValue) => {
                      const stop = stops.find(s => s.stop_id === itemValue);
                      setDestinationStop(stop || null);
                      setShowResults(false);
                    }}
                    style={styles.picker}
                  >
                    <Picker.Item label="Select destination station..." value={null} />
                    {stops
                      .filter(stop => stop.stop_id !== originStop?.stop_id)
                      .map((stop) => (
                        <Picker.Item 
                          key={stop.stop_id} 
                          label={stop.stop_name} 
                          value={stop.stop_id} 
                        />
                      ))}
                  </Picker>
                </View>
              </View>
            )}
          </>
        )}

        {/* Date/Time Selection */}
        {originStop && destinationStop && (
          <View style={styles.section}>
            <Text style={styles.sectionTitle}>4. Select Departure Date & Time</Text>
            <View style={styles.dateTimeContainer}>
              <TouchableOpacity 
                style={styles.dateButton}
                onPress={() => setShowDatePicker(true)}
              >
                <Text style={styles.buttonLabel}>📅 Date</Text>
                <Text style={styles.buttonValue}>{formatDate(selectedDate)}</Text>
              </TouchableOpacity>

              <TouchableOpacity 
                style={styles.timeButton}
                onPress={() => setShowTimePicker(true)}
              >
                <Text style={styles.buttonLabel}>⏰ Depart After</Text>
                <Text style={styles.buttonValue}>{formatTimeDisplay(selectedDate)}</Text>
              </TouchableOpacity>
            </View>
          </View>
        )}

        {/* Find Trips Button */}
        {originStop && destinationStop && (
          <TouchableOpacity 
            style={styles.findButton}
            onPress={handleFindTrips}
            activeOpacity={0.8}
          >
            <Text style={styles.findButtonText}>🔍 Find Trips</Text>
          </TouchableOpacity>
        )}

        {/* Results */}
        {showResults && (
          <View style={styles.resultsSection}>
            <Text style={styles.resultsTitle}>
              {trips.length} Trip{trips.length !== 1 ? 's' : ''} Found
            </Text>
            <Text style={styles.routeSummary}>
              {originStop?.stop_name} → {destinationStop?.stop_name}
            </Text>
            
            {loading ? (
              <ActivityIndicator size="large" color="#007AFF" style={styles.loader} />
            ) : trips.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyEmoji}>🚌</Text>
                <Text style={styles.emptyText}>No trips found</Text>
                <Text style={styles.emptySubtext}>
                  Try a different time or date
                </Text>
                {route.route_short_name === 'MI' && selectedDate.getHours() >= 9 && (
                  <Text style={styles.helpfulText}>
                    💡 The MI (Milton) line mainly operates during morning rush hour (until ~8:30 AM)
                  </Text>
                )}
              </View>
            ) : (
              <FlatList
                data={trips}
                renderItem={renderTripItem}
                keyExtractor={(item, index) => `${item.trip_id}-${index}`}
                scrollEnabled={false}
                contentContainerStyle={styles.tripsList}
              />
            )}
          </View>
        )}
      </ScrollView>

      {showDatePicker && (
        <DateTimePicker
          value={selectedDate}
          mode="date"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onDateChange}
          minimumDate={new Date()}
        />
      )}

      {showTimePicker && (
        <DateTimePicker
          value={selectedDate}
          mode="time"
          display={Platform.OS === 'ios' ? 'spinner' : 'default'}
          onChange={onTimeChange}
        />
      )}
    </SafeAreaView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 16,
    backgroundColor: '#fff',
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  backButton: {
    padding: 8,
  },
  backButtonText: {
    fontSize: 16,
    color: '#007AFF',
  },
  headerTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
  },
  content: {
    flex: 1,
  },
  routeCard: {
    backgroundColor: '#fff',
    margin: 16,
    padding: 16,
    borderRadius: 12,
    borderLeftWidth: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  routeNumber: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#333',
  },
  routeName: {
    fontSize: 14,
    color: '#666',
    marginTop: 4,
  },
  serviceBadge: {
    alignSelf: 'flex-start',
    paddingHorizontal: 10,
    paddingVertical: 4,
    borderRadius: 6,
    marginTop: 8,
  },
  serviceBadgeText: {
    color: '#fff',
    fontSize: 12,
    fontWeight: '600',
  },
  section: {
    marginHorizontal: 16,
    marginBottom: 20,
  },
  sectionTitle: {
    fontSize: 16,
    fontWeight: '600',
    color: '#333',
    marginBottom: 8,
  },
  pickerContainer: {
    backgroundColor: '#fff',
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
    overflow: 'hidden',
  },
  picker: {
    height: 50,
  },
  dateTimeContainer: {
    flexDirection: 'row',
    gap: 12,
  },
  dateButton: {
    flex: 2,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  timeButton: {
    flex: 1,
    backgroundColor: '#fff',
    padding: 12,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: '#ddd',
  },
  buttonLabel: {
    fontSize: 12,
    color: '#999',
    marginBottom: 4,
  },
  buttonValue: {
    fontSize: 14,
    fontWeight: '500',
    color: '#333',
  },
  findButton: {
    backgroundColor: '#007AFF',
    marginHorizontal: 16,
    marginTop: 8,
    marginBottom: 20,
    padding: 16,
    borderRadius: 12,
    alignItems: 'center',
  },
  findButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: '600',
  },
  resultsSection: {
    marginHorizontal: 16,
    marginBottom: 30,
  },
  resultsTitle: {
    fontSize: 18,
    fontWeight: '600',
    color: '#333',
    marginBottom: 4,
  },
  routeSummary: {
    fontSize: 14,
    color: '#666',
    marginBottom: 16,
  },
  tripsList: {
    gap: 8,
  },
  tripItem: {
    backgroundColor: '#fff',
    padding: 16,
    borderRadius: 10,
    borderWidth: 1,
    borderColor: '#eee',
  },
  tripTimeContainer: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    marginBottom: 8,
  },
  timeBlock: {
    alignItems: 'center',
  },
  timeLabel: {
    fontSize: 11,
    color: '#999',
    marginBottom: 2,
  },
  timeValue: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  timeArrow: {
    alignItems: 'center',
    flex: 1,
  },
  arrowText: {
    fontSize: 20,
    color: '#007AFF',
  },
  durationText: {
    fontSize: 12,
    color: '#666',
    marginTop: 2,
  },
  tripHeadsign: {
    fontSize: 13,
    color: '#666',
    textAlign: 'center',
    paddingTop: 8,
    borderTopWidth: 1,
    borderTopColor: '#eee',
  },
  loader: {
    marginTop: 40,
  },
  emptyContainer: {
    alignItems: 'center',
    padding: 40,
    backgroundColor: '#fff',
    borderRadius: 12,
  },
  emptyEmoji: {
    fontSize: 48,
    marginBottom: 16,
  },
  emptyText: {
    fontSize: 18,
    fontWeight: '600',
    color: '#666',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#999',
    marginTop: 8,
    textAlign: 'center',
  },
  helpfulText: {
    fontSize: 14,
    color: '#007AFF',
    marginTop: 16,
    textAlign: 'center',
  },
});

export default TripPlannerScreen;