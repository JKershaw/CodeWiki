# Issue 4: Missing Verification and Feedback Loops

## Severity: HIGH

## Summary

The system generates wiki content but lacks mechanisms to verify that content is accurate. There's no feedback loop from benchmark results back to agent behavior, and no verification step before content enters the wiki.

---

## The Verification Gap

### Current Flow (No Verification)

```
Commit → Analysis Agent → Wiki Update → Published
                ↓
           (No check that content is accurate)
```

### What Should Happen

```
Commit → Analysis Agent → Wiki Update → Verification → Published
                                              ↓
                                        (Check against source)
                                              ↓
                                        If wrong → Reject/Flag
```

---

## Missing Verification Points

### 1. Code Examples Not Verified

**Agents affected:** Writer, Pattern, CodeChange, Technical-Debt

**The problem:**
Agents generate code snippets and examples. Nothing verifies these snippets:
- Actually exist in the codebase
- Compile/parse correctly
- Are current (not from old version)

**Example failure:**
```markdown
## Usage Example

```typescript
import { authenticate } from '@/services/auth';

const user = await authenticate(credentials);
```
```

This example might be:
- From an old API (authenticate now takes different params)
- From a hallucinated import path
- Syntactically invalid TypeScript

---

### 2. Links Not Validated

**Agents affected:** Link, Overview, CodeChange

**The problem:**
Agents create internal wiki links. Nothing verifies target pages exist.

**Current behavior:**
```typescript
// link-agent.ts
// Creates links based on semantic similarity
// Never checks if target page actually exists
const suggestedLinks = await this.findSemanticRelations(page, allPages);
```

**Result:** Broken links enter the wiki. Users click and get 404s.

---

### 3. Claims Not Cross-Referenced

**Agents affected:** All analysis agents

**The problem:**
Agents make claims about the codebase:
- "The system uses JWT authentication"
- "Error handling follows the Result pattern"
- "All API endpoints are rate-limited"

Nothing verifies these claims match reality.

---

### 4. No Benchmark → Agent Feedback

**The system has:**
- Accuracy benchmarks (grade wiki answers)
- Quality benchmarks (score 8 dimensions)
- Self-improvement agent (analyzes trends)

**But:**
- Orchestrator cannot see benchmark results at runtime
- Agents don't know which of their outputs scored poorly
- No automatic adjustment based on feedback

**Current architecture:**
```
Wiki Generation ───────────────────────> Benchmarks
     ↑                                       ↓
     │                                  Self-Improvement
     │                                       ↓
     └──────── Manual Developer Fixes ←── Report
```

The feedback loop requires human intervention. There's no closed loop.

---

## Evidence from Codebase

### No Verification Layer
```bash
# Search for verification logic
grep -r "verify" src/agents/ --include="*.ts"
# Results: Only WikiEditorAgent verifies edit requests are valid
# No content verification
```

### Link Agent Creates Unverified Links
```typescript
// src/agents/meta/link-agent.ts
// Finds related pages and suggests links
// Never validates target pages exist
const links = await this.identifyLinks(pageContent, otherPages);
return { suggestedLinks: links }; // No validation
```

### Orchestrator Has No Benchmark Access
```typescript
// src/agents/orchestrator/orchestrator.ts
// Receives: coverage stats, work queue status, findings
// Does NOT receive: benchmark results, quality scores
```

---

## Impact on Wiki Quality

### 1. Error Accumulation
Without verification, errors enter the wiki and persist:
- Wrong code examples stay wrong
- Broken links stay broken
- Inaccurate claims stay inaccurate

### 2. Compounding Errors
Synthesis agents read wiki content. Errors in analysis agent output become input for synthesis agents, which may amplify them.

### 3. Trust Degradation
Users encounter errors, lose trust in wiki, stop using it.

### 4. Wasted Improvement Cycles
Self-improvement agent identifies issues, but fixes require manual intervention. Issues may persist for many iterations.

---

## The Benchmark Disconnect

### What Benchmarks Measure

**Accuracy Benchmark:**
- Asks questions about the codebase
- Grades wiki's answers against actual code
- Produces: `accurate`, `partial`, `inaccurate`, `no_answer`

**Quality Benchmark:**
- Evaluates 8 dimensions per page
- Identifies strengths and weaknesses
- Scores 0-100 per dimension

### What Could Use This Data

1. **Orchestrator could prioritize:**
   - Pages with low accuracy → schedule for re-analysis
   - Questions with `no_answer` → schedule exploration of that area
   - Low quality dimensions → schedule Writer Agent on those pages

2. **Agents could learn:**
   - Pattern Agent output for topic X always scores low → adjust prompts
   - Security Agent misses category Y → add to checklist

3. **Consolidation could target:**
   - Pages identified as inaccurate → priority for review
   - Duplicate detection informed by benchmark confusion

---

## Recommended Fixes

### Immediate
1. **Add link validation to Link Agent**
   ```typescript
   async createLinks(links: string[]) {
     const validLinks = links.filter(link =>
       this.wikiPages.some(page => page.path === link)
     );
     const invalidLinks = links.filter(link =>
       !this.wikiPages.some(page => page.path === link)
     );
     if (invalidLinks.length > 0) {
       this.logger.warn('Invalid links rejected', { invalidLinks });
     }
     return validLinks;
   }
   ```

2. **Add code example validation**
   For agents that produce code snippets, add a tool that checks:
   - File exists at referenced path
   - Code snippet exists in file (fuzzy match)

### Short-term
3. **Create verification agent**
   New meta agent that:
   - Reads pages with code examples
   - Verifies examples against source
   - Creates findings for mismatches

4. **Expose benchmark data to orchestrator**
   Add read-only access so orchestrator can:
   - See which pages scored poorly
   - Prioritize work on low-accuracy areas
   - Track improvement over time

### Medium-term
5. **Closed feedback loop**
   ```
   Benchmark Results
        ↓
   Orchestrator sees results
        ↓
   Prioritizes re-work on low-scoring pages
        ↓
   Agents re-analyze
        ↓
   Next benchmark measures improvement
   ```

6. **Agent prompt adaptation**
   For agents with consistently low-scoring output:
   - Log which outputs scored poorly
   - Analyze common failure modes
   - Suggest prompt improvements

---

## Verification Checklist

After implementing fixes, verify:
- [ ] Link Agent only creates links to existing pages
- [ ] Code examples are validated before publishing
- [ ] Orchestrator has access to benchmark results
- [ ] Low-accuracy pages are prioritized for re-work
- [ ] Metrics track verification pass/fail rates
