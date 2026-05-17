// src/components/RealTimeAlerts.tsx
import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  Animated,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';

interface AlertMessage {
  Code: string;
  Category?: string;
  SubCategory?: string;
  Status?: string;
  PostedDateTime?: string;
  SubjectEnglish?: string;
  SubjectFrench?: string;
  BodyEnglish?: string;
  BodyFrench?: string;
}

interface RealTimeAlertsProps {
  apiKey: string;
  pollingInterval?: number; // milliseconds, default 60000 (1 minute)
}

const RealTimeAlerts: React.FC<RealTimeAlertsProps> = ({ apiKey, pollingInterval = 60000 }) => {
  const [alerts, setAlerts] = useState<AlertMessage[]>([]);
  const [loading, setLoading] = useState(false);
  const [expanded, setExpanded] = useState(false);
  const [hasNew, setHasNew] = useState(false);
  const [lastFetched, setLastFetched] = useState<Date | null>(null);
  const flashAnim = useRef(new Animated.Value(0)).current;
  const intervalRef = useRef<number | null>(null); // ✅ Fix: use number for interval ID

  // Fetch alerts from the API
  const fetchAlerts = async () => {
    setLoading(true);
    try {
      const url = `https://api.openmetrolinx.com/OpenDataAPI/api/V1/ServiceUpdate/ServiceAlertAll?key=${apiKey}`;
      const response = await fetch(url, {
        headers: {
          Accept: 'application/json',
        },
      });

      if (response.status === 204 || response.status === 404) {
        setAlerts([]);
        setHasNew(false);
        return;
      }

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}`);
      }

      const data = await response.json();
      let newAlerts: AlertMessage[] = [];
      if (data && Array.isArray(data)) {
        newAlerts = data;
      } else if (data && data.ServiceAlertAll && Array.isArray(data.ServiceAlertAll)) {
        newAlerts = data.ServiceAlertAll;
      } else if (data && data.Result && Array.isArray(data.Result)) {
        newAlerts = data.Result;
      } else {
        const firstKey = Object.keys(data)[0];
        if (firstKey && Array.isArray(data[firstKey])) {
          newAlerts = data[firstKey];
        }
      }

      // Check for new messages by comparing the latest PostedDateTime
      let hasNewMessages = false;
      if (newAlerts.length > 0 && alerts.length > 0) {
        const latestExisting = alerts.reduce((latest, a) => {
          const date = a.PostedDateTime ? new Date(a.PostedDateTime).getTime() : 0;
          return date > latest ? date : latest;
        }, 0);
        const latestNew = newAlerts.reduce((latest, a) => {
          const date = a.PostedDateTime ? new Date(a.PostedDateTime).getTime() : 0;
          return date > latest ? date : latest;
        }, 0);
        hasNewMessages = latestNew > latestExisting;
      } else if (newAlerts.length > 0 && alerts.length === 0) {
        hasNewMessages = true;
      }

      if (hasNewMessages) {
        // Trigger flash animation
        Animated.sequence([
          Animated.timing(flashAnim, {
            toValue: 1,
            duration: 300,
            useNativeDriver: false,
          }),
          Animated.timing(flashAnim, {
            toValue: 0,
            duration: 300,
            useNativeDriver: false,
          }),
        ]).start(() => setHasNew(false));
        setHasNew(true);
      }

      setAlerts(newAlerts);
      setLastFetched(new Date());
    } catch (error) {
      console.error('Failed to fetch alerts:', error);
      Alert.alert('Alert Fetch Error', 'Unable to get real-time alerts. Check your connection.');
    } finally {
      setLoading(false);
    }
  };

  // Start polling when component mounts
  useEffect(() => {
    fetchAlerts();
    if (pollingInterval > 0) {
      intervalRef.current = setInterval(fetchAlerts, pollingInterval) as unknown as number;
    }
    return () => {
      if (intervalRef.current) clearInterval(intervalRef.current);
    };
  }, []);

  const backgroundColor = flashAnim.interpolate({
    inputRange: [0, 1],
    outputRange: ['#335B00', '#FF6B6B'],
  });

  const formatDate = (dateStr?: string) => {
    if (!dateStr) return '';
    const date = new Date(dateStr);
    return date.toLocaleString();
  };

  const toggleExpand = () => setExpanded(!expanded);

  return (
    <View style={styles.container}>
      <TouchableOpacity onPress={toggleExpand} activeOpacity={0.8}>
        <Animated.View style={[styles.header, { backgroundColor }]}>
          <Text style={styles.headerText}>
            🚨 Service Alerts {alerts.length > 0 ? `(${alerts.length})` : '(0)'}
          </Text>
          <Text style={styles.arrow}>{expanded ? '▲' : '▼'}</Text>
        </Animated.View>
      </TouchableOpacity>

      {expanded && (
        <View style={styles.dropdown}>
          {loading ? (
            <ActivityIndicator size="small" color="#335B00" style={styles.loader} />
          ) : alerts.length === 0 ? (
            <Text style={styles.emptyText}>No active service alerts at this time.</Text>
          ) : (
            <ScrollView style={styles.scrollView} nestedScrollEnabled>
              {alerts.map((alert, idx) => (
                <View key={alert.Code || idx} style={styles.alertCard}>
                  <Text style={styles.alertTitle}>
                    {alert.SubjectEnglish || alert.Category || 'Service Alert'}
                  </Text>
                  {alert.PostedDateTime && (
                    <Text style={styles.alertDate}>Posted: {formatDate(alert.PostedDateTime)}</Text>
                  )}
                  <Text style={styles.alertBody}>
                    {alert.BodyEnglish || alert.SubCategory || 'No details available.'}
                  </Text>
                  {alert.Status && <Text style={styles.alertStatus}>Status: {alert.Status}</Text>}
                </View>
              ))}
            </ScrollView>
          )}
          {lastFetched && (
            <Text style={styles.lastFetched}>Last updated: {lastFetched.toLocaleTimeString()}</Text>
          )}
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    marginHorizontal: 15,
    marginBottom: 10,
    zIndex: 1,
  },
  header: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    backgroundColor: '#335B00',
    paddingHorizontal: 16,
    paddingVertical: 10,
    borderRadius: 25,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.1,
    shadowRadius: 2,
    elevation: 2,
  },
  headerText: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  arrow: {
    color: '#fff',
    fontSize: 14,
    fontWeight: 'bold',
  },
  dropdown: {
    backgroundColor: '#fff',
    borderRadius: 12,
    marginTop: 5,
    padding: 10,
    borderWidth: 1,
    borderColor: '#e0e0e0',
    maxHeight: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  scrollView: {
    maxHeight: 260,
  },
  loader: {
    padding: 20,
  },
  emptyText: {
    textAlign: 'center',
    color: '#888',
    padding: 20,
    fontSize: 14,
  },
  alertCard: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    padding: 12,
    marginBottom: 10,
    borderLeftWidth: 4,
    borderLeftColor: '#FF6B6B',
  },
  alertTitle: {
    fontSize: 15,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 4,
  },
  alertDate: {
    fontSize: 11,
    color: '#999',
    marginBottom: 6,
  },
  alertBody: {
    fontSize: 13,
    color: '#555',
    lineHeight: 18,
  },
  alertStatus: {
    fontSize: 11,
    color: '#335B00',
    marginTop: 6,
    fontWeight: '600',
  },
  lastFetched: {
    fontSize: 10,
    color: '#aaa',
    textAlign: 'right',
    marginTop: 5,
  },
});

export default RealTimeAlerts;