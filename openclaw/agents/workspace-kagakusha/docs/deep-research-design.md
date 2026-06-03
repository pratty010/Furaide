# Deep Research Agent Design for OpenCLAW
## Comprehensive Architecture & Implementation Guide

**Date:** February 9, 2026  
**Version:** 1.0

---

## Executive Summary

This document presents a comprehensive design for building a **Deep Research Agent** system within the OpenCLAW framework, inspired by state-of-the-art approaches like DeepResearcher (ArXiv 2504.03160) and production multi-agent systems from Anthropic, OpenAI, and Google.

### Key Design Principles

1. **Two-Tier Output System**: Instant 1-pager for quick insights + Deep research mode for comprehensive investigation
2. **Human-Readable Reports**: Factual, vetted, informative with proper citations and scholarly tone
3. **Persistent Knowledge Base**: Vector search over `/reports` folder to reuse information
4. **Query Optimization**: Smart search query formulation to minimize web_search API calls
5. **Long-term Memory**: Distilled insights stored in `MEMORY.md` for cumulative learning

---

## Part 1: Understanding Deep Research Methodology

### 1.1 Core Concepts from DeepResearcher

**DeepResearcher** is the first comprehensive framework for end-to-end training of LLM-based deep research agents through reinforcement learning in real-world web environments.

#### Key Architectural Components

```
┌─────────────────────────────────────────────────────────┐
│              DEEP RESEARCH TRAJECTORY                    │
├─────────────────────────────────────────────────────────┤
│                                                          │
│  1. <think>                                             │
│     └─ Planning & Strategy Formation                    │
│     └─ Multi-step decomposition                         │
│     └─ Self-reflection & adjustment                     │
│                                                          │
│  2. <search>                                            │
│     └─ Optimized query formulation                      │
│     └─ Multiple search strategies                       │
│     └─ Cross-validation from sources                    │
│                                                          │
│  3. Web Browsing Agent (Multi-agent)                    │
│     └─ Sequential page processing                       │
│     └─ Short-term memory repository                     │
│     └─ Relevant info extraction                         │
│     └─ Decision: continue/stop browsing                 │
│                                                          │
│  4. <answer>                                            │
│     └─ Synthesis of gathered information                │
│     └─ Citations & fact-checking                        │
│     └─ Honesty when info insufficient                   │
│                                                          │
└─────────────────────────────────────────────────────────┘
```

#### Emergent Cognitive Behaviors

Research shows that end-to-end RL training produces these behaviors:

1. **Planning**: Formulating multi-step research strategies upfront
2. **Cross-validation**: Verifying information across multiple sources before committing
3. **Self-reflection**: Redirecting research when initial paths prove unproductive
4. **Honesty**: Acknowledging uncertainty when definitive answers cannot be found
5. **Dynamic adaptation**: Merging or adjusting steps based on intermediate findings

### 1.2 Multi-Agent Orchestration Patterns

From Anthropic's Research System and academic literature:

#### **Orchestrator-Worker Pattern**

```
                    ┌──────────────────┐
                    │  Lead/Orchestrator│
                    │     Agent         │
                    └────────┬──────────┘
                             │
              ┌──────────────┼──────────────┐
              │              │              │
         ┌────▼────┐    ┌────▼────┐   ┌────▼────┐
         │SubAgent │    │SubAgent │   │SubAgent │
         │   #1    │    │   #2    │   │   #3    │
         │(Search) │    │(Analysis│   │(Synthesis
         └─────────┘    └─────────┘   └─────────┘
```

**Key Principles:**

- **Lead agent**: Analyzes query, develops strategy, coordinates subagents
- **Subagents**: Specialized workers operating in parallel on distinct aspects
- **Parallel execution**: 3-5 subagents for breadth-first exploration
- **Result aggregation**: Lead agent compiles findings into coherent output

#### **Hierarchical Task Decomposition**

Used for ambiguous, open-ended problems requiring multi-step reasoning:

1. **Coordinator agent** decomposes high-level goal into multiple tasks
2. **Specialized subagents** execute or further decompose
3. **Iterative refinement** based on intermediate results

### 1.3 Production System Insights

**From Anthropic's Research System:**

- Multi-agent with Opus 4 lead + Sonnet 4 subagents achieved **90.2% improvement** over single-agent
- Excels at breadth-first queries involving multiple independent directions
- Parallel tool calling reduced research time by **up to 90%**

**Prompt Engineering Principles:**

1. **Teach orchestrator how to delegate**: Clear objectives, output format, tool guidance, task boundaries
2. **Scale effort to query complexity**: 1 agent for simple facts, 2-4 for comparisons, 10+ for complex research
3. **Guide thinking process**: Extended thinking mode for planning and self-reflection
4. **Parallel tool calling**: Subagents use 3+ tools simultaneously
5. **Long-horizon conversation management**: Summarize phases, store in external memory, spawn fresh subagents when context limits approach
6. **Direct filesystem output**: Subagents write artifacts directly, pass lightweight references to coordinator

---

## Part 2: OpenCLAW Architecture Integration

### 2.1 OpenCLAW Core Components

#### **Gateway-Centric Architecture**

```
┌──────────────────────────────────────────────────┐
│            OPENCLAW GATEWAY                       │
│  (Single long-running process)                    │
├──────────────────────────────────────────────────┤
│                                                   │
│  • Manages all messaging surfaces                │
│  • WebSocket API (127.0.0.1:18789)              │
│  • Canvas host (18793) for HTML/A2UI            │
│  • Event emitter (agent, chat, heartbeat, cron) │
│                                                   │
└─────────┬──────────────┬──────────────┬──────────┘
          │              │              │
    ┌─────▼─────┐  ┌─────▼─────┐  ┌─────▼─────┐
    │  Clients  │  │   Nodes   │  │  WebChat  │
    │ (CLI/Mac) │  │(iOS/macOS)│  │    UI     │
    └───────────┘  └───────────┘  └───────────┘
```

#### **Tools System**

OpenCLAW provides **first-class agent tools**:

| Tool Category | Tools | Purpose |
|--------------|-------|---------|
| **Web** | `web_search`, `web_fetch` | Information retrieval |
| **Filesystem** | `read`, `write`, `edit`, `apply_patch` | File operations |
| **Runtime** | `exec`, `bash`, `process` | Code execution |
| **Sessions** | `sessions_list`, `sessions_history`, `sessions_send`, `sessions_spawn` | Agent coordination |
| **Memory** | `memory_search`, `memory_get` | Knowledge retrieval |
| **Browser** | `browser` (status/start/snapshot/act) | Web automation |
| **Nodes** | `nodes` (camera/screen/location) | Device integration |

**Tool Groups** (shorthands):
- `group:web` = web_search + web_fetch
- `group:fs` = read + write + edit + apply_patch
- `group:sessions` = all session management tools
- `group:memory` = memory_search + memory_get

#### **Skills System**

Skills teach agents **how to use tools** via `SKILL.md` files with YAML frontmatter:

```yaml
---
name: deep-research-instant
description: Quick 1-page research summary with citations
user-invocable: true
metadata: {"openclaw": {"requires": {"env": ["BRAVE_API_KEY"]}}}
---

# Instructions
1. Formulate 2-3 focused search queries
2. Use web_search to gather initial information
3. Extract key facts and synthesize 1-page summary
4. Include inline citations [1][2][3]
```

**Skill Locations** (precedence):
1. `<workspace>/skills` (highest - per-agent)
2. `~/.openclaw/skills` (shared across agents)
3. Bundled skills (shipped with install)

#### **Subagents System**

```python
# Spawn subagent for background research
{
  "tool": "sessions_spawn",
  "params": {
    "task": "Research the market size of AI agents in 2025",
    "label": "Market Research",
    "model": "claude-sonnet-4",  # Cost optimization
    "runTimeoutSeconds": 300,
    "cleanup": "keep"
  }
}
```

**Key Features:**
- Run in isolated sessions: `agent:<agentId>:subagent:<uuid>`
- **Announce results** back to requester chat channel
- **Parallel execution**: Up to `maxConcurrent` (default: 8)
- **Independent context**: Own token usage, separate from main agent
- **Tool restrictions**: No session tools by default (prevent nested fan-out)
- **Cannot spawn subagents** themselves (avoid exponential complexity)

**Configuration:**
```json
{
  "agents": {
    "defaults": {
      "subagents": {
        "maxConcurrent": 8,
        "model": "claude-sonnet-4",
        "archiveAfterMinutes": 60
      }
    }
  },
  "tools": {
    "subagents": {
      "tools": {
        "deny": ["gateway", "cron", "sessions_spawn"],
        "allow": ["group:web", "group:fs", "memory_search"]
      }
    }
  }
}
```

### 2.2 Memory & Persistence Architecture

#### **Vector Search Implementation**

OpenCLAW supports `memory_search` and `memory_get` tools for semantic retrieval:

```javascript
// Search past research reports
{
  "tool": "memory_search",
  "params": {
    "query": "AI agent market trends 2024-2025",
    "limit": 5,
    "threshold": 0.7
  }
}
```

**Backend Options:**
1. **File-based vector DB** (Chroma/LanceDB)
2. **MongoDB Atlas Vector Search** (for cloud deployments)
3. **Elasticsearch with vector plugin** (enterprise scale)

#### **Report Storage Structure**

```
workspace/
├── reports/
│   ├── 2026-02-09_ai-agents-market/
│   │   ├── instant_summary.md
│   │   ├── deep_report.md
│   │   ├── sources.json
│   │   └── embeddings.json
│   ├── 2026-02-08_climate-tech-funding/
│   │   ├── instant_summary.md
│   │   ├── deep_report.md
│   │   └── ...
│   └── index.json  # Metadata for quick lookup
└── MEMORY.md  # Distilled long-term insights
```

---

## Part 3: Proposed Architecture Design

### 3.1 System Overview

```
┌─────────────────────────────────────────────────────────────┐
│                  USER REQUEST                                │
│          "Research AI agents market in 2025"                 │
└────────────────────────┬────────────────────────────────────┘
                         │
                         ▼
┌─────────────────────────────────────────────────────────────┐
│              RESEARCH COORDINATOR AGENT                      │
│  • Analyzes query complexity                                 │
│  • Checks /reports for existing research (vector search)     │
│  • Decides: Instant mode vs Deep research mode               │
│  • Formulates research plan                                  │
└────────────────────────┬────────────────────────────────────┘
                         │
          ┌──────────────┴──────────────┐
          │                             │
          ▼                             ▼
┌──────────────────────┐      ┌──────────────────────┐
│   INSTANT MODE       │      │   DEEP RESEARCH      │
│   (1-pager)          │      │   MODE               │
└──────────────────────┘      └──────────────────────┘
          │                             │
          │                             ▼
          │              ┌──────────────────────────────┐
          │              │  PLANNING PHASE              │
          │              │  • Clarifying questions      │
          │              │  • Internal search plan      │
          │              │  • Subagent task allocation  │
          │              └──────────┬───────────────────┘
          │                         │
          │                         ▼
          │              ┌──────────────────────────────┐
          │              │  PARALLEL RESEARCH PHASE     │
          │              │  3-5 Specialized Subagents:  │
          │              │  • Background research       │
          │              │  • Market data gathering     │
          │              │  • Expert opinion mining     │
          │              │  • Trend analysis            │
          │              │  • Competitive landscape     │
          │              └──────────┬───────────────────┘
          │                         │
          │                         ▼
          │              ┌──────────────────────────────┐
          │              │  SYNTHESIS PHASE             │
          │              │  • Cross-validate findings   │
          │              │  • Resolve contradictions    │
          │              │  • Build comprehensive report│
          │              └──────────┬───────────────────┘
          │                         │
          └─────────────┬───────────┘
                        │
                        ▼
┌─────────────────────────────────────────────────────────────┐
│              POST-PROCESSING                                 │
│  • Store in /reports with embeddings                         │
│  • Update MEMORY.md with key insights                        │
│  • Return formatted report with citations                    │
└─────────────────────────────────────────────────────────────┘
```

### 3.2 Component Specifications

#### **Component 1: Research Coordinator Agent**

**File:** `agents/research-coordinator/SOUL.md`

```markdown
# Research Coordinator Agent

You are a research coordinator specialized in managing complex research projects.

## Your Responsibilities

1. **Query Analysis**: Determine research scope and complexity
2. **Mode Selection**: Choose between instant (1-pager) or deep research
3. **Memory Check**: Search /reports for existing relevant research
4. **Planning**: Create structured research plan with clear objectives
5. **Delegation**: Spawn specialized subagents for parallel research
6. **Synthesis**: Compile findings into human-readable reports

## Decision Tree

### Instant Mode (1-pager)
Trigger when:
- Simple factual query
- User explicitly requests "quick" or "summary"
- Existing report covers 80%+ of request

Process:
1. Formulate 2-3 optimized search queries
2. Use web_search for top sources
3. Memory_search for past reports
4. Synthesize 1-page summary with citations
5. Offer to expand to deep research

### Deep Research Mode
Trigger when:
- Complex, multi-faceted query
- User requests "comprehensive" or "detailed"
- Novel topic without existing coverage
- Contradictory information needs resolution

Process:
1. Present clarifying questions to user
2. Create internal research plan
3. Spawn 3-5 specialized subagents
4. Monitor progress and adjust strategy
5. Cross-validate findings
6. Compile comprehensive report

## Output Standards

All reports must:
- Be factual and well-cited
- Use scholarly tone while remaining accessible
- Include inline citations [1][2][3]
- Have clear structure (Introduction, Findings, Conclusion)
- Acknowledge limitations and uncertainties
```

#### **Component 2: Search Query Optimizer Skill**

**File:** `skills/optimize-search-query/SKILL.md`

```yaml
---
name: optimize-search-query
description: Generate optimal search queries to maximize information retrieval
user-invocable: false
disable-model-invocation: false
metadata: {"openclaw": {"requires": {"config": ["tools.web.search.enabled"]}}}
---

# Search Query Optimization

Generate high-quality search queries using these strategies:

## Query Formulation Techniques

### 1. Keyword Enrichment
- Extract NER (Named Entity Recognition) entities
- Add synonyms and related terms
- Include domain-specific terminology

### 2. Pseudo-Answer Generation
- "What would a good answer look like?"
- Generate hypothetical answer, extract keywords
- Search for those patterns

### 3. Multi-Strategy Approach
Combine:
- Broad exploratory queries (for overview)
- Specific targeted queries (for details)
- Comparison queries (for validation)

### 4. Query Templates

**Market Research:**
- "{topic} market size 2024-2025"
- "major players in {topic} industry"
- "{topic} growth trends forecast"

**Technical Research:**
- "{technology} architecture best practices"
- "{technology} vs alternatives comparison"
- "{technology} case studies production"

**Academic Research:**
- "{topic} site:arxiv.org OR site:scholar.google.com"
- "{topic} systematic review meta-analysis"
- "{topic} latest research 2024-2026"

## Usage Example

```python
# Instead of:
"AI agents"

# Optimize to:
[
  "AI agent frameworks market size 2025",
  "production AI agent architectures enterprise",
  "LangChain AutoGPT comparison deployment"
]
```

## Cost Optimization

- Start broad, narrow based on results
- Reuse search results within 7-day cache window
- Extract maximum info per search before next query
```

#### **Component 3: Specialized Subagent Templates**

**A. Background Research Subagent**

```yaml
---
name: background-researcher
description: Gather foundational knowledge and context
---

# Background Researcher

**Task:** Establish comprehensive background on the topic.

## Research Protocol

1. **Wikipedia/Encyclopedia sweep**
   - Get basic definitions and history
   - Identify key concepts and terminology

2. **Academic foundations**
   - Search: "{topic} site:arxiv.org"
   - Look for survey papers and reviews

3. **Recent developments**
   - News from last 6-12 months
   - Industry reports and whitepapers

## Output Format

```markdown
# Background: {Topic}

## Definition & Overview
[2-3 paragraphs with citations]

## Historical Context
[Key milestones, 3-5 bullet points]

## Current State (2024-2026)
[Recent developments, 3-5 bullet points]

## Key Terminology
- Term 1: Definition [citation]
- Term 2: Definition [citation]

## Sources
[1] Source 1 details
[2] Source 2 details
```
```

**B. Data Gathering Subagent**

```yaml
---
name: data-gatherer
description: Collect quantitative data and statistics
---

# Data Gatherer

**Task:** Find hard numbers, statistics, and quantitative evidence.

## Research Protocol

1. **Market data sources**
   - Statista, IBISWorld, Gartner, Forrester
   - Industry association reports

2. **Financial data**
   - Company filings (10-K, earnings reports)
   - Investment databases (Crunchbase, PitchBook)

3. **Academic metrics**
   - Citation counts, h-indices
   - Dataset sizes, benchmark performance

## Output Format

```markdown
# Data Findings: {Topic}

## Market Size & Growth
| Metric | Value | Year | Source |
|--------|-------|------|--------|
| Market Size | $X.XB | 2025 | [1] |
| CAGR | X.X% | 2024-2030 | [2] |

## Key Statistics
- Stat 1: X units [citation]
- Stat 2: X% growth [citation]

## Trends
[Charts/graphs if available]

## Sources
[Numbered list]
```
```

**C. Expert Opinion Mining Subagent**

```yaml
---
name: expert-opinion-miner
description: Find expert perspectives and thought leadership
---

# Expert Opinion Miner

**Task:** Gather expert analysis, predictions, and informed opinions.

## Research Protocol

1. **Thought leaders**
   - Twitter/X threads from domain experts
   - LinkedIn posts from industry veterans
   - Blog posts from recognized authorities

2. **Interviews & podcasts**
   - Search: "{topic} podcast interview"
   - Conference talks and panels

3. **Expert commentary**
   - Analyst reports
   - Op-eds in industry publications

## Output Format

```markdown
# Expert Perspectives: {Topic}

## Consensus Views
[What most experts agree on, 2-3 points]

## Contrarian Perspectives
[Alternative viewpoints, 1-2 points]

## Future Predictions
| Expert | Prediction | Timeframe | Source |
|--------|-----------|-----------|--------|
| Name 1 | Prediction text | 2026-2028 | [1] |

## Notable Quotes
> "Quote text" - Expert Name [citation]

## Sources
[Numbered list]
```
```

#### **Component 4: Report Generator Skill**

**File:** `skills/generate-research-report/SKILL.md`

```yaml
---
name: generate-research-report
description: Compile findings into professional research report
command-dispatch: tool
command-tool: write
---

# Research Report Generator

Generate publication-quality research reports from gathered data.

## Report Structure

### Instant Report (1-pager)

```markdown
# {Topic}: Executive Summary

**Date:** {ISO date}  
**Author:** OpenCLAW Research Agent  
**Status:** Quick Overview

## Overview
[2-3 paragraphs synthesizing key findings]

## Key Findings
1. Finding one with context [1][2]
2. Finding two with context [3][4]
3. Finding three with context [5]

## Data Highlights
- Metric 1: Value [citation]
- Metric 2: Value [citation]

## Expert Consensus
[1 paragraph on what experts agree about]

## Conclusion
[2-3 sentences with forward-looking statement]

## References
[1] Full citation with URL
[2] Full citation with URL
...

---
*For comprehensive analysis, request deep research mode.*
```

### Deep Report (10-20 pages)

```markdown
# {Topic}: Comprehensive Research Report

**Date:** {ISO date}  
**Authors:** OpenCLAW Research Team  
**Research Duration:** {X hours}  
**Sources Analyzed:** {N sources}

## Abstract
[150-200 words summarizing entire report]

## Table of Contents
1. Introduction
2. Methodology
3. Background & Context
4. Current State Analysis
5. Market Dynamics / Technical Deep-Dive
6. Expert Perspectives
7. Future Outlook
8. Limitations & Uncertainties
9. Conclusion
10. References

## 1. Introduction

### Research Objectives
[What we set out to discover]

### Scope & Boundaries
[What this report covers and doesn't cover]

### Key Questions
1. Question one
2. Question two
...

## 2. Methodology

### Research Approach
[Describe multi-agent coordination, parallel research]

### Sources
- Web search across {N} queries
- {N} academic papers analyzed
- {N} industry reports reviewed
- {N} expert opinions gathered

### Quality Controls
- Cross-validation across minimum 3 sources
- Fact-checking for claims
- Citation verification
- Contradiction resolution process

## 3. Background & Context
[Detailed background from subagent #1]

## 4. Current State Analysis
[Synthesis of multiple subagent findings]

### Market Overview
[Charts, tables, statistics]

### Technology Landscape
[If technical topic]

### Competitive Dynamics
[Key players, market share]

## 5. [Domain-Specific Deep Dive]
[Tailored section based on topic]

## 6. Expert Perspectives

### Consensus Views
[Areas of agreement]

### Divergent Opinions
[Areas of disagreement with analysis]

### Notable Insights
[Particularly valuable expert contributions]

## 7. Future Outlook

### Short-term (6-12 months)
[Predicted developments]

### Medium-term (1-3 years)
[Likely trajectories]

### Long-term (3-5 years)
[Speculative but informed predictions]

### Risk Factors
[What could disrupt these forecasts]

## 8. Limitations & Uncertainties

### Data Gaps
[What information was unavailable]

### Methodological Constraints
[Limitations of approach]

### Unresolved Questions
[Areas requiring further research]

## 9. Conclusion

### Summary of Findings
[3-5 key takeaways]

### Implications
[What this means for stakeholders]

### Recommendations
[If appropriate]

## 10. References

### Primary Sources
[Numbered list with full citations]

### Secondary Sources
[Additional reading]

---

## Appendices

### A. Search Queries Used
[Complete list for reproducibility]

### B. Data Tables
[Full datasets referenced in text]

### C. Methodology Details
[Subagent task assignments, timelines]
```
```

#### **Component 5: Memory Management System**

**File:** `skills/memory-manager/SKILL.md`

```yaml
---
name: memory-manager
description: Maintain long-term knowledge base from research sessions
---

# Memory Management

Distill research findings into reusable knowledge.

## MEMORY.md Structure

```markdown
# Research Agent Long-Term Memory

Last Updated: {timestamp}

## Research Domains

### AI & Machine Learning
#### AI Agents (Updated: 2026-02-09)
- Market size: $2.1B (2025), projected $15.3B (2030) [Report: 2026-02-09_ai-agents-market]
- Key players: LangChain, AutoGPT, OpenCLAW, Anthropic Claude
- Main use cases: Customer support (35%), research (28%), coding (22%)
- Technical trends: Multi-agent orchestration, RAG optimization, agentic workflows

#### Large Language Models (Updated: 2026-01-15)
- Leading models: GPT-5, Claude Opus 4, Gemini Ultra 2
- Context windows: 200K-1M tokens standard
- Cost trends: Decreasing 40% YoY for equivalent capability
...

### Climate & Environment
#### Carbon Capture Technology
...

## Key Insights

### Cross-Domain Patterns
1. **Parallel processing dominance**: Multi-agent systems outperform single-agent by 50-90%
2. **Cost optimization**: Using cheaper models for subagents while maintaining quality
3. **Citation importance**: Users demand traceable sources

### Methodology Learnings
1. **Optimal search strategy**: 3-5 targeted queries > 10+ exploratory queries
2. **Subagent allocation**: 3-5 specialists for most topics (diminishing returns beyond 6)
3. **Cross-validation threshold**: Minimum 3 sources for factual claims

## Research Templates

### Market Research Template
Proven effective for: Technology markets, Industry analysis
Components: Background, Market size, Key players, Trends, Outlook
Subagents: Background (1), Data gatherer (1), Expert opinion (2), Trend analyst (1)

### Technical Deep-Dive Template
Proven effective for: Software architectures, Algorithm comparisons
Components: Technical background, Architecture analysis, Performance benchmarks, Use cases
Subagents: Background (1), Technical analyst (2), Benchmark collector (1), Case study miner (1)

## Source Quality Rankings

### Highly Reliable
- Academic: arxiv.org, scholar.google.com, ACL anthology
- Industry: Gartner, Forrester, McKinsey reports
- Technical: GitHub repos with >10K stars, official documentation

### Use with Caution
- Blog posts without author credentials
- News articles without primary sources
- Social media without verification

### Generally Unreliable
- Marketing materials without data
- Anonymous sources
- Outdated information (>2 years for fast-moving fields)
```

## Usage Protocol

### After Each Research Session

1. **Extract key findings** (5-10 bullet points)
2. **Add to relevant domain section** in MEMORY.md
3. **Update "Last Updated" timestamp**
4. **Note research report path** for reference

### Before Starting Research

1. **Search MEMORY.md** for relevant background
2. **Check /reports** for similar past research
3. **Reuse insights** to avoid redundant work
4. **Update strategy** based on past learnings
```

#### **Component 6: Vector Search Integration**

**Setup Script:** `tools/vector-search-setup.sh`

```bash
#!/bin/bash
# Vector search setup for /reports folder

# Install dependencies
npm install chromadb  # or: pip install chromadb

# Create vector DB initialization script
cat > workspace/scripts/init-vector-db.js << 'EOF'
const { ChromaClient } = require('chromadb');

async function initializeVectorDB() {
  const client = new ChromaClient();
  
  // Create collection for research reports
  const collection = await client.createCollection({
    name: "research_reports",
    metadata: { "hnsw:space": "cosine" }
  });
  
  console.log("Vector DB initialized for research reports");
}

initializeVectorDB();
EOF

# Create embedding generation script
cat > workspace/scripts/embed-report.js << 'EOF'
const { ChromaClient } = require('chromadb');
const fs = require('fs');
const path = require('path');

async function embedReport(reportPath) {
  const client = new ChromaClient();
  const collection = await client.getCollection({ name: "research_reports" });
  
  // Read report content
  const content = fs.readFileSync(reportPath, 'utf-8');
  
  // Extract metadata
  const metadata = {
    path: reportPath,
    date: extractDate(content),
    topic: extractTopic(content),
    type: path.basename(reportPath).includes('instant') ? 'instant' : 'deep'
  };
  
  // Add to vector DB (uses OpenAI embeddings by default)
  await collection.add({
    ids: [path.basename(reportPath, '.md')],
    documents: [content],
    metadatas: [metadata]
  });
  
  console.log(`Embedded: ${reportPath}`);
}

function extractDate(content) {
  const match = content.match(/\*\*Date:\*\* (\d{4}-\d{2}-\d{2})/);
  return match ? match[1] : new Date().toISOString().split('T')[0];
}

function extractTopic(content) {
  const match = content.match(/^# (.+?):/m);
  return match ? match[1] : 'Unknown';
}

// Run for provided path
const reportPath = process.argv[2];
if (reportPath) {
  embedReport(reportPath);
}
EOF

echo "Vector search setup complete!"
echo "Run: node workspace/scripts/init-vector-db.js"
```

**Vector Search Skill:** `skills/vector-search-reports/SKILL.md`

```yaml
---
name: vector-search-reports
description: Search past research reports semantically
---

# Vector Search for Reports

Search the /reports folder for relevant past research.

## Usage

```javascript
// In agent code
const results = await vectorSearchReports({
  query: "AI agent market trends 2024-2025",
  limit: 5,
  threshold: 0.7,
  reportType: "all"  // or "instant" | "deep"
});

// Returns:
// [
//   {
//     path: "/reports/2026-02-09_ai-agents-market/deep_report.md",
//     similarity: 0.92,
//     topic: "AI Agents Market Analysis",
//     date: "2026-02-09",
//     excerpt: "..."
//   },
//   ...
// ]
```

## Integration with Research Flow

### Before Starting Research

1. **Semantic search** for similar past reports:
   ```
   query = user_question
   past_reports = vector_search(query, limit=3, threshold=0.75)
   ```

2. **Check coverage**:
   - If similarity > 0.85: Reuse existing report with updates
   - If similarity 0.65-0.85: Use as starting point, fill gaps
   - If similarity < 0.65: Conduct fresh research

3. **Extract relevant sections**:
   ```javascript
   for (report of past_reports) {
     relevant_sections = extractSections(report, query);
     add_to_context(relevant_sections);
   }
   ```

### After Completing Research

1. **Generate embeddings** for new report
2. **Add to vector DB** with metadata
3. **Update index.json** for quick lookup

## Performance Optimization

### Caching Strategy
- Cache embeddings for 30 days
- Regenerate if report updated
- Store embeddings in `/reports/{report_id}/embeddings.json`

### Query Optimization
- Use pseudo-answer generation for better matching
- Include synonyms and related terms
- Weight recent reports higher (decay factor)

### Hybrid Search
Combine:
1. **Vector similarity** (semantic matching)
2. **Keyword matching** (exact term presence)
3. **Recency boost** (newer reports weighted higher)

```python
final_score = (
  0.6 * vector_similarity +
  0.3 * keyword_score +
  0.1 * recency_score
)
```
```

---

## Part 4: Implementation Roadmap

### Phase 1: Foundation (Week 1-2)

#### Tasks
1. **Set up project structure**
   ```bash
   workspace/
   ├── agents/
   │   └── research-coordinator/
   │       ├── SOUL.md
   │       ├── IDENTITY.md
   │       └── config.json
   ├── skills/
   │   ├── optimize-search-query/SKILL.md
   │   ├── generate-research-report/SKILL.md
   │   ├── memory-manager/SKILL.md
   │   └── vector-search-reports/SKILL.md
   ├── reports/
   │   └── index.json
   ├── scripts/
   │   ├── init-vector-db.js
   │   └── embed-report.js
   └── MEMORY.md
   ```

2. **Configure OpenCLAW**
   ```json
   {
     "agents": {
       "list": [
         {
           "id": "research-coordinator",
           "name": "Research Coordinator",
           "model": "claude-opus-4",
           "thinking": "extended",
           "tools": {
             "profile": "full",
             "allow": ["group:web", "group:fs", "group:sessions", "group:memory"]
           },
           "subagents": {
             "maxConcurrent": 5,
             "model": "claude-sonnet-4",
             "allowAgents": ["*"]
           }
         }
       ]
     },
     "tools": {
       "web": {
         "search": {
           "enabled": true,
           "maxResults": 10,
           "cacheMinutes": 15
         },
         "fetch": {
           "enabled": true,
           "maxCharsCap": 50000
         }
       },
       "subagents": {
         "tools": {
           "allow": ["group:web", "group:fs", "memory_search"],
           "deny": ["sessions_spawn", "gateway", "cron"]
         }
       }
     }
   }
   ```

3. **Initialize vector database**
   ```bash
   cd workspace
   npm install chromadb openai  # For embeddings
   node scripts/init-vector-db.js
   ```

4. **Create basic skills**
   - Implement search query optimizer
   - Create report generator templates
   - Set up memory manager

#### Success Criteria
- ✅ OpenCLAW configured with research coordinator agent
- ✅ Web search and fetch tools operational
- ✅ Vector database initialized
- ✅ Basic skills loaded and accessible
- ✅ Subagent spawning works correctly

### Phase 2: Instant Mode Implementation (Week 3)

#### Tasks
1. **Build instant research workflow**
   ```
   User Query → Coordinator Agent
   ↓
   Analyze complexity (instant vs deep)
   ↓
   Vector search /reports
   ↓
   If found: Return existing + offer update
   If not found: Continue ↓
   ↓
   Optimize 2-3 search queries
   ↓
   Parallel web_search calls
   ↓
   Extract top facts from snippets
   ↓
   Synthesize 1-page report
   ↓
   Save to /reports + embed
   ↓
   Return to user + offer deep research
   ```

2. **Create instant report template**
   - 1-page format (see Component 4)
   - Inline citations
   - Executive summary style

3. **Test with sample queries**
   - "What is the current state of quantum computing?"
   - "AI safety research progress 2025"
   - "Top programming languages for LLM agents"

#### Success Criteria
- ✅ Instant mode completes in <2 minutes
- ✅ Generated reports are factual and well-cited
- ✅ Vector search correctly finds similar past reports
- ✅ Reports saved with proper structure
- ✅ User receives offer for deep research

### Phase 3: Deep Research Mode (Week 4-5)

#### Tasks
1. **Implement planning phase**
   ```javascript
   // Coordinator agent logic
   1. Present clarifying questions to user
      - What specific aspects interest you?
      - What depth of analysis? (high-level vs technical)
      - Any particular focus areas?
   
   2. Wait for user responses
   
   3. Create research plan:
      - Identify 4-6 research dimensions
      - Allocate specialized subagents
      - Define success criteria for each
   
   4. Display plan to user for approval
   ```

2. **Create specialized subagent templates**
   - Background researcher
   - Data gatherer
   - Expert opinion miner
   - Trend analyst
   - Comparative analyst

3. **Build parallel research orchestration**
   ```javascript
   // Spawn 3-5 subagents in parallel
   const subagents = [];
   
   for (const task of researchPlan.tasks) {
     const subagent = await tools.sessions_spawn({
       task: task.description,
       label: task.label,
       model: "claude-sonnet-4",
       runTimeoutSeconds: 600
     });
     subagents.push(subagent);
   }
   
   // Wait for all to complete
   const results = await Promise.all(
     subagents.map(sa => waitForCompletion(sa.runId))
   );
   
   // Cross-validate and synthesize
   const finalReport = await synthesizeFindings(results);
   ```

4. **Implement cross-validation logic**
   ```
   For each claim in findings:
     sources = getSourcesForClaim(claim)
     if sources.length < 3:
       flag as "needs verification"
     if sources.length >= 3:
       check for contradictions
       if contradictions exist:
         research further OR note disagreement
   ```

5. **Build comprehensive report generator**
   - 10-20 page format (see Component 4)
   - Full table of contents
   - Methodology section
   - Limitations & uncertainties
   - Appendices

#### Success Criteria
- ✅ Clarifying questions presented appropriately
- ✅ Research plan generated and displayed
- ✅ 3-5 subagents spawn successfully in parallel
- ✅ Cross-validation identifies contradictions
- ✅ Comprehensive report generated (10-20 pages)
- ✅ All claims have ≥3 source citations
- ✅ Limitations clearly stated
- ✅ Deep research completes in <15 minutes

### Phase 4: Memory & Optimization (Week 6)

#### Tasks
1. **Implement MEMORY.md distillation**
   ```javascript
   async function distillToMemory(report) {
     // Extract key insights (5-10 bullets)
     const insights = await extractInsights(report);
     
     // Identify domain
     const domain = classifyDomain(report.topic);
     
     // Update MEMORY.md
     const memory = readMemory();
     memory.domains[domain] = memory.domains[domain] || {};
     memory.domains[domain][report.topic] = {
       updated: new Date().toISOString(),
       insights: insights,
       reportPath: report.path
     };
     
     writeMemory(memory);
   }
   ```

2. **Optimize search query formulation**
   - Implement pseudo-answer generation
   - Add keyword enrichment
   - Create domain-specific templates

3. **Add search result caching**
   ```javascript
   const searchCache = new Map();
   
   async function cachedWebSearch(query) {
     const cacheKey = query.toLowerCase().trim();
     const cached = searchCache.get(cacheKey);
     
     if (cached && (Date.now() - cached.timestamp < 15 * 60 * 1000)) {
       return cached.results;  // Cache hit
     }
     
     const results = await tools.web_search({ query });
     searchCache.set(cacheKey, {
       results,
       timestamp: Date.now()
     });
     
     return results;
   }
   ```

4. **Implement intelligent query minimization**
   ```
   Strategy:
   1. Start with 1 broad query
   2. Analyze results for coverage
   3. If gaps identified, formulate targeted query
   4. Repeat until sufficient coverage or max 5 queries
   
   Example:
   Query 1: "AI agents 2025" → 70% coverage
   Query 2: "AI agent market size statistics" → +20% coverage
   Query 3: "enterprise AI agent deployments" → +10% coverage
   Total: 3 queries for 100% coverage (vs 10+ unoptimized)
   ```

5. **Add metrics tracking**
   ```json
   {
     "research_session": {
       "id": "20260209-143022",
       "topic": "AI Agents Market 2025",
       "mode": "deep",
       "metrics": {
         "duration_seconds": 847,
         "web_searches": 12,
         "unique_sources": 34,
         "subagents_spawned": 5,
         "tokens_used": 125000,
         "estimated_cost_usd": 2.34,
         "cache_hits": 3,
         "report_pages": 16
       }
     }
   }
   ```

#### Success Criteria
- ✅ MEMORY.md automatically updated after each session
- ✅ Search queries optimized (average 3-5 per session vs 10+)
- ✅ Cache hit rate >30% for repeated topics
- ✅ Metrics tracked and logged
- ✅ Cost per deep research <$3 USD

### Phase 5: Polish & User Experience (Week 7)

#### Tasks
1. **Add progress indicators**
   ```javascript
   // During deep research
   await tools.message.send({
     text: "🔍 **Research Progress**\n\n" +
           "✅ Background research complete (2/5)\n" +
           "⏳ Data gathering in progress (3/5)\n" +
           "⏳ Expert opinions pending (4/5)\n" +
           "⏳ Trend analysis pending (5/5)\n" +
           "📊 Cross-validation not started"
   });
   ```

2. **Implement feedback loop**
   ```
   After instant report:
   "Would you like me to:\n" +
   "1️⃣ Expand to comprehensive deep research\n" +
   "2️⃣ Focus on a specific section\n" +
   "3️⃣ Update with latest information\n" +
   "4️⃣ This is sufficient"
   
   After deep research:
   "Research complete! Would you like:\n" +
   "1️⃣ Clarification on any section\n" +
   "2️⃣ Additional depth on specific topic\n" +
   "3️⃣ Export in different format (PDF, DOCX)\n" +
   "4️⃣ Start related research"
   ```

3. **Create user documentation**
   ```markdown
   # Using the Deep Research Agent
   
   ## Quick Start
   
   ### Instant Research (1-pager)
   Just ask your question:
   > "What are AI agents?"
   
   Get a quick summary in <2 minutes.
   
   ### Deep Research (comprehensive)
   Add "comprehensive" or "detailed":
   > "Give me a comprehensive analysis of AI agents market"
   
   Or use instant mode and select "expand to deep research"
   
   ## Best Practices
   
   1. **Be specific**: "AI agents in healthcare" > "AI"
   2. **Provide context**: Mention if you need technical depth
   3. **Review instant first**: Save time by checking 1-pager
   4. **Ask clarifying questions**: Agent will prompt if needed
   
   ## Features
   
   - ✅ Automatic source citation
   - ✅ Cross-validation across 3+ sources
   - ✅ Expert opinion synthesis
   - ✅ Historical context + future outlook
   - ✅ Reuses past research (faster + cheaper)
   - ✅ Exports to Markdown, PDF, DOCX
   ```

4. **Add export formats**
   ```bash
   # Install pandoc for conversions
   npm install node-pandoc
   
   # In report generator skill
   async function exportReport(reportPath, format) {
     const formats = ['pdf', 'docx', 'html'];
     if (!formats.includes(format)) throw new Error('Unsupported format');
     
     const pandoc = require('node-pandoc');
     const outputPath = reportPath.replace('.md', `.${format}`);
     
     await pandoc(reportPath, `-o ${outputPath} --toc --toc-depth=3`);
     return outputPath;
   }
   ```

5. **Create usage examples**
   - Market research example
   - Technical deep-dive example
   - Competitive analysis example
   - Academic research example

#### Success Criteria
- ✅ Progress updates shown during research
- ✅ Clear feedback prompts after reports
- ✅ User documentation complete
- ✅ Export to PDF/DOCX working
- ✅ 5+ example use cases documented

---

## Part 5: Configuration & Best Practices

### 5.1 Optimal Configuration

```json
{
  "agents": {
    "list": [
      {
        "id": "research-coordinator",
        "name": "Research Coordinator",
        "model": "claude-opus-4",
        "thinking": "extended",
        "contextLimit": 200000,
        "temperature": 0.3,
        "tools": {
          "profile": "full",
          "allow": [
            "group:web",
            "group:fs",
            "group:sessions",
            "group:memory",
            "browser"
          ]
        },
        "subagents": {
          "maxConcurrent": 5,
          "model": "claude-sonnet-4",
          "thinking": "extended",
          "allowAgents": ["*"],
          "archiveAfterMinutes": 120
        }
      }
    ],
    "defaults": {
      "imageModel": "claude-opus-4",
      "thinking": "extended"
    }
  },
  "tools": {
    "web": {
      "search": {
        "enabled": true,
        "provider": "brave",
        "maxResults": 10,
        "cacheMinutes": 15
      },
      "fetch": {
        "enabled": true,
        "maxCharsCap": 50000,
        "extractMode": "markdown",
        "cacheMinutes": 15
      }
    },
    "subagents": {
      "tools": {
        "allow": ["group:web", "group:fs", "memory_search", "browser"],
        "deny": ["sessions_spawn", "gateway", "cron", "nodes"]
      }
    }
  },
  "browser": {
    "enabled": true,
    "defaultProfile": "research-chrome",
    "headless": true
  },
  "memory": {
    "provider": "chromadb",
    "embeddingModel": "text-embedding-ada-002",
    "collectionName": "research_reports"
  }
}
```

### 5.2 Cost Optimization Strategies

#### Model Selection
```
Coordinator (Orchestration):
- Model: Claude Opus 4 or GPT-4.5
- Reasoning: Needs best planning & synthesis capability
- Cost: ~$0.50-1.00 per deep research session

Subagents (Execution):
- Model: Claude Sonnet 4 or GPT-4
- Reasoning: Good quality at 1/4 the cost
- Cost: ~$0.20-0.40 per subagent (5 subagents = $1.00-2.00)

Total per deep research: $1.50-3.00
```

#### Search Optimization
```
Unoptimized: 15-20 searches per session = high API costs
Optimized: 3-5 searches per session = 70% cost reduction

Strategies:
1. Start broad, narrow based on results
2. Reuse cached results (15min window)
3. Extract maximum from each search before next
4. Use pseudo-answer generation for better queries
```

#### Token Management
```
Instant mode: 5K-15K tokens (~$0.05-0.15)
Deep mode: 100K-200K tokens (~$1.50-3.00)

Optimizations:
1. Summarize intermediate findings (don't pass full text)
2. Use subagents to process content in parallel
3. Store findings in files, pass references not content
4. Prune context after each synthesis phase
```

### 5.3 Quality Assurance Checklist

#### Before Publishing Report

- [ ] **Citations**: Every claim has source [N]
- [ ] **Cross-validation**: Factual claims verified across ≥3 sources
- [ ] **Contradictions**: Disagreements noted and explained
- [ ] **Recency**: Sources from last 6-12 months (unless historical)
- [ ] **Tone**: Professional yet accessible, no marketing language
- [ ] **Structure**: Clear headings, logical flow, table of contents
- [ ] **Limitations**: Uncertainties and gaps acknowledged
- [ ] **Completeness**: All research questions addressed
- [ ] **Sources**: Full citations with URLs in references section
- [ ] **Formatting**: Markdown syntax correct, tables render properly

#### Source Quality Criteria

**Tier 1 (Highest confidence):**
- Peer-reviewed academic papers
- Official government/organization statistics
- Reputable analyst firms (Gartner, Forrester, McKinsey)
- Primary research studies
- Official documentation

**Tier 2 (Good confidence):**
- Industry publications (TechCrunch, The Verge for tech)
- Expert blog posts (credentialed authors)
- Company financial reports (10-K, earnings)
- Conference proceedings
- High-quality journalism (NYT, WSJ, Reuters)

**Tier 3 (Use with caution):**
- General blog posts
- Social media from experts
- Marketing content with data backing
- Wikipedia (for background only)

**Reject:**
- Anonymous sources
- Marketing fluff without data
- Severely outdated information
- Known unreliable sources

### 5.4 Common Pitfalls & Solutions

| Pitfall | Solution |
|---------|----------|
| **Subagent redundancy** | Clear task boundaries in delegation |
| **Search query drift** | Validate query relevance before executing |
| **Citation laziness** | Require minimum 3 sources per claim |
| **Synthesis overload** | Summarize subagent findings before synthesis |
| **Context window overflow** | Store findings in files, pass references |
| **Stale cache hits** | 15min cache for web_search, regenerate for critical updates |
| **Hallucinated statistics** | Cross-validate all numbers across sources |
| **Unclear uncertainties** | Dedicate section to limitations |
| **Poor query optimization** | Use query templates + pseudo-answer generation |
| **Vector search misses** | Include synonyms + related terms in embeddings |

---

## Part 6: Testing & Validation

### 6.1 Test Scenarios

#### Instant Mode Tests

**Test 1: Simple Factual Query**
```
Query: "What is the capital of France?"
Expected:
- Duration: <30 seconds
- Searches: 1
- Output: 1-paragraph with citation
- No deep research offer (too simple)
```

**Test 2: Current Event**
```
Query: "Latest developments in quantum computing 2026"
Expected:
- Duration: 1-2 minutes
- Searches: 2-3
- Output: 1-page summary with 5-7 key developments
- Offer deep research expansion
```

**Test 3: Existing Report**
```
Query: "AI agents market analysis" (after already researched)
Expected:
- Duration: <1 minute
- Vector search hit
- Output: Existing report + offer to update
```

#### Deep Research Tests

**Test 4: Market Research**
```
Query: "Comprehensive analysis of carbon capture technology market"
Expected:
- Clarifying questions: Geographic focus? Technical depth?
- Subagents: 4-5 (background, market data, expert opinions, trends, competitive)
- Duration: 10-15 minutes
- Output: 12-18 pages with sections on market size, key players, technology types, outlook
- Cross-validation: All statistics from 3+ sources
```

**Test 5: Technical Deep-Dive**
```
Query: "Detailed comparison of vector database architectures"
Expected:
- Clarifying questions: Use cases of interest? Performance focus?
- Subagents: 4-5 (background, architecture analysis, benchmark collector, use case miner)
- Duration: 8-12 minutes
- Output: 10-15 pages with technical diagrams, performance benchmarks, trade-offs
- Technical accuracy validated
```

**Test 6: Contradictory Information**
```
Query: "Impact of remote work on productivity"
Expected:
- Identifies conflicting studies
- Presents multiple perspectives
- Notes: "Research findings are mixed..."
- Analyzes methodological differences
- Conclusion: Nuanced, acknowledges uncertainty
```

### 6.2 Acceptance Criteria

#### Functional Requirements
- ✅ Instant mode completes in <2 minutes
- ✅ Deep mode completes in <15 minutes
- ✅ Vector search finds relevant reports (>70% accuracy)
- ✅ Search queries optimized (avg 3-5 per deep session)
- ✅ Subagents spawn and complete successfully
- ✅ Reports saved with proper structure in /reports
- ✅ MEMORY.md updated after each session
- ✅ Citations present for all claims
- ✅ Cross-validation across 3+ sources

#### Quality Requirements
- ✅ Factual accuracy: >95% of claims verifiable
- ✅ Citation completeness: 100% of claims cited
- ✅ Source quality: >80% Tier 1-2 sources
- ✅ Readability: Accessible to educated non-experts
- ✅ Structure: Logical flow with clear sections
- ✅ Limitations: Acknowledged in dedicated section

#### Performance Requirements
- ✅ Cost per instant report: <$0.20
- ✅ Cost per deep report: <$3.00
- ✅ Cache hit rate: >30% for repeat topics
- ✅ Subagent efficiency: <5% redundant work
- ✅ Token usage: <200K per deep session

---

## Part 7: Advanced Features (Future Enhancements)

### 7.1 Adaptive Research Depth

```javascript
// Auto-determine optimal depth based on query complexity
function determineResearchDepth(query) {
  const complexity = analyzeComplexity(query);
  
  if (complexity.score < 3) {
    return { mode: 'instant', subagents: 0 };
  } else if (complexity.score < 7) {
    return { mode: 'moderate', subagents: 3 };
  } else {
    return { mode: 'deep', subagents: 5 };
  }
}

function analyzeComplexity(query) {
  return {
    score: calculateScore({
      multipleTopics: countTopics(query),
      requiresComparison: detectComparison(query),
      technicalDepth: detectTechnicalTerms(query),
      timeSpan: detectTimeRange(query),
      interdisciplinary: detectMultipleDomains(query)
    })
  };
}
```

### 7.2 Collaborative Research Sessions

```
Feature: Multiple users can contribute to same research session

Flow:
1. User A starts research on "AI safety"
2. Initial 1-pager generated
3. User A shares session with User B
4. User B adds: "Focus more on alignment problem"
5. Agent spawns additional subagent for alignment
6. Both users receive updated report
7. Users can comment on specific sections
8. Agent addresses comments in next iteration

Benefits:
- Team research collaboration
- Expert review integration
- Iterative refinement
```

### 7.3 Scheduled Research Updates

```javascript
// Monitor topics and auto-update when significant changes detected
{
  "scheduled_research": [
    {
      "topic": "AI agents market",
      "reportId": "2026-02-09_ai-agents-market",
      "schedule": "weekly",
      "updateTriggers": [
        "majorNewsEvent",
        "significantDataChange",
        "newCompetitorEntry"
      ],
      "notify": ["user@example.com"]
    }
  ]
}

// Implementation using OpenCLAW cron
await tools.cron.add({
  schedule: "0 9 * * MON",  // Every Monday 9 AM
  task: "Check for updates on monitored research topics",
  action: "research-update-check"
});
```

### 7.4 Multi-Modal Research

```
Feature: Incorporate images, videos, podcasts into research

Example:
Query: "Analysis of 2026 Super Bowl ads"

Subagents:
1. Text analysis (articles, reviews)
2. Video analysis (actual ads via YouTube)
3. Sentiment analysis (social media reactions)
4. Audio analysis (podcast commentary)

Output:
- Text report with embedded screenshots
- Video clip references with timestamps
- Audio quotes from experts
- Sentiment charts and visualizations
```

### 7.5 Domain-Specific Templates

```yaml
# templates/market-research.yaml
name: "Market Research Template"
domains: ["business", "technology", "healthcare"]
subagents:
  - name: "Market Size Analyst"
    tools: ["web_search", "web_fetch"]
    focus: "TAM, SAM, SOM calculations"
  
  - name: "Competitive Intelligence"
    tools: ["web_search", "browser"]
    focus: "Key players, market share, positioning"
  
  - name: "Trend Forecaster"
    tools: ["web_search", "memory_search"]
    focus: "Growth drivers, future projections"
  
  - name: "Expert Synthesizer"
    tools: ["web_search"]
    focus: "Analyst opinions, thought leadership"

report_structure:
  - "Executive Summary"
  - "Market Overview"
  - "Market Size & Growth"
  - "Competitive Landscape"
  - "Key Trends & Drivers"
  - "Future Outlook"
  - "Risks & Opportunities"

# Usage:
await spawnResearchFromTemplate('market-research', {
  topic: "AI agents market",
  geography: "global",
  timeframe: "2024-2030"
});
```

---

## Conclusion

This comprehensive design provides a **production-ready architecture** for building a Deep Research Agent system within OpenCLAW. The system combines:

1. **State-of-the-art research methodologies** from DeepResearcher, Anthropic's Research system, and academic literature
2. **OpenCLAW's powerful primitives** (subagents, skills, tools, memory)
3. **Practical implementation details** (code snippets, configurations, workflows)
4. **Quality assurance frameworks** (testing, validation, best practices)

### Key Advantages

- ✅ **Two-tier system**: Fast 1-pagers + comprehensive deep research
- ✅ **Cost-optimized**: $1.50-3.00 per deep research vs $10+ for comparable services
- ✅ **Reusable knowledge**: Vector search prevents redundant work
- ✅ **Human-readable**: Professional reports suitable for sharing
- ✅ **Extensible**: Easy to add new domains, templates, features
- ✅ **Production-ready**: Built on proven OpenCLAW architecture

### Implementation Timeline

- **Phase 1 (Foundation)**: 2 weeks
- **Phase 2 (Instant Mode)**: 1 week
- **Phase 3 (Deep Research)**: 2 weeks
- **Phase 4 (Memory & Optimization)**: 1 week
- **Phase 5 (Polish & UX)**: 1 week
- **Total**: ~7 weeks to production

### Next Steps

1. **Review this design** with your team
2. **Set up OpenCLAW environment** if not already done
3. **Start with Phase 1**: Foundation setup
4. **Iterate based on feedback** from initial tests
5. **Expand with advanced features** as needed

This agent will transform how research is conducted—combining the speed of AI with the rigor of human scholarship.

---

**Document prepared by:** Claude (Anthropic)  
**For:** OpenCLAW Deep Research Agent Implementation  
**Date:** February 9, 2026