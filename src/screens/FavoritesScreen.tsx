// src/screens/FavoritesScreen.tsx
import React, { useState, useCallback } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  RefreshControl,
} from 'react-native';
import { useNavigation, useFocusEffect } from '@react-navigation/native';
import { StackNavigationProp } from '@react-navigation/stack';
import { StorageService } from '../services/StorageService';
import { Favorite, RootStackParamList } from '../types';
import { usePremium } from '../services/PremiumService';

type FavoritesScreenNavigationProp = StackNavigationProp<RootStackParamList, 'Main'>;

const FavoritesScreen = () => {
  const navigation = useNavigation<FavoritesScreenNavigationProp>();
  const { isPremium, refreshPremiumStatus } = usePremium();
  const [favorites, setFavorites] = useState<Favorite[]>([]);
  const [refreshing, setRefreshing] = useState(false);
  const [realtimeMessages, setRealtimeMessages] = useState<any[]>([]);

  const loadFavorites = async () => {
    const savedFavorites = await StorageService.getFavorites();
    setFavorites(savedFavorites);
  };

  const loadRealTimeMessages = async () => {
    // Simulate fetching real-time messages from GO Transit API
    const messages = [
      {
        id: '1',
        title: 'Service Alert',
        message: 'Lakeshore West line: 15-minute delay due to signal issue at Oakville',
        severity: 'warning',
        timestamp: Date.now(),
      },
      {
        id: '2',
        title: 'Schedule Update',
        message: 'Kitchener line: Extra trains added for evening rush hour',
        severity: 'info',
        timestamp: Date.now(),
      },
      {
        id: '3',
        title: 'Weather Advisory',
        message: 'Expect delays due to winter weather conditions',
        severity: 'critical',
        timestamp: Date.now(),
      },
    ];
    setRealtimeMessages(messages);
  };

  useFocusEffect(
    useCallback(() => {
      loadFavorites();
      if (isPremium) {
        loadRealTimeMessages();
      }
      refreshPremiumStatus();
    }, [isPremium])
  );

  const handleLoadFavorite = (favorite: Favorite) => {
    navigation.navigate('Schedule', {
      lineId: favorite.lineId,
      startStationId: favorite.startStationId,
      endStationId: favorite.endStationId,
      lineName: favorite.lineName,
      startStationName: favorite.startStationName,
      endStationName: favorite.endStationName,
    });
  };

  const handleDeleteFavorite = async (favoriteId: string) => {
    Alert.alert(
      'Delete Favorite',
      'Are you sure you want to remove this favorite?',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Delete',
          style: 'destructive',
          onPress: async () => {
            await StorageService.deleteFavorite(favoriteId);
            await loadFavorites();
          },
        },
      ]
    );
  };

  const getSeverityColor = (severity: string) => {
    switch (severity) {
      case 'warning': return '#ff9800';
      case 'critical': return '#f44336';
      default: return '#4caf50';
    }
  };

  return (
    <ScrollView
      style={styles.container}
      refreshControl={
        <RefreshControl refreshing={refreshing} onRefresh={async () => {
          setRefreshing(true);
          await loadFavorites();
          if (isPremium) await loadRealTimeMessages();
          setRefreshing(false);
        }} />
      }
    >
      <View style={styles.header}>
        <Text style={styles.title}>⭐ Favorites</Text>
        <Text style={styles.subtitle}>Quick access to your saved trips</Text>
      </View>

      {favorites.length === 0 ? (
        <View style={styles.emptyState}>
          <Text style={styles.emptyText}>No favorites saved yet</Text>
          <Text style={styles.emptySubtext}>
            Save your favorite routes from the Home screen
          </Text>
        </View>
      ) : (
        favorites.map((favorite) => (
          <TouchableOpacity
            key={favorite.id}
            style={styles.favoriteCard}
            onPress={() => handleLoadFavorite(favorite)}
            onLongPress={() => handleDeleteFavorite(favorite.id)}
          >
            <View style={styles.favoriteHeader}>
              <Text style={styles.favoriteLine}>{favorite.lineName}</Text>
              <Text style={styles.favoriteDelete}>🗑️</Text>
            </View>
            <View style={styles.favoriteRoute}>
              <Text style={styles.stationName}>📍 {favorite.startStationName}</Text>
              <Text style={styles.arrow}>→</Text>
              <Text style={styles.stationName}>🏁 {favorite.endStationName}</Text>
            </View>
            <Text style={styles.favoriteDate}>
              Saved: {new Date(favorite.createdAt).toLocaleDateString()}
            </Text>
          </TouchableOpacity>
        ))
      )}

      {isPremium && realtimeMessages.length > 0 && (
        <View style={styles.messagesSection}>
          <Text style={styles.messagesTitle}>🚨 Real-Time Alerts</Text>
          {realtimeMessages.map((message) => (
            <View key={message.id} style={styles.messageCard}>
              <View style={[styles.messageHeader, { borderLeftColor: getSeverityColor(message.severity) }]}>
                <Text style={styles.messageTitle}>{message.title}</Text>
                <Text style={styles.messageTime}>
                  {new Date(message.timestamp).toLocaleTimeString()}
                </Text>
              </View>
              <Text style={styles.messageBody}>{message.message}</Text>
            </View>
          ))}
        </View>
      )}
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#335B00',
    padding: 20,
    alignItems: 'center',
  },
  title: {
    fontSize: 24,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#fff',
    marginTop: 5,
  },
  emptyState: {
    alignItems: 'center',
    padding: 40,
  },
  emptyText: {
    fontSize: 18,
    color: '#999',
  },
  emptySubtext: {
    fontSize: 14,
    color: '#ccc',
    marginTop: 5,
  },
  favoriteCard: {
    backgroundColor: '#fff',
    margin: 15,
    padding: 15,
    borderRadius: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  favoriteHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  favoriteLine: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#335B00',
  },
  favoriteDelete: {
    fontSize: 16,
  },
  favoriteRoute: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 10,
  },
  stationName: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  arrow: {
    fontSize: 18,
    marginHorizontal: 10,
    color: '#335B00',
  },
  favoriteDate: {
    fontSize: 11,
    color: '#999',
  },
  messagesSection: {
    backgroundColor: '#fff',
    margin: 15,
    padding: 15,
    borderRadius: 10,
  },
  messagesTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  messageCard: {
    backgroundColor: '#f9f9f9',
    borderRadius: 8,
    marginBottom: 10,
    overflow: 'hidden',
  },
  messageHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    padding: 12,
    backgroundColor: '#fff',
    borderLeftWidth: 4,
  },
  messageTitle: {
    fontSize: 14,
    fontWeight: '600',
    color: '#333',
  },
  messageTime: {
    fontSize: 11,
    color: '#999',
  },
  messageBody: {
    padding: 12,
    fontSize: 13,
    color: '#666',
    borderTopWidth: 1,
    borderTopColor: '#f0f0f0',
  },
});

export default FavoritesScreen;