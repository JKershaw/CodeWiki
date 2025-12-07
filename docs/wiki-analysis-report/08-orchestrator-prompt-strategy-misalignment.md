# Issue 7: Orchestrator Prompt-Strategy Misalignment

## Severity: HIGH

## Summary

The orchestrator has a fundamental tension between two competing philosophies:

1. **The deterministic strategies** implement "Useful Wiki First" - prioritizing codebase exploration to document the **current state** before analyzing commits
2. **The LLM prompt** is still heavily oriented toward **commit analysis** - the original design

This mismatch causes the LLM orchestrator to schedule commit analysis work when exploration would be more valuable, requiring a fallback mechanism to patch over the problem.

---

## The Two Philosophies

### Philosophy 1: Commit-Centric (Original)
> "Analyze commits to understand what changed and why"

- Wiki grows from commit history
- Pages describe changes: "This commit added..."
- Historical evolution is the primary organizing principle
- Good for understanding **how code evolved**

### Philosophy 2: Current-State-Centric (New)
> "Document the current codebase first, add historical context later"

- Wiki describes what exists now
- Pages explain what code does, not what changed
- Current state is the primary organizing principle
- Good for understanding **how code works today**

---

## Evidence of Misalignment

### Deterministic Strategies: Current-State First

```typescript
// strategies.ts lines 709-715
export const deterministicStrategies: Strategy[] = [
  bootstrapStrategy,
  codebaseExplorationStrategy,    // PRIMARY: document what exists NOW
  synthesisStrategy,              // Elevated: create structure early
  metaAgentsStrategy,
  commitAnalysisStrategy,         // DEMOTED: historical context comes after
];
```

**Explicit comment:** "Commit Analysis - DEMOTED: historical context comes after useful wiki"

### LLM Prompt: Commit-Centric

```typescript
// prompts.ts - System prompt structure

## Available Agents

EXPLORATION AGENT (run on specific directories):
- codebase-explorer: [single agent]

ANALYSIS AGENTS (run on specific commits):
- code-change
- narrative
- security
- technical-debt
- pattern
- dependency      // [6 agents, all require commits]

META AGENTS...
SYNTHESIS AGENTS...
```

The LLM sees:
- 1 exploration agent
- 6 analysis agents (all commit-based)
- Natural tendency: pick from the larger category

### Decision Guidelines: Focus on Commit Processing

```
**5-10 pages (Navigability Phase):**
- Start processing RECENT commits (last week) for context

**10-20 pages (Enrichment Phase):**
- Process commits to add "why" context

**20+ pages (Depth & Historical Phase):**
- Process older commits for historical context
```

The guidelines emphasize commit processing at every phase. Exploration is mentioned but not prioritized.

### The Fallback Patch

```typescript
// orchestrator.ts lines 308-324
// Fallback: If LLM didn't schedule any exploration, add deterministic exploration
let fallbackExplorationWork: WorkItem[] = [];
if (!llmScheduledExploration && this.git && this.contextGatherer) {
  const remainingSlots = maxItems - llmWorkItems.length;
  if (remainingSlots > 0) {
    // Force exploration even though LLM didn't schedule it
    const explorationResult = await codebaseExplorationStrategy(...);
    fallbackExplorationWork = explorationResult.workItems;
  }
}
```

**This fallback exists because the team knows the LLM won't prioritize exploration correctly.**

---

## The Context Format Also Contributes

The context formatter (`formatForPrompt`) does put exploration first:

```
1. Immediate Actions (pending edits)
2. Project Context
3. Codebase Structure ← EXPLORATION INFO HERE
4. Wiki State
5. Quality Gaps
6. Recent Activity
7. Historical Context ← COMMIT INFO HERE
```

But then the user prompt contradicts this:

```typescript
// buildUserPrompt
return `${contextString}

## Your Task
...
Consider:
- Pending edit requests: ${ctx.pendingEditRequests}
...
Return your response using the format: agentType,targetCommitId,reason
                                                  ^^^^^^^^^^^^^^^^
                                                  Implicitly suggests commits
```

The format instruction says "targetCommitId" not "targetPath or targetCommitId".

---

## Symptoms in Generated Wikis

### 1. Commit-Style Content
Pages often read like commit logs:
- "This commit introduces..."
- "This change adds..."
- "This patch fixes..."

Instead of encyclopedic documentation:
- "The authentication system works by..."
- "To use this module, you..."
- "The key components are..."

### 2. Writer Agent Overload
The Writer Agent exists specifically to fix commit-style content. If the foundation were built from exploration rather than commits, less rewriting would be needed.

### 3. Gaps in Current-State Knowledge
Pages about commit changes may reference code that no longer exists (was refactored later). Exploration would document what exists **now**.

### 4. Inconsistent Prioritization
Sometimes LLM prioritizes exploration, sometimes commits. The fallback catches some cases but not all.

---

## Root Cause

The system evolved from commit-centric to current-state-centric, but the LLM prompt wasn't fully updated:

| Component | Philosophy |
|-----------|------------|
| Original design | Commit-centric |
| Deterministic strategies | Current-state-centric (updated) |
| LLM system prompt | **Still commit-centric** |
| Context formatting | Mixed |
| Fallback mechanism | Patches mismatch |

---

## Recommended Fixes

### Immediate
1. **Update LLM system prompt to prioritize exploration**
   ```
   ## Primary Strategy: Current-State First

   Document the current codebase BEFORE analyzing commits:
   1. Exploration: What code exists today?
   2. Synthesis: How is it organized?
   3. Commit Analysis: How did it evolve? (lower priority)
   ```

2. **Reorder agent categories in prompt**
   Put exploration agents first, prominently.

3. **Update format instruction**
   ```
   Return your response using the format: agentType,target,reason
   (target is a path for exploration, commit ID for analysis, empty for others)
   ```

### Short-term
4. **Add explicit exploration budget**
   ```
   When wiki has < 20 pages, dedicate at least 50% of work items to exploration.
   ```

5. **Rename "analysis agents" to "commit agents"**
   Make the distinction clearer.

### Medium-term
6. **Separate orchestrator modes**
   - Early mode: Focus on exploration and structure
   - Mature mode: Add historical commit context

   Rather than trying to balance both in one prompt.

7. **Remove fallback mechanism**
   If the LLM is properly prompted, the fallback shouldn't be needed. Its existence is a code smell indicating the prompt is wrong.

---

## Impact Assessment

| Area | Current Impact |
|------|----------------|
| Wiki content quality | Pages are commit-style instead of documentation-style |
| Writer Agent load | High - must rewrite many pages |
| User experience | Wiki reads like a changelog, not documentation |
| Development velocity | Fallback mechanism adds complexity |
| LLM cost | LLM makes suboptimal choices, requires more iterations |

---

## Questions for Self-Analysis

1. "What percentage of wiki pages contain commit-style language ('this commit', 'this change') versus encyclopedic language?"

2. "How often does the fallback exploration mechanism trigger? What percentage of exploration work comes from fallback vs. LLM decision?"

3. "For pages created from exploration vs. commits, which have higher benchmark accuracy?"

4. "Does the Writer Agent run more on pages that originated from commit analysis vs. exploration?"
