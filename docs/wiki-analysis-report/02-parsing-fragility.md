# Issue 2: Fragile Response Parsing

## Severity: HIGH

## Summary

All agents parse LLM responses using regex patterns that assume perfect formatting. When the LLM output deviates even slightly, content is lost silently or replaced with default values.

---

## The Pattern

Every agent follows the same problematic pattern:

```typescript
// Extract section with regex
const titleMatch = response.match(/TITLE:\s*(.+)/);
const title = titleMatch?.[1] ?? 'Default Title';  // Silent fallback

const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/);
const confidence = confidenceMatch
  ? parseFloat(confidenceMatch[1])
  : 0.7;  // Silent default to 0.7
```

---

## Failure Modes

### 1. Missing Sections Default Silently

**Example: Overview Agent**

Expected format:
```
TITLE: Authentication System Overview
INTRODUCTION: This section covers...
KEY_CONCEPTS:
- Concept 1: Description
- Concept 2: Description
CONFIDENCE: 0.8
```

If LLM outputs:
```
Title: Authentication System Overview  // Wrong casing
Introduction: This section covers...
Key Concepts:                          // Wrong casing + spacing
- Concept 1
CONFIDENCE: 0.8
```

Result:
- Title: Falls back to "Category Overview"
- Introduction: Empty (regex didn't match)
- Key Concepts: Empty array
- Confidence: 0.8 (only thing that matched)

**The wiki page is created with placeholder content and no error is logged.**

---

### 2. Malformed Content Parsed Incorrectly

**Example: Code Change Agent**

Expected format for wiki updates:
```
---WIKI_UPDATE---
PATH: architecture/authentication
TYPE: update
CONTENT:
The authentication module...
---END_WIKI_UPDATE---
```

If LLM outputs:
```
---WIKI_UPDATE---
PATH: architecture/authentication
TYPE: update
CONTENT:
The authentication module uses ---END_WIKI_UPDATE--- markers internally...
---END_WIKI_UPDATE---
```

Result: Content is truncated at the embedded marker. The sentence about markers is lost.

---

### 3. Nested Content Breaks Extraction

**Example: Pattern Agent**

```
PATTERN_NAME: Factory Pattern
CODE_SNIPPET:
```typescript
class Factory {
  // Creates instances
}
```
TRADE_OFFS: ...
```

The markdown code fence inside the response can break regex extraction that looks for the next section header.

---

### 4. Whitespace Sensitivity

Many regex patterns are whitespace-sensitive:
```typescript
/CONFIDENCE:\s*([\d.]+)/  // Requires exactly "CONFIDENCE:"
```

These fail on:
- `CONFIDENCE : 0.8` (space before colon)
- `Confidence: 0.8` (wrong case)
- `CONFIDENCE:0.8` (no space after colon)
- `CONFIDENCE:\n0.8` (newline instead of space)

---

## Agents Most Affected

| Agent | Sections Parsed | Silent Defaults | Risk Level |
|-------|-----------------|-----------------|------------|
| WriterAgent | 3 | 2 | HIGH |
| OverviewAgent | 6 | 6 | CRITICAL |
| NarrativeAgent | 5 | 4 | HIGH |
| PatternAgent | 8+ | Unknown | HIGH |
| TechnicalDebtAgent | 10+ | Many | HIGH |
| CodeChangeAgent | Variable | Variable | MEDIUM |

---

## Evidence from Code

### Writer Agent (lines 247-264)
```typescript
// Parse with regex
const titleMatch = response.match(/^TITLE:\s*(.+)$/m);
const contentMatch = response.match(/^CONTENT:\s*([\s\S]+?)(?=^CONFIDENCE:|$)/m);
const confidenceMatch = response.match(/^CONFIDENCE:\s*([\d.]+)/m);

// All silent defaults
const title = titleMatch?.[1]?.trim() || existingPage?.title || 'Untitled';
const content = contentMatch?.[1]?.trim() || '';
const confidence = confidenceMatch ? parseFloat(confidenceMatch[1]) : 0.7;
```

### Overview Agent (lines 246-299)
Six separate regex extractions, each with its own silent fallback.

### Narrative Agent (lines 142-240)
Complex parsing with multiple fallback formats - if primary format fails, tries legacy format. Still silently defaults if both fail.

---

## Impact on Wiki Quality

1. **Inconsistent Confidence Scores**
   Pages defaulting to 0.7 confidence when LLM actually meant 0.4 (but formatted wrong)

2. **Lost Content**
   Entire sections disappear when regex doesn't match

3. **Placeholder Content**
   "Untitled" pages, empty introductions, missing key concepts

4. **No Debugging Trail**
   No logs indicate parsing failed - looks like agent succeeded

5. **Cascading Errors**
   Synthesis agents work from wiki content. Bad parsing → bad input → worse output.

---

## Recommended Fixes

### Immediate
1. **Add parsing failure logging**
   ```typescript
   if (!titleMatch) {
     logger.warn('Failed to parse TITLE from response', {
       agentType,
       responsePreview: response.slice(0, 200)
     });
   }
   ```

2. **Reject malformed responses**
   ```typescript
   if (!titleMatch || !contentMatch) {
     throw new AgentParsingError('Required sections missing');
     // Let executor retry with different temperature
   }
   ```

### Short-term
3. **Switch to structured output**
   ```typescript
   const result = await llm.complete({
     prompt,
     responseFormat: {
       type: 'json_schema',
       schema: WikiUpdateSchema
     }
   });
   ```
   JSON parsing is more robust than regex.

4. **Add response validation layer**
   ```typescript
   const parsed = parseAgentResponse(response);
   const validated = validateAgentOutput(parsed, AgentOutputSchema);
   if (!validated.success) {
     return { error: validated.errors };
   }
   ```

### Medium-term
5. **Implement retry with clarification**
   If parsing fails, retry with:
   ```
   Your response didn't match the expected format.
   Please ensure you include TITLE:, CONTENT:, and CONFIDENCE: sections.
   ```

6. **Use tool-based output**
   Instead of parsing free-form text, have agents call tools:
   ```typescript
   tools: [{
     name: 'create_wiki_update',
     parameters: {
       title: string,
       content: string,
       confidence: number
     }
   }]
   ```

---

## Validation Checklist

After implementing fixes, verify:
- [ ] Parsing failures are logged with context
- [ ] Malformed responses trigger retry, not silent default
- [ ] Structured output format is used where possible
- [ ] Test coverage includes malformed response cases
- [ ] Metrics track parsing failure rate per agent
