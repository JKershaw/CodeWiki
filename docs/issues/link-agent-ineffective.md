# Critical Issue: LinkAgent Ineffective - 85% of Pages Isolated

**Issue ID:** LINK-001
**Severity:** Critical
**Component:** `src/agents/meta/link-agent.ts`
**Related:** Orchestrator prompts, Response parsing

## Summary

The LinkAgent, responsible for creating cross-references between wiki pages, is largely ineffective. Analysis shows **85.5% of wiki pages have no links** (incoming or outgoing), making the wiki a collection of isolated documents rather than an interconnected knowledge base.

## Evidence

### Statistics from Test Run
- Total pages: 62
- Pages with outgoing links: 3 (4.8%)
- Pages with backlinks: 8 (12.9%)
- Pages completely isolated: 53 (85.5%)

### Log Messages
```
Meta/synthesis agent link should not have target (ignoring)
Meta/synthesis agent link should not have target (ignoring)
```

## Root Cause Analysis

### Issue 1: Orchestrator Assigns Targets to LinkAgent

**Location:** `src/agents/orchestrator/prompts.ts:271-276`

```typescript
// Meta/synthesis agents should NOT have target
if (target) {
  console.warn(`Meta/synthesis agent ${agentType} should not have target (ignoring)`);
}
validWorkItems.push({ agentType, reason });
```

**Problem:** When the LLM orchestrator suggests link agent work, it sometimes includes a target (like a commit ID or path). The orchestrator logs a warning but still adds the work item. While the LinkAgent does run, this indicates the LLM doesn't understand that meta agents operate on the whole wiki, not specific targets.

**Impact:** The warning itself doesn't prevent LinkAgent from running, but it indicates prompt confusion.

### Issue 2: LLM Response Format Mismatch (Primary Cause)

**Location:** `src/agents/meta/link-agent.ts:164-193`

The LinkAgent expects responses in this exact format:
```
LINK_SUGGESTIONS:
- [source/page-path] -> [target/page-path] | [STRENGTH:strong] | Description
- [source/page-path] -> [target/page-path] | [STRENGTH:medium] | Description

CONFIDENCE: 0.8
```

**Parsing Pattern:**
```typescript
const linkPatterns: ItemPattern<...>[] = [
  {
    pattern: /^-\s*\[([^\]]+)\]\s*->\s*\[([^\]]+)\]\s*\|\s*\[STRENGTH:(\w+)\]\s*\|\s*(.+)$/i,
    mapper: (m) => ({
      sourcePath: m[1]!.trim(),
      targetPath: m[2]!.trim(),
      strength: m[3]!.toLowerCase() as 'strong' | 'medium' | 'weak',
      reason: m[4]!.trim(),
    }),
  },
];
```

**Problem:** The llama-4-maverick model does not reliably follow this format. If the response deviates even slightly (missing brackets, different separator, natural language instead of structured output), parsing returns zero links.

**Evidence:** Throughout the logs, we see pattern failures for many agents:
```
[codebase-explorer] Failed to parse SUMMARY {...}
[pattern] Parse stats: 0 ok, 9 failed
[code-change] Failed to parse PAGE_TITLE {...}
```

While we don't see LinkAgent-specific parse failures in logs (because they use `parseListItemsWithFallback` which fails silently to empty array), the pattern is consistent: the LLM model doesn't follow structured output formats.

### Issue 3: No Feedback Loop for Link Creation

**Location:** `src/agents/meta/link-agent.ts:58-69`

```typescript
// Find pages that need link analysis (no links yet or low confidence)
const pagesToAnalyze = pages.filter(p => p.links.length === 0);

if (pagesToAnalyze.length === 0) {
  return {
    result: createAgentResult({
      summary: 'All pages already have links analyzed',
      ...
    }),
    ...
  };
}
```

**Problem:** The agent only analyzes pages with zero links. If a page once had links (but they were removed or invalid), it won't be re-analyzed. There's also no mechanism to:
- Verify that suggested links point to valid pages
- Re-run link analysis when new pages are created
- Track link quality or remove stale links

### Issue 4: Limited Pages Analyzed Per Run

**Location:** `src/agents/meta/link-agent.ts:113`

```typescript
const limitedPagesToAnalyze = pagesToAnalyze.slice(0, 10);
```

**Problem:** Only 10 pages are analyzed per LinkAgent run. With 62 pages and mostly failed parses, it would take many runs to cover all pages, and even then, parse failures mean no actual links are created.

## Data Flow Analysis

```
1. Orchestrator → generates 'link' work item
   ↓
2. Executor → claims work item, creates AgentContext
   ↓
3. LinkAgent.run() → called with wiki target
   ↓
4. Filters pages with no links → sends up to 10 to LLM
   ↓
5. LLM responds (but NOT in expected format)
   ↓
6. parseResponse() → parseListItemsWithFallback returns []
   ↓
7. generateUpdates() → no updates generated (linksBySource is empty)
   ↓
8. Returns empty updates array → no changes applied
```

## Impact on Wiki Quality

1. **No Navigation:** Users cannot click from one page to discover related content
2. **No Knowledge Graph:** The wiki cannot answer "what relates to X?"
3. **Quality Benchmark Failure:** "contextual_richness" dimension scores low (42/100)
4. **Duplicate Content:** Without links, similar pages get created instead of merged
5. **Research Agent Limitation:** Cannot follow links to gather comprehensive answers

## Recommendations

### Short-term Fixes

1. **Add Link Parsing Logging**
   Add explicit logging when link parsing returns empty to diagnose failures:
   ```typescript
   const linkSuggestions = parseListItemsWithFallback(...);
   if (linkSuggestions.length === 0) {
     console.warn(`[link] No links parsed from response`, {
       responsePreview: response.slice(0, 500)
     });
   }
   ```

2. **Relaxed Parsing Pattern**
   Create fallback patterns that are more lenient:
   ```typescript
   // Fallback: simpler format without strength
   /^-\s*([^\s]+)\s*(?:->|→|to)\s*([^\s]+)\s*[:\-|]\s*(.+)$/i
   ```

3. **Validation of Link Targets**
   Before saving, verify target pages exist:
   ```typescript
   const validLinks = newLinks.filter(l => pageMap.has(l.target));
   ```

### Medium-term Fixes

4. **Post-Processing Link Pass**
   Run a batch link analysis after wiki generation completes, not interleaved with other agents.

5. **Model-Specific Prompts**
   Detect the LLM model and use appropriate prompts. Some models need more explicit formatting instructions or examples.

6. **Link Quality Tracking**
   Store link creation success/failure metrics and use them to adjust the approach.

### Long-term Fixes

7. **Structured Output Mode**
   Use LLM features for structured output (JSON mode) when available, rather than relying on text parsing.

8. **Embedding-Based Linking**
   Use vector embeddings to find semantically similar pages, independent of LLM format compliance.

## Files to Investigate

| File | Purpose |
|------|---------|
| `src/agents/meta/link-agent.ts` | Main LinkAgent implementation |
| `src/agents/parsing/response-parser.ts` | Parse utilities, `parseListItemsWithFallback` |
| `src/agents/orchestrator/prompts.ts` | Work item generation and validation |
| `src/commands/update-wiki-page.ts` | How links are saved to wiki pages |
| `src/executor/executor.ts` | How agent updates are applied |

## Verification Steps

To verify the fix works:

1. Run wiki generation with verbose logging enabled
2. Check for `[link]` log messages showing successful parses
3. After run, query: `SELECT COUNT(*) FROM wiki_pages WHERE links != '[]'`
4. Target: >50% of pages should have at least one link

## Related Issues

- LLM Response Parsing Failures (see `llm-parsing-failures.md`)
- Quality Benchmark Stagnation
- Confidence Score Calibration
