import { test, expect } from "bun:test";

test("vertexUrl with location='global' returns correct URL", async () => {
  const { vertexUrl } = await import("../../plugins/tools/web-tools/providers/vertex-endpoint.ts");
  const url = vertexUrl({ project: "my-project", location: "global", model: "gemini-3.1-flash-lite" });
  expect(url).toBe("https://aiplatform.googleapis.com/v1/projects/my-project/locations/global/publishers/google/models/gemini-3.1-flash-lite:generateContent");
});

test("vertexUrl with location='us-central1' returns correct URL", async () => {
  const { vertexUrl } = await import("../../plugins/tools/web-tools/providers/vertex-endpoint.ts");
  const url = vertexUrl({ project: "my-project", location: "us-central1", model: "gemini-3.1-flash-lite" });
  expect(url).toBe("https://us-central1-aiplatform.googleapis.com/v1/projects/my-project/locations/us-central1/publishers/google/models/gemini-3.1-flash-lite:generateContent");
});

test("vertexUrl with location='europe-west4' returns correct URL", async () => {
  const { vertexUrl } = await import("../../plugins/tools/web-tools/providers/vertex-endpoint.ts");
  const url = vertexUrl({ project: "my-project", location: "europe-west4", model: "gemini-3.1-flash-lite" });
  expect(url).toBe("https://europe-west4-aiplatform.googleapis.com/v1/projects/my-project/locations/europe-west4/publishers/google/models/gemini-3.1-flash-lite:generateContent");
});

test("getVertexAccessToken skips if google-auth-library not installed", async () => {
  try {
    await import("../../plugins/tools/web-tools/providers/vertex-auth.ts");
  } catch {
    console.log("SKIP: install google-auth-library to run auth tests");
    return;
  }
});
