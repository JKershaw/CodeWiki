# Orchestrator Depth Improvements Plan

**Created:** 2025-12-05
**Status:** Phase 1 Complete

## Background

Feedback from benchmarking revealed that the Orchestrator prioritizes structure and quantity over depth:
- `completeness_coverage`: 46.0/100
- `contextual_richness`: 51.8/100
- `actionability`: 36.3/100

The current system prompt explicitly states: "A useful wiki with good structure beats comprehensive coverage" without balancing for depth.

## Improvement Plan

### Phase 1 - Quick Wins (Low Effort, Immediate Value)

| # | Improvement | Impact | Effort | Status |
|---|------------|--------|--------|--------|
| 1 | Context gatherer depth metrics | HIGH | MEDIUM | ✅ Complete |
| 2 | System prompt balance definition | MEDIUM | LOW | ✅ Complete |
| 3 | Agent descriptions | MEDIUM | LOW | ✅ Complete |
| 4 | Phase guidance | MEDIUM-HIGH | LOW | ✅ Complete |
| 5 | User prompt considerations | HIGH | LOW | ✅ Complete |

### Phase 2 - Core Mechanism (Medium Effort, High Value)

| # | Improvement | Impact | Effort | Status |
|---|------------|--------|--------|--------|
| 6 | WriterAgent enhancement for shallow content | HIGH | MEDIUM | Pending |
| 7 | Deepening strategy in strategies.ts | HIGH | MEDIUM | Pending |

### Phase 3 - Future (High Effort, Defer)

| # | Improvement | Impact | Effort | Status |
|---|------------|--------|--------|--------|
| 8 | WikiPage schema extension | HIGH | HIGH | Deferred |

---

## Detailed Plans

### 1. Context Gatherer Changes (`context-gatherer.ts`)

**Current State:**
- `OrchestratorContext` only tracks: `pagesNeedingRewrite`, `avgConfidence`, `lowConfidencePages`, `pagesWithoutLinks`

**Planned Changes:**
Add new fields to `OrchestratorContext`:
```typescript
// New depth metrics (heuristic-based, no content assumptions)
shallowPages: number;           // Pages that are short or lack structure
pagesLackingExamples: number;   // Pages without code blocks
```

Detection heuristics (simple, no semantic analysis):
- **Shallow**: Page content < 500 chars OR has fewer than 2 headings (excluding overview/index pages)
- **Lacking examples**: No fenced code blocks (```) in content

### 2. System Prompt Balance Definition (`prompts.ts:11-17`)

Add DEPTH as a balancing factor:
```
You balance:
- COVERAGE: Has every commit been analyzed?
- STRUCTURE: Does the wiki have good organization and navigation?
- QUALITY: Are pages readable, linked, and confidence-scored?
- DEPTH: Do pages explain HOW things work with examples, not just WHAT exists?
- USEFULNESS: Can someone use this wiki to understand the codebase NOW?

Key insight: A useful wiki balances structure AND depth. Prioritize making existing pages substantive.
```

### 3. Agent Descriptions (`prompts.ts:27-48`)

Update descriptions to emphasize depth:
- `code-change`: Add "Include implementation details and examples where possible"
- `writer`: Change to "Transforms shallow or commit-style pages into substantive articles with examples"
- `quality`: Add "Flags pages that lack depth or examples"

### 4. Phase Guidance (`prompts.ts:57-81`)

Add depth objectives to each phase:
- **Foundation (0-5)**: Focus on exploration (unchanged)
- **Navigability (5-10)**: Add "Ensure early pages have examples"
- **Enrichment (10-20)**: Emphasize deepening: "Prioritize adding depth to shallow pages"
- **Historical (20+)**: Add "Deepen high-value pages while backfilling history"

### 5. User Prompt Considerations (`prompts.ts:130-138`)

Add shallow pages to considerations:
```typescript
- Shallow pages (short or lacking structure): ${ctx.shallowPages}
- Pages without code examples: ${ctx.pagesLackingExamples}
${ctx.shallowPages > 0 ? '⚠️ Consider running writer agent to add depth!' : ''}
```

---

## Implementation Notes

### Test-Driven Development

For context-gatherer changes:
1. Write tests for `shallowPages` detection
2. Write tests for `pagesLackingExamples` detection
3. Implement the detection logic
4. Verify tests pass

### Files to Modify

1. `src/agents/orchestrator/context-gatherer.ts` - Add metrics
2. `src/agents/orchestrator/prompts.ts` - Update prompts
3. `tests/unit/context-gatherer.test.ts` - Add tests (if exists, or create)

### Rollback Plan

All changes are additive and non-breaking. If issues arise:
- Context metrics can be removed without affecting existing functionality
- Prompt changes can be reverted independently
