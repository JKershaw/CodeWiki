# Issue 5: Untested Consolidation Pipeline

## Severity: MEDIUM-HIGH

## Summary

The Consolidation Agent and its handlers are the wiki's self-healing mechanism. They're supposed to fix duplicates, contradictions, broken links, and other issues found by meta agents. But this entire system has **zero integration tests**, meaning we don't know if it actually works.

---

## The Consolidation System

### Architecture

```
Meta Agents (find issues)
    ↓
Quality Agent → Findings: clarity issues, empty sections
Consistency Agent → Findings: contradictions, duplicates
Structure Agent → Findings: page length, organization
Link Agent → Findings: broken links, missing references
    ↓
Finding Repository (stores issues)
    ↓
Consolidation Agent (processes findings)
    ↓
Finding Handler Registry
    ├── DuplicateHandler → merge duplicate pages
    ├── ContradictionHandler → resolve conflicts
    ├── BrokenLinkHandler → fix/remove bad links
    ├── OrphanedPageHandler → handle unreferenced pages
    ├── TerminologyHandler → standardize terms
    └── CategoryMismatchHandler → fix categorization
    ↓
Wiki Updates
```

### The Problem

None of this has integration tests. The only tests are unit tests for the Finding domain object itself.

---

## What's Untested

### 1. Consolidation Agent
**Location:** `src/agents/consolidation/consolidation-agent.ts`

**Untested behaviors:**
- Does it correctly retrieve findings from repository?
- Does it delegate to the right handler?
- What happens if a handler fails?
- Does it correctly update finding status?
- Does it roll back on partial failure?

### 2. DuplicateHandler
**Location:** `src/agents/consolidation/handlers/`

**Untested behaviors:**
- Does it correctly identify the "canonical" page?
- Does it merge content appropriately?
- Does it update all references to the deleted page?
- Does it preserve important content from both pages?

### 3. ContradictionHandler

**Untested behaviors:**
- How does it decide which version is correct?
- Does it consult source code to resolve?
- Does it preserve both viewpoints if unclear?
- What if both statements are partially correct?

### 4. BrokenLinkHandler

**Untested behaviors:**
- Does it find the correct replacement link?
- Does it remove links with no replacement?
- Does it update the page content correctly?
- What about links in markdown tables or code blocks?

### 5. Finding Lifecycle

**Untested behaviors:**
- Finding: open → in_progress (when consolidation starts)
- Finding: in_progress → addressed (when fixed)
- Finding: in_progress → open (on failure, rollback)
- Finding: in_progress → ignored (if unfixable)

---

## Evidence

### Test Coverage Report

```bash
# Integration tests for consolidation
find tests/integration -name "*consolidation*"
# Result: Nothing found

# Unit tests for consolidation
find tests/unit -name "*consolidation*"
# Result: Nothing found

# Any test mentioning consolidation
grep -r "consolidation" tests/
# Result: Only mock type definitions
```

### Agent Test Summary

| Agent | Integration Tests |
|-------|-------------------|
| TechnicalDebtAgent | 552 lines |
| WikiEditorAgent | 489 lines |
| PatternAgent | 407 lines |
| ConsistencyAgent | 384 lines |
| NarrativeAgent | 378 lines |
| SecurityAgent | 337 lines |
| DependencyAgent | 330 lines |
| ... | ... |
| **ConsolidationAgent** | **0 lines** |
| **All Handlers** | **0 lines** |

---

## Risk Analysis

### What Could Go Wrong

1. **Silent Failure**
   Consolidation Agent runs, marks findings as "addressed", but wiki unchanged.

2. **Content Loss**
   DuplicateHandler merges pages but loses important content from one.

3. **Incorrect Resolution**
   ContradictionHandler picks wrong version, propagates error.

4. **Broken References**
   Page deleted but references not updated, creating more broken links.

5. **Infinite Loop**
   Handler creates new finding while processing old one, never terminates.

6. **State Corruption**
   Partial failure leaves finding in_progress forever, blocking future processing.

---

## The Missing Tests

### What Should Exist

```typescript
describe('ConsolidationAgent Integration', () => {
  it('should merge duplicate pages and update references', async () => {
    // Setup: Create two near-duplicate pages
    // Create a finding marking them as duplicates
    // Run consolidation agent
    // Assert: One page remains, other is gone
    // Assert: All references updated
    // Assert: Finding marked as addressed
  });

  it('should resolve contradictions by consulting source', async () => {
    // Setup: Two pages with contradictory claims
    // Source code supports one claim
    // Run consolidation agent
    // Assert: Correct claim preserved
    // Assert: Finding addressed
  });

  it('should rollback on handler failure', async () => {
    // Setup: Finding that will cause handler to fail
    // Run consolidation agent
    // Assert: Finding status back to 'open'
    // Assert: Wiki unchanged
  });

  it('should handle circular references', async () => {
    // Setup: Page A links to B, B links to A
    // Both marked as potentially orphaned
    // Run consolidation
    // Assert: Neither incorrectly deleted
  });
});

describe('DuplicateHandler', () => {
  it('should preserve content from both pages', async () => {
    // Page A: Covers topics 1, 2
    // Page B: Covers topics 2, 3
    // After merge: Covers topics 1, 2, 3
  });

  it('should choose better title', async () => {
    // Page A: "auth stuff"
    // Page B: "Authentication System Architecture"
    // After merge: Uses Page B title
  });
});
```

---

## Recommended Fixes

### Immediate
1. **Add basic consolidation agent tests**
   - Test finding retrieval
   - Test handler delegation
   - Test status updates

2. **Add duplicate handler tests**
   - Most common finding type
   - Highest risk of content loss

### Short-term
3. **Add handler tests for each type**
   - Contradiction, BrokenLink, Orphaned, Terminology, Category

4. **Add failure scenario tests**
   - Handler throws error
   - Database update fails
   - Partial completion

### Medium-term
5. **End-to-end consolidation tests**
   - Full cycle: meta agent finds issue → consolidation fixes → verify wiki state

6. **Property-based tests**
   - Generate random duplicate scenarios
   - Verify invariants (no content loss, no orphaned pages)

---

## Temporary Mitigation

Until tests exist, consider:

1. **Manual verification of consolidation runs**
   Log all consolidation actions for human review.

2. **Dry-run mode**
   Add flag to consolidation agent that shows what it would do without doing it.

3. **Backup before consolidation**
   Take wiki snapshot before each consolidation run.

4. **Disable automatic consolidation**
   Only run consolidation manually until confident in behavior.

---

## Metrics to Track

After implementing tests:
- Consolidation agent test coverage %
- Handler test coverage %
- Finding resolution success rate
- Content preservation verification
- Edge case coverage count
