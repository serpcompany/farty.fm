import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import AsyncStorage from "@react-native-async-storage/async-storage";

interface SettingsStore {
  autoStartOnForeground: boolean;
  setAutoStartOnForeground: (value: boolean) => void;
}

const useSettingsStore = create<SettingsStore>()(
  persist(
    (set) => ({
      autoStartOnForeground: false,
      setAutoStartOnForeground: (value) => set({ autoStartOnForeground: value }),
    }),
    {
      name: "settings-storage",
      storage: createJSONStorage(() => AsyncStorage),
    }
  )
);

export default useSettingsStore;
