# Issue: Response Parsing Failures Creating Malformed Content

**Priority:** P0 - Critical
**Severity:** CRITICAL
**Status:** Open
**Detected:** 2025-12-11 (llama-4-maverick testing)

---

## Summary

Different LLM models output in different formats than expected, causing the response parser to fail and create empty or malformed wiki pages with regex patterns leaking into content.

---

## Symptoms

- Empty sections (SUMMARY, FINDINGS missing)
- Regex patterns leaking into published content
- Default/fallback values used instead of parsed content
- Low confidence scores on pages that should have more content

---

## Examples

**commits/9f3a6737 (Malformed content):**
```markdown
# Setup Openrouter Audit

\s*([\\s\\S]*?)(?=

## Source

- **Commit:** 9f3a6737
```

The `\s*([\\s\\S]*?)(?=` is a regex pattern that leaked through.

**commits/c17900b6 (Empty content):**
```markdown
# Simplify high-complexity agent prompts for better LLM reliability

## Source

- **Commit:** c17900b6
- **Files:** [list]
```

No actual content between title and source.

---

## Log Evidence

```
[code-change] Failed to parse PAGE_TITLE
[code-change] Failed to parse SUMMARY
[codebase-explorer] Failed to parse WIKI_PAGES
[pattern] Parse stats: 1 ok, 7 failed
```

---

## Root Cause

**Location:** `src/agents/parsing/response-parser.ts`

The parser expects specific formats:
```typescript
// Expected: SUMMARY: content here
const primaryPattern = new RegExp(`${sectionName}:\\s*([\\s\\S]*?)(?=\\n(?:${terminators.join('|')})|$)`, 'i');
```

But different models output differently:
- **Claude:** Uses `SUMMARY:` prefix reliably
- **Llama:** Often uses markdown headings `## Summary` instead
- **Qwen:** Mixes formats unpredictably

The parser has limited fallback patterns (lines 181-266) and fails silently, returning empty strings or defaults.

---

## Proposed Fix

1. **Expand fallback pattern library:**
   ```typescript
   const sectionPatterns = [
     // Primary: SECTION_NAME: content
     new RegExp(`${name}:\\s*([\\s\\S]*?)(?=\\n(?:${terms})|$)`, 'i'),
     // Markdown H2: ## Section Name
     new RegExp(`##\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n##|$)`, 'i'),
     // Markdown H3: ### Section Name
     new RegExp(`###\\s*${name}\\s*\\n([\\s\\S]*?)(?=\\n###|$)`, 'i'),
     // XML-style: <section_name>content</section_name>
     new RegExp(`<${name.toLowerCase()}>([\\s\\S]*?)</${name.toLowerCase()}>`, 'i'),
     // Colon after heading: ## Section Name:
     new RegExp(`##\\s*${name}:\\s*\\n([\\s\\S]*?)(?=\\n##|$)`, 'i'),
   ];
   ```

2. **Add model-specific parsing profiles:**
   ```typescript
   const modelProfiles: Record<string, ParsingProfile> = {
     'claude': { preferredFormat: 'label', fallbackOrder: ['markdown', 'xml'] },
     'llama': { preferredFormat: 'markdown', fallbackOrder: ['label', 'xml'] },
     'qwen': { preferredFormat: 'label', fallbackOrder: ['markdown', 'xml'] },
   };
   ```

3. **Validate parsed content before saving:**
   ```typescript
   function validateContent(content: string): ValidationResult {
     const issues = [];
     if (content.match(/\\[sS]\*|\\n|(?=\\n)/)) {
       issues.push('Contains regex patterns');
     }
     if (content.length < 50) {
       issues.push('Content too short');
     }
     return { valid: issues.length === 0, issues };
   }
   ```

4. **Log parsing failures with context:**
   ```typescript
   if (!parsed) {
     logger.warn(`[${agentType}] Failed to parse ${sectionName}`, {
       responsePreview: response.substring(0, 200),
       patternsAttempted: patterns.length,
     });
   }
   ```

---

## Acceptance Criteria

- [ ] Parser handles markdown heading format as primary fallback
- [ ] No regex patterns leak into published content
- [ ] Parse failure rate < 10% across tested models
- [ ] Logging provides actionable debugging info

---

## Related Issues

- LLM reasoning leaking into content (#001)
- Hallucinated pattern pages (#002)
