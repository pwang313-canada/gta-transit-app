// src/components/RouteAutocomplete.tsx
import React, { useState, useEffect, useRef, useCallback } from 'react';
import {
  View,
  TextInput,
  FlatList,
  Text,
  TouchableOpacity,
  StyleSheet,
  ActivityIndicator,
} from 'react-native';
import DatabaseService, { RouteDisplay } from '../services/DatabaseService';

interface RouteAutocompleteProps {
  onSelectRoute: (route: RouteDisplay) => void;
  placeholder?: string;
}

const RouteAutocomplete: React.FC<RouteAutocompleteProps> = ({ 
  onSelectRoute, 
  placeholder = "Search for a route (e.g., 21, MI, Lakeshore)" 
}) => {
  const [query, setQuery] = useState('');
  const [routes, setRoutes] = useState<RouteDisplay[]>([]);
  const [allRoutes, setAllRoutes] = useState<RouteDisplay[]>([]);
  const [loading, setLoading] = useState(false);
  const [showResults, setShowResults] = useState(false);
  const inputRef = useRef<TextInput>(null);

  // Load all routes initially
  useEffect(() => {
    const loadRoutes = async () => {
      setLoading(true);
      try {
        const routeList = await DatabaseService.getRoutesWithDirections();
        console.log('Loaded routes:', routeList.map(r => r.route_short_name));
        setAllRoutes(routeList);
        setRoutes(routeList);
      } catch (error) {
        console.error('Error loading routes:', error);
      } finally {
        setLoading(false);
      }
    };
    
    loadRoutes();
  }, []);

  // Filter routes as user types - CASE INSENSITIVE
  const handleTextChange = useCallback((text: string) => {
    const upperText = text.toUpperCase();
    setQuery(text);
    
    console.log('Searching for:', text, 'Uppercase:', upperText);
    
    if (text.trim() === '') {
      setRoutes(allRoutes);
      setShowResults(false);
      return;
    }
    
    // Case-insensitive filtering
    const filtered = allRoutes.filter(route => {
      const shortName = route.route_short_name.toUpperCase();
      const longName = route.route_long_name.toUpperCase();
      const displayName = route.display_name.toUpperCase();
      const searchTerm = text.toUpperCase();
      
      return shortName.includes(searchTerm) || 
             longName.includes(searchTerm) || 
             displayName.includes(searchTerm);
    });
    
    console.log(`Found ${filtered.length} routes matching "${text}"`);
    
    // Sort by relevance (exact matches first)
    filtered.sort((a, b) => {
      const searchTerm = text.toUpperCase();
      const aExact = a.route_short_name.toUpperCase() === searchTerm;
      const bExact = b.route_short_name.toUpperCase() === searchTerm;
      if (aExact && !bExact) return -1;
      if (!aExact && bExact) return 1;
      return 0;
    });
    
    setRoutes(filtered);
    setShowResults(true);
  }, [allRoutes]);

  const handleSelectRoute = useCallback((route: RouteDisplay) => {
    setQuery(route.display_name);
    setShowResults(false);
    onSelectRoute(route);
    inputRef.current?.blur();
  }, [onSelectRoute]);

  // Get service type color
  const getServiceTypeColor = (serviceType: string) => {
    return serviceType === 'Train' ? '#ff6b6b' : '#4ecdc4';
  };

  const renderRouteItem = useCallback(({ item }: { item: RouteDisplay }) => (
    <TouchableOpacity
      style={styles.resultItem}
      onPress={() => handleSelectRoute(item)}
      activeOpacity={0.7}
    >
      <View style={styles.routeInfo}>
        <View style={styles.routeHeader}>
          <Text style={styles.routeShortName}>
            {item.route_short_name}
          </Text>
          <View style={[
            styles.serviceTypeBadge,
            { backgroundColor: getServiceTypeColor(item.service_type) }
          ]}>
            <Text style={styles.serviceTypeText}>
              {item.service_type}
            </Text>
          </View>
        </View>
        <Text style={styles.routeLongName}>
          {item.route_long_name}
        </Text>
      </View>
      <Text style={styles.chevron}>›</Text>
    </TouchableOpacity>
  ), [handleSelectRoute]);

  return (
    <View style={styles.container}>
      <TextInput
        ref={inputRef}
        style={styles.input}
        placeholder={placeholder}
        value={query}
        onChangeText={handleTextChange}
        onFocus={() => query.trim() !== '' && setShowResults(true)}
        placeholderTextColor="#999"
        autoCapitalize="characters"
      />
      
      {loading && (
        <View style={styles.loadingContainer}>
          <ActivityIndicator size="small" color="#007AFF" />
        </View>
      )}
      
      {showResults && query.length > 0 && routes.length > 0 && (
        <View style={styles.resultsContainer}>
          <FlatList
            data={routes}
            keyExtractor={(item) => item.route_short_name}
            keyboardShouldPersistTaps="always"
            renderItem={renderRouteItem}
            initialNumToRender={10}
            maxToRenderPerBatch={10}
            windowSize={5}
            removeClippedSubviews={true}
          />
        </View>
      )}
      
      {showResults && query.length > 0 && routes.length === 0 && !loading && (
        <View style={styles.noResultsContainer}>
          <Text style={styles.noResultsText}>
            No routes found matching "{query}"
          </Text>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 1000,
  },
  input: {
    height: 50,
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    paddingHorizontal: 15,
    fontSize: 16,
    backgroundColor: '#fff',
  },
  loadingContainer: {
    position: 'absolute',
    right: 15,
    top: 13,
  },
  resultsContainer: {
    position: 'absolute',
    top: 55,
    left: 0,
    right: 0,
    maxHeight: 300,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    zIndex: 1001,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  resultItem: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#eee',
  },
  routeInfo: {
    flex: 1,
  },
  routeHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 4,
  },
  routeShortName: {
    fontSize: 16,
    fontWeight: 'bold',
    marginRight: 8,
  },
  serviceTypeBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 4,
  },
  serviceTypeText: {
    color: '#fff',
    fontSize: 11,
    fontWeight: '600',
  },
  routeLongName: {
    fontSize: 14,
    color: '#666',
  },
  chevron: {
    fontSize: 20,
    color: '#ccc',
  },
  noResultsContainer: {
    position: 'absolute',
    top: 55,
    left: 0,
    right: 0,
    padding: 20,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    alignItems: 'center',
  },
  noResultsText: {
    color: '#999',
    fontSize: 14,
  },
});

export default RouteAutocomplete;