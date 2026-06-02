#!/usr/bin/env node
/**
 * sql-safety-check.mjs
 * Classifies SQL and checks safety before execution.
 * Usage: bun sql-safety-check.mjs --sql "<text>" [--override <token>]
 *        echo "SQL" | bun sql-safety-check.mjs [--override <token>]
 */

import { createReadStream } from 'node:fs';
import { createInterface } from 'node:readline';
import process from 'node:process';

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--sql' && argv[i + 1]) {
      args.sql = argv[++i];
    } else if (argv[i] === '--override' && argv[i + 1]) {
      args.override = argv[++i];
    }
  }
  return args;
}

async function readStdin() {
  if (process.stdin.isTTY) return null;
  const rl = createInterface({ input: process.stdin, crlfDelay: Infinity });
  const lines = [];
  for await (const line of rl) lines.push(line);
  return lines.join('\n').trim() || null;
}

/**
 * Strip SQL comments and string literals to avoid false positives from
 * keywords embedded in quoted strings or comments.
 */
function stripCommentsAndStrings(sql) {
  let result = '';
  let i = 0;
  while (i < sql.length) {
    // Single-line comment
    if (sql[i] === '-' && sql[i + 1] === '-') {
      while (i < sql.length && sql[i] !== '\n') i++;
      result += ' ';
      continue;
    }
    // Multi-line comment
    if (sql[i] === '/' && sql[i + 1] === '*') {
      i += 2;
      while (i < sql.length && !(sql[i] === '*' && sql[i + 1] === '/')) i++;
      i += 2;
      result += ' ';
      continue;
    }
    // Single-quoted string
    if (sql[i] === "'") {
      i++;
      while (i < sql.length) {
        if (sql[i] === "'" && sql[i + 1] === "'") { i += 2; continue; }
        if (sql[i] === "'") { i++; break; }
        i++;
      }
      result += "''";
      continue;
    }
    result += sql[i++];
  }
  return result;
}

function classifySQL(sql) {
  const cleaned = stripCommentsAndStrings(sql).trim();
  const upper = cleaned.toUpperCase();

  // Tokenize for WHERE-clause detection (simple approach)
  const hasWhere = /\bWHERE\b/.test(upper);

  // Keywords to detect
  const isDrop = /\bDROP\b/.test(upper);
  const isTruncate = /\bTRUNCATE\b/.test(upper);
  const isDelete = /\bDELETE\b/.test(upper);
  const isUpdate = /\bUPDATE\b/.test(upper);
  const isInsert = /\bINSERT\b/.test(upper);
  const isMerge = /\bMERGE\b/.test(upper);
  const isCreate = /\bCREATE\b/.test(upper);
  const isAlter = /\bALTER\b/.test(upper);
  const isSelect = /^\s*(?:WITH\b.*\bSELECT\b|\bSELECT\b)/.test(upper);

  const notes = [];

  // Destructive: DROP, TRUNCATE, DELETE without WHERE
  if (isDrop) {
    return { sqlClass: 'destructive', notes: ['DROP permanently removes schema objects.'] };
  }
  if (isTruncate) {
    return { sqlClass: 'destructive', notes: ['TRUNCATE removes all rows without a WHERE clause.'] };
  }
  if (isDelete && !hasWhere) {
    return { sqlClass: 'destructive', notes: ['DELETE without WHERE removes all rows — treat as destructive.'] };
  }

  // DML with safety notes
  if (isDelete && hasWhere) {
    notes.push('Run SELECT preview first: replace DELETE with SELECT * to audit affected rows.');
    return { sqlClass: 'DML', notes };
  }
  if (isUpdate) {
    if (!hasWhere) {
      return { sqlClass: 'destructive', notes: ['UPDATE without WHERE affects all rows — treat as destructive.'] };
    }
    notes.push('Run SELECT preview first: replace UPDATE with SELECT * to audit affected rows.');
    return { sqlClass: 'DML', notes };
  }
  if (isInsert || isMerge) {
    if (isMerge) notes.push('MERGE combines INSERT/UPDATE/DELETE — verify target carefully.');
    return { sqlClass: 'DML', notes };
  }

  // DDL
  if (isCreate || isAlter) {
    notes.push('Provide rollback migration + schema diff before applying to production.');
    return { sqlClass: 'DDL', notes };
  }

  // Default to SELECT (read-only)
  if (isSelect) {
    return { sqlClass: 'SELECT', notes: [] };
  }

  // Unknown / other (CALL, EXEC, etc.) — treat conservatively as DML
  return { sqlClass: 'DML', notes: ['Unknown statement type — treated conservatively as DML.'] };
}

async function main() {
  const argv = process.argv.slice(2);
  const args = parseArgs(argv);

  let sql = args.sql ?? null;
  if (!sql) {
    sql = await readStdin();
  }
  if (!sql) {
    const out = { class: null, allowed: false, reason: 'No SQL provided via --sql or stdin.', notes: [] };
    process.stdout.write(JSON.stringify(out, null, 2) + '\n');
    process.exit(2);
  }

  const { sqlClass, notes } = classifySQL(sql);

  let allowed = true;
  let reason = '';

  if (sqlClass === 'destructive') {
    if (args.override && args.override.trim() !== '') {
      allowed = true;
      reason = `Destructive operation allowed via --override token.`;
    } else {
      allowed = false;
      reason = 'Destructive SQL requires --override <token> to proceed.';
    }
  } else if (sqlClass === 'SELECT') {
    reason = 'Read-only SELECT — safe to run.';
  } else if (sqlClass === 'DML') {
    reason = 'DML operation — review notes before executing.';
  } else if (sqlClass === 'DDL') {
    reason = 'DDL operation — review notes and confirm rollback plan.';
  }

  const output = {
    class: sqlClass,
    allowed,
    reason,
    notes,
  };

  process.stdout.write(JSON.stringify(output, null, 2) + '\n');
  process.exit(allowed ? 0 : 2);
}

main().catch((err) => {
  process.stderr.write(`Fatal: ${err.message}\n`);
  process.exit(1);
});
