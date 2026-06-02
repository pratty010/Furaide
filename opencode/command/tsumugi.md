---
description: Re-embed all evidence summaries at a new provider or embedding dimension. Use when switching embedding providers or after a dimension mismatch error.
argument-hint: "[provider] [dimension]"
agent: kitsune
---

Set intent to artifact_intake_update with re-embed scope and proceed.

Call bb_reembed with the specified provider and dimension. If provider or dimension are not specified in arguments, ask for them — both are required to avoid dimension mismatch errors on search.

$ARGUMENTS
