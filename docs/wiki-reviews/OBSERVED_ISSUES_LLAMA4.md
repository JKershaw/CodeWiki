# CodeWiki Observed Issues - Llama 4 Maverick Testing

## Executive Summary

After running 150 iterations (50+50+50) of the CodeWiki system against its own repository using `meta-llama/llama-4-maverick`, significant issues were identified across multiple categories. The system generated 43 wiki pages but:

- **53% of pages are about node_modules** (irrelevant content)
- **0% of pages have inter-page links** (isolated islands)
- **System stalled after ~100 iterations** (work queue bug)
- **Only 3.8% of commits were processed**
- **Garbled/corrupted content was accepted**

---

## Critical Issues (P0)

### 1. Work Queue Claiming Bug
**Location**: `src/executor/executor.ts`, `src/agents/orchestrator/`

The system has 61 pending work items but reports "No more work to do". The work claiming mechanism is broken.

**Evidence**:
```
📊 Before processing:
   Pending work: 66

🚀 Running 50 iterations...
No work items claimed, generating more...
No more work to do
```

**Impact**: Wiki generation completely stalls despite available work.

### 2. Zero Inter-Page Links
**Location**: Unknown - link generation mechanism

100% of 43 pages have `links: []` and `backlinks: []`. The wiki is a collection of disconnected islands.

**Evidence**: Every page in wiki-pages.json has empty links arrays.

**Impact**: Wiki is unusable for navigation - no cross-referencing between related concepts.

### 3. Garbled/Corrupted Content Accepted
**Location**: Content validation (missing)

Page `commits/3dd4eb0b` contains 8,411 characters of complete gibberish that was saved to the wiki.

**Evidence**:
```
exampled branch:example:problem-pattern": {
      },
+...
     *environmentCriterion"param**
 linkedin magicensThreshold block=d conting ParameterTypes
```

**Impact**: Nonsense content pollutes wiki with zero value.

### 4. Factually Incorrect Information
**Location**: Getting-started agent, fact verification (missing)

The `guides/getting-started` page states "Node.js version 16 or higher" but package.json requires Node 24.x.

**Evidence**:
- Wiki says: "Node.js version 16 or higher"
- package.json says: `"engines": { "node": "24.x" }`

**Impact**: Users receive incorrect setup instructions.

---

## High Priority Issues (P1)

### 5. node_modules Content Dominates Wiki
**Location**: `src/agents/orchestrator/`, directory coverage filter

23 out of 43 pages (53%) document node_modules packages instead of actual source code.

**Categories affected**:
- utilities: 11 pages (mostly node_modules)
- dependencies: 8 pages (all node_modules)
- eslint: 2 pages (node_modules)
- octokit: 1 page (node_modules)
- libraries: 1 page (node_modules)

**Evidence**: Orchestrator keeps suggesting node_modules paths despite validation rejecting them:
```
Invalid path for codebase-explorer: node_modules/jsdom/lib/jsdom/living
Invalid path for codebase-explorer: node_modules/playwright-core/lib/server
```

**Impact**: More than half the wiki content is useless dependency documentation.

### 6. Analysis Agents Never Execute
**Location**: Agent configuration, orchestrator work generation

Security, narrative, technical-debt, dependency, and pattern agents have pending work but never get claimed.

**Evidence** (pending work counts):
- technical-debt: 10
- security: 10
- narrative: 10
- dependency: 10
- pattern: 9

**Impact**: Wiki lacks security analysis, pattern recognition, and technical debt tracking.

### 7. Link Agent Never Claimed
**Location**: Work claiming logic

A link agent work item was created in the first orchestrator run but has never been claimed despite being in "pending" status.

**Impact**: Explains why no pages have links despite link agent existing.

### 8. Minimal Commit Page Content
**Location**: code-change agent prompts/output handling

Some commit pages have almost no useful content:
- `commits/f3d4611d`: 136 characters
- `commits/5d848bd3`: 213 characters
- `commits/f1588470`: 242 characters

**Impact**: Pages exist but provide no documentation value.

---

## Medium Priority Issues (P2)

### 9. Static Confidence Scores
**Location**: Confidence calculation logic

All 43 pages have exactly `confidence: 0.5` - a default value that never changes.

**Impact**: No way to identify which pages need improvement.

### 10. Writer Agent Zero Cost
**Location**: `src/agents/synthesis/writer-agent.ts`

Writer agent consistently reports $0.0000 cost and 0-1ms duration, suggesting it's not making LLM calls.

**Evidence**:
```
✓ writer completed (0ms, $0.0000)
✓ writer completed (1ms, $0.0000)
```

**Impact**: Writer isn't actually synthesizing content.

### 11. Invalid Agent Types from LLM
**Location**: Orchestrator LLM parsing

The LLM sometimes outputs prose instead of agent types:
```
Invalid agent type: This plan adheres to the budget rules for a 15+ page wiki
Invalid agent type: This distribution follows the budget guidelines for a 15+ page wiki
```

**Impact**: Wasted orchestrator cycles.

### 12. Wrong Project Structure in Documentation
**Location**: Getting-started agent content generation

The getting-started guide shows incorrect project structure.

**Generated**:
```
src/
  commands/
  config/
  services/
  utils/
```

**Actual**:
```
src/
  agents/
  repositories/
  executor/
  domain/
  web/
```

**Impact**: Misleading documentation.

### 13. Broken External Links
**Location**: Content generation

Getting-started contains a non-existent link:
```markdown
[Configuration Wiki Page](https://github.com/wiki/configuration)
```

**Impact**: Broken user experience.

### 14. Relative Links with .md Extensions
**Location**: Overview/architecture pages

Pages contain links like `[CodeWiki - Overview](overview.md)` which use `.md` extensions that won't work in the wiki viewer.

**Impact**: Internal navigation broken.

### 15. 32 Failed Work Items Not Retried
**Location**: Executor error handling

17% of work items (32/179) have failed status with no retry mechanism.

**Impact**: Work is permanently lost on first failure.

### 16. Tool Enforcement Failures
**Location**: code-change agent, LLM tool usage

The code-change agent frequently fails with "made 0 tool call(s), but 1 required".

**Impact**: Commits don't get documented.

---

## Low Priority Issues (P3)

### 17. Low Commit Coverage
Only 12/316 commits (3.8%) were processed in 150 iterations.

### 18. Agents Report No Metrics
Warning: "Agent has tool requirements but didn't report metrics" for multiple agents.

### 19. API Error Handling
503 errors cause immediate failure with limited retry (3 attempts).

### 20. 2 Stuck Claimed Items
2 work items are in "claimed" status but never completed, potentially blocking queue.

### 21. Meta-Content Pages
Page `utilities/asamuzakjp-documentation-challenges` is about how documentation FAILED - not useful content.

---

## Root Cause Analysis

### 1. Missing Input Filtering
node_modules paths should be filtered from the directory tree BEFORE the orchestrator sees them, not after it suggests them.

### 2. Missing Output Validation
Content should be validated for coherence before being saved to wiki.

### 3. Missing Fact Verification
Claims about the codebase should be verified against actual files.

### 4. Work Queue State Machine Issues
The transition between pending → claimed → completed appears broken for certain agent types.

### 5. LLM Output Parsing Robustness
The orchestrator needs better parsing to handle malformed LLM responses.

---

## Recommended Fix Priority

### Phase 1: Critical Fixes
1. Fix work queue claiming bug
2. Fix link agent claiming
3. Add content validation (reject gibberish)
4. Filter node_modules from directory tree

### Phase 2: Quality Improvements
5. Implement fact verification against source files
6. Add minimum content threshold for pages
7. Fix confidence scoring
8. Add retry mechanism for failed work

### Phase 3: Polish
9. Fix relative links format
10. Improve error handling for API failures
11. Debug writer agent zero-cost issue
12. Add monitoring for stuck claimed items

---

## Test Commands Used

```bash
# Run iterations
npx tsx src/cli.ts process . 50

# Check wiki pages
cat .codewiki-data/wiki-pages.json | jq '[.[] | {path, title, linksCount: (.links | length)}]'

# Check work queue status
cat .codewiki-data/work-queue.json | jq 'group_by(.status) | map({status: .[0].status, count: length})'

# Check pending work by agent
cat .codewiki-data/work-queue.json | jq '[.[] | select(.status == "pending") | .agentType] | group_by(.) | map({agent: .[0], count: length})'
```
