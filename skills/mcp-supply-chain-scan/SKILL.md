---
name: mcp-supply-chain-scan
description: Audit the MCP server and tool supply chain for security and integrity issues. Use in Workflow #1/#2/#3 RECON phase to scan registered MCP servers, native tools, and external dependencies for known vulnerabilities, unsigned/untrusted sources, and configuration risks.
---

# mcp-supply-chain-scan

Audit MCP server and tool supply-chain security.

## When to invoke

- Workflow #1/#2/#3 enters RECON Security Triage
- Need to assess MCP server trust and integrity
- Want to check for known vulnerabilities in tools/dependencies
- Should verify all registered MCPs are properly configured

## Phases

1. **MCP Inventory**: List all registered MCP servers in opencode.json and tool definitions.
2. **Source Verification**: Verify each source is trusted (official org, pinned commit/version).
3. **Vulnerability Check**: Run CVE/advisory checks against MCP dependency trees.
4. **Configuration Audit**: Confirm MCP permissions, capabilities, and environment are correctly scoped.
5. **Report**: Document findings with trust tier and remediation steps if needed.

## Output

Writes to `.opencode/tmp/security-audit-mcp-<timestamp>.json` with severity levels and remediation paths.

## Rules

- All MCP sources must be pinned to commit SHA or versioned release.
- No unauthenticated HTTP sources; require HTTPS + signature verification where supported.
- Known-vulnerable versions must be flagged before proceeding.
