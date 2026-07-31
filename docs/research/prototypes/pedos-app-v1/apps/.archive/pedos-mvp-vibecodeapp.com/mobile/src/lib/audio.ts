import { Audio } from "expo-av";
import * as FileSystem from "expo-file-system";
import { Platform } from "react-native";

const RECORDINGS_DIR = `${FileSystem.documentDirectory ?? ""}recordings/`;

export async function ensureRecordingsDir(): Promise<void> {
  if (Platform.OS === "web") return;
  const dirInfo = await FileSystem.getInfoAsync(RECORDINGS_DIR);
  if (!dirInfo.exists) {
    await FileSystem.makeDirectoryAsync(RECORDINGS_DIR, { intermediates: true });
  }
}

export async function requestMicPermission(): Promise<boolean> {
  const { granted } = await Audio.requestPermissionsAsync();
  return granted;
}

export async function startRecording(): Promise<Audio.Recording> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: true,
    playsInSilentModeIOS: true,
  });

  const { recording } = await Audio.Recording.createAsync(
    Audio.RecordingOptionsPresets.HIGH_QUALITY
  );

  return recording;
}

export async function stopRecording(
  recording: Audio.Recording
): Promise<{ uri: string; duration: number }> {
  const status = await recording.getStatusAsync();
  const duration = status.durationMillis ?? 0;
  await recording.stopAndUnloadAsync();
  const uri = recording.getURI() ?? "";

  return { uri, duration };
}

export async function saveRecordingFile(
  tempUri: string,
  id: string
): Promise<string> {
  if (Platform.OS === "web") return tempUri;
  await ensureRecordingsDir();
  const permanentUri = `${RECORDINGS_DIR}${id}.m4a`;
  await FileSystem.copyAsync({ from: tempUri, to: permanentUri });
  return permanentUri;
}

export async function deleteRecordingFile(uri: string): Promise<void> {
  if (Platform.OS === "web") return;
  const fileInfo = await FileSystem.getInfoAsync(uri);
  if (fileInfo.exists) {
    await FileSystem.deleteAsync(uri);
  }
}

export async function createSound(uri: string): Promise<Audio.Sound> {
  await Audio.setAudioModeAsync({
    allowsRecordingIOS: false,
    playsInSilentModeIOS: true,
  });

  const { sound } = await Audio.Sound.createAsync({ uri });
  return sound;
}

export function formatDuration(ms: number): string {
  const totalSeconds = Math.floor(ms / 1000);
  const minutes = Math.floor(totalSeconds / 60);
  const seconds = totalSeconds % 60;
  return `${String(minutes).padStart(2, "0")}:${String(seconds).padStart(2, "0")}`;
}
