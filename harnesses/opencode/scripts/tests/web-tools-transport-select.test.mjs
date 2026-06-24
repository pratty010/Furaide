import { test, expect, describe, beforeAll, afterAll } from "bun:test";

const ORIG_ENV = {};

function saveEnv(keys) {
  for (const k of keys) ORIG_ENV[k] = process.env[k];
}

function restoreEnv(keys) {
  for (const k of keys) {
    if (ORIG_ENV[k] === undefined) delete process.env[k];
    else process.env[k] = ORIG_ENV[k];
  }
}

describe("selectGoogleTransport", () => {
  describe("auto mode", () => {
    const KEYS = ["GEMINI_API_KEY", "GOOGLE_API_KEY", "GOOGLE_CLOUD_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS"];

    beforeAll(() => saveEnv(KEYS));
    afterAll(() => restoreEnv(KEYS));

    test("with GEMINI_API_KEY set returns ai-studio", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_CLOUD_PROJECT;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

      const { selectGoogleTransport } = await import("../../plugins/web-tools/providers/transport-select.ts");
      const result = selectGoogleTransport("auto");
      expect(result.kind).toBe("ai-studio");
    });

    test("with GOOGLE_API_KEY set (no GEMINI_API_KEY) returns ai-studio", async () => {
      delete process.env.GEMINI_API_KEY;
      process.env.GOOGLE_API_KEY = "test-key";
      delete process.env.GOOGLE_CLOUD_PROJECT;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

      const { selectGoogleTransport } = await import("../../plugins/web-tools/providers/transport-select.ts");
      const result = selectGoogleTransport("auto");
      expect(result.kind).toBe("ai-studio");
    });

    test("with GOOGLE_CLOUD_PROJECT + GOOGLE_APPLICATION_CREDENTIALS (no API key) returns vertex", async () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      process.env.GOOGLE_CLOUD_PROJECT = "my-project";
      process.env.GOOGLE_APPLICATION_CREDENTIALS = "/fake/path";

      const { selectGoogleTransport } = await import("../../plugins/web-tools/providers/transport-select.ts");
      const result = selectGoogleTransport("auto");
      expect(result.kind).toBe("vertex");
    });

    test("with neither API key nor Vertex env returns none", async () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;
      delete process.env.GOOGLE_CLOUD_PROJECT;
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

      const { selectGoogleTransport } = await import("../../plugins/web-tools/providers/transport-select.ts");
      const result = selectGoogleTransport("auto");
      expect(result.kind).toBe("none");
      expect(result.reason).toContain("No Google credentials");
    });

    test("prefers AI Studio over Vertex when both are set", async () => {
      process.env.GEMINI_API_KEY = "test-key";
      process.env.GOOGLE_CLOUD_PROJECT = "my-project";
      process.env.GOOGLE_APPLICATION_CREDENTIALS = "/fake/path";

      const { selectGoogleTransport } = await import("../../plugins/web-tools/providers/transport-select.ts");
      const result = selectGoogleTransport("auto");
      expect(result.kind).toBe("ai-studio");
    });
  });

  describe("vertex mode", () => {
    const KEYS = ["GOOGLE_CLOUD_PROJECT", "GOOGLE_APPLICATION_CREDENTIALS"];

    beforeAll(() => saveEnv(KEYS));
    afterAll(() => restoreEnv(KEYS));

    test("without GOOGLE_CLOUD_PROJECT returns none", async () => {
      delete process.env.GOOGLE_CLOUD_PROJECT;
      process.env.GOOGLE_APPLICATION_CREDENTIALS = "/fake/path";

      const { selectGoogleTransport } = await import("../../plugins/web-tools/providers/transport-select.ts");
      const result = selectGoogleTransport("vertex");
      expect(result.kind).toBe("none");
      expect(result.reason).toContain("GOOGLE_CLOUD_PROJECT");
    });

    test("without ADC returns none", async () => {
      process.env.GOOGLE_CLOUD_PROJECT = "my-project";
      delete process.env.GOOGLE_APPLICATION_CREDENTIALS;

      const { selectGoogleTransport } = await import("../../plugins/web-tools/providers/transport-select.ts");
      const result = selectGoogleTransport("vertex");
      // Without GOOGLE_APPLICATION_CREDENTIALS and no well-known file, should be none
      expect(result.kind).toBe("none");
    });
  });

  describe("ai-studio mode", () => {
    const KEYS = ["GEMINI_API_KEY", "GOOGLE_API_KEY"];

    beforeAll(() => saveEnv(KEYS));
    afterAll(() => restoreEnv(KEYS));

    test("without either key returns none", async () => {
      delete process.env.GEMINI_API_KEY;
      delete process.env.GOOGLE_API_KEY;

      const { selectGoogleTransport } = await import("../../plugins/web-tools/providers/transport-select.ts");
      const result = selectGoogleTransport("ai-studio");
      expect(result.kind).toBe("none");
      expect(result.reason).toContain("requires GEMINI_API_KEY");
    });

    test("with GEMINI_API_KEY returns ai-studio", async () => {
      process.env.GEMINI_API_KEY = "test-key";

      const { selectGoogleTransport } = await import("../../plugins/web-tools/providers/transport-select.ts");
      const result = selectGoogleTransport("ai-studio");
      expect(result.kind).toBe("ai-studio");
    });
  });
});
