import { Type } from "@sinclair/typebox";
import type { ExtensionAPI } from "@mariozechner/pi-coding-agent";
import type { WebConfig } from "../config/schema.ts";
import type { KnowledgeDB } from "../runtime/db.ts";
import type { CodeResult } from "../types.ts";
import { ctx7Search } from "../providers/ctx7.ts";
import { ghSearchCode, ghSearchRepos, githubAvailable as realGithubAvailable } from "../providers/github.ts";

export interface CodeSearchArgs {
  query: string;
  library?: string;
  language?: string;
  owner?: string;
  limit?: number;
}

export interface CodeSearchDeps {
  // Intentionally unused by this tool (DB-bypass behavior).
  db?: KnowledgeDB;
  cfg: WebConfig;
  ctx7: (args: CodeSearchArgs) => Promise<CodeResult[]>;
  github: (args: CodeSearchArgs) => Promise<CodeResult[]>;
  githubAvailable?: () => Promise<boolean>;
}

export interface CodeSearchResponse {
  results: CodeResult[];
  provider: "ctx7+github";
  cached: false;
}

export async function handleCodeSearch(
  args: CodeSearchArgs,
  deps: CodeSearchDeps,
): Promise<CodeSearchResponse> {
  // DB-bypass by design: this tool never reads/writes KnowledgeDB.
  const cfgLimit = Math.max(1, deps.cfg.codeSearch.limit);
  const limit = Math.min(cfgLimit, Math.max(1, args.limit ?? cfgLimit));

  const ctx7Results = deps.cfg.providers.ctx7.enabled
    ? await deps.ctx7(args).catch(() => [])
    : [];

  const isGithubAvailable = deps.githubAvailable ?? realGithubAvailable;
  const shouldUseGithub = deps.cfg.providers.github.enabled && (await isGithubAvailable().catch(() => false));
  const githubResults = shouldUseGithub
    ? await deps.github(args).catch(() => [])
    : [];

  const results = [...ctx7Results, ...githubResults].slice(0, limit);

  return {
    results,
    provider: "ctx7+github",
    cached: false,
  };
}

export function registerCodeSearch(
  pi: ExtensionAPI,
  deps: { cfg: WebConfig; db?: KnowledgeDB } | WebConfig,
): void {
  const cfg = ("cfg" in deps ? deps.cfg : deps);
  pi.registerTool({
    name: "code_search",
    label: "Code Search",
    description: "Search Context7 docs and GitHub code with auth-gated GitHub fallback.",
    parameters: Type.Object({
      query: Type.String({ description: "Search query" }),
      library: Type.Optional(Type.String({ description: "Library/package name for Context7 lookup" })),
      language: Type.Optional(Type.String({ description: "Programming language filter for GitHub" })),
      owner: Type.Optional(Type.String({ description: "GitHub org/user filter" })),
    }),
    async execute(_toolCallId, rawArgs) {
      const args = rawArgs as CodeSearchArgs;

      const result = await handleCodeSearch(args, {
        cfg,
        ctx7: async (a) => ctx7Search(a.query, { library: a.library }, cfg),
        github: async (a) => {
          const [code, repos] = await Promise.all([
            Promise.resolve(ghSearchCode(a.query, {
              language: a.language,
              owner: a.owner,
              limit: cfg.codeSearch.limit,
            }, cfg)),
            Promise.resolve(ghSearchRepos(a.query, {
              language: a.language,
              limit: Math.min(10, cfg.codeSearch.limit),
            }, cfg)),
          ]);
          return [...code, ...repos];
        },
      });

      return {
        content: [{ type: "text", text: JSON.stringify(result) }],
        details: result,
      };
    },
  });
}
