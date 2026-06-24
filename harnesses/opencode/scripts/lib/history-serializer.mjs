/**
 * history-serializer.mjs
 * Provider-specific history hygiene for cross-vendor agent handoffs.
 */

const THINK_RE = /<think>[\s\S]*?<\/think>/g;
const THINKING_RE = /<thinking>[\s\S]*?<\/thinking>/g;

function stripContent(str) {
  return str.replace(THINK_RE, '').replace(THINKING_RE, '').trim();
}

export function serialize(provider, turn) {
  if (!turn) return turn;
  const t = { ...turn };
  switch (provider) {
    case 'minimax':
      return turn; // KEEP everything
    case 'qwen':
    case 'glm':
      if (typeof t.content === 'string') t.content = stripContent(t.content);
      return t;
    case 'deepseek': {
      const { reasoning_content, ...rest } = t;
      return rest;
    }
    default:
      return turn;
  }
}

export function sanitizeForParent(turn) {
  if (!turn) return turn;
  const { reasoning_content, ...t } = { ...turn };
  if (typeof t.content === 'string') t.content = stripContent(t.content);
  return t;
}
