import { createHash } from "node:crypto";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { WebConfig } from "../config/schema.ts";
import { braveVideos as braveVideosProvider } from "../providers/brave.ts";
import { binaryExists, run } from "../runtime/runner.ts";
import type { KnowledgeDB } from "../runtime/db.ts";
import type { SemanticCache } from "../runtime/semantic-cache.ts";
import type { VideoResult } from "../types.ts";
import { normaliseQuery } from "../runtime/query-normalise.ts";
import { setLastCacheOutcome } from "../../runtime/last-cache-outcome.ts";

export interface VideoSearchArgs {
  query: string;
  count?: number;
  freshness?: "pd" | "pw" | "pm" | "py";
  transcript?: boolean;
  force?: boolean;
}

export interface VideoSearchDeps {
  db: KnowledgeDB;
  semanticCache: SemanticCache;
  cfg: WebConfig;
  braveVideos: (args: VideoSearchArgs) => Promise<VideoResult[]>;
  ytDlpTranscript: (url: string) => Promise<string>;
  geminiVideo: (url: string) => Promise<string>;
}

export interface VideoSearchResponse {
  results: VideoResult[];
  provider: "brave";
  cached: boolean | "soft";
  similarity?: number;
}

function stableNormalizeArgs(args: VideoSearchArgs): Record<string, unknown> {
  return {
    query: args.query.trim(),
    count: args.count ?? null,
    freshness: args.freshness ?? null,
    transcript: args.transcript ?? null,
    force: args.force ?? false,
  };
}

function hashQuery(tool: string, args: VideoSearchArgs): string {
  return createHash("sha256")
    .update(`${tool}:${JSON.stringify(stableNormalizeArgs(args))}`)
    .digest("hex");
}

function stripVtt(content: string): string {
  return content
    .replace(/^WEBVTT\s*/m, "")
    .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[.,]\d{3}[^\n]*/g, "")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
}

function stripSrt(content: string): string {
  return content
    .replace(/^\d+\s*$/gm, "")
    .replace(/\d{2}:\d{2}:\d{2}[.,]\d{3}\s+-->\s+\d{2}:\d{2}:\d{2}[.,]\d{3}[^\n]*/g, "")
    .replace(/<[^>]+>/g, "")
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean)
    .join(" ");
}

async function ytDlpTranscriptDefault(url: string, cfg: WebConfig): Promise<string> {
  if (!binaryExists("yt-dlp")) {
    throw new Error("yt-dlp not available");
  }

  const dir = mkdtempSync(join(tmpdir(), "pi-ytdlp-"));
  try {
    const langs = cfg.videoSearch.transcriptLangs.join(",");
    const args = [
      cfg.videoSearch.preferAutoSubs ? "--write-auto-sub" : "--write-sub",
      "--sub-langs",
      langs,
      "--sub-format",
      cfg.videoSearch.subtitleFormat,
      "--skip-download",
      "-o",
      join(dir, "%(id)s.%(ext)s"),
    ];

    if (cfg.providers.ytDlp.cookiesFromBrowser) {
      args.push("--cookies-from-browser", cfg.providers.ytDlp.cookiesFromBrowser);
    }
    args.push(url);

    const runResult = run("yt-dlp", args, cfg.providers.ytDlp.timeoutSec * 1000);
    if (!runResult.ok) {
      throw new Error(runResult.errorMsg ?? "yt-dlp failed");
    }

    const subtitleFile = readdirSync(dir).find((name) => name.endsWith(".vtt") || name.endsWith(".srt"));
    if (!subtitleFile) {
      throw new Error("no subtitle file produced by yt-dlp");
    }

    const raw = readFileSync(join(dir, subtitleFile), "utf8");
    const clean = subtitleFile.endsWith(".vtt") ? stripVtt(raw) : stripSrt(raw);
    return clean.slice(0, cfg.videoSearch.maxTranscriptChars);
  } finally {
    try {
      rmSync(dir, { recursive: true, force: true });
    } catch {
      // best-effort cleanup
    }
  }
}

async function geminiVideoDefault(url: string, cfg: WebConfig): Promise<string> {
  const envName = cfg.providers.gemini.apiKeyEnv;
  const apiKey = cfg.secrets[envName];
  if (!apiKey) {
    throw new Error(`no ${envName}`);
  }

  const model = cfg.providers.gemini.videoModel;
  const prompt = `Create a concise timestamped summary for this video URL. Output format: [mm:ss] point. URL: ${url}`;
  const response = await fetch(
    `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent?key=${apiKey}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        contents: [{ role: "user", parts: [{ text: prompt }] }],
      }),
    },
  );

  if (!response.ok) {
    throw new Error(`Gemini video ${response.status}: ${await response.text()}`);
  }

  const json = (await response.json()) as any;
  return json.candidates?.[0]?.content?.parts?.[0]?.text ?? "";
}

async function withConcurrency<T>(tasks: (() => Promise<T>)[], limit: number): Promise<T[]> {
  const results: T[] = [];
  let i = 0;
  async function run(): Promise<void> {
    while (i < tasks.length) {
      const idx = i++;
      results[idx] = await tasks[idx]();
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, tasks.length) }, run));
  return results;
}

export async function handleVideoSearch(
  args: VideoSearchArgs,
  deps: VideoSearchDeps,
): Promise<VideoSearchResponse> {
  const { db, semanticCache, cfg } = deps;
  const now = Date.now();
  const ttl = cfg.semanticCache.ttl.video_search;
  const normQuery = normaliseQuery(args.query);

  if (!args.force) {
    const hit = await semanticCache.lookup("video_search", normQuery);
    setLastCacheOutcome({
      tool: "video_search",
      outcome: hit.kind,
      similarity: (hit.kind === "hard" || hit.kind === "soft") ? hit.similarity : null,
    });
    if (
      hit.kind === "l1_hit" &&
      hit.result &&
      typeof hit.result === "object" &&
      "results" in hit.result &&
      Array.isArray((hit.result as Record<string, unknown>).results) &&
      (hit.result as Record<string, unknown>).provider === "brave"
    ) {
      const cachedResult = hit.result as { results: VideoResult[]; provider: "brave"; similarity?: number };
      return { ...cachedResult, cached: true };
    }
    if (hit.kind === "hard" || hit.kind === "soft") {
      const q = db.getQueryByHash(hit.queryHash);
      if (q) {
        const rows = db.raw
          .query<any, [string]>(`
            SELECT
              j.value AS url,
              p.title AS title,
              p.provider AS provider,
              p.metadata AS metadata
            FROM queries q
            JOIN json_each(q.result_urls) j
            LEFT JOIN pages p ON p.url = j.value
            WHERE q.query_hash = ?
            ORDER BY j.key ASC
          `)
          .all(hit.queryHash);

        const results: VideoResult[] = rows.map((row: any) => {
          let duration: string | undefined;
          let thumbnail: string | undefined;
          let transcript: string | undefined;
          if (row.metadata) {
            try {
              const parsed = JSON.parse(String(row.metadata)) as {
                duration?: string;
                thumbnail?: string;
                transcript?: string;
              };
              duration = parsed.duration;
              thumbnail = parsed.thumbnail;
              transcript = parsed.transcript;
            } catch {
              // ignore malformed metadata
            }
          }

          return {
            title: row.title ?? "",
            url: row.url,
            duration,
            thumbnail,
            transcript,
            provider: "brave",
          };
        });

        return {
          results,
          provider: "brave",
          cached: hit.kind === "hard" ? true : "soft",
          similarity: hit.similarity,
        };
      }
    }
  } else {
    setLastCacheOutcome({ tool: "video_search", outcome: "miss", similarity: null });
  }

  const results = await deps.braveVideos(args);
  const transcriptEnabled = args.transcript ?? cfg.videoSearch.transcript;

  const tasks = results.map((result) => async (): Promise<VideoResult> => {
    let transcript: string | undefined;
    let summary: string | undefined;

    if (transcriptEnabled && result.url) {
      try {
        const maybeTranscript = await deps.ytDlpTranscript(result.url);
        if (typeof maybeTranscript === "string" && maybeTranscript.trim().length > 0) {
          transcript = maybeTranscript.slice(0, cfg.videoSearch.maxTranscriptChars);
        }
      } catch {
        // fall through to Gemini fallback
      }

      if (!transcript && cfg.videoSearch.geminiFallback === "timestamped_summary") {
        try {
          const maybeSummary = await deps.geminiVideo(result.url);
          if (typeof maybeSummary === "string" && maybeSummary.trim().length > 0) {
            summary = maybeSummary;
          }
        } catch {
          // non-fatal
        }
      }
    }

    db.upsertPage({
      url: result.url,
      title: result.title,
      kind: "video",
      provider: "brave",
      metadata: JSON.stringify({
        duration: result.duration,
        thumbnail: result.thumbnail,
        ...(transcript ? { transcript } : {}),
        ...(summary ? { summary } : {}),
      }),
      expiresAt: now + ttl,
    });

    return {
      ...result,
      ...(transcript ? { transcript } : {}),
    };
  });

  const enriched = await withConcurrency(tasks, 3);

  const queryHash = hashQuery("video_search", { ...args, query: normQuery });

  const finalResult: VideoSearchResponse = {
    results: enriched,
    provider: "brave",
    cached: false,
  };

  await semanticCache.store(
    {
      tool: "video_search",
      queryText: normQuery,
      queryHash,
      provider: "brave",
      answer: null,
      resultUrls: enriched.map((r) => r.url).filter(Boolean),
      expiresAt: now + ttl,
    },
    args.query,
    finalResult
  );

  return finalResult;
}

export function registerVideoSearch(pi: ExtensionAPI, deps: Omit<VideoSearchDeps, "braveVideos" | "ytDlpTranscript" | "geminiVideo"> & Partial<Pick<VideoSearchDeps, "braveVideos" | "ytDlpTranscript" | "geminiVideo">>): void {
  pi.registerTool({
    name: "video_search",
    label: "Video Search",
    description: "Search videos via Brave with semantic-cache replay and transcript enrichment.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      count: Type.Optional(Type.Number({ minimum: 1, maximum: 20 })),
      freshness: Type.Optional(
        Type.Union([
          Type.Literal("pd"),
          Type.Literal("pw"),
          Type.Literal("pm"),
          Type.Literal("py"),
        ]),
      ),
      transcript: Type.Optional(Type.Boolean({ description: "Enable yt-dlp transcript retrieval" })),
      force: Type.Optional(Type.Boolean({ description: "Bypass semantic cache" })),
    }),
    async execute(_toolCallId, rawArgs) {
      const args = rawArgs as VideoSearchArgs;

      const merged: VideoSearchArgs = {
        query: args.query,
        count: args.count ?? deps.cfg.videoSearch.count,
        freshness: args.freshness ?? (deps.cfg.videoSearch.freshness ?? undefined),
        transcript: args.transcript ?? deps.cfg.videoSearch.transcript,
        force: args.force,
      };

      const result = await handleVideoSearch(merged, {
        ...deps,
        braveVideos:
          deps.braveVideos ??
          (async (a) =>
            Promise.resolve(
              braveVideosProvider(
                a.query,
                { count: a.count, freshness: a.freshness ?? null },
                deps.cfg,
              ),
            )),
        ytDlpTranscript: deps.ytDlpTranscript ?? ((url) => ytDlpTranscriptDefault(url, deps.cfg)),
        geminiVideo: deps.geminiVideo ?? ((url) => geminiVideoDefault(url, deps.cfg)),
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
