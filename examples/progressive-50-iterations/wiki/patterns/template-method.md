---
title: "TEMPLATE_METHOD"
confidence: 0.7
path: patterns/template-method
---

# Template Method

**Category:** design

## Description

The agent follows a consistent flow: fetch commit → build prompt → call LLM → parse response → generate updates. This structure is replicated across agents

## Usage in This Codebase

Found in: `src/agents/analysis/technical-debt-agent.ts:18-51`

## Examples

*See commit a286af4b for implementation example.*

---
*Last updated from commit a286af4b*
