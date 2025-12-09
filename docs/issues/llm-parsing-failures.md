# Critical Issue: LLM Response Parsing Failures

**Issue ID:** LLM-001
**Severity:** Critical
**Component:** `src/agents/parsing/response-parser.ts`, All agents
**Related:** Model selection, Prompt engineering

## Summary

The LLM model (meta-llama/llama-4-maverick) frequently returns responses that don't match expected formats, causing widespread parsing failures. This results in:

- **82% of pages stuck at default 0.5 confidence** (instead of meaningful scores)
- **Quality signals lost** (findings, links, patterns not captured)
- **Fallback defaults used throughout** (masking actual analysis quality)

## Evidence

### Confidence Score Distribution
```
Confidence 0.5: 51 pages (82%)
Confidence 0.6:  4 pages ( 6%)
Confidence 0.7:  1 page  ( 2%)
Other:           6 pages (10%)
```

Most pages have exactly 0.5 confidence because parsing fails and the default is used.

### Log Evidence (From Test Run)

```
[codebase-explorer] Failed to parse SUMMARY {...}
[codebase-explorer] Failed to parse FINDINGS {...}
[codebase-explorer] Failed to parse WIKI_PAGES {...}
[codebase-explorer] Using default confidence 0.7 {...}

[pattern] Parse stats: 0 ok, 9 failed {
  failed: ['SUMMARY', 'PATTERNS_FOUND', 'KEY_FILES', 'IMPLEMENTATION_EXPLANATION',
           'TRADE_OFFS', 'CONVENTIONS', 'ANTI_PATTERNS', 'WIKI_UPDATES', 'CONFIDENCE']
}

[technical-debt] Failed to parse DEBT_TREND (valid: adding_debt, reducing_debt, neutral, mixed)
[security] Failed to parse SECURITY_RELEVANCE (valid: critical, high, medium, low, none)
[narrative] Failed to parse NARRATIVE_TYPE (valid: planning, adr, design, changelog, ...)
```

### Example Malformed Responses

**Expected Format:**
```
SUMMARY:
This module handles user authentication...

FINDINGS:
- [TYPE] [IMPORTANCE:high] Description [path/to/file]

CONFIDENCE: 0.85
```

**Actual Responses from LLM:**

1. **Tool call syntax in output** (instead of analysis):
```
```
list_directory(path: "src/agents")
```
```

2. **Markdown headers instead of sections**:
```
### Summary
This module handles...

### Findings
- High importance: Description
```

3. **Natural language instead of structured format**:
```
The security relevance of this code is medium because...
```

4. **Garbage/corrupted output**:
```
### (lowastics`...
```

## Affected Agents and Their Expected Formats

### 1. CodebaseExplorerAgent
**Expected:**
```
SUMMARY: [text]
FINDINGS:
- [TYPE] [IMPORTANCE:level] [Description] [paths]
WIKI_PAGES:
---PAGE---
PATH: category/name
TITLE: Title
CONTENT: ...
---END_PAGE---
CONFIDENCE: 0.8
```

**Parsing Issues:**
- LLM returns tool calls instead of analysis
- Missing section headers
- Wrong delimiter formats

### 2. PatternAgent
**Expected:**
```
SUMMARY: [text]
PATTERNS_FOUND:
- [Pattern Name] | [Pattern Type] | [Description]
KEY_FILES: ...
IMPLEMENTATION_EXPLANATION: ...
TRADE_OFFS: ...
CONVENTIONS: ...
ANTI_PATTERNS: ...
WIKI_UPDATES: ...
CONFIDENCE: 0.8
```

**Issues:** Parse stats show 0 successful, 9 failed in many runs.

### 3. SecurityAgent
**Expected:**
```
SUMMARY: [text]
SECURITY_RELEVANCE: critical|high|medium|low|none
FINDINGS: ...
VULNERABILITIES: ...
RECOMMENDATIONS: ...
WIKI_UPDATES: ...
CONFIDENCE: 0.8
```

**Issues:** `SECURITY_RELEVANCE` often missing or in wrong format.

### 4. TechnicalDebtAgent
**Expected:**
```
SUMMARY: [text]
DEBT_TREND: adding_debt|reducing_debt|neutral|mixed
FINDINGS: ...
TODO_ITEMS: ...
SOLID_VIOLATIONS: ...
REMEDIATION: ...
HOTSPOTS: ...
WIKI_UPDATES: ...
CONFIDENCE: 0.5
```

**Issues:** `DEBT_TREND` parsing frequently fails.

### 5. NarrativeAgent
**Expected:**
```
SUMMARY: [text]
NARRATIVE_TYPE: planning|adr|design|changelog|philosophy|guide|readme|decision|none
PAGE_TITLE: [title]
FINDINGS: ...
KEY_DECISIONS: ...
WIKI_UPDATES: ...
CONFIDENCE: 0.7
```

**Issues:** `NARRATIVE_TYPE` enum value not recognized.

### 6. LinkAgent
**Expected:**
```
LINK_SUGGESTIONS:
- [source/path] -> [target/path] | [STRENGTH:strong] | Description

CONFIDENCE: 0.8
```

**Issues:** Link format highly specific; any deviation returns 0 links.

## Root Cause Analysis

### 1. Model Instruction-Following Capability

**Problem:** The `meta-llama/llama-4-maverick` model doesn't reliably follow structured output instructions. It tends to:
- Generate natural language instead of structured sections
- Include markdown formatting not in the prompt
- Output tool call syntax when it should output analysis
- Truncate or corrupt output mid-response

**Evidence:** Claude/GPT models typically follow these formats more reliably. The llama model appears optimized for conversational output.

### 2. Overly Rigid Parsing Patterns

**Location:** `src/agents/parsing/response-parser.ts`

Each agent uses specific regex patterns that require exact formatting:

```typescript
// Example: Must have exactly [TYPE] [IMPORTANCE:level]
pattern: /^-\s*\[([^\]]+)\]\s*\[IMPORTANCE:(\w+)\]\s*(.+?)(?:\s*\[([^\]]*)\])?$/i
```

If the LLM outputs:
- `- TYPE: high importance - Description` → **Fails**
- `- [TYPE] [high] Description` → **Fails** (missing IMPORTANCE:)
- `- [TYPE] [IMPORTANCE:HIGH] Description` → Works

### 3. Silent Fallbacks Mask Problems

**Problem:** When parsing fails, agents use default values silently:

```typescript
const confidence = parseConfidence(ctx, { defaultValue: 0.7 });
// If parsing fails, returns 0.7 - no error thrown
```

This means:
- Code continues executing with garbage data
- No alarm raised about systematic failures
- Quality appears stable when it's actually degraded

### 4. No Prompt Validation/Retry

When a response fails to parse, the system doesn't:
- Retry with a reformatted prompt
- Ask the LLM to correct its output
- Fall back to a simpler format

## Impact Analysis

### Direct Impacts

| Impact | Description |
|--------|-------------|
| Quality Blindness | Can't distinguish good pages from bad ones (all ~0.5 confidence) |
| Lost Analysis | Findings, patterns, security issues not captured |
| Broken Links | LinkAgent suggestions not parsed → 85% pages isolated |
| Misleading Metrics | Benchmark scores reflect parsing failures, not actual quality |

### Cascading Effects

1. **Orchestrator Decisions:** Uses confidence scores to prioritize work → bad priorities
2. **Quality Agent:** Can't identify truly low-quality pages
3. **Self-Improvement Analysis:** Can't trace root causes accurately
4. **Research Agent:** Answers based on incomplete wiki content

## Recommendations

### Immediate (Quick Fixes)

1. **Add Parsing Success Metrics**
   ```typescript
   // After each agent run, log parsing success rate
   console.log(`[${agentType}] Parse success: ${successCount}/${totalSections}`);
   ```

2. **Aggregate Parse Failure Alerts**
   Track parse failures across runs and alert when rate exceeds threshold:
   ```typescript
   if (parseFailureRate > 0.3) {
     console.error(`HIGH PARSE FAILURE RATE: ${parseFailureRate * 100}%`);
   }
   ```

3. **Relax Parsing Patterns**
   Add fallback patterns that accept more variations:
   ```typescript
   const findingPatterns = [
     // Strict format
     /^-\s*\[([^\]]+)\]\s*\[IMPORTANCE:(\w+)\]\s*(.+)$/i,
     // Relaxed format
     /^-\s*(\w+)[\s:]+(\w+)\s+(?:importance)?[\s:-]*(.+)$/i,
   ];
   ```

### Medium-term

4. **Model-Specific Prompts**
   Detect model and adjust prompt format:
   ```typescript
   if (model.includes('llama')) {
     // Use simpler format with more examples
     // Repeat format instructions multiple times
   }
   ```

5. **Retry with Correction**
   If parse fails, send follow-up asking for correction:
   ```typescript
   if (parseFailures.length > 0) {
     const correction = await llm.complete({
       messages: [
         { role: 'assistant', content: originalResponse },
         { role: 'user', content: `Please reformat your response using exactly this format:\n${FORMAT_EXAMPLE}` }
       ]
     });
   }
   ```

6. **JSON Mode When Available**
   Use structured output features:
   ```typescript
   const response = await llm.complete({
     ...options,
     response_format: { type: 'json_object' }
   });
   ```

### Long-term

7. **Model Evaluation Pipeline**
   Test each model against parsing requirements before deployment:
   ```typescript
   // Run standard prompts, measure parse success rate
   const modelScore = await evaluateModelParsing('llama-4-maverick');
   if (modelScore < 0.8) {
     console.warn('Model may have parsing issues');
   }
   ```

8. **Adaptive Parsing**
   Learn from successful parses to improve patterns:
   ```typescript
   // Store successful response formats
   // Generate patterns from examples
   ```

## Verification Checklist

After implementing fixes, verify:

- [ ] Parse success rate > 80% for all agents
- [ ] Confidence scores distributed (not all 0.5)
- [ ] Findings populated for most agent runs
- [ ] Link suggestions successfully parsed
- [ ] Quality benchmark scores improve

## Related Files

| File | Purpose |
|------|---------|
| `src/agents/parsing/response-parser.ts` | Core parsing utilities |
| `src/agents/parsing/index.ts` | Parsing exports |
| `src/agents/analysis/*.ts` | Analysis agent implementations |
| `src/agents/meta/*.ts` | Meta agent implementations |
| `src/services/llm/openrouter-llm-service.ts` | LLM API integration |

## Appendix: Parse Function Reference

### Core Functions

| Function | Purpose | Failure Behavior |
|----------|---------|------------------|
| `parseSection()` | Extract named section | Returns null, logs warning |
| `parseSectionItems()` | Parse list items | Returns empty array |
| `parseListItemsWithFallback()` | Parse with multiple patterns | Returns empty array |
| `parseConfidence()` | Extract confidence score | Returns default (0.5 or 0.7) |
| `parseChoice()` | Parse enum value | Returns null, logs error |

### Failure Logging

```typescript
// Failures are logged with context:
console.warn(`[${ctx.agentType}] Failed to parse ${sectionName}`, {
  section: sectionName,
  required: boolean,
  pattern: 'regex preview...',
  responsePreview: 'first 100 chars...'
});
```

## Related Issues

- LinkAgent Ineffective (see `link-agent-ineffective.md`)
- Quality Benchmark Stagnation
- Confidence Score Calibration
