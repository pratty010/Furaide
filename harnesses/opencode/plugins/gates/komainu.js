// Komainu (Security Patterns) — The shrine-guardian pair that screens edits for dangerous patterns.
// Part of Furaidē's shikigami — F.R.I.D.A.Y. collection (https://github.com/pratty010/F.R.I.D.A.Y)
/**
 * komainu.js
 * opencode plugin: Edit/Write security pattern gate.
 * First hit per pattern per session: SECURITY WARNING (agent can fix + retry).
 * Second+ hit same pattern same session: SECURITY ESCALATION (human verification required).
 * No-op for all non-Edit/Write tools. Autonomy preserved.
 */

const PATTERNS = [
  // --- Workflow / state integrity ---
  { key: 'state-json-direct',
    label: 'Direct write to state.json (use workflow-state.mjs instead)',
    test: ({ tool, args }) => tool === 'write' && /\bstate\.json$/.test(args?.file_path || '') },
  { key: 'workflow-force',
    label: 'workflow-state advance --force without explicit user auth',
    test: ({ args }) => /workflow.state.*advance.*--force/.test(args?.content || args?.new_string || '') },
  { key: 'active-workflow-direct',
    label: 'Direct write to .opencode-active-workflow (managed by workflow-state.mjs)',
    test: ({ tool, args }) => tool === 'write' && /\.opencode-active-workflow/.test(args?.file_path || '') },

  // --- Model routing violations ---
  { key: 'gemini-25',
    label: 'Banned model gemini-2.5-* referenced (removed from whitelist)',
    test: ({ args }) => /gemini-2\.5-/.test(args?.content || args?.new_string || '') },
  { key: 'plugin-removal',
    label: 'gate-enforcer or model-failover removed from opencode.jsonc plugin array',
    test: ({ args }) =>
      /opencode\.jsonc/.test(args?.file_path || '') && (
        !/gate-enforcer/.test(args?.content || '') ||
        !/model-failover/.test(args?.content || '')
      ) },
  { key: 'whitelist-banned',
    label: 'Banned model family added back to opencode.jsonc whitelist',
    test: ({ args }) =>
      /opencode\.jsonc/.test(args?.file_path || '') &&
      /gemini-2\.5-/.test(args?.content || '') },

  // --- Secrets / credentials ---
  { key: 'api-key-sk',
    label: 'Hardcoded OpenAI/Anthropic API key (sk- prefix)',
    test: ({ args }) => /["']sk-[A-Za-z0-9]{8,}/.test(args?.content || args?.new_string || '') },
  { key: 'api-key-aiza',
    label: 'Hardcoded Google API key (AIza prefix)',
    test: ({ args }) => /["']AIza[A-Za-z0-9_-]{30,}/.test(args?.content || args?.new_string || '') },
  { key: 'api-key-github',
    label: 'Hardcoded GitHub token (ghp_ / github_pat_)',
    test: ({ args }) => /["'](ghp_|github_pat_)[A-Za-z0-9]{20,}/.test(args?.content || args?.new_string || '') },
  { key: 'api-key-aws',
    label: 'Hardcoded AWS access key (AKIA prefix)',
    test: ({ args }) => /["']AKIA[A-Z0-9]{16}/.test(args?.content || args?.new_string || '') },
  { key: 'api-key-slack',
    label: 'Hardcoded Slack token (xoxb- / xoxp-)',
    test: ({ args }) => /["'](xoxb|xoxp)-[A-Za-z0-9-]{20,}/.test(args?.content || args?.new_string || '') },
  { key: 'private-key',
    label: 'Private key block in content',
    test: ({ args }) => /BEGIN (RSA |EC |OPENSSH |PRIVATE )?PRIVATE KEY/.test(args?.content || args?.new_string || '') },
  { key: 'bearer-literal',
    label: 'Hardcoded Bearer token in string literal',
    test: ({ args }) => /["']Bearer [A-Za-z0-9._-]{20,}/.test(args?.content || args?.new_string || '') },
  { key: 'env-credential',
    label: '.env write with credential-shaped value (_KEY=/_SECRET=/_TOKEN=/_PASSWORD=)',
    test: ({ tool, args }) =>
      tool === 'write' &&
      /\.env/.test(args?.file_path || '') &&
      /(_KEY|_SECRET|_TOKEN|_PASSWORD)=[^\s]{8,}/.test(args?.content || '') },

  // --- DevOps / SRE ---
  { key: 'rm-rf',
    label: 'rm -rf without rollback annotation',
    test: ({ args }) => {
      const text = args?.content || args?.new_string || '';
      return /\brm -rf\b/.test(text) && !/rollback/i.test(text);
    }},
  { key: 'no-verify',
    label: 'git --no-verify (pre-commit hook bypass)',
    test: ({ args }) => /--no-verify/.test(args?.content || args?.new_string || '') },
  { key: 'prod-db-url',
    label: 'Production DB connection string with embedded credentials',
    test: ({ args }) => /\b(postgres|mysql|mongodb):\/\/[^@]+:[^@]+@/.test(args?.content || args?.new_string || '') },
  { key: 'unsafe-exec',
    label: 'exec()/spawn() with non-literal argument (possible command injection)',
    test: ({ args }) => /\b(exec|spawn)\s*\(\s*[^"'`]/.test(args?.content || args?.new_string || '') },

  // --- Security domain (PoC / exploit) ---
  { key: 'eval-dynamic',
    label: 'eval() with non-literal argument (possible code injection)',
    test: ({ args }) => /\beval\s*\(\s*[^"'`\d]/.test(args?.content || args?.new_string || '') },
  { key: 'inner-html',
    label: 'Raw innerHTML or dangerouslySetInnerHTML assignment',
    test: ({ args }) => /innerHTML\s*=|dangerouslySetInnerHTML/.test(args?.content || args?.new_string || '') },
  { key: 'path-traversal',
    label: 'Path traversal pattern (../../..)',
    test: ({ args }) => /\.\.[\/\\]\.\.[\/\\]\.\./.test(args?.content || args?.new_string || '') },
  { key: 'ssrf',
    label: 'Possible SSRF: user-controlled variable passed directly to fetch/requests.get',
    test: ({ args }) => /\b(fetch|requests\.get)\s*\(\s*[a-zA-Z_$][a-zA-Z0-9_$]*\s*[,)]/.test(args?.content || args?.new_string || '') },
  { key: 'sql-inject',
    label: 'SQL string concatenation (possible injection vector)',
    test: ({ args }) => /["']SELECT\b[^"']*["']\s*\+|f["']SELECT\s*\{/.test(args?.content || args?.new_string || '') },

  // --- Unsafe deserialization ---
  { key: 'yaml-unsafe',
    label: 'yaml.load() without Loader= (unsafe deserialization)',
    test: ({ args }) => {
      const t = args?.content || args?.new_string || '';
      return /yaml\.load\s*\(/.test(t) && !/Loader=/.test(t);
    }},
  { key: 'pickle-load',
    label: 'pickle.load() — unsafe on untrusted data',
    test: ({ args }) => /pickle\.load\s*\(/.test(args?.content || args?.new_string || '') },
  { key: 'torch-unsafe',
    label: 'torch.load(weights_only=False) — unsafe checkpoint loading',
    test: ({ args }) => /torch\.load\s*\([^)]*weights_only\s*=\s*False/.test(args?.content || args?.new_string || '') },

  // --- Financial / Legal domain ---
  { key: 'financial-no-disclaimer',
    label: 'Investment recommendation language without disclaimer in financial output',
    test: ({ args }) => {
      const t = args?.content || args?.new_string || '';
      return /\b(invest|buy|sell|hold)\b/i.test(t) &&
        !/not.{0,30}(advice|recommendation|liable)/i.test(t) &&
        /financial|investment|portfolio|stock|equity/i.test(t);
    }},
  { key: 'legal-no-caveat',
    label: 'Legal obligation language without not-legal-advice caveat',
    test: ({ args }) => {
      const t = args?.content || args?.new_string || '';
      return /\b(you must|you are legally|you are required to|you are liable)\b/i.test(t) &&
        !/not.{0,40}legal.{0,20}advice/i.test(t);
    }},

  // --- Fleet architecture violations ---
  { key: 'circular-dispatch',
    label: 'Specialist dispatching to another specialist (circular routing forbidden)',
    test: ({ args }) => {
      const specialists = ['deep-researcher','financial','legal-compliance','security','coding','devops-sre','pm-spec','writer','brand-builder'];
      const t = args?.content || args?.new_string || '';
      const hits = specialists.filter(s => new RegExp(`task:\\s*${s}\\b|@${s}\\b`).test(t));
      return hits.length >= 2;
    }},
  { key: 'think-structural',
    label: '<think> or <thinking> used as structural XML delimiter (collides with model reasoning tokens)',
    test: ({ args }) => /<think>|<thinking>/.test(args?.content || args?.new_string || '') },
];

const EDIT_TOOLS = new Set(['edit', 'write']);

export function __test_hookFor() {
  const hitCounts = new Map();

  return async function toolExecuteBefore(input, output) {
    const tool = input?.tool;
    const args = output?.args;
    if (!EDIT_TOOLS.has(tool)) return;

    for (const pattern of PATTERNS) {
      let matched = false;
      try { matched = pattern.test({ tool, args }); } catch { continue; }
      if (!matched) continue;

      const count = (hitCounts.get(pattern.key) || 0) + 1;
      hitCounts.set(pattern.key, count);

      if (count >= 2) {
        throw new Error(
          `SECURITY ESCALATION [${pattern.key}]: Same pattern fired ${count} times this session.\n` +
          `Pattern: ${pattern.label}\n` +
          `Human verification required — fix the issue and ask the user to confirm before retrying.`
        );
      } else {
        throw new Error(
          `SECURITY WARNING [${pattern.key}] (hit 1 of 2 before escalation):\n` +
          `${pattern.label}\n` +
          `Review and fix before retrying this write.`
        );
      }
    }
  };
}

const realHook = __test_hookFor();

/** Factory returning the plugin object — used by the package export in src/index.ts */
export async function createSecurityPatternsPlugin() {
  return {
    name: 'security-patterns',
    hooks: {
      'tool.execute.before': realHook,
    },
  };
}

export default {
  name: 'security-patterns',
  hooks: {
    'tool.execute.before': realHook,
  },
};
