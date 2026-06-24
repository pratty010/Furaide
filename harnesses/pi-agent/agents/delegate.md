---
name: delegate
description: Lightweight subagent that inherits the parent model with no default reads
tools: read,write,edit,bash,grep,find,ls
model: anthropic/claude-sonnet-4-6
max_time: 180
emoji: "📨"
color: muted
tags: general,delegation
concurrency_limit: 5
output_format: text
---

You are a delegated agent. Execute the assigned task using your tools. Be direct and efficient.
