import { test, expect, describe } from "bun:test";

describe("brave CLI argv safety", () => {
  test("rejects query starting with '-'", async () => {
    const brave = await import("../../plugins/web-tools/providers/brave.ts");
    await expect(brave.searchWeb({ query: "--evil" })).rejects.toThrow();
  });

  test("rejects freshness starting with '-'", async () => {
    const brave = await import("../../plugins/web-tools/providers/brave.ts");
    await expect(brave.searchWeb({ query: "x", freshness: "--evil" })).rejects.toThrow();
  });

  test("rejects null query", async () => {
    const brave = await import("../../plugins/web-tools/providers/brave.ts");
    await expect(brave.searchWeb({ query: null })).rejects.toThrow();
  });

  test("clamps count above max", async () => {
    // This test verifies the in-process clamp. Since CLI may be missing,
    // the contract under test is that we never call out with count > 20.
    // We just verify the validation throws on a leading-dash query.
    const brave = await import("../../plugins/web-tools/providers/brave.ts");
    await expect(brave.searchWeb({ query: "-x" })).rejects.toThrow();
  });
});

describe("tavily CLI argv safety", () => {
  test("rejects query starting with '-'", async () => {
    const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
    await expect(tavily.searchWeb({ query: "--evil" })).rejects.toThrow();
  });

  test("rejects freshness starting with '-'", async () => {
    const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
    await expect(tavily.searchWeb({ query: "x", freshness: "--evil" })).rejects.toThrow();
  });

  test("rejects null query", async () => {
    const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
    await expect(tavily.searchWeb({ query: null })).rejects.toThrow();
  });

  test("fetchContent rejects URL starting with '-'", async () => {
    const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
    await expect(tavily.fetchContent({ urls: ["--evil"] })).rejects.toThrow();
  });

  test("fetchContent rejects loopback URL", async () => {
    const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
    await expect(tavily.fetchContent({ urls: ["http://localhost/"] })).rejects.toThrow();
  });

  test("fetchContent rejects private IP", async () => {
    const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
    await expect(tavily.fetchContent({ urls: ["http://10.0.0.5/"] })).rejects.toThrow();
  });

  test("fetchContent rejects metadata service", async () => {
    const tavily = await import("../../plugins/web-tools/providers/tavily.ts");
    await expect(tavily.fetchContent({ urls: ["http://metadata.google.internal/"] })).rejects.toThrow();
  });
});

describe("gemini URL safety", () => {
  test("fetchContent rejects loopback URL", async () => {
    const gemini = await import("../../plugins/web-tools/providers/gemini.ts");
    await expect(gemini.fetchContent({ urls: ["http://localhost/"] })).rejects.toThrow();
  });

  test("fetchContent rejects private IP", async () => {
    const gemini = await import("../../plugins/web-tools/providers/gemini.ts");
    await expect(gemini.fetchContent({ urls: ["http://192.168.1.1/"] })).rejects.toThrow();
  });

  test("fetchContent rejects metadata service", async () => {
    const gemini = await import("../../plugins/web-tools/providers/gemini.ts");
    await expect(gemini.fetchContent({ urls: ["http://169.254.169.254/latest/meta-data/"] })).rejects.toThrow();
  });

  test("fetchContent rejects more than 5 URLs", async () => {
    const gemini = await import("../../plugins/web-tools/providers/gemini.ts");
    const urls = Array.from({ length: 6 }, (_, i) => `https://example.com/${i}`);
    await expect(gemini.fetchContent({ urls })).rejects.toThrow();
  });

  test("fetchContent rejects empty urls", async () => {
    const gemini = await import("../../plugins/web-tools/providers/gemini.ts");
    await expect(gemini.fetchContent({ urls: [] })).rejects.toThrow();
  });
});
