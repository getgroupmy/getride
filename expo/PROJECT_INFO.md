# RideShare App

A beautiful, modern ride-sharing application inspired by Uber, built with React Native and Expo.

## Features

### 🗺️ **Interactive Map Interface**
- Real-time location tracking with expo-location
- Custom map markers with animations
- Google Maps integration for accurate navigation

### 🔍 **Smart Location Search**
- Pickup and destination selection
- Popular destinations list
- Clean, intuitive search interface

### 🚗 **Multiple Ride Types**
- **Economy**: Affordable rides for everyday trips
- **Comfort**: Premium cars with extra legroom  
- **Premium**: Luxury vehicles for special occasions

### 💰 **Dynamic Pricing**
- Real-time price estimates based on distance
- Different pricing tiers for each ride type
- Transparent pricing display

### 📍 **Live Ride Tracking**
- Driver location tracking on map
- Real-time status updates
- Driver information and ratings
- Direct communication options (call/message)

## Tech Stack

- **React Native** with Expo SDK 54
- **Expo Router** for file-based navigation
- **React Native Maps** for map functionality
- **TypeScript** for type safety
- **React Query** for state management
- **Lucide React Native** for icons

## Design

The app features a clean, modern design with:
- Smooth animations using React Native's Animated API
- Beautiful gradients and shadows
- Mobile-optimized layouts
- Intuitive gesture handling
- Consistent color system (black, white, emerald green accent)

## Navigation Flow

1. **Home** (`/`) - Map view with location search
2. **Search** (`/search`) - Pickup/destination selection
3. **Ride Confirm** (`/ride-confirm`) - Choose ride type and view pricing
4. **Ride Tracking** (`/ride-tracking`) - Live ride tracking with driver info
