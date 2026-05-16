// src/components/SearchablePicker.tsx
import React, { useState, useEffect, useRef } from 'react';
import {
  View,
  TextInput,
  TouchableOpacity,
  Text,
  StyleSheet,
  ScrollView,
  Keyboard,
  TouchableWithoutFeedback,
} from 'react-native';
import { Ionicons } from '@expo/vector-icons';

interface SearchablePickerProps {
  items: Array<{ label: string; value: string }>;
  placeholder?: string;
  onValueChange: (value: string) => void;
  value?: string;
}

const SearchablePicker: React.FC<SearchablePickerProps> = ({
  items,
  placeholder = 'Select an option...',
  onValueChange,
  value,
}) => {
  const [isExpanded, setIsExpanded] = useState(false);
  const [searchText, setSearchText] = useState('');
  const [filteredItems, setFilteredItems] = useState(items);
  const [selectedLabel, setSelectedLabel] = useState('');
  const searchInputRef = useRef<TextInput>(null);

  useEffect(() => {
    const selectedItem = items.find(item => item.value === value);
    setSelectedLabel(selectedItem?.label || '');
  }, [value, items]);

  useEffect(() => {
    if (searchText.trim() === '') {
      const sorted = [...items].sort((a, b) => {
        return a.value.toLowerCase().localeCompare(b.value.toLowerCase());
      });
      setFilteredItems(sorted);
    } else {
      const searchLower = searchText.toLowerCase().trim();
      
      const filtered = items.filter(item =>
        item.label.toLowerCase().includes(searchLower) ||
        item.value.toLowerCase().includes(searchLower)
      );
      
      const sorted = filtered.sort((a, b) => {
        const aLabelLower = a.label.toLowerCase();
        const bLabelLower = b.label.toLowerCase();
        const aValueLower = a.value.toLowerCase();
        const bValueLower = b.value.toLowerCase();
        
        const aExact = aValueLower === searchLower || aLabelLower === searchLower;
        const bExact = bValueLower === searchLower || bLabelLower === searchLower;
        
        if (aExact && !bExact) return -1;
        if (!aExact && bExact) return 1;
        
        const aStartsWith = aValueLower.startsWith(searchLower) || aLabelLower.startsWith(searchLower);
        const bStartsWith = bValueLower.startsWith(searchLower) || bLabelLower.startsWith(searchLower);
        
        if (aStartsWith && !bStartsWith) return -1;
        if (!aStartsWith && bStartsWith) return 1;
        
        return aValueLower.localeCompare(bValueLower);
      });
      
      setFilteredItems(sorted);
    }
  }, [searchText, items]);

  const handleSelect = (item: { label: string; value: string }) => {
    setSelectedLabel(item.label);
    onValueChange(item.value);
    setIsExpanded(false);
    setSearchText('');
    Keyboard.dismiss(); // Dismiss keyboard immediately
  };

  const toggleExpand = () => {
    if (isExpanded) {
      setIsExpanded(false);
      setSearchText('');
      Keyboard.dismiss();
    } else {
      setIsExpanded(true);
      // Focus the search input after a short delay when expanding
      setTimeout(() => {
        searchInputRef.current?.focus();
      }, 100);
    }
  };

  const handleSearchBlur = () => {
    // Don't close the dropdown on blur, let user close manually if needed
  };

  return (
    <View style={styles.container}>
      <TouchableOpacity
        style={styles.pickerButton}
        onPress={toggleExpand}
        activeOpacity={0.7}
      >
        <Text style={[styles.pickerButtonText, !selectedLabel && styles.placeholderText]}>
          {selectedLabel || placeholder}
        </Text>
        <Ionicons 
          name={isExpanded ? "chevron-up" : "chevron-down"} 
          size={20} 
          color="#666" 
        />
      </TouchableOpacity>

      {isExpanded && (
        <View style={styles.dropdownContainer}>
          <View style={styles.searchContainer}>
            <Ionicons name="search" size={20} color="#999" style={styles.searchIcon} />
            <TextInput
              ref={searchInputRef}
              style={styles.searchInput}
              placeholder="Search..."
              value={searchText}
              onChangeText={setSearchText}
              autoFocus={true}
              autoCapitalize="characters"
              autoCorrect={false}
              returnKeyType="search"
              blurOnSubmit={false}
            />
            {searchText !== '' && (
              <TouchableOpacity onPress={() => setSearchText('')}>
                <Ionicons name="close-circle" size={20} color="#999" />
              </TouchableOpacity>
            )}
          </View>

          <ScrollView 
            style={styles.scrollView}
            nestedScrollEnabled={true}
            showsVerticalScrollIndicator={true}
            keyboardShouldPersistTaps="handled"
          >
            {filteredItems.length === 0 ? (
              <View style={styles.emptyContainer}>
                <Text style={styles.emptyText}>No results found for "{searchText}"</Text>
              </View>
            ) : (
              filteredItems.map((item) => (
                <TouchableOpacity
                  key={item.value}
                  style={styles.item}
                  onPress={() => handleSelect(item)}
                  activeOpacity={0.7}
                >
                  <Text style={styles.itemText}>{item.label}</Text>
                  {value === item.value && (
                    <Ionicons name="checkmark-circle" size={20} color="#335B00" />
                  )}
                </TouchableOpacity>
              ))
            )}
          </ScrollView>
        </View>
      )}
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    position: 'relative',
    zIndex: 1,
  },
  pickerButton: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
  },
  pickerButtonText: {
    fontSize: 16,
    color: '#333',
  },
  placeholderText: {
    color: '#999',
  },
  dropdownContainer: {
    marginTop: 8,
    backgroundColor: '#fff',
    borderWidth: 1,
    borderColor: '#ddd',
    borderRadius: 8,
    maxHeight: 300,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  searchContainer: {
    flexDirection: 'row',
    alignItems: 'center',
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderBottomWidth: 1,
    borderBottomColor: '#e0e0e0',
  },
  searchIcon: {
    marginRight: 8,
  },
  searchInput: {
    flex: 1,
    fontSize: 16,
    padding: 8,
  },
  scrollView: {
    maxHeight: 250,
  },
  item: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    padding: 12,
    borderBottomWidth: 1,
    borderBottomColor: '#f0f0f0',
  },
  itemText: {
    fontSize: 14,
    color: '#333',
    flex: 1,
  },
  emptyContainer: {
    padding: 20,
    alignItems: 'center',
  },
  emptyText: {
    fontSize: 14,
    color: '#999',
    textAlign: 'center',
  },
});

export default SearchablePicker;