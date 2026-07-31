import { existsSync } from "fs";
import { describe, expect, test } from "bun:test";

import {
  APP_ROOT_DIR,
  APP_TMP_DIR,
  FART_SAMPLES_DIR,
  MELODIES_DIR,
} from "./paths.ts";

describe("paths", () => {
  test("resolves bundled audio assets from the repo instead of a hard-coded workspace path", (): void => {
    expect(FART_SAMPLES_DIR.startsWith(APP_ROOT_DIR)).toBe(true);
    expect(MELODIES_DIR.startsWith(APP_ROOT_DIR)).toBe(true);
    expect(existsSync(FART_SAMPLES_DIR)).toBe(true);
    expect(existsSync(MELODIES_DIR)).toBe(true);
  });

  test("uses a project-local tmp directory instead of the system tmp root", (): void => {
    expect(APP_TMP_DIR.startsWith(APP_ROOT_DIR)).toBe(true);
    expect(APP_TMP_DIR.startsWith("/tmp/")).toBe(false);
  });
});
