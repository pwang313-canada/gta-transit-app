// src/services/StorageService.ts
import AsyncStorage from '@react-native-async-storage/async-storage';
import { Favorite } from '../types';

const FAVORITES_KEY = '@gta_transit:favorites';
const LAST_USAGE_KEY = '@gta_transit:last_usage';
const USAGE_COUNT_KEY = '@gta_transit:usage_count';

export class StorageService {
  // Save a favorite route
  static async saveFavorite(favorite: Favorite): Promise<void> {
    try {
      const favorites = await this.getFavorites();
      favorites.push(favorite);
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
    } catch (error) {
      console.error('Error saving favorite:', error);
    }
  }

  // Get all favorites
  static async getFavorites(): Promise<Favorite[]> {
    try {
      const favoritesJson = await AsyncStorage.getItem(FAVORITES_KEY);
      return favoritesJson ? JSON.parse(favoritesJson) : [];
    } catch (error) {
      console.error('Error getting favorites:', error);
      return [];
    }
  }

  // Delete a favorite
  static async deleteFavorite(favoriteId: string): Promise<void> {
    try {
      const favorites = await this.getFavorites();
      const filtered = favorites.filter(f => f.id !== favoriteId);
      await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(filtered));
    } catch (error) {
      console.error('Error deleting favorite:', error);
    }
  }

  // Update favorite
  static async updateFavorite(favorite: Favorite): Promise<void> {
    try {
      const favorites = await this.getFavorites();
      const index = favorites.findIndex(f => f.id === favorite.id);
      if (index !== -1) {
        favorites[index] = favorite;
        await AsyncStorage.setItem(FAVORITES_KEY, JSON.stringify(favorites));
      }
    } catch (error) {
      console.error('Error updating favorite:', error);
    }
  }

  // Clear all favorites
  static async clearFavorites(): Promise<void> {
    try {
      await AsyncStorage.removeItem(FAVORITES_KEY);
    } catch (error) {
      console.error('Error clearing favorites:', error);
    }
  }

  // Track free usage
  static async incrementFreeUsage(): Promise<number> {
    try {
      const count = await this.getFreeUsageCount();
      const newCount = count + 1;
      await AsyncStorage.setItem(USAGE_COUNT_KEY, newCount.toString());
      await AsyncStorage.setItem(LAST_USAGE_KEY, Date.now().toString());
      return newCount;
    } catch (error) {
      console.error('Error incrementing free usage:', error);
      return 0;
    }
  }

  static async getFreeUsageCount(): Promise<number> {
    try {
      const count = await AsyncStorage.getItem(USAGE_COUNT_KEY);
      // Reset if it's been more than a day since last usage
      const lastUsage = await AsyncStorage.getItem(LAST_USAGE_KEY);
      const lastUsageTime = lastUsage ? parseInt(lastUsage, 10) : 0;
      const hoursSinceLast = (Date.now() - lastUsageTime) / (1000 * 60 * 60);
      
      if (hoursSinceLast > 24) {
        // Reset after 24 hours
        await this.resetFreeUsage();
        return 0;
      }
      
      return count ? parseInt(count, 10) : 0;
    } catch (error) {
      console.error('Error getting free usage count:', error);
      return 0;
    }
  }

  static async resetFreeUsage(): Promise<void> {
    try {
      await AsyncStorage.setItem(USAGE_COUNT_KEY, '0');
    } catch (error) {
      console.error('Error resetting free usage:', error);
    }
  }

  // Premium status
  static async setPremiumActive(active: boolean): Promise<void> {
    try {
      await AsyncStorage.setItem('@gta_transit:premium_active', active.toString());
    } catch (error) {
      console.error('Error setting premium status:', error);
    }
  }

  static async isPremiumActive(): Promise<boolean> {
    try {
      const active = await AsyncStorage.getItem('@gta_transit:premium_active');
      if (!active) return false;
      
      // Check trial expiration if applicable
      const trialStart = await AsyncStorage.getItem('@gta_transit:trial_start');
      if (trialStart) {
        const trialStartTime = parseInt(trialStart, 10);
        const daysSinceTrial = (Date.now() - trialStartTime) / (1000 * 60 * 60 * 24);
        if (daysSinceTrial > 7) {
          // Trial expired
          await this.setPremiumActive(false);
          return false;
        }
      }
      
      return active === 'true';
    } catch (error) {
      console.error('Error checking premium status:', error);
      return false;
    }
  }

  static async startTrial(): Promise<void> {
    try {
      await AsyncStorage.setItem('@gta_transit:trial_start', Date.now().toString());
      await this.setPremiumActive(true);
    } catch (error) {
      console.error('Error starting trial:', error);
    }
  }
}