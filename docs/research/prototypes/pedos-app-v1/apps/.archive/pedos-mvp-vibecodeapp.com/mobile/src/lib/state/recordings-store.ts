import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface RecordingLocation {
  latitude: number;
  longitude: number;
  city?: string;
  region?: string;
  country?: string;
}

export interface RecordingAnalysis {
  brightness: number;   // 0–1, zero-crossing rate (0 = bassy, 1 = squeaky)
  loudness: number;     // mean dB (e.g. -21.4)
  duration: number;     // seconds from audio analysis
}

export interface Recording {
  id: string;
  uri: string;
  duration: number;       // milliseconds from the recording API
  createdAt: string;      // ISO date string
  title: string | null;
  location?: RecordingLocation;
  analysis?: RecordingAnalysis;
}

interface RecordingsStore {
  recordings: Recording[];
  addRecording: (recording: Recording) => void;
  deleteRecording: (id: string) => void;
}

const useRecordingsStore = create<RecordingsStore>()(
  persist(
    (set, get) => ({
      recordings: [],
      addRecording: (recording: Recording) =>
        set({ recordings: [recording, ...get().recordings] }),
      deleteRecording: (id: string) =>
        set({ recordings: get().recordings.filter((r) => r.id !== id) }),
    }),
    {
      name: "recordings-storage",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

export default useRecordingsStore;
