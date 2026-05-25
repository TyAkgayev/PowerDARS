import React from 'react';
import { Text, Image } from 'react-native';

// Renders either an emoji string or a require()'d image based on icon type.
// icon: string (emoji) | number (require() result) | null
export default function IconView({ icon, size = 22, style }) {
  if (!icon) return null;
  if (typeof icon === 'number') {
    return <Image source={icon} style={[{ width: size, height: size }, style]} />;
  }
  return <Text style={[{ fontSize: size, lineHeight: size + 4 }, style]}>{icon}</Text>;
}
