// src/screens/PremiumScreen.tsx
import React, { useState } from 'react';
import {
  View,
  Text,
  StyleSheet,
  TouchableOpacity,
  ScrollView,
  Alert,
  Linking,
} from 'react-native';
import { usePremium } from '../services/PremiumService';

const PremiumScreen = () => {
  const { isPremium, freeUsageCount, purchasePremium, restorePurchase } = usePremium();
  const [loading, setLoading] = useState(false);

  const handlePurchase = async () => {
    setLoading(true);
    // In production, integrate with actual payment provider (RevenueCat, Stripe, etc.)
    Alert.alert(
      'Purchase Premium',
      'Premium access costs $4.99/month or $29.99/year\n\nFeatures include:\n• Real-time GO Transit alerts\n• Unlimited schedule lookups\n• Ad-free experience\n• Priority support',
      [
        { text: 'Cancel', style: 'cancel' },
        {
          text: 'Start 7-Day Free Trial',
          onPress: async () => {
            const success = await purchasePremium();
            if (success) {
              Alert.alert('Success', 'Premium activated! Enjoy your trial.');
            } else {
              Alert.alert('Error', 'Purchase failed. Please try again.');
            }
            setLoading(false);
          },
        },
      ]
    );
  };

  if (isPremium) {
    return (
      <ScrollView style={styles.container}>
        <View style={styles.premiumHeader}>
          <Text style={styles.premiumEmoji}>💎</Text>
          <Text style={styles.premiumTitle}>Premium Active</Text>
          <Text style={styles.premiumSubtitle}>Thank you for being a premium member!</Text>
        </View>

        <View style={styles.featuresCard}>
          <Text style={styles.featuresTitle}>Premium Features</Text>
          <View style={styles.featureItem}>
            <Text style={styles.featureIcon}>✅</Text>
            <Text style={styles.featureText}>Real-time GO Transit alerts</Text>
          </View>
          <View style={styles.featureItem}>
            <Text style={styles.featureIcon}>✅</Text>
            <Text style={styles.featureText}>Unlimited schedule lookups</Text>
          </View>
          <View style={styles.featureItem}>
            <Text style={styles.featureIcon}>✅</Text>
            <Text style={styles.featureText}>Ad-free experience</Text>
          </View>
          <View style={styles.featureItem}>
            <Text style={styles.featureIcon}>✅</Text>
            <Text style={styles.featureText}>Priority support</Text>
          </View>
        </View>

        <TouchableOpacity style={styles.contactButton} onPress={() => Linking.openURL('mailto:support@gtatransit.com')}>
          <Text style={styles.contactButtonText}>📧 Contact Support</Text>
        </TouchableOpacity>
      </ScrollView>
    );
  }

  const remainingUses = 3 - freeUsageCount;
  const showTrial = freeUsageCount < 3;

  return (
    <ScrollView style={styles.container}>
      <View style={styles.header}>
        <Text style={styles.title}>🚆 Go Premium</Text>
        <Text style={styles.subtitle}>Get the most out of your GTA transit experience</Text>
      </View>

      {showTrial && (
        <View style={styles.trialCard}>
          <Text style={styles.trialTitle}>🎁 7-Day Free Trial</Text>
          <Text style={styles.trialText}>Try all premium features free for 7 days!</Text>
          <Text style={styles.remainingText}>Free uses remaining: {remainingUses}/3</Text>
        </View>
      )}

      <View style={styles.pricingCard}>
        <Text style={styles.pricingTitle}>Premium Plan</Text>
        <Text style={styles.price}>$4.99 <Text style={styles.pricePeriod}>/month</Text></Text>
        <Text style={styles.orText}>or</Text>
        <Text style={styles.price}>$29.99 <Text style={styles.pricePeriod}>/year</Text></Text>
        <Text style={styles.saveText}>Save 50% with annual plan</Text>
      </View>

      <View style={styles.featuresCard}>
        <Text style={styles.featuresTitle}>✨ Premium Features</Text>
        <View style={styles.featureItem}>
          <Text style={styles.featureIcon}>🚨</Text>
          <Text style={styles.featureText}>Real-time GO Transit alerts</Text>
        </View>
        <View style={styles.featureItem}>
          <Text style={styles.featureIcon}>♾️</Text>
          <Text style={styles.featureText}>Unlimited schedule lookups</Text>
        </View>
        <View style={styles.featureItem}>
          <Text style={styles.featureIcon}>📱</Text>
          <Text style={styles.featureText}>Ad-free experience</Text>
        </View>
        <View style={styles.featureItem}>
          <Text style={styles.featureIcon}>🎯</Text>
          <Text style={styles.featureText}>Priority support</Text>
        </View>
        <View style={styles.featureItem}>
          <Text style={styles.featureIcon}>⭐</Text>
          <Text style={styles.featureText}>Unlimited favorites</Text>
        </View>
      </View>

      <TouchableOpacity style={styles.subscribeButton} onPress={handlePurchase} disabled={loading}>
        <Text style={styles.subscribeButtonText}>
          {loading ? 'Processing...' : (showTrial ? 'Start 7-Day Free Trial' : 'Subscribe Now')}
        </Text>
      </TouchableOpacity>

      <TouchableOpacity style={styles.restoreButton} onPress={restorePurchase}>
        <Text style={styles.restoreButtonText}>Restore Purchase</Text>
      </TouchableOpacity>

      <Text style={styles.termsText}>
        By subscribing, you agree to our Terms of Service and Privacy Policy.
        Subscription automatically renews unless auto-renew is turned off at least 24 hours before the end of the current period.
      </Text>
    </ScrollView>
  );
};

const styles = StyleSheet.create({
  container: {
    flex: 1,
    backgroundColor: '#f5f5f5',
  },
  header: {
    backgroundColor: '#00A1E0',
    padding: 30,
    alignItems: 'center',
  },
  title: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
  },
  subtitle: {
    fontSize: 14,
    color: '#fff',
    marginTop: 5,
    textAlign: 'center',
  },
  premiumHeader: {
    backgroundColor: '#4caf50',
    padding: 30,
    alignItems: 'center',
  },
  premiumEmoji: {
    fontSize: 50,
  },
  premiumTitle: {
    fontSize: 28,
    fontWeight: 'bold',
    color: '#fff',
    marginTop: 10,
  },
  premiumSubtitle: {
    fontSize: 14,
    color: '#fff',
    marginTop: 5,
  },
  trialCard: {
    backgroundColor: '#ff9800',
    margin: 15,
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
  },
  trialTitle: {
    fontSize: 20,
    fontWeight: 'bold',
    color: '#fff',
  },
  trialText: {
    fontSize: 14,
    color: '#fff',
    marginTop: 5,
  },
  remainingText: {
    fontSize: 12,
    color: '#fff',
    marginTop: 10,
  },
  pricingCard: {
    backgroundColor: '#fff',
    margin: 15,
    padding: 20,
    borderRadius: 10,
    alignItems: 'center',
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 3,
  },
  pricingTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
  },
  price: {
    fontSize: 32,
    fontWeight: 'bold',
    color: '#00A1E0',
    marginTop: 10,
  },
  pricePeriod: {
    fontSize: 16,
    fontWeight: 'normal',
  },
  orText: {
    fontSize: 14,
    color: '#999',
    marginVertical: 5,
  },
  saveText: {
    fontSize: 12,
    color: '#4caf50',
    marginTop: 5,
  },
  featuresCard: {
    backgroundColor: '#fff',
    margin: 15,
    padding: 20,
    borderRadius: 10,
  },
  featuresTitle: {
    fontSize: 18,
    fontWeight: 'bold',
    color: '#333',
    marginBottom: 15,
  },
  featureItem: {
    flexDirection: 'row',
    alignItems: 'center',
    marginBottom: 12,
  },
  featureIcon: {
    fontSize: 20,
    marginRight: 10,
  },
  featureText: {
    fontSize: 14,
    color: '#333',
  },
  subscribeButton: {
    backgroundColor: '#ff9800',
    margin: 15,
    padding: 18,
    borderRadius: 10,
    alignItems: 'center',
  },
  subscribeButtonText: {
    color: '#fff',
    fontSize: 18,
    fontWeight: 'bold',
  },
  restoreButton: {
    margin: 15,
    padding: 12,
    alignItems: 'center',
  },
  restoreButtonText: {
    color: '#00A1E0',
    fontSize: 14,
  },
  termsText: {
    fontSize: 10,
    color: '#999',
    textAlign: 'center',
    margin: 15,
    lineHeight: 16,
  },
  contactButton: {
    margin: 15,
    padding: 15,
    backgroundColor: '#4caf50',
    borderRadius: 10,
    alignItems: 'center',
  },
  contactButtonText: {
    color: '#fff',
    fontSize: 16,
    fontWeight: '600',
  },
});

export default PremiumScreen;