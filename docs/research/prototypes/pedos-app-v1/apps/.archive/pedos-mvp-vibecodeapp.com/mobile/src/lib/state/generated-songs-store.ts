import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

export interface GeneratedSong {
  id: string;
  melodyKey: string;
  melodyName: string;
  filename: string;
  url: string;
  sampleNames: string[];
  createdAt: string;
  status: "generating" | "ready" | "error";
  durationSeconds?: number;
}

interface GeneratedSongsStore {
  songs: GeneratedSong[];
  addSong: (song: GeneratedSong) => void;
  updateSong: (id: string, updates: Partial<GeneratedSong>) => void;
  deleteSong: (id: string) => void;
}

const useGeneratedSongsStore = create<GeneratedSongsStore>()(
  persist(
    (set, get) => ({
      songs: [],
      addSong: (song: GeneratedSong) =>
        set({ songs: [song, ...get().songs] }),
      updateSong: (id: string, updates: Partial<GeneratedSong>) =>
        set({
          songs: get().songs.map((s) =>
            s.id === id ? { ...s, ...updates } : s
          ),
        }),
      deleteSong: (id: string) =>
        set({ songs: get().songs.filter((s) => s.id !== id) }),
    }),
    {
      name: "generated-songs-storage",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

export default useGeneratedSongsStore;
