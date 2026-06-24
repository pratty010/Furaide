# TypeScript 7 Native Port: Research Report

> Compiled 2026-06-23 for the Furaidē monorepo. Scope: what TS7 (Corsa) is, what it changes, and how it affects TypeScript-heavy LLM harness packages and plugins across this repo.

---

## 1. Executive Summary

Microsoft is porting the TypeScript compiler and language service from TypeScript (the Strada codebase) to Go (the Corsa codebase). The native port ships as TypeScript 7 once it reaches parity. Today it is available as a preview package called `@typescript/native-preview` with a `tsgo` binary, plus a VS Code extension.

Three claims matter for tool maintainers:

1. **Compiler speed.** Most command-line typechecks run roughly 10x faster on real codebases. The VS Code codebase drops from 77.8s to 7.5s.
2. **Editor load.** Project load in the editor drops roughly 8x. VS Code goes from 9.6s to 1.2s.
3. **Memory.** Roughly half the memory usage, with further optimization expected.

The compiler is feature-complete for typechecking, JSX, emit, declaration emit, build mode, and incremental builds. The language service (LSP) is in progress. The public API is not ready. The old JS codebase continues as TypeScript 6.x until TS7 reaches maturity and adoption.

---

## 2. Primary Sources

| Source | URL | Date | Author |
|--------|-----|------|--------|
| Announcement post | https://devblogs.microsoft.com/typescript/typescript-native-port/ | 2025-03-11 | Anders Hejlsberg |
| Native Previews post | https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/ | 2025-05-22 | Daniel Rosenwasser |
| typescript-go repo | https://github.com/microsoft/typescript-go | live | Microsoft |
| CHANGES.md (intentional differences) | https://github.com/microsoft/typescript-go/blob/main/CHANGES.md | live | Microsoft |
| npm preview package | https://www.npmjs.com/package/@typescript/native-preview | live | TypeScript Team |
| VS Code extension | https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview | live | TypeScript Team |
| FAQ discussions | https://github.com/microsoft/typescript-go/discussions/categories/faqs | live | community |

Codenames used in Microsoft posts and code comments:

- **Strada**: the original TypeScript codebase, the JS implementation. Ships as TS 5.8 and the upcoming 6.x line.
- **Corsa**: the native Go port. Ships as TS 7 once stable.
- **tsgo**: the preview binary name. Will be renamed to `tsc` and moved into the `typescript` package at RC.

---

## 3. Performance Claims

### 3.1 Command-line typecheck (from the March announcement)

Benchmark: `tsc` on real codebases, same machine.

| Codebase | LOC | Strada (current) | Corsa (native) | Speedup |
|----------|-----|------------------|----------------|---------|
| VS Code | 1,505,000 | 77.8s | 7.5s | 10.4x |
| Playwright | 356,000 | 11.1s | 1.1s | 10.1x |
| TypeORM | 270,000 | 17.5s | 1.3s | 13.5x |
| date-fns | 104,000 | 6.5s | 0.7s | 9.5x |
| tRPC (server + client) | 18,000 | 5.5s | 0.6s | 9.1x |
| rxjs | 2,100 | 1.1s | 0.1s | 11.0x |

Source: https://devblogs.microsoft.com/typescript/typescript-native-port/ , "How Much Faster?" section.

### 3.2 Editor project load (from the March announcement)

VS Code codebase, full project load on a fast machine:

- Strada: 9.6s
- Corsa: 1.2s
- Improvement: 8x

Overall memory usage is roughly half. Microsoft notes they have not actively optimized memory yet.

Source: https://devblogs.microsoft.com/typescript/typescript-native-port/ , "Editor Speed" section.

### 3.3 Sentry JSX benchmark (from the May preview post)

Running `--extendedDiagnostics --noEmit` on the Sentry codebase:

- Strada (`tsc`): 72.81s total. Check time 63.26s. 3,356,832K memory. 9,306 files.
- Corsa (`tsgo`): 6.761s total. Check time 5.882s. 3,892,267K memory. 9,292 files.

Corsa checks Sentry in under 7 seconds where Strada takes over a minute. Memory is comparable on this benchmark, but the time delta is consistent with the 10x claim.

Source: https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/ , "JSX Checking Support" section.

---

## 4. Feature Status Today

From the typescript-go README, "What Works So Far?" table. Definitions in the repo:

- **done**: believed complete. OK to log bugs.
- **in progress**: some features work, some do not. OK to log panics only.
- **prototype**: proof of concept. Do not log bugs.
- **not ready**: not started or far from ready.

| Feature | Status | Notes |
|---------|--------|-------|
| Program creation | done | Same files and module resolution as TS 6.0. Not all resolution modes supported yet. |
| Parsing / scanning | done | Exact same syntax errors as TS 6.0. |
| Command-line and `tsconfig.json` parsing | done | `tsconfig` errors may be less helpful. |
| Type resolution | done | Same types as TS 6.0. |
| Type checking | done | Same errors, locations, messages. Types printback in errors may display differently. |
| JavaScript inference and JSDoc | done | Complete, but intentionally lacking some features. Declaration emit differs intentionally. |
| JSX | done | Added after the March announcement. |
| Declaration emit | done | Behavior changed substantially for `.js` input. |
| Emit (JS output) | done | |
| Watch mode | prototype | Watches and rebuilds, no incremental rechecking. Not optimized. |
| Build mode / project references | done | |
| Incremental build | done | |
| Language service (LSP) | in progress | Nearly all features implemented. |
| API | not ready | |

Source: https://github.com/microsoft/typescript-go , "What Works So Far?" section.

As of the May 2025 preview post, the LSP supports completions, go-to-definition, and hover. Find-all-references, rename, and signature help are still pending. Auto-imports are not fully ported.

Source: https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/ , "Editor Support & LSP Progress" section.

---

## 5. Installation and Usage

### 5.1 Command-line compiler

```bash
npm install -D @typescript/native-preview
npx tsgo            # use as you would tsc
npx tsgo --project ./src/tsconfig.json
```

The binary is `tsgo` today. Microsoft plans to rename it to `tsc` and move it into the `typescript` package at RC.

Source: https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/ , section 1.

### 5.2 VS Code extension

Install "TypeScript (Native Preview)" from the marketplace. The extension defers to the built-in TS extension by default, so it must be enabled explicitly. Three enable paths:

- Command palette: "TypeScript Native Preview: Enable (Experimental)"
- Settings UI: "TypeScript > Experimental: Use Tsgo"
- JSON setting:

```json
"typescript.experimental.useTsgo": true
```

The older form `js/ts.experimental.useTsgo` also appears in the March post. Prefer the `typescript.experimental.useTsgo` form from the May post.

Disable with the command "TypeScript Native Preview: Disable" or by toggling the setting.

Source: https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/ , section 1.

### 5.3 Release cadence

Nightly previews. The VS Code extension auto-updates by default. File issues at https://github.com/microsoft/typescript-go/issues .

---

## 6. Intentional Changes vs TypeScript 6.0

Corsa is a rewrite, not a line-by-line port. Some behavior changed on purpose. Full list lives in CHANGES.md. The categories below are the ones most likely to affect LLM harness codebases.

Source for all sub-sections: https://github.com/microsoft/typescript-go/blob/main/CHANGES.md

### 6.1 Scanner

- **UTF-8 offsets, not UTF-16.** Node positions are UTF-8 byte offsets from the start of the file. Any tool that consumes node positions and assumes UTF-16 will break on files with non-ASCII characters.

### 6.2 JavaScript and JSDoc

- JavaScript support was rewritten, not ported. Some legacy JS patterns no longer typecheck.
- Closure header support is removed. Most Closure-specific JSDoc features are gone.
- Constructor functions are no longer supported. Use `class` declarations.

```js
// removed
function C() { this.property = 1; }
C.prototype.method = function () {}

// required
class C {
  constructor() { this.property = 1; }
  method() {}
}
```

- `@class` / `@constructor` no longer turn a function into a constructor.
- `@enum` is removed. Use `@typedef`.
- Closure function type syntax `function(string): void` is removed. Use arrow type syntax `(s: string) => void`.
- Identifier-named typedefs are removed. Use `@typedef {T} Name`.
- Values are no longer resolved as types in JSDoc type positions. Use `typeof`.

```js
// removed
/** @typedef {FORWARD | BACKWARD} Direction */
const FORWARD = 1, BACKWARD = 2;

// required
/** @typedef {typeof FORWARD | typeof BACKWARD} Direction */
const FORWARD = 1, BACKWARD = 2;
```

- JSDoc variadic types `{...number}` are now only synonyms for array types. A variadic type on a parameter no longer makes it a rest parameter. The parameter must use rest syntax `...ns`.
- The postfix `=` type no longer adds `undefined` when `strictNullChecks` is off. This fixes a Strada bug.
- `@param` tags apply to at most one function. Shared `@param` across comma-declared functions now only types the first.
- `@type` tags now prevent narrowing, matching TS assertion syntax.
- `@overload` is ignored on arrow functions and function expressions. Use a `@type` with call signatures instead.

### 6.3 Expando declarations

- Constructor functions: removed.
- Fallback initialisers `f.x = f.x || init`: removed. Use `if (!f.x) f.x = init;`.
- Nested, undeclared expandos: removed. All intermediate expandos must be assigned.
- Identifier declarations inside classes: removed.
- `this` aliases for `globalThis` at script top level: removed. Use `globalThis`.
- `this` aliases for `module.exports` in CommonJS: removed. Use `exports`.
- A `this` property with a type annotation in the constructor no longer creates a property. Use a class field or an initializer.

### 6.4 CommonJS

- Mixing `module.exports = X` with `module.exports.x = Y` is no longer permitted. A CommonJS module must use one form or the other.
- Nested undeclared exports like `exports.N.X.p = 1` are removed.
- Empty `module.exports = {}` assignments are ignored. Delete the line.
- Single-property access `require` like `var readFile = require('fs').readFile` must use destructuring: `var { readFile } = require('fs')`.
- Aliasing `var mod = module.exports` then assigning `mod.x = 1` is removed. Assign to `module.exports.x` directly.

### 6.5 Parser changes

These mostly affect tools that walk the AST.

- Malformed `...T?` tuple tails now fail with a parse error instead of a grammar error.
- Malformed string ImportSpecifiers contain the string text instead of an empty identifier.
- Empty binding elements use `Kind=BindingElement` with nil fields instead of a separate `OmittedExpression` kind.
- `ShorthandPropertyAssignment` no longer includes an `EqualsToken` child when it has an `ObjectAssignmentInitializer`.
- JSDoc nodes include leading whitespace in their location.
- The parser always parses a `JSDocText` node for JSDoc comments. `string` is no longer part of the `comment` type.
- `JSDocMemberName` is now parsed as `QualifiedName`.

### 6.6 Checker changes

- Template literal type inference pulls a full Unicode code point for empty placeholders. Strada splits supplementary-plane characters (emoji) into surrogate halves. Corsa keeps them together.
- With `strict: false`, arguments for parameters typed `undefined`, `unknown`, or `any` can no longer be omitted. `void` can still be omitted.
- `@typedef` and `@callback` in a class body are hoisted outside the class.
- Async functions returning non-Promises now use the same error as TS.

### 6.7 Declaration emit

Declaration emit for `.js` input is substantially rewritten. Matching Strada's `.d.ts` output for `.js` files is an explicit non-goal. Declaration emit in the presence of errors is not well-defined and will differ. Incorrect `.d.ts` output from a `.js` file should be filed as an issue.

### 6.8 Module resolution deprecations

From the May preview post, `node` / `node10` resolution is deprecated in favor of `node16`, `nodenext`, or `bundler`. Projects using `--moduleResolution node` or `--module commonjs` may see:

```
Cannot find module 'blah' or its corresponding type declarations.
Module '"module"' has no exported member 'Thing'.
```

Fix by switching `tsconfig.json` to:

```json
{
  "compilerOptions": {
    "module": "preserve",
    "moduleResolution": "bundler"
  }
}
```

or:

```json
{
  "compilerOptions": {
    "module": "nodenext"
  }
}
```

Source: https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/ , "Known and Notable Differences" section.

### 6.9 Preview gaps (as of May 2025)

- `--build` mode is not yet available in the preview. Individual projects can still be built with `tsgo`.
- `--declaration` emit is not supported in the preview.
- Certain downlevel emit targets are limited.
- JSX emit only preserves what you wrote.
- Project references language service is not available. Generated `.d.ts` files can still be leveraged.

---

## 7. API and LSP Roadmap

### 7.1 LSP instead of TSServer

Strada communicates with editors via the TSServer protocol, which predates LSP. Corsa moves to LSP. Microsoft is not doing a 1:1 port, so editor tooling that speaks TSServer directly will need an LSP migration path.

Source: https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/ , "Editor Support & LSP Progress" section.

### 7.2 IPC API and libsyncrpc

The new API layer communicates over standard I/O via IPC, language-agnostic. There are JavaScript-based clients for interacting with the API.

Because much TS API usage today is synchronous, and Node.js does not provide an easy way to communicate synchronously with a child process, Microsoft built a Rust native Node.js module called `libsyncrpc` for synchronous IPC.

- Repo: https://github.com/microsoft/libsyncrpc
- API design discussion: https://github.com/microsoft/typescript-go/pull/711

This matters for tool maintainers who embed the TS compiler API synchronously. The synchronous path now goes through a Rust native module, not a JS function call.

Source: https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/ , "API Progress" section.

### 7.3 Repo future

Long-term, `microsoft/typescript-go` will merge into `microsoft/TypeScript`. The staging repo and its issue tracker will eventually close. Treat discussions and issues accordingly.

Source: https://github.com/microsoft/typescript-go , "Other Notes" section.

---

## 8. Versioning Roadmap

From the March announcement, "Versioning Roadmap" section.

- TS 5.8 was the current release at announcement. TS 5.9 was coming soon.
- The JS codebase continues development into the 6.x series. TS 6.0 introduces deprecations and breaking changes to align with the native codebase.
- When the native codebase reaches sufficient parity, it ships as TS 7.0.
- TS 6.x (JS) is maintained until TS 7+ reaches sufficient maturity and adoption.
- Long-term goal: keep the two versions aligned so users can upgrade to TS 7 when it meets their requirements, or fall back to TS 6 if needed.

---

## 9. Implications for Furaidē Components

This repo has several TypeScript-heavy components. The relevant facts differ per component.

### 9.1 opencode-all (`harnesses/opencode/tools/opencode-all/`)

- Runtime is Bun, not Node.js. The `typescript` package is a devDependency for typechecking only.
- TS7 does not speed up the running TUI. Bun executes the TS directly.
- TS7 does speed up `bunx tsc --noEmit` and any IDE typecheck. The `tsconfig.json` uses `moduleResolution: "Bundler"` and `module: "ESNext"`, which aligns with the TS7 migration direction. No resolution migration needed.
- The `types` field is `["bun-types"]`. Confirm `bun-types` still resolves under `tsgo` once `@typescript/native-preview` is used in CI.
- Action: try replacing `typescript` with `@typescript/native-preview` in CI typecheck to cut typecheck time. Validate `bun-types` compatibility first.

### 9.2 brand-builder-plugin (`harnesses/opencode/future-work/brand-builder-plugin/`)

- Has its own `bun install` and its own deps.
- Same Bun runtime situation as opencode-all.
- Action: audit `tsconfig.json` for `moduleResolution: "node"` or `module: "commonjs"`. Migrate to `bundler` or `nodenext` before adopting TS7.

### 9.3 claude-code skills and plugins (`harnesses/claude-code/`)

- The `github` skill and `satori` plugin are mostly Markdown and shell. TypeScript surface is small.
- Any TS utility scripts should be checked against the CommonJS mixing rule in section 6.4 if they use `module.exports`.

### 9.4 OpenCode fleet installer scripts (`harnesses/opencode/scripts/`)

- Installer tests are in `scripts/tests/` and run under Bun. They are JS, not TS-heavy.
- No direct TS7 impact.

### 9.5 Cross-component concerns

- **UTF-8 offsets.** Any tool in this repo that consumes TS node positions and assumes UTF-16 will break under TS7. None found in a quick scan, but audit before adopting TS7 in any AST-walking tool.
- **Synchronous API consumers.** If any component embeds the TS compiler API synchronously, plan for the `libsyncrpc` migration. Rust native module adds a build dependency.
- **CI typecheck.** Replacing `typescript` with `@typescript/native-preview` in CI is the fastest win. The preview is not yet feature-complete for `--build` mode or declaration emit, so projects that rely on those should wait.

---

## 10. Adoption Checklist for a TypeScript Component

Run this checklist before switching a component to TS7.

1. **Module resolution.** `tsconfig.json` uses `bundler`, `node16`, or `nodenext`. Not `node` or `node10`.
2. **Module system.** `module` is `preserve`, `nodenext`, or ESNext. Not `commonjs` unless the code is truly CommonJS.
3. **CommonJS hygiene.** No mixing of `module.exports = X` with `module.exports.x = Y`. No `this` aliasing for `exports`. No nested undeclared exports.
4. **No constructor functions.** All class-like code uses `class` declarations. No `function C() { this.x = 1; }` patterns.
5. **JSDoc audit.** No Closure-only tags (`@enum`, `@class` on functions, Closure function type syntax, identifier-named typedefs). Use `typeof` for value unions in JSDoc types.
6. **AST consumers.** Any tool that reads TS node positions is UTF-8 aware, not UTF-16. Any tool that walks `ShorthandPropertyAssignment` or `OmittedExpression` handles the new node shapes.
7. **Declaration emit.** If the project emits `.d.ts` from `.js` input, compare output against Strada and update golden files. Matching Strada is an explicit non-goal.
8. **Synchronous API.** If the component embeds the TS compiler API synchronously, plan for `libsyncrpc` as a native dependency.
9. **Editor integration.** If the component ships editor tooling that speaks TSServer, plan an LSP path.
10. **CI.** Try `@typescript/native-preview` in CI behind a flag. Compare typecheck time and error output against the current `typescript` package.

---

## 11. References

All URLs verified at time of writing.

1. Microsoft DevBlog. "A 10x Faster TypeScript." Anders Hejlsberg. 2025-03-11.
   https://devblogs.microsoft.com/typescript/typescript-native-port/

2. Microsoft DevBlog. "Announcing TypeScript Native Previews." Daniel Rosenwasser. 2025-05-22.
   https://devblogs.microsoft.com/typescript/announcing-typescript-native-previews/

3. microsoft/typescript-go repository. README.
   https://github.com/microsoft/typescript-go

4. microsoft/typescript-go repository. CHANGES.md (intentional differences from Strada).
   https://github.com/microsoft/typescript-go/blob/main/CHANGES.md

5. npm package page. `@typescript/native-preview`.
   https://www.npmjs.com/package/@typescript/native-preview

6. VS Code Marketplace. "TypeScript (Native Preview)" extension.
   https://marketplace.visualstudio.com/items?itemName=TypeScriptTeam.native-preview

7. microsoft/libsyncrpc repository. Rust native Node.js module for synchronous IPC.
   https://github.com/microsoft/libsyncrpc

8. typescript-go API design PR. "API server."
   https://github.com/microsoft/typescript-go/pull/711

9. typescript-go JSX type-checking PR.
   https://github.com/microsoft/typescript-go/pull/762

10. TypeScript 6.0 deprecations issue.
    https://github.com/microsoft/TypeScript/issues/54500

11. typescript-go FAQ discussions.
    https://github.com/microsoft/typescript-go/discussions/categories/faqs

12. TypeScript Community Discord (AMA referenced in the March post).
    https://discord.gg/typescript
