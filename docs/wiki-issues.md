# CodeWiki: Current Issues and Gaps

This document analyzes the remaining issues in the CodeWiki agent architecture after recent fixes. The system uses a two-phase verification model:

1. **Proactive verification**: Agents use tools to verify claims before writing
2. **Reactive correction**: Meta agents provide eventual consistency by finding and fixing errors

This model is sound, but there are gaps in implementation.

---

## Executive Summary

| Issue | Severity | Description | Deep Dive |
|-------|----------|-------------|-----------|
| [Tool Usage Not Enforced](#issue-1-tool-usage-not-enforced) | HIGH | Agents have tools but nothing ensures they use them | [Full Analysis](./issues/01-tool-usage-not-enforced.md) |
| [No Source Verification Meta Agent](#issue-2-no-source-verification-meta-agent) | HIGH | Meta agents check wiki-internal quality, not wiki-to-codebase accuracy | [Full Analysis](./issues/02-no-source-verification-agent.md) |
| [Missing INACCURATE Finding Type](#issue-3-missing-inaccurate-finding-type) | MEDIUM | Consolidation can't fix accuracy issues because they aren't detected | [Full Analysis](./issues/03-missing-inaccurate-finding-type.md) |

---

## Issue 1: Tool Usage Not Enforced

### Severity: HIGH

### Summary

All analysis and synthesis agents now have access to codebase tools (`read_file`, `search_files`, `list_directory`). The prompts instruct them to "verify before writing." However, there's no mechanism to ensure agents actually use these tools effectively.

### The Problem

LLMs can:
- Generate plausible content without calling tools at all
- Call tools but ignore the results in favor of training data
- Use tools superficially (read one file, extrapolate broadly)

The system logs tool usage but doesn't enforce it:

```typescript
// executor.ts - tool calls are logged but not validated
const toolUsageFinding = completion.toolCalls.length > 0
  ? [createFinding({
      type: 'TOOL_USE',
      description: `Read ${filesRead.length} source files`,
      // ...
    })]
  : [];  // No tools used - no error, no warning, just empty
```

### Evidence

Agent prompts say "CRITICAL: Verify Before Documenting" but there's no enforcement:

```typescript
// pattern-agent.ts system prompt
// "CRITICAL: Verify Before Documenting
//  1. Use read_file to get the COMPLETE source file
//  2. Verify line numbers are accurate
//  ..."

// But the agent can still return results without using tools
// Nothing checks if verification actually happened
```

### Impact

- Agents may generate authoritative-sounding but unverified content
- No way to distinguish "verified and wrote" vs "wrote without verification"
- Proactive verification becomes optional rather than mandatory

### Potential Solutions

1. **Minimum tool usage requirement**: Require N tool calls before accepting output
2. **Verification attestation**: Agent must explicitly state what it verified
3. **Tool-call-to-claim ratio**: Track ratio of tools used vs. claims made
4. **Retry without tools = failure**: If agent produces content with 0 tool calls, retry or reject

---

## Issue 2: No Source Verification Meta Agent

### Severity: HIGH

### Summary

The meta agents review wiki quality but none of them verify that wiki content matches the actual source code. They check wiki-internal consistency, not wiki-to-codebase accuracy.

### Current Meta Agents

| Agent | What It Checks | Catches Inaccuracies? |
|-------|---------------|----------------------|
| QualityAgent | Clarity, completeness, citations | No - checks structure, not facts |
| ConsistencyAgent | Contradictions between pages | No - checks page-to-page, not page-to-code |
| LinkAgent | Cross-references validity | No - checks links exist, not content |
| StructureAgent | Wiki organization | No - checks structure, not content |
| WikiEditorAgent | Temporal ordering of edits | No - manages edit flow, not accuracy |

### The Gap

Consider this scenario:

1. CodeChangeAgent writes: "AuthService uses JWT tokens for session management"
2. But `src/services/auth.ts` actually uses cookie-based sessions
3. QualityAgent runs: "Page is well-structured, has citations" ✓
4. ConsistencyAgent runs: "No contradictions with other pages" ✓
5. **No agent checks if the claim matches the source code**
6. Inaccurate content persists indefinitely

### What Would Close the Gap

A `SourceVerificationAgent` that:

1. Extracts factual claims from wiki pages (file paths, function names, behaviors)
2. Uses tools to read the referenced source code
3. Verifies claims match reality
4. Creates `INACCURATE` findings for mismatches

```typescript
// Conceptual implementation
class SourceVerificationAgent implements Agent {
  readonly type: AgentType = 'source-verification';

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
    const pages = await getWikiPages(context.wikiId);
    const findings: Finding[] = [];

    for (const page of pages) {
      // Extract verifiable claims
      const claims = this.extractClaims(page.content);

      for (const claim of claims) {
        // Verify against source
        const sourceContent = await tools.read_file(claim.filePath);
        const verification = await this.verifyClaim(claim, sourceContent);

        if (!verification.accurate) {
          findings.push({
            type: 'INACCURATE',
            description: verification.reason,
            relatedPaths: [page.path, claim.filePath],
            importance: 'high',
          });
        }
      }
    }

    return { findings, updates: [] };
  }
}
```

### Impact of Missing This

- Errors introduced during initial generation persist
- Eventual consistency only works for wiki-internal issues
- Users may trust incorrect documentation
- The reactive correction model has a blind spot

---

## Issue 3: Missing INACCURATE Finding Type

### Severity: MEDIUM

### Summary

The Consolidation Agent handles findings from meta agents, but there's no finding type for "content doesn't match source code." Even if a verification agent existed, Consolidation couldn't process its findings.

### Current Finding Types

```typescript
// From finding-handler-registry.ts
type FindingType =
  | 'DUPLICATE'           // Two pages cover same topic
  | 'BROKEN_LINK'         // Link points to non-existent page
  | 'TERMINOLOGY'         // Inconsistent term usage
  | 'CONTRADICTION'       // Pages contradict each other
  | 'CATEGORY_MISMATCH'   // Page in wrong category
  | 'ORPHANED_PAGE'       // Page with no inbound links
```

### The Gap

No `INACCURATE` type exists for:
- "This code example doesn't compile"
- "This file path doesn't exist"
- "This function signature is wrong"
- "This behavior description doesn't match implementation"

### What Would Close the Gap

1. Add `INACCURATE` finding type
2. Create `InaccuracyHandler` for Consolidation Agent

```typescript
// New finding type
interface InaccurateFinding extends Finding {
  type: 'INACCURATE';
  claim: string;           // The inaccurate statement
  sourceFile: string;      // File that contradicts it
  actualBehavior: string;  // What the code actually does
}

// Handler for Consolidation Agent
class InaccuracyHandler extends FindingHandler {
  readonly findingType = 'INACCURATE';

  async handle(finding: InaccurateFinding, context: AgentContext) {
    // Read the source file
    const sourceContent = await tools.read_file(finding.sourceFile);

    // Get LLM to generate corrected content
    const correctedContent = await context.llm.complete({
      system: 'You are correcting inaccurate wiki content...',
      messages: [{
        role: 'user',
        content: `
          The wiki claims: "${finding.claim}"
          But the source code shows: ${sourceContent}

          Generate corrected wiki content that accurately describes the code.
        `
      }]
    });

    // Return update to fix the page
    return [{
      type: 'update',
      path: finding.relatedPaths[0],
      content: correctedContent,
      confidenceDelta: 0.2,  // Boost confidence after correction
    }];
  }
}
```

### Impact of Missing This

- Even if inaccuracies were detected, no handler exists to fix them
- The Consolidation pipeline has a gap
- Manual intervention required for accuracy fixes

---

## How These Issues Interact

```
┌─────────────────────────────────────────────────────────────────┐
│                    PROACTIVE VERIFICATION                        │
│  Agents have tools → But usage not enforced → May not verify    │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼ Unverified content enters wiki
┌─────────────────────────────────────────────────────────────────┐
│                    REACTIVE CORRECTION                           │
│  Meta agents run → But none check source accuracy → Gap persists │
└────────────────────────────┬────────────────────────────────────┘
                             │
                             ▼ Inaccuracies not detected
┌─────────────────────────────────────────────────────────────────┐
│                    CONSOLIDATION                                 │
│  Handles findings → But no INACCURATE type → Can't fix accuracy │
└─────────────────────────────────────────────────────────────────┘
```

All three issues compound: unverified content enters, isn't detected, and can't be fixed.

---

## Recommended Fix Priority

### Phase 1: Detection (High Priority)
1. Create `SourceVerificationAgent` (meta agent)
2. Add `INACCURATE` finding type
3. Create `InaccuracyHandler` for Consolidation

This closes the reactive correction gap.

### Phase 2: Prevention (Medium Priority)
4. Add tool usage validation to executor
5. Consider minimum tool-call requirements for analysis agents
6. Track verification metrics per agent

This strengthens proactive verification.

### Phase 3: Monitoring (Lower Priority)
7. Dashboard for accuracy metrics
8. Alerts when inaccuracy rate exceeds threshold
9. Per-agent accuracy tracking

---

## Deep Dive Documents

For detailed analysis, implementation sketches, and test cases, see:

- [Issue 1: Tool Usage Not Enforced](./issues/01-tool-usage-not-enforced.md) - Analysis of why prompt-based verification isn't enough
- [Issue 2: No Source Verification Agent](./issues/02-no-source-verification-agent.md) - Proposed SourceVerificationAgent design
- [Issue 3: Missing INACCURATE Finding Type](./issues/03-missing-inaccurate-finding-type.md) - InaccuracyHandler implementation

---

## Related Files

- `src/agents/registry.ts` - Agent type definitions
- `src/agents/meta/` - Current meta agents
- `src/agents/consolidation/` - Consolidation pipeline
- `src/agents/consolidation/finding-handler-registry.ts` - Finding types
- `src/executor/executor.ts` - Agent execution and tool handling
- `src/domain/finding.ts` - Finding type definitions
- `src/agents/agent-helpers.ts` - Tool executor creation
