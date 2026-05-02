// metro.config.js - Create this file in your project root
const { getDefaultConfig } = require('expo/metro-config');

module.exports = {
  resolver: {
    assetExts: ['db', 'png', 'jpg', 'jpeg', 'ttf'],
  },
};