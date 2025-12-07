# CodeWiki Analysis Report: Why the Wiki Doesn't Quite Work

## Executive Summary

After analyzing the CodeWiki agent architecture, implementation details, and test coverage, I've identified **systemic issues** that explain why the generated wiki content doesn't achieve the quality it should. The problems fall into several categories:

### The Core Problem

**The wiki grows through a sophisticated multi-agent pipeline, but the agents lack the verification mechanisms needed to produce accurate, trustworthy content.**

The architecture is well-designed with clear separation of concerns:
- Analysis agents process commits and produce wiki updates
- Meta agents review quality and find issues
- Consolidation agents fix detected problems
- Synthesis agents create higher-order documentation

However, the implementation has critical gaps:

1. **Hallucination without verification** - Agents generate factual claims about code without tools to verify those claims
2. **Fragile response parsing** - LLM outputs are parsed with regex that fails silently
3. **Untested consolidation** - The self-healing pipeline has zero integration tests
4. **Disconnected feedback** - Benchmark results don't flow back to improve agent behavior

---

## Issue Categories

| Category | Severity | Affected Agents | Impact |
|----------|----------|-----------------|--------|
| Hallucination | **CRITICAL** | Writer, Overview, Pattern, Technical-Debt | Fabricated code examples, invented claims |
| Prompt-Strategy Misalignment | **HIGH** | Orchestrator, All agents | Wiki built from commits instead of current code |
| Response Parsing | **HIGH** | All agents | Lost content, silent failures |
| Missing Context | **HIGH** | Technical-Debt, Pattern, Narrative | Insufficient info for accurate analysis |
| No Verification Loop | **HIGH** | All synthesis agents | Can't confirm facts match source |
| Untested Consolidation | **MEDIUM** | Consolidation, Handlers | Unknown failure modes |
| Bootstrap Quality | **MEDIUM** | Bootstrap | Poor foundation for wiki growth |

---

## The 8 Most Impactful Issues

### 1. Orchestrator Prompt-Strategy Misalignment (HIGH)
The deterministic strategies implement "Useful Wiki First" - prioritizing codebase exploration to document **current state** before analyzing commits. But the **LLM prompt is still commit-centric**. It lists 6 commit-based analysis agents prominently and only 1 exploration agent. The LLM naturally gravitates toward commit work, requiring a fallback mechanism to force exploration. The result: wikis grow from commit history ("this commit added...") instead of current-state documentation ("this component does...").

### 2. Writer Agent Rewrites Without Verification (CRITICAL)
The Writer Agent transforms "commit-style" content to "encyclopedia-style" but has **no tools** to verify facts. It's explicitly instructed to "add context and explanation" but must invent that context from memory, leading to plausible-sounding but potentially false claims.

### 3. Synthesis Agents Create Content Without Source Access (CRITICAL)
Getting Started, Testing Guide, Extension Guide, and Overview agents generate documentation without tools to read the actual codebase. They work from wiki summaries only, compounding any errors in those summaries.

### 4. Pattern Agent Fabricates Line Numbers (CRITICAL)
The Pattern Agent is asked to provide code snippets "with exact line ranges" but has no tool to verify those line numbers are correct. The LLM generates plausible but often wrong line references.

### 5. Response Parsing Fails Silently (HIGH)
All agents use regex-based parsing that:
- Defaults missing sections to placeholder values (confidence → 0.7)
- Loses content if LLM output format deviates slightly
- Has no error reporting for malformed responses

### 6. Meta Agents Find Issues but Consolidation is Untested (HIGH)
Quality, Consistency, Link, and Structure agents detect problems and create Findings. The Consolidation Agent should fix these, but it has **zero integration tests**. We don't know if it actually works.

### 7. Bootstrap Sets Poor Foundation (MEDIUM)
Initial wiki pages are created with 0.5-0.6 confidence from README/package.json only. These low-quality pages become the foundation that other agents build upon, propagating inaccuracies.

### 8. Orchestrator Can't Learn from Results (MEDIUM)
The orchestrator decides what work to prioritize but has **no access** to benchmark results at runtime. It might keep scheduling work that doesn't improve quality while ignoring work that would.

---

## Agent Health Summary

| Agent | Tests | Hallucination Risk | Parsing Risk | Overall |
|-------|-------|-------------------|--------------|---------|
| CodeChangeAgent | Minimal | Medium | Medium | ⚠️ |
| NarrativeAgent | Good | High | High | ⚠️ |
| SecurityAgent | Good | Medium | Medium | ✓ |
| TechnicalDebtAgent | Excellent | High | Medium | ⚠️ |
| PatternAgent | Good | **Critical** | Medium | ❌ |
| DependencyAgent | Good | Low | Low | ✓ |
| CodebaseExplorerAgent | None | Medium | Medium | ⚠️ |
| WikiEditorAgent | Excellent | Low | Low | ✓ |
| ConsistencyAgent | Good | Medium | High | ⚠️ |
| StructureAgent | Good | Low | Low | ✓ |
| QualityAgent | Unit only | Medium | Medium | ⚠️ |
| LinkAgent | None | Medium | Unknown | ❌ |
| ConsolidationAgent | **None** | Medium | Medium | ❌ |
| WriterAgent | **None** | **Critical** | High | ❌ |
| OverviewAgent | Good | High | High | ⚠️ |
| BootstrapAgent | Good | Medium | Medium | ⚠️ |
| ProjectOverviewAgent | **None** | High | Medium | ❌ |
| GettingStartedAgent | Good | High | Medium | ⚠️ |
| TestingGuideAgent | **None** | High | Medium | ❌ |
| ExtensionGuideAgent | **None** | High | Medium | ❌ |

**Legend:** ✓ = Healthy, ⚠️ = Issues, ❌ = Critical Problems

---

## Detailed Analysis Documents

1. **[01-hallucination-issues.md](./01-hallucination-issues.md)** - Deep dive into agents that fabricate content
2. **[02-parsing-fragility.md](./02-parsing-fragility.md)** - Response parsing failure modes
3. **[03-context-insufficiency.md](./03-context-insufficiency.md)** - Agents lacking needed information
4. **[04-verification-gaps.md](./04-verification-gaps.md)** - Missing feedback and verification loops
5. **[05-consolidation-blindspot.md](./05-consolidation-blindspot.md)** - Untested self-healing pipeline
6. **[06-orchestrator-disconnect.md](./06-orchestrator-disconnect.md)** - Planning without results feedback
7. **[07-questions-for-self-analysis.md](./07-questions-for-self-analysis.md)** - Questions to ask the production system
8. **[08-orchestrator-prompt-strategy-misalignment.md](./08-orchestrator-prompt-strategy-misalignment.md)** - Commit-centric prompt vs current-state-first strategy

---

## Recommendations Priority

### Immediate (Block wiki quality issues)
1. **Fix orchestrator prompt to prioritize exploration** - Update LLM system prompt to match "Useful Wiki First" strategy
2. Add tool access to Writer Agent for fact verification
3. Add schema validation for all LLM responses (reject malformed)
4. Write integration tests for Consolidation Agent

### Short-term (Improve accuracy)
5. Give synthesis agents read-only codebase access
6. Add content verification step after Pattern Agent runs
7. Implement structured output (JSON) instead of regex parsing
8. Remove the exploration fallback mechanism (prompt should work correctly)

### Medium-term (Systemic improvement)
9. Create benchmark → orchestrator feedback loop
10. Add provenance-based confidence scoring
11. Implement "draft → verify → publish" workflow for synthesis content
12. Separate orchestrator into "exploration mode" and "enrichment mode"

---

## Next Steps

Run the self-analysis agent with the questions in [07-questions-for-self-analysis.md](./07-questions-for-self-analysis.md) after 100+ iterations to get empirical data on:
- Which specific content is inaccurate
- Which agents contribute to poor pages
- Where the orchestrator makes suboptimal decisions
- What patterns predict low-quality output

This will help prioritize fixes based on real-world impact rather than theoretical analysis.
