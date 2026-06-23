import { existsSync } from "node:fs";
import { join } from "node:path";
import { homedir } from "node:os";

export type GoogleTransportSelection =
  | { kind: "vertex" }
  | { kind: "ai-studio" }
  | { kind: "none"; reason: string };

function adcAvailable(): boolean {
  if (process.env.GOOGLE_APPLICATION_CREDENTIALS) return true;
  const home = homedir();
  if (!home) return false;
  const wellKnown = join(home, ".config", "gcloud", "application_default_credentials.json");
  try {
    return existsSync(wellKnown);
  } catch {
    return false;
  }
}

export function selectGoogleTransport(transport: "auto" | "vertex" | "ai-studio"): GoogleTransportSelection {
  if (transport === "ai-studio") {
    const key = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
    if (!key) {
      return { kind: "none", reason: "AI Studio transport requires GEMINI_API_KEY or GOOGLE_API_KEY" };
    }
    return { kind: "ai-studio" };
  }

  if (transport === "vertex") {
    const project = process.env.GOOGLE_CLOUD_PROJECT;
    if (!project) {
      return { kind: "none", reason: "Vertex AI transport requires GOOGLE_CLOUD_PROJECT" };
    }
    if (!adcAvailable()) {
      return { kind: "none", reason: "Vertex AI transport requires GOOGLE_APPLICATION_CREDENTIALS or well-configured ADC" };
    }
    return { kind: "vertex" };
  }

  // auto
  const aiStudioKey = process.env.GEMINI_API_KEY ?? process.env.GOOGLE_API_KEY;
  if (aiStudioKey) return { kind: "ai-studio" };

  const hasProject = !!process.env.GOOGLE_CLOUD_PROJECT;
  const hasAdc = adcAvailable();
  if (hasProject && hasAdc) return { kind: "vertex" };

  const parts: string[] = [];
  if (!aiStudioKey) parts.push("no GEMINI_API_KEY or GOOGLE_API_KEY");
  if (!hasProject) parts.push("no GOOGLE_CLOUD_PROJECT");
  if (!hasAdc) parts.push("no ADC credentials");
  return { kind: "none", reason: `No Google credentials: ${parts.join("; ")}` };
}
