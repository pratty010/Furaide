#!/usr/bin/env node
/**
 * humanize-check.mjs
 * AI-tell density gate for prose deliverables.
 * Input: prose via stdin | --file <path>
 * Output JSON: { verdict: 'ok'|'warn'|'critical', score, reasons[], word_count }
 * Exit: 0=ok  1=warn  2=critical
 */
import { readFileSync } from 'node:fs';

const AI_VOCAB = [
  'leverage','utilize','delve','seamless','robust','pivotal','comprehensive',
  'cutting-edge','innovative','empower','synergy','holistic','actionable',
  'streamline','paradigm','ecosystem','unlock','elevate','reimagine',
  'transformative','dynamic','impactful','proactive','scalable','bespoke',
  'game-changing','groundbreaking','best-in-class','world-class',
  'state-of-the-art','next-generation','mission-critical','thought leadership',
  'tailor-made','meticulous','testament','vibrant','foster'
];

const FILLERS = [
  "in conclusion,","it's worth noting that","it is worth noting that",
  "it is important to note","it's important to note","as mentioned earlier",
  "as noted above","needless to say","at the end of the day","in a nutshell",
  "to summarize,","that being said,","without further ado","the bottom line is"
];

function readInput() {
  const args = process.argv.slice(2);
  const fi = args.indexOf('--file');
  if (fi !== -1) return readFileSync(args[fi + 1], 'utf8');
  try { return readFileSync('/dev/stdin', 'utf8'); } catch { return ''; }
}

const text = readInput();
const lower = text.toLowerCase();
const wordCount = text.split(/\s+/).filter(Boolean).length;
const reasons = [];
let score = 0;

// 1. AI vocabulary density
const vocabHits = AI_VOCAB.filter(w => lower.includes(w));
if (vocabHits.length >= 6) { score += 3; reasons.push(`AI vocabulary (${vocabHits.length} hits): ${vocabHits.slice(0,6).join(', ')}`); }
else if (vocabHits.length >= 3) { score += 2; reasons.push(`AI vocabulary (${vocabHits.length} hits): ${vocabHits.join(', ')}`); }
else if (vocabHits.length >= 1) { score += 1; reasons.push(`AI vocabulary: ${vocabHits.join(', ')}`); }

// 2. Filler phrases
const fillerHits = FILLERS.filter(p => lower.includes(p));
if (fillerHits.length >= 3) { score += 3; reasons.push(`Filler phrases (${fillerHits.length}): ${fillerHits.join(', ')}`); }
else if (fillerHits.length >= 1) { score += 1; reasons.push(`Filler: ${fillerHits.join(', ')}`); }

// 3. Em-dash overuse
const emDashes = (text.match(/—/g) || []).length;
const emPer1k = wordCount > 0 ? (emDashes / wordCount) * 1000 : 0;
if (emPer1k > 6) { score += 2; reasons.push(`Em-dash overuse: ${emDashes} (${emPer1k.toFixed(1)}/1k words)`); }
else if (emPer1k > 3) { score += 1; reasons.push(`Em-dash elevated: ${emDashes} (${emPer1k.toFixed(1)}/1k words)`); }

// 4. Rule of three
const rot = (text.match(/\b[\w']+[\w\s',-]+,\s[\w']+[\w\s',-]+,\s(?:and|or)\s[\w']+/gi) || []).length;
if (rot >= 4) { score += 2; reasons.push(`Rule-of-three overuse: ${rot} instances`); }
else if (rot >= 2) { score += 1; reasons.push(`Rule-of-three: ${rot} instances`); }

// 5. Negative parallelisms
const negPar = (lower.match(/not only.+but also/g) || []).length;
if (negPar >= 2) { score += 2; reasons.push(`Negative parallelisms: ${negPar}`); }
else if (negPar === 1) { score += 1; reasons.push('Negative parallelism: 1 instance'); }

const verdict = score >= 6 ? 'critical' : score >= 2 ? 'warn' : 'ok';
const exitCode = { ok: 0, warn: 1, critical: 2 }[verdict];
process.stdout.write(JSON.stringify({ verdict, score, reasons, word_count: wordCount }, null, 2) + '\n');
process.exit(exitCode);
