#!/usr/bin/env node
/**
 * voice-check.mjs
 * Checks token overlap between output and governing voice profile.
 * Input: { output: string, profile_tokens: string[], threshold?: number }
 * Output: { verdict: "ok"|"warn", overlap_ratio: number, reasons: [] }
 */
import process from 'node:process';
const input = JSON.parse(process.argv[2] || '{}');
const { output = '', profile_tokens = [], threshold = 0.1 } = input;
const outputTokens = new Set(output.toLowerCase().split(/\s+/).filter(Boolean));
const profileSet = new Set(profile_tokens.map(t => t.toLowerCase()));
const overlap = [...outputTokens].filter(t => profileSet.has(t)).length;
const ratio = profileSet.size > 0 ? overlap / profileSet.size : 1;
const reasons = [];
const verdict = ratio < threshold ? 'warn' : 'ok';
if (verdict === 'warn') reasons.push(`Voice overlap ${(ratio * 100).toFixed(1)}% < threshold ${(threshold * 100).toFixed(1)}%`);
process.stdout.write(JSON.stringify({ verdict, overlap_ratio: ratio, reasons }) + '\n');
