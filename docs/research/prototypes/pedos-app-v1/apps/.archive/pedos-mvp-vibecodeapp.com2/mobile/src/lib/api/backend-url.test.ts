import {
  buildBackendUrl,
  deriveBackendUrlFromHostUri,
  normalizeBackendUrl,
  resolveBackendUrlFromConfig,
} from "./backend-url";

describe("normalizeBackendUrl", () => {
  it("trims trailing slashes", () => {
    expect(normalizeBackendUrl("http://172.16.3.50:3002///")).toBe(
      "http://172.16.3.50:3002"
    );
  });
});

describe("deriveBackendUrlFromHostUri", () => {
  it("derives the backend host from an Expo host URI", () => {
    expect(deriveBackendUrlFromHostUri("172.16.3.50:8081")).toBe(
      "http://172.16.3.50:3002"
    );
  });

  it("returns null for an empty host URI", () => {
    expect(deriveBackendUrlFromHostUri("")).toBeNull();
  });
});

describe("resolveBackendUrlFromConfig", () => {
  it("prefers EXPO_PUBLIC_BACKEND_URL when present", () => {
    expect(
      resolveBackendUrlFromConfig({
        EXPO_PUBLIC_BACKEND_URL: "https://api.example.com/",
      })
    ).toBe("https://api.example.com");
  });

  it("falls back to the Expo dev host when no explicit backend URL is set", () => {
    expect(
      resolveBackendUrlFromConfig(
        {},
        {
          expoHostUri: "172.16.3.50:8081",
        }
      )
    ).toBe("http://172.16.3.50:3002");
  });

  it("throws a useful error when it cannot resolve a backend URL", () => {
    expect(() => resolveBackendUrlFromConfig({})).toThrow(
      "Backend URL is not configured"
    );
  });
});

describe("buildBackendUrl", () => {
  it("joins the base URL and path safely", () => {
    expect(
      buildBackendUrl("http://172.16.3.50:3002/", "/api/musical-fruit/samples")
    ).toBe("http://172.16.3.50:3002/api/musical-fruit/samples");
  });
});
