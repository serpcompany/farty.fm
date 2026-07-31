import React from 'react';
import { View, Text, Switch, ScrollView } from 'react-native';
import { Stack } from 'expo-router';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import useSettingsStore from '@/lib/state/settings-store';

export default function SettingsScreen() {
  const insets = useSafeAreaInsets();
  const autoStartOnForeground = useSettingsStore((s) => s.autoStartOnForeground);
  const setAutoStartOnForeground = useSettingsStore((s) => s.setAutoStartOnForeground);

  return (
    <>
      <Stack.Screen options={{ title: 'Settings' }} />
      <ScrollView
        testID="settings-screen"
        style={{ flex: 1, backgroundColor: '#f2f2f7' }}
        contentContainerStyle={{
          paddingTop: 24,
          paddingBottom: insets.bottom + 40,
          paddingHorizontal: 20,
        }}
        showsVerticalScrollIndicator={false}
      >
        {/* Quick Record Section */}
        <Text
          style={{
            fontSize: 12,
            fontWeight: '600',
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: 0.8,
            marginBottom: 8,
            marginLeft: 4,
          }}
        >
          Quick Record
        </Text>
        <View
          style={{
            backgroundColor: '#ffffff',
            borderRadius: 14,
            overflow: 'hidden',
            marginBottom: 32,
            shadowColor: '#000',
            shadowOffset: { width: 0, height: 1 },
            shadowOpacity: 0.06,
            shadowRadius: 4,
            elevation: 1,
          }}
        >
          <View
            style={{
              flexDirection: 'row',
              alignItems: 'center',
              paddingHorizontal: 16,
              paddingVertical: 14,
            }}
          >
            <View style={{ flex: 1, marginRight: 12 }}>
              <Text
                style={{
                  fontSize: 16,
                  fontWeight: '500',
                  color: '#111827',
                  marginBottom: 2,
                }}
              >
                Auto-start on open
              </Text>
              <Text style={{ fontSize: 13, color: '#9ca3af', lineHeight: 18 }}>
                Recording begins when you open or return to Pedos
              </Text>
            </View>
            <Switch
              testID="auto-start-toggle"
              value={autoStartOnForeground}
              onValueChange={setAutoStartOnForeground}
              trackColor={{ false: '#d1d5db', true: '#84cc16' }}
              thumbColor="#ffffff"
            />
          </View>
        </View>

        {/* Siri Shortcut Section */}
        <Text
          style={{
            fontSize: 12,
            fontWeight: '600',
            color: '#6b7280',
            textTransform: 'uppercase',
            letterSpacing: 0.8,
            marginBottom: 8,
            marginLeft: 4,
          }}
        >
          Siri Shortcut
        </Text>
        <View
          style={{
            backgroundColor: '#f7fee7',
            borderRadius: 14,
            padding: 16,
            borderWidth: 1,
            borderColor: '#d9f99d',
          }}
        >
          <Text
            style={{
              fontSize: 15,
              fontWeight: '600',
              color: '#365314',
              marginBottom: 10,
            }}
          >
            Add a Siri Shortcut
          </Text>
          <View style={{ gap: 8 }}>
            {[
              'Open the iOS Shortcuts app',
              'Create a new shortcut',
              'Add the "Open URL" action with vibecode://record',
              'Add it to Siri with any phrase, like "Record a fart"',
            ].map((step, index) => (
              <View
                key={index}
                style={{ flexDirection: 'row', alignItems: 'flex-start', gap: 10 }}
              >
                <View
                  style={{
                    width: 22,
                    height: 22,
                    borderRadius: 11,
                    backgroundColor: '#84cc16',
                    alignItems: 'center',
                    justifyContent: 'center',
                    marginTop: 1,
                    flexShrink: 0,
                  }}
                >
                  <Text
                    style={{ fontSize: 12, fontWeight: '700', color: '#ffffff' }}
                  >
                    {index + 1}
                  </Text>
                </View>
                <Text
                  style={{
                    flex: 1,
                    fontSize: 14,
                    color: '#4d7c0f',
                    lineHeight: 20,
                  }}
                >
                  {step}
                </Text>
              </View>
            ))}
          </View>
        </View>
      </ScrollView>
    </>
  );
}
