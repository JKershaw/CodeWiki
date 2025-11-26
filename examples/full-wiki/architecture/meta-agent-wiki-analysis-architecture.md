---
title: "Meta-Agent Wiki Analysis Architecture"
confidence: 0.50
created: 2025-11-26T12:31:53.943Z
updated: 2025-11-26T12:31:53.943Z
commits: [addfc9e6ba26bc56753b30cadb7949e2afa582d8]
---
# Meta-Agent Wiki Analysis Architecture

This commit introduces two meta-agents for wiki analysis: a Quality Agent that evaluates documentation quality and a Consistency Agent that detects inconsistencies across wiki pages. These agents represent a significant architectural decision to implement recursive self-improvement where agents analyze and improve their own output. The implementation includes sophisticated heuristics for finding broken links, duplicates, orphaned pages, category mismatches, and contradictory information.

## Key Points



## Decisions Made

- **Meta-agent pattern**: Agents can analyze the collective output of other agents (the wiki), enabling recursive self-improvement and cross-document analysis that individual commit-focused agents cannot provide
- **Two-phase analysis**: Quick deterministic checks (broken links, orphans, duplicates) before expensive LLM analysis reduces costs while maintaining thoroughness
- **Wiki-level execution**: Meta-agents run on repository state rather than commits, requiring new execution paths in orchestrator and executor
- **Threshold-based filtering**: Multiple configurable thresholds (MIN_PAGES_FOR_ANALYSIS=5, SIMILARITY_THRESHOLD=0.6, MAX_PAGES_TO_COMPARE=20) control when and how deeply analysis runs
- **Comprehensive consistency checks**: Six distinct consistency issue types (broken links, duplicate titles, similar content, orphaned pages, category mismatches, terminology inconsistencies)
- **Multi-dimensional quality scoring**: Five rubric categories with weighted importance enable nuanced quality assessment beyond simple pass/fail

## Source Files

- `src/agents/meta/consistency-agent.ts`
- `src/agents/meta/index.ts`
- `src/agents/meta/quality-agent.ts`
- `src/agents/orchestrator/orchestrator.ts`
- `src/cli.ts`
- `src/executor/executor.ts`
- `src/repositories/file-based/file-agent-run-repository.ts`
- `tests/unit/consistency-agent.test.ts`
- `tests/unit/quality-agent.test.ts`

---
*Captured from commit addfc9e6*
