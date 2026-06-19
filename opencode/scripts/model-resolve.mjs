#!/usr/bin/env bun

import { readFileSync, writeFileSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const FLEET_ROOT = join(__dirname, '..');
const ROUTING_MANIFEST = join(FLEET_ROOT, 'docs/routing-manifest.json');
const RESERVED_MODELS = {
  'opencode-go/glm-5.1': { maxPrimary: 1, maxFirstFallback: 1 },
  'opencode-go/qwen3.7-max': { maxPrimary: 1, maxFirstFallback: 1 },
  'google-vertex/gemini-3.1-pro-preview': { maxPrimary: 1, maxFirstFallback: 1 },
  'openai/gpt-5.5': { maxPrimary: 1, maxFirstFallback: 1 },
};

function getProvider(model) {
  return model.split('/')[0];
}

function getAvailableModels() {
  try {
    const output = execFileSync('opencode', ['models', '--refresh'], {
      encoding: 'utf8',
      timeout: 30000,
    });
    return new Set(output.split('\n').map(s => s.trim()).filter(Boolean));
  } catch {
    const output = execFileSync('opencode', ['models'], { encoding: 'utf8' });
    return new Set(output.split('\n').map(s => s.trim()).filter(Boolean));
  }
}

function collectDesiredModels(manifest) {
  const desired = {};
  const allAgents = { ...manifest.specialists, ...manifest.subagents };
  for (const [name, cfg] of Object.entries(allAgents)) {
    if (name.startsWith('_')) continue;
    desired[name] = {
      primary: cfg.primary,
      heavy: cfg.heavy,
      simple: cfg.simple,
      fallback: cfg.fallback || [],
    };
  }
  return desired;
}

function countReservedUsage(resolved, model) {
  let primaryCount = 0;
  let firstFallbackCount = 0;
  for (const [, cfg] of Object.entries(resolved)) {
    if (cfg.primary === model) primaryCount++;
    if (cfg.fallback?.[0] === model) firstFallbackCount++;
    if (cfg.heavy === model) primaryCount++;
  }
  return { primaryCount, firstFallbackCount };
}

function wouldExceedReservedCap(resolved, model, role) {
  const reserved = RESERVED_MODELS[model];
  if (!reserved) return false;
  const { primaryCount, firstFallbackCount } = countReservedUsage(resolved, model);
  if (role === 'primary' || role === 'heavy') {
    return primaryCount >= reserved.maxPrimary;
  }
  if (role === 'fallback') {
    return firstFallbackCount >= reserved.maxFirstFallback;
  }
  return false;
}

function getModelsByTier(availableModels) {
  const byProvider = {};
  for (const model of availableModels) {
    const provider = getProvider(model);
    if (!byProvider[provider]) byProvider[provider] = [];
    byProvider[provider].push(model);
  }
  return byProvider;
}

function findReplacement(availableModels, resolved, originalModel, role, currentAgent, allAgentsConfig) {
  if (!originalModel) return null;
  const originalProvider = getProvider(originalModel);
  const byProvider = getModelsByTier(availableModels);
  const providers = Object.keys(byProvider).filter(p => p !== originalProvider);

  const candidates = [];
  for (const provider of providers) {
    for (const model of byProvider[provider]) {
      if (wouldExceedReservedCap(resolved, model, role)) continue;
      if (role === 'fallback') {
        const primaryModel = resolved[currentAgent]?.primary;
        if (primaryModel && getProvider(primaryModel) === provider) continue;
      }
      candidates.push(model);
    }
  }

  const originalConfig = allAgentsConfig[currentAgent];
  if (originalConfig) {
    const preferredOrder = [
      originalConfig.heavy,
      originalConfig.simple,
      ...originalConfig.fallback,
    ].filter(Boolean);

    for (const preferred of preferredOrder) {
      if (availableModels.has(preferred) && candidates.includes(preferred)) {
        return preferred;
      }
    }
  }

  const tierOrder = ['primary', 'heavy', 'simple', 'fallback'];
  for (const tier of tierOrder) {
    for (const provider of providers) {
      for (const model of byProvider[provider]) {
        if (wouldExceedReservedCap(resolved, model, role)) continue;
        if (role === 'fallback') {
          const primaryModel = resolved[currentAgent]?.primary;
          if (primaryModel && getProvider(primaryModel) === provider) continue;
        }
        return model;
      }
    }
  }

  return null;
}

function validateInvariants(resolved) {
  const errors = [];

  for (const [name, cfg] of Object.entries(resolved)) {
    if (!cfg.fallback?.length) continue;
    const primaryProvider = getProvider(cfg.primary);
    const fb1Provider = getProvider(cfg.fallback[0]);
    if (primaryProvider === fb1Provider) {
      errors.push(`${name}: primary and #1-fallback are both from provider "${primaryProvider}"`);
    }
  }

  for (const [name, cfg] of Object.entries(resolved)) {
    if (!cfg.fallback?.length) continue;
    const providers = new Set([cfg.primary, ...cfg.fallback].map(getProvider));
    if (providers.size < 2) {
      errors.push(`${name} chain has only ${providers.size} provider(s): ${[...providers].join(', ')}`);
    }
  }

  for (const [model, limits] of Object.entries(RESERVED_MODELS)) {
    const { primaryCount, firstFallbackCount } = countReservedUsage(resolved, model);
    if (primaryCount > limits.maxPrimary) {
      errors.push(`${model} is primary for ${primaryCount} agents (max ${limits.maxPrimary})`);
    }
    if (firstFallbackCount > limits.maxFirstFallback) {
      errors.push(`${model} is #1-fallback for ${firstFallbackCount} agents (max ${limits.maxFirstFallback})`);
    }
  }

  return errors;
}

function resolveModels() {
  const availableModels = getAvailableModels();
  const manifest = JSON.parse(readFileSync(ROUTING_MANIFEST, 'utf8'));
  const desired = collectDesiredModels(manifest);
  const allAgentsConfig = { ...manifest.specialists, ...manifest.subagents };

  const resolved = {};
  const changes = [];

  for (const [name, cfg] of Object.entries(desired)) {
    resolved[name] = { ...cfg };
  }

  for (const [name, cfg] of Object.entries(desired)) {
    if (!availableModels.has(cfg.primary)) {
      const replacement = findReplacement(availableModels, resolved, cfg.primary, 'primary', name, allAgentsConfig);
      if (replacement) {
        changes.push({ agent: name, field: 'primary', from: cfg.primary, to: replacement, reason: 'unavailable' });
        resolved[name].primary = replacement;
      } else {
        changes.push({ agent: name, field: 'primary', from: cfg.primary, to: null, reason: 'no replacement found' });
      }
    }

    if (cfg.heavy && !availableModels.has(cfg.heavy)) {
      const replacement = findReplacement(availableModels, resolved, cfg.heavy, 'heavy', name, allAgentsConfig);
      if (replacement) {
        changes.push({ agent: name, field: 'heavy', from: cfg.heavy, to: replacement, reason: 'unavailable' });
        resolved[name].heavy = replacement;
      } else {
        changes.push({ agent: name, field: 'heavy', from: cfg.heavy, to: null, reason: 'no replacement found' });
      }
    }

    if (cfg.simple && !availableModels.has(cfg.simple)) {
      const replacement = findReplacement(availableModels, resolved, cfg.simple, 'simple', name, allAgentsConfig);
      if (replacement) {
        changes.push({ agent: name, field: 'simple', from: cfg.simple, to: replacement, reason: 'unavailable' });
        resolved[name].simple = replacement;
      } else {
        changes.push({ agent: name, field: 'simple', from: cfg.simple, to: null, reason: 'no replacement found' });
      }
    }

    const newFallbacks = [];
    for (const fb of cfg.fallback) {
      if (availableModels.has(fb)) {
        newFallbacks.push(fb);
      } else {
        const replacement = findReplacement(availableModels, resolved, fb, 'fallback', name, allAgentsConfig);
        if (replacement) {
          changes.push({ agent: name, field: 'fallback', from: fb, to: replacement, reason: 'unavailable' });
          newFallbacks.push(replacement);
        } else {
          changes.push({ agent: name, field: 'fallback', from: fb, to: null, reason: 'no replacement found' });
        }
      }
    }
    resolved[name].fallback = newFallbacks;
  }

  const invariantErrors = validateInvariants(resolved);
  if (invariantErrors.length > 0) {
    console.error('Invariant violations after resolution:');
    for (const err of invariantErrors) {
      console.error('  -', err);
    }
    process.exit(1);
  }

  const modelMap = {};
  for (const [name, cfg] of Object.entries(resolved)) {
    modelMap[name] = cfg.primary;
  }

  const resolvedManifest = {
    ...manifest,
    specialists: {},
    subagents: {},
  };

  for (const [name, cfg] of Object.entries(resolved)) {
    if (manifest.specialists?.[name]) {
      resolvedManifest.specialists[name] = cfg;
      continue;
    }
    if (manifest.subagents?.[name]) {
      resolvedManifest.subagents[name] = cfg;
    }
  }

  return {
    availableModels: [...availableModels].sort(),
    desired,
    resolved,
    resolvedManifest,
    modelMap,
    changes,
    invariantErrors,
    allAvailable: changes.filter(c => c.to !== null).length === 0 && invariantErrors.length === 0,
  };
}

const result = resolveModels();
console.log(JSON.stringify(result, null, 2));
