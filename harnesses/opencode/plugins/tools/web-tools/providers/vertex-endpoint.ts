export interface VertexUrlParams {
  project: string;
  location: string;
  model: string;
  apiVersion?: "v1" | "v1beta1";
}

// v1 is GA and the version used by the official Vertex Python SDK
// (`genai.Client(http_options=HttpOptions(api_version="v1"))`).
// v1beta1 is the older documented REST endpoint for Maps Grounding.
// If Maps Grounding returns empty groundingChunks on v1 in your account,
// flip apiVersion to "v1beta1" here (or via a future config knob).
export function vertexUrl({ project, location, model, apiVersion = "v1" }: VertexUrlParams): string {
  const host = location === "global"
    ? "aiplatform.googleapis.com"
    : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/${apiVersion}/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
}
