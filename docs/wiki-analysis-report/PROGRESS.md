# Wiki Analysis Report - Progress Tracker

## Overview

This document tracks the progress of addressing issues identified in the CodeWiki agent analysis report.

**Last Updated:** 2025-12-07

---

## Issue Status Summary

| Issue | Severity | Status | Notes |
|-------|----------|--------|-------|
| 01 - Hallucination Issues | CRITICAL | ✅ **Fixed** | Added verification tools to agents |
| 02 - Parsing Fragility | HIGH | 🔴 Open | Silent regex failures |
| 03 - Context Insufficiency | HIGH | ✅ **Fixed** | All analysis agents now have tool access |
| 04 - Verification Gaps | HIGH | 🔴 Open | No feedback loops |
| 05 - Consolidation Blindspot | MEDIUM-HIGH | ✅ **Fixed** | Added integration tests |
| 06 - Orchestrator Disconnect | MEDIUM | 🔴 Open | No benchmark → orchestrator feedback |
| 07 - Questions for Self-Analysis | N/A | 📋 Reference | Questions to run after 100+ iterations |
| 08 - Prompt-Strategy Misalignment | HIGH | ✅ **Fixed** | Prompt now aligned with "Useful Wiki First" |

---

## Completed Work

### Issue 01: Hallucination in Content Generation ✅

**Fixed:** 2025-12-07
**Commit:** `06ae6da`
**Branch:** `claude/assess-orchestrator-misalignment-01FjqQdvGxJsMXHR72aZsPH5`

**Problem:** PatternAgent, WriterAgent, and OverviewAgent generated content without verifying claims against source code, leading to fabricated code examples, incorrect line numbers, and invented technical details.

**Analysis Findings:**
- The original issue document was partially incorrect - GettingStartedAgent, TestingGuideAgent, and ExtensionGuideAgent already had tool access
- Only 3 agents actually lacked tools: PatternAgent, WriterAgent, OverviewAgent
- Existing tool infrastructure (`codebaseTools`, `createCodebaseToolExecutor`) was fully reusable

**Changes Made:**

1. **PatternAgent** (`src/agents/analysis/pattern-agent.ts`):
   - Added `createCodebaseToolExecutor` import
   - Changed `complete()` → `completeWithTools()` with maxToolRounds: 5
   - Updated system prompt with "CRITICAL: Verify Before Documenting" section
   - Updated user prompt to list available tools and verification requirements
   - Instructions to read full files before citing line numbers

2. **WriterAgent** (`src/agents/synthesis/writer-agent.ts`):
   - Added `createCodebaseToolExecutor` import
   - Changed `complete()` → `completeWithTools()` with maxToolRounds: 3
   - Updated system prompt with verification instructions
   - Instructions to use read_file before adding code examples
   - Guidance: "Never invent code examples or technical details"

3. **OverviewAgent** (`src/agents/synthesis/overview-agent.ts`):
   - Added `createCodebaseToolExecutor` import
   - Updated both `runOnWiki` and `runOnCategory` to use `completeWithTools()`
   - Updated prompts to suggest verification when synthesizing technical claims

**Expected Outcomes:**
- Agents verify claims before documenting them
- Code examples come from actual source files, not hallucination
- Line number references are verified against real files
- Uncertain claims are noted as such rather than stated as fact

**Validation Metrics to Monitor:**
- [ ] Reduction in fabricated code examples (manual audit)
- [ ] Accuracy of line number references (spot check)
- [ ] Tool usage rate in agent runs (should see tool calls in logs)

---

### Issue 08: Orchestrator Prompt-Strategy Misalignment ✅

**Fixed:** 2025-12-07
**Commit:** `429f41e`
**Branch:** `claude/assess-orchestrator-misalignment-01FjqQdvGxJsMXHR72aZsPH5`

**Changes Made:**
1. Rewrote `ORCHESTRATOR_SYSTEM_PROMPT` in `src/agents/orchestrator/prompts.ts`:
   - Added "Useful Wiki First" philosophy upfront
   - Restructured agents into Tier 1/2/3 priority system:
     - Tier 1: Exploration + key synthesis (highest priority)
     - Tier 2: Quality improvement via meta/synthesis agents
     - Tier 3: Commit analysis (lower priority)
   - Added explicit budget rules table:
     - 0-5 pages: ≥50% exploration, ≥30% synthesis, ≤20% commits
     - 5-15 pages: ≥30% exploration, ≥40% synthesis, ≤30% commits
     - 15+ pages: Flexible allocation

2. Fixed `buildUserPrompt`:
   - Removed `targetCommitId` format instruction that biased toward commits
   - Now references budget rules dynamically based on page count

3. Updated `synthesisGuidance` to align with tier structure

**Expected Outcomes:**
- LLM prioritizes exploration when coverage gaps exist
- Fallback mechanism triggers less often
- Fewer commit-style pages created
- Reduced Writer Agent load

**Validation Metrics to Monitor:**
- [ ] Fallback trigger rate (should decrease)
- [ ] `pagesNeedingRewrite` count (should decrease)
- [ ] LLM work item distribution (should follow budget rules)

---

### Issue 03: Insufficient Context for Analysis ✅

**Fixed:** 2025-12-07
**Branch:** `claude/assess-orchestrator-misalignment-01FjqQdvGxJsMXHR72aZsPH5`

**Problem:** Analysis agents (TechnicalDebtAgent, SecurityAgent, NarrativeAgent, DependencyAgent) only received diff context, making it impossible to verify claims, understand full file structure, or find related code.

**Changes Made:**

1. **TechnicalDebtAgent** (`src/agents/analysis/technical-debt-agent.ts`):
   - Added `createCodebaseToolExecutor` import
   - Changed `complete()` → `completeWithTools()` with maxToolRounds: 5
   - Added tool instructions to user prompt (read full file for context, verify TODO relevance, check for systemic debt patterns)
   - Added "CRITICAL: Verify Before Documenting" section to system prompt

2. **SecurityAgent** (`src/agents/analysis/security-agent.ts`):
   - Added `createCodebaseToolExecutor` import
   - Changed `complete()` → `completeWithTools()` with maxToolRounds: 5
   - Added tool instructions to user prompt (trace data flow, verify auth implementations, check security configs)
   - Added verification section to system prompt

3. **NarrativeAgent** (`src/agents/analysis/narrative-agent.ts`):
   - Added `createCodebaseToolExecutor` import
   - Changed `complete()` → `completeWithTools()` with maxToolRounds: 3
   - Added tool instructions to user prompt (read complete documents, find related docs, verify cross-references)
   - Added verification section to system prompt

4. **DependencyAgent** (`src/agents/analysis/dependency-agent.ts`):
   - Added `createCodebaseToolExecutor` import
   - Changed `complete()` → `completeWithTools()` with maxToolRounds: 3
   - Added tool instructions to user prompt (search for imports, read configs, verify dependency usage)
   - Added verification section to system prompt

**Expected Outcomes:**
- Agents can read full files instead of relying only on diffs
- Technical debt analysis can verify complexity metrics and TODO context
- Security analysis can trace data flow and verify auth implementations
- Narrative agent can read complete documents for accurate representation
- Dependency agent can search for actual import usage

**Validation Metrics to Monitor:**
- [ ] Tool usage rate in analysis agent runs
- [ ] Reduction in false positive findings
- [ ] Improved context in generated wiki pages

---

### Issue 05: Consolidation Pipeline Test Coverage ✅

**Fixed:** 2025-12-07
**Branch:** `claude/assess-orchestrator-misalignment-01FjqQdvGxJsMXHR72aZsPH5`

**Problem:** The Consolidation Agent and its handlers (DuplicateHandler, BrokenLinkHandler) had zero integration tests, creating unknown failure modes in the self-healing pipeline.

**Changes Made:**

1. **Created `tests/integration/consolidation-agent.test.ts`**:
   - ConsolidationAgent tests:
     - No findings returns empty result
     - Delegates to correct handler based on finding type
     - Handles unsupported finding types gracefully
     - Throws error when trying to run on commits
     - Agent type and target handling tests
   - Finding lifecycle tests:
     - Marks findings as in_progress then addressed on success
     - TODO: Error recovery path (needs mock enhancement)
   - DuplicateHandler tests:
     - Merges duplicate pages and generates delete update
     - Keeps pages separate when LLM decides not to merge
     - Handles single page case gracefully
   - BrokenLinkHandler tests:
     - Fixes broken link by finding similar valid path
     - Removes link when no similar path exists
   - FindingHandlerRegistry tests:
     - Register and retrieve handlers correctly
     - Returns undefined for unknown finding types
     - Checks if handler exists
     - Lists all supported types

2. **Added consolidation fixtures to `tests/fixtures/agent-responses.ts`**:
   - `duplicateMerge()`: Response for merging duplicate pages
   - `duplicateKeepSeparate()`: Response for keeping pages separate

**Test Coverage Added:**
- ConsolidationAgent: 7 tests
- Finding lifecycle: 1 test + TODO
- DuplicateHandler: 3 tests
- BrokenLinkHandler: 2 tests
- FindingHandlerRegistry: 4 tests

**Total new tests: 17**

**Expected Outcomes:**
- Unknown failure modes in consolidation pipeline now have test coverage
- Duplicate handling logic (highest risk due to content loss potential) is verified
- Handler registry pattern works correctly
- Edge cases (single page, no similar path) are handled

**Remaining Work:**
- [ ] Add error simulation to MockLLMService to test finding rollback on failure
- [ ] Add more edge case tests for complex merge scenarios

---

## Remaining Issues (Priority Order)

### 🔴 HIGH: Issue 02 - Fragile Response Parsing

**Impact:** Silent content loss, placeholder defaults
**Affected Agents:** All agents
**Root Cause:** Regex parsing with silent fallbacks

**Recommended Next Steps:**
1. Add parsing failure logging with context
2. Reject malformed responses instead of defaulting
3. Switch to structured output (JSON schema) where possible

---

### 🔴 HIGH: Issue 04 - Missing Verification Loops

**Impact:** Errors persist, no self-correction
**Root Cause:** No verification step before publishing; benchmark data isolated

**Recommended Next Steps:**
1. Add link validation to Link Agent
2. Add code example validation
3. Expose benchmark data to orchestrator (read-only)

---

### 🟡 MEDIUM: Issue 06 - Orchestrator Cannot Learn from Results

**Impact:** Repeated mistakes, ignored improvement opportunities
**Root Cause:** Orchestrator has no access to benchmark results

**Recommended Next Steps:**
1. Add read-only benchmark visibility to orchestrator
2. Log orchestrator decisions with benchmark context
3. Implement soft prioritization hints based on scores

---

## Recommended Priority Order

Based on impact and dependencies:

1. **Issue 02 (Parsing)** - Affects all agents, relatively easy fix
2. **Issue 04 (Verification)** - Enables closed-loop improvement
3. **Issue 06 (Orchestrator Learning)** - Optimization after foundation is solid

**Completed:**
- ✅ Issue 01 (Hallucination) - Added verification tools to PatternAgent, WriterAgent, OverviewAgent
- ✅ Issue 03 (Context) - Added verification tools to TechnicalDebtAgent, SecurityAgent, NarrativeAgent, DependencyAgent
- ✅ Issue 05 (Consolidation) - Added integration tests for ConsolidationAgent and handlers
- ✅ Issue 08 (Prompt-Strategy Misalignment) - Aligned orchestrator prompt with "Useful Wiki First"

---

## Validation Plan

After 100+ iterations, run the self-analysis questions from `07-questions-for-self-analysis.md` to gather empirical data on:

- Which specific content is inaccurate
- Which agents contribute to poor pages
- Where the orchestrator makes suboptimal decisions
- What patterns predict low-quality output

This will help validate fixes and prioritize remaining work.
