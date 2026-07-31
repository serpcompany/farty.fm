import { mkdirSync } from "fs";
import { dirname, join, resolve } from "path";
import { fileURLToPath } from "url";

const CURRENT_DIR: string = dirname(fileURLToPath(import.meta.url));

export const BACKEND_DIR: string = resolve(CURRENT_DIR, "..", "..");
export const APP_ROOT_DIR: string = resolve(CURRENT_DIR, "..", "..", "..");

export const TEST_DATA_DIR: string = join(APP_ROOT_DIR, "test-data");
export const FART_SAMPLES_DIR: string = join(TEST_DATA_DIR, "fart-samples");
export const FART_SAMPLES_CACHE_PATH: string = join(FART_SAMPLES_DIR, "analysis.json");
export const MELODIES_DIR: string = join(TEST_DATA_DIR, "melodies");

export const APP_TMP_DIR: string = join(APP_ROOT_DIR, "tmp");
export const BACKEND_TMP_DIR: string = join(APP_TMP_DIR, "backend");
export const MUSICAL_FRUIT_OUTPUT_DIR: string = join(BACKEND_TMP_DIR, "musical-fruit-output");
export const AUDIO_COMPARE_TMP_DIR: string = join(BACKEND_TMP_DIR, "audio-compare");
export const QUALITY_TEST_OUTPUT_DIR: string = join(BACKEND_TMP_DIR, "quality-test-output");

export function ensureDirectory(path: string): string {
  mkdirSync(path, { recursive: true });
  return path;
}
