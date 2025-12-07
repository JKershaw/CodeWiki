# Wiki Analysis Report - Progress Tracker

## Overview

This document tracks the progress of addressing issues identified in the CodeWiki agent analysis report.

**Last Updated:** 2025-12-07

---

## Issue Status Summary

| Issue | Severity | Status | Notes |
|-------|----------|--------|-------|
| 01 - Hallucination Issues | CRITICAL | 🔴 Open | Writer, Pattern agents lack verification |
| 02 - Parsing Fragility | HIGH | 🔴 Open | Silent regex failures |
| 03 - Context Insufficiency | HIGH | 🔴 Open | Agents work from diffs only |
| 04 - Verification Gaps | HIGH | 🔴 Open | No feedback loops |
| 05 - Consolidation Blindspot | MEDIUM-HIGH | 🔴 Open | Zero integration tests |
| 06 - Orchestrator Disconnect | MEDIUM | 🔴 Open | No benchmark → orchestrator feedback |
| 07 - Questions for Self-Analysis | N/A | 📋 Reference | Questions to run after 100+ iterations |
| 08 - Prompt-Strategy Misalignment | HIGH | ✅ **Fixed** | Prompt now aligned with "Useful Wiki First" |

---

## Completed Work

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

### 🔴 CRITICAL: Issue 01 - Hallucination in Content Generation

**Impact:** Fabricated code examples, incorrect claims enter wiki
**Affected Agents:** Writer, Pattern, Technical-Debt, Overview, Getting-Started
**Root Cause:** Synthesis agents have no tool access to verify facts

**Recommended Next Steps:**
1. Add read-only tools to Writer Agent (readFile, searchFiles, listDirectory)
2. Remove line number requirements from Pattern Agent OR add verification
3. Implement verification pass after synthesis agents run

---

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

1. **Issue 01 (Hallucination)** - Most impactful on content quality
2. **Issue 02 (Parsing)** - Affects all agents, relatively easy fix
3. **Issue 03 (Context)** - Improves accuracy of analysis agents
4. **Issue 04 (Verification)** - Enables closed-loop improvement
5. **Issue 05 (Consolidation)** - Ensures self-healing works
6. **Issue 06 (Orchestrator Learning)** - Optimization after foundation is solid

---

## Validation Plan

After 100+ iterations, run the self-analysis questions from `07-questions-for-self-analysis.md` to gather empirical data on:

- Which specific content is inaccurate
- Which agents contribute to poor pages
- Where the orchestrator makes suboptimal decisions
- What patterns predict low-quality output

This will help validate fixes and prioritize remaining work.
