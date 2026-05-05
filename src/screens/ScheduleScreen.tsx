// src/screens/ScheduleScreen.tsx
import { RouteProp, useRoute } from '@react-navigation/native';
import React, { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { getScheduleForStation } from '../data/goTransitData';
import { RootStackParamList } from '../types';

type ScheduleScreenRouteProp = RouteProp<RootStackParamList, 'Schedule'>;

const ScheduleScreen = () => {
  const route = useRoute<ScheduleScreenRouteProp>();
  const { lineId, startStationId, endStationId, lineName, startStationName, endStationName } = route.params;
  
  const [departures, setDepartures] = useState<any[]>([]);
  const [showFullSchedule, setShowFullSchedule] = useState(false);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    loadSchedule();
  }, []);

  const loadSchedule = () => {
    // In production, fetch from actual API
    const allDepartures = getScheduleForStation(lineId, startStationId);
    const currentHour = new Date().getHours();
    const currentMinute = new Date().getMinutes();
    
    let filteredDepartures = allDepartures;
    if (!showFullSchedule) {
      filteredDepartures = allDepartures.filter(departure => {
        const [hour, minute] = departure.time.split(':').map(Number);
        if (hour > currentHour) return true;
        if (hour === currentHour && minute >= currentMinute) return true;
        return false;
      });
    }
    
    setDepartures(filteredDepartures);
    setLoading(false);
  };

  const toggleSchedule = () => {
    setShowFullSchedule(!showFullSchedule);
    setLoading(true);
    setTimeout(loadSchedule, 100);
  };

  const getTravelTime = (departureTime: string) => {
    // This would calculate actual travel time between stations
    return '~1 hour';
  };

  if (loading) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#00A1E0" />
      </View>
    );
  }

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.headerTitle}>{lineName}</Text>
        <View style={styles.route}>
          <Text style={styles.stationName}>{startStationName}</Text>
          <Text style={styles.arrow}>→</Text>
          <Text style={styles.stationName}>{endStationName}</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.toggleButton} onPress={toggleSchedule}>
        <Text style={styles.toggleButtonText}>
          {showFullSchedule ? 'Show Current Schedule' : 'Show Full Schedule'}
        </Text>
      </TouchableOpacity>

      <View style={styles.scheduleSection}>
        <Text style={styles.scheduleTitle}>
          {showFullSchedule ? 'All Departures' : 'Upcoming Departures'}
        </Text>
        {departures.map((departure, index) => (
          <View key={index} style={styles.scheduleCard}>
            <View style={styles.scheduleTimeContainer}>
              <Text style={styles.scheduleTime}>{departure.time}</Text>
              <Text style={styles.schedulePlatform}>Platform {departure.platform}</Text>
            </View>
            <View style={styles.scheduleInfo}>
              <Text style={styles.scheduleDestination}>{departure.destination}</Text>
              <Text style={styles.travelTime}>{getTravelTime(departure.time)}</Text>
            </View>
          </View>
        ))}
        {departures.length === 0 && (
          <Text style={styles.noTrains}>No trains found for this time</Text>
        )}
      </View>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  loadingContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  header: {
    backgroundColor: '#00A1E0',
    padding: 20,
    alignItems: 'center',
  },
  headerTitle: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  route: {
    flexDirection: 'row',
    alignItems: 'center',
    marginTop: 10,
  },
  stationName: {
    fontSize: 14,
    color: '#fff',
    fontWeight: '600',
  },
  arrow: {
    fontSize: 18,
    marginHorizontal: 10,
    color: '#fff',
  },
  toggleButton: {
    backgroundColor: '#ff9800',
    margin: 15,
    padding: 12,
    borderRadius: 10,
    alignItems: 'center',
  },
  toggleButtonText: {
    color: '#fff',
    fontWeight: '600',
  },
  scheduleSection: {
    backgroundColor: '#fff',
    margin: 15,
    padding: 15,
    borderRadius: 10,
  },
  scheduleTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  scheduleCard: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    paddingVertical: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  scheduleTimeContainer: {
    flexDirection: 'row',
    alignItems: 'baseline',
    gap: 10,
  },
  scheduleTime: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#00A1E0',
  },
  schedulePlatform: {
    fontSize: 12,
    color: '#999',
  },
  scheduleInfo: {
    alignItems: 'flex-end',
  },
  scheduleDestination: {
    fontSize: 14,
    color: '#333',
  },
  travelTime: {
    fontSize: 11,
    color: '#4caf50',
    marginTop: 2,
  },
  noTrains: {
    textAlign: 'center',
    color: '#999',
    padding: 20,
  },
});

export default ScheduleScreen;