import { DefaultTheme, ThemeProvider } from '@react-navigation/native';
import { Stack, usePathname, useRouter } from 'expo-router';
import * as SplashScreen from 'expo-splash-screen';
import { StatusBar } from 'expo-status-bar';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { GestureHandlerRootView } from 'react-native-gesture-handler';
import { KeyboardProvider } from 'react-native-keyboard-controller';
import { FloatingRecordButton } from '@/components/FloatingRecordButton';
import { AppState } from 'react-native';
import { useRef, useEffect } from 'react';
import useSettingsStore from '@/lib/state/settings-store';

export const unstable_settings = {
  initialRouteName: '(tabs)',
};

SplashScreen.preventAutoHideAsync();

const queryClient = new QueryClient();

const HIDDEN_ROUTES = ['/record', '/review', '/playback'];

function RootLayoutNav() {
  const pathname = usePathname();
  const showFloatingButton = !HIDDEN_ROUTES.some((r) => pathname.startsWith(r));

  const router = useRouter();
  const appState = useRef(AppState.currentState);
  const autoStartOnForeground = useSettingsStore((s) => s.autoStartOnForeground);
  const pathnameRef = useRef(pathname);

  useEffect(() => {
    pathnameRef.current = pathname;
  }, [pathname]);

  useEffect(() => {
    const sub = AppState.addEventListener('change', (nextState) => {
      const wasBackground = appState.current === 'background' || appState.current === 'inactive';
      const isNowActive = nextState === 'active';
      if (wasBackground && isNowActive && autoStartOnForeground) {
        if (!pathnameRef.current.startsWith('/record')) {
          router.push('/record');
        }
      }
      appState.current = nextState;
    });
    return () => sub.remove();
  }, [autoStartOnForeground, router]);

  return (
    <ThemeProvider value={DefaultTheme}>
      <Stack>
        <Stack.Screen name="(tabs)" options={{ headerShown: false }} />
        <Stack.Screen name="modal" options={{ presentation: 'modal' }} />
        <Stack.Screen
          name="record"
          options={{ presentation: 'fullScreenModal', headerShown: false, animation: 'fade' }}
        />
        <Stack.Screen
          name="review"
          options={{ presentation: 'card', title: 'Review', headerShown: false }}
        />
        <Stack.Screen
          name="playback"
          options={{ presentation: 'card', title: 'Playback', headerShown: false }}
        />
        <Stack.Screen name="settings" options={{ title: 'Settings', headerBackTitle: 'Home' }} />
      </Stack>
      {showFloatingButton ? <FloatingRecordButton /> : null}
    </ThemeProvider>
  );
}

export default function RootLayout() {
  return (
    <QueryClientProvider client={queryClient}>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <KeyboardProvider>
          <StatusBar style="dark" />
          <RootLayoutNav />
        </KeyboardProvider>
      </GestureHandlerRootView>
    </QueryClientProvider>
  );
}
