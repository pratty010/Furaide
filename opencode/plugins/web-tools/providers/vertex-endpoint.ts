export interface VertexUrlParams {
  project: string;
  location: string;
  model: string;
}

export function vertexUrl({ project, location, model }: VertexUrlParams): string {
  const host = location === "global"
    ? "aiplatform.googleapis.com"
    : `${location}-aiplatform.googleapis.com`;
  return `https://${host}/v1/projects/${project}/locations/${location}/publishers/google/models/${model}:generateContent`;
}
