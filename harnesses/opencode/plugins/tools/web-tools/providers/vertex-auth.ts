import { GoogleAuth } from "google-auth-library";

let cachedToken: { token: string; expiresAt: number } | null = null;

export async function getVertexAccessToken(): Promise<string> {
  if (cachedToken && Date.now() < cachedToken.expiresAt - 60_000) {
    return cachedToken.token;
  }

  const auth = new GoogleAuth({
    scopes: "https://www.googleapis.com/auth/cloud-platform",
  });

  const client = await auth.getClient();
  const token = await client.getAccessToken();

  if (!token?.token) {
    throw new Error(
      "Failed to obtain Vertex AI access token: no token returned. "
      + "Ensure GOOGLE_APPLICATION_CREDENTIALS is set or ADC is configured."
    );
  }

  const expiresAt = token.res?.data?.expires_in
    ? Date.now() + (Number(token.res.data.expires_in) - 60) * 1000
    : Date.now() + 59 * 60 * 1000;

  cachedToken = { token: token.token, expiresAt };
  return token.token;
}
