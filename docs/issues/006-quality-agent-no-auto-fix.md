# Issue: Quality Agent Detects Issues But Never Fixes Them

**Priority:** P1 - High
**Severity:** HIGH
**Status:** Open
**Detected:** 2025-12-09 (qwen testing), confirmed 2025-12-11 (llama testing)

---

## Summary

The quality agent can detect issues like low confidence, empty sections, and missing citations, but it returns empty updates, creating no self-improvement loop.

---

## Root Cause

**Location:** `src/agents/meta/quality-agent.ts:320-327`

```typescript
private generateUpdates(
  _pages: WikiPage[],
  _analysis: QualityAnalysis
): WikiPageUpdate[] {
  // Quality agent reports issues but doesn't auto-fix
  // Future: could generate merge updates with improved content
  return [];  // <-- ALWAYS EMPTY
}
```

The function is explicitly designed to return nothing.

---

## Impact

Pages with quality issues are identified but never improved:

| Issue Type | Detection | Fix |
|------------|-----------|-----|
| Low confidence pages | Yes (lines 195-202) | No |
| Empty sections | Yes (lines 165-171) | No |
| Missing source citations | Yes (lines 184-192) | No |
| Shallow content (<100 chars) | Yes (lines 175-182) | No |
| Inconsistent formatting | Yes | No |

All issues are reported in findings but **nothing addresses them**.

---

## Proposed Fix

1. **Generate improvement updates for low-quality pages:**
   ```typescript
   private generateUpdates(
     pages: WikiPage[],
     analysis: QualityAnalysis
   ): WikiPageUpdate[] {
     const updates: WikiPageUpdate[] = [];

     for (const issue of analysis.issues) {
       if (issue.severity === 'high' && issue.autoFixable) {
         const update = await this.generateFix(issue, pages);
         if (update) updates.push(update);
       }
     }

     return updates;
   }
   ```

2. **Implement specific fix generators:**
   ```typescript
   private async generateFix(issue: QualityIssue, pages: WikiPage[]): Promise<WikiPageUpdate | null> {
     switch (issue.type) {
       case 'empty_section':
         return this.fillEmptySection(issue, pages);
       case 'missing_citations':
         return this.addCitations(issue, pages);
       case 'shallow_content':
         return this.expandContent(issue, pages);
       default:
         return null;
     }
   }
   ```

3. **Add confidence-boosting updates:**
   ```typescript
   // For pages with low confidence but verifiable content
   if (page.confidence < 0.7 && await this.verifyContent(page)) {
     updates.push({
       type: 'update',
       path: page.path,
       confidenceDelta: 0.2,
       reason: 'Content verified against source',
     });
   }
   ```

4. **Integrate with consolidation agent:**
   ```typescript
   // Quality findings should be processed by consolidation handlers
   const qualityFindings = analysis.issues.map(i => ({
     type: 'quality_issue' as FindingType,
     description: i.description,
     affectedPaths: [i.pagePath],
     severity: i.severity,
   }));
   ```

---

## Acceptance Criteria

- [ ] Quality agent generates updates for fixable issues
- [ ] Low confidence pages can be improved
- [ ] Empty sections trigger content generation
- [ ] Quality findings integrate with consolidation agent

---

## Related Issues

- Overview agent never updates (#005)
- Orphaned pages / weak linking (#004)
- Link agent skips existing pages (#007)
