# Issue: Hallucinated/Fabricated Pattern Pages

**Priority:** P1 - High
**Severity:** HIGH
**Status:** Open
**Detected:** 2025-12-11 (llama-4-maverick testing)

---

## Summary

The pattern agent creates wiki pages describing "patterns" that don't actually exist in the codebase, with fabricated code references and high confidence scores.

---

## Affected Pages

- `patterns/add` - References non-existent `global._register()`
- `patterns/avoid` - Describes a "PAGRAM mixture" (not in codebase)
- `patterns/sum` - Generic description of summing numbers (not a real pattern)
- `patterns/single-type-other-version-1` - Vague versioning pattern with no code evidence

---

## Examples

**patterns/add:**
```markdown
# The _add Pattern

The _add pattern involves using a global registration function, `global._register()`, to manage certain components or modules within the system.
```

This `global._register()` function does not exist anywhere in the codebase.

**patterns/avoid:**
```markdown
# Avoid Pattern

The Avoid Pattern is categorized under design patterns and is related to other patterns such as the Add Pattern. The pattern is used to address issues related to mixture patterns.
```

"PAGRAM mixture" and "mixture patterns" are not concepts in this codebase.

---

## Root Cause

The pattern agent:
1. Attempts to identify patterns from code analysis
2. Does not verify that referenced code actually exists
3. Assigns high confidence (0.9) regardless of verification
4. Creates pages even when LLM hallucinates content

**Location:** `src/agents/analysis/pattern-agent.ts`

---

## Proposed Fix

1. **Require verified file paths before creating pattern pages:**
   ```typescript
   async function verifyPatternEvidence(pattern: DetectedPattern, repoAccess: RepoAccess): Promise<boolean> {
     for (const filePath of pattern.affectedFiles) {
       const exists = await repoAccess.fileExists(filePath);
       if (!exists) return false;
     }
     return pattern.affectedFiles.length > 0;
   }
   ```

2. **Add code existence verification:**
   - Check that referenced functions/classes exist
   - Verify line number references are valid
   - Require at least one concrete code example

3. **Lower confidence for unverified patterns:**
   ```typescript
   const confidence = verified ? 0.8 : 0.3;
   if (!verified) {
     // Don't create page, just log finding
     return { findings: [suspectedPattern], updates: [] };
   }
   ```

4. **Add minimum evidence threshold:**
   - Require at least 2 files demonstrating the pattern
   - Require specific code snippets, not generic descriptions

---

## Acceptance Criteria

- [ ] Pattern pages only created when code evidence is verified
- [ ] Confidence scores reflect verification status
- [ ] Existing hallucinated pages are flagged or removed
- [ ] Pattern agent logs when it skips unverified patterns

---

## Related Issues

- LLM reasoning leaking into content (#001)
- Response parsing failures (#003)
