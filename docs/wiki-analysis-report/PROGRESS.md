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
| 03 - Context Insufficiency | HIGH | 🟡 Partial | PatternAgent now has tools; others pending |
| 04 - Verification Gaps | HIGH | 🔴 Open | No feedback loops |
| 05 - Consolidation Blindspot | MEDIUM-HIGH | 🔴 Open | Zero integration tests |
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

### 🔴 HIGH: Issue 03 - Insufficient Context for Analysis

**Impact:** False positives/negatives, decontextualized analysis
**Affected Agents:** Technical-Debt, Pattern, Narrative, Security
**Root Cause:** Agents receive only diffs, not full file context

**Recommended Next Steps:**
1. Add tool access to analysis agents (like CodeChangeAgent has)
2. Pre-fetch full file contents before analysis
3. Add cross-reference context (imports, tests)

---

### 🔴 HIGH: Issue 04 - Missing Verification Loops

**Impact:** Errors persist, no self-correction
**Root Cause:** No verification step before publishing; benchmark data isolated

**Recommended Next Steps:**
1. Add link validation to Link Agent
2. Add code example validation
3. Expose benchmark data to orchestrator (read-only)

---

### 🟡 MEDIUM-HIGH: Issue 05 - Untested Consolidation Pipeline

**Impact:** Unknown failure modes in self-healing
**Root Cause:** Zero integration tests for Consolidation Agent and handlers

**Recommended Next Steps:**
1. Add basic consolidation agent tests
2. Add duplicate handler tests (highest risk)
3. Add failure scenario tests

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
2. **Issue 03 (Context)** - Partially addressed; remaining analysis agents need tools
3. **Issue 04 (Verification)** - Enables closed-loop improvement
4. **Issue 05 (Consolidation)** - Ensures self-healing works
5. **Issue 06 (Orchestrator Learning)** - Optimization after foundation is solid

**Completed:**
- ✅ Issue 01 (Hallucination) - Added verification tools to PatternAgent, WriterAgent, OverviewAgent
- ✅ Issue 08 (Prompt-Strategy Misalignment) - Aligned orchestrator prompt with "Useful Wiki First"

---

## Validation Plan

After 100+ iterations, run the self-analysis questions from `07-questions-for-self-analysis.md` to gather empirical data on:

- Which specific content is inaccurate
- Which agents contribute to poor pages
- Where the orchestrator makes suboptimal decisions
- What patterns predict low-quality output

This will help validate fixes and prioritize remaining work.
