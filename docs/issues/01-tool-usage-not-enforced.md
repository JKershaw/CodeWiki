# Issue 1: Tool Usage Not Enforced

## Status: RESOLVED

**Resolved in:** Commit `c0943a4` on branch `claude/review-docs-issue-01ByzJJuVr4ZghLHQoGVp6uS`

## Summary

All analysis and synthesis agents have access to codebase tools (`read_file`, `search_files`, `list_directory`). Prompts instruct agents to "verify before writing." However, there's no mechanism ensuring agents actually use these tools effectively.

## Severity: HIGH (was)

---

## Resolution

### What Was Implemented

The fix implements **Option 1 (Minimum Tool Usage Requirement)** from the proposed solutions, with a layered approach:

#### 1. Tool Enforcement Module (`src/executor/tool-enforcement.ts`)

New module providing:
- `ToolEnforcementConfig` - Per-agent requirements configuration
- `validateToolUsage()` - Validates tool calls against requirements
- `isWarnOnly()` / `hasToolRequirements()` - Helper functions
- `ToolEnforcementError` - Error class for failed validations
- `formatToolMetricsForLog()` - Formatted logging output

#### 2. Tool Metrics Tracking (`src/agents/base-agent.ts`)

Added to `AgentRunResult`:
```typescript
interface ToolMetrics {
  toolCallCount: number;
  toolsUsed: Record<string, number>;
  filesRead: string[];
}

interface AgentRunResult {
  // ... existing fields
  toolMetrics?: ToolMetrics;  // NEW
}
```

Added `extractToolMetrics(completion)` helper function.

#### 3. Agent Updates

All analysis agents now report tool metrics:
- `code-change-agent.ts`
- `pattern-agent.ts`
- `security-agent.ts`
- `technical-debt-agent.ts`
- `narrative-agent.ts`
- `dependency-agent.ts`
- `codebase-explorer-agent.ts`

#### 4. Executor Integration (`src/executor/executor.ts`)

After `agent.run()` returns:
1. Checks if agent has tool requirements via `hasToolRequirements()`
2. Validates tool usage via `validateToolUsage()`
3. Logs tool metrics: `🔧 ✓ code-change: 3 tool call(s) [read_file(2), search_files(1)]`
4. For strict agents: throws `ToolEnforcementError` if requirements not met
5. For warnOnly agents: logs warning but continues

### Enforcement Configuration

| Agent Type | Min Calls | Required Tools | Mode |
|------------|-----------|----------------|------|
| code-change | 1 | read_file | **Strict** |
| pattern | 1 | read_file | **Strict** |
| security | 1 | read_file | **Strict** |
| technical-debt | 1 | read_file | **Strict** |
| narrative | 1 | - | Warn only |
| dependency | 1 | - | Warn only |
| bootstrap | 1 | - | Warn only |
| project-overview | 1 | - | Warn only |
| getting-started | 1 | - | Warn only |
| testing-guide | 1 | - | Warn only |
| extension-guide | 1 | - | Warn only |
| writer | 0 | - | Warn only |
| overview | 0 | - | Warn only |
| quality | 0 | - | None |
| link | 0 | - | None |
| wiki-editor | 0 | - | None |
| structure | 0 | - | None |
| consistency | 0 | - | None |

### Verification

- All 1299 tests pass
- TypeScript compiles cleanly
- Test output shows enforcement working:
  ```
  # ✗ AGENT FAILURE: code-change
  # Error: Agent 'code-change' made 0 tool call(s), but 1 required
  ```

### Future Enhancements

The following from the original proposal remain as future work:
- **Attestation format**: Agent explicitly states what it verified
- **Tool-call-to-claim ratio**: Track claims vs. tool calls
- **Retry mechanism**: Re-prompt if no tools used

---

## Original Analysis

## Current State

### Tool Infrastructure

The tool system is well-implemented in `src/agents/agent-helpers.ts`:

```typescript
export function createCodebaseToolExecutor(context: AgentContext): {
  tools: ToolDefinition[];
  executeTools: (calls) => Promise<results>;
} | null
```

Tools available:
- `read_file` - Read any file from the repository
- `search_files` - Find files matching glob patterns
- `list_directory` - List directory contents

### Agent Tool Usage

All 20+ agents now call `completeWithTools()`:

| Agent | Tool Rounds | Has Tools |
|-------|-------------|-----------|
| CodeChangeAgent | 5 | ✓ |
| PatternAgent | 5 | ✓ |
| SecurityAgent | 5 | ✓ |
| TechnicalDebtAgent | 5 | ✓ |
| NarrativeAgent | 3 | ✓ |
| DependencyAgent | 3 | ✓ |
| CodebaseExplorerAgent | 10 | ✓ |
| WriterAgent | 3 | ✓ |
| OverviewAgent | 3 | ✓ |
| BootstrapAgent | 5 | ✓ |
| ProjectOverviewAgent | 5 | ✓ |
| GettingStartedAgent | 5 | ✓ |
| TestingGuideAgent | 5 | ✓ |
| ExtensionGuideAgent | 5 | ✓ |

### Prompt Instructions

Agents have verification instructions in their prompts:

```typescript
// pattern-agent.ts system prompt
`## CRITICAL: Verify Before Documenting

You have access to tools - USE THEM to verify claims:
1. Use read_file to get the COMPLETE source file before referencing line numbers
2. Use search_files to find related implementations
3. Verify line numbers are accurate by reading the actual file
4. Never cite specific line numbers without reading the file first`
```

## The Gap

### Problem Statement

The LLM can return valid output **without using any tools**. The system accepts this:

```typescript
// executor.ts - current behavior
const completion = await context.llm.completeWithTools({
  tools: toolExecutor.tools,
  executeTools: toolExecutor.executeTools,
  maxToolRounds: 5,
  // ...
});

// Tool usage is logged but not required
const toolUsageFinding = completion.toolCalls.length > 0
  ? [createFinding({ type: 'TOOL_USE', ... })]
  : [];  // Zero tools used = no error, just empty finding
```

### Failure Modes

1. **No tool calls at all**: LLM generates plausible content from training data
2. **Superficial tool use**: Reads one file, extrapolates broadly
3. **Tool results ignored**: Calls tool but uses training data anyway
4. **Wrong file read**: Reads a file but cites claims about a different file

### Evidence: What Happens Without Enforcement

Consider the PatternAgent analyzing a commit:

```
Input: Commit adding Repository pattern to src/repositories/

Expected (with tools):
1. LLM calls read_file("src/repositories/user-repository.ts")
2. LLM sees actual code structure
3. LLM documents real patterns with accurate line numbers

Actual (possible without enforcement):
1. LLM sees commit message mentions "Repository pattern"
2. LLM generates typical Repository pattern documentation
3. Line numbers are plausible but potentially wrong
4. Code examples may not match actual implementation
```

## Potential Solutions

### Option 1: Minimum Tool Usage Requirement

Require N tool calls before accepting output:

```typescript
interface ToolRequirement {
  minCalls: number;
  requiredTools?: string[];  // e.g., ['read_file']
}

const AGENT_TOOL_REQUIREMENTS: Record<AgentType, ToolRequirement> = {
  'code-change': { minCalls: 1, requiredTools: ['read_file'] },
  'pattern': { minCalls: 2, requiredTools: ['read_file'] },
  'codebase-explorer': { minCalls: 3 },
  'writer': { minCalls: 1 },
  // ...
};

// In executor
if (completion.toolCalls.length < requirements.minCalls) {
  throw new AgentVerificationError(
    `Agent ${agent.type} made ${completion.toolCalls.length} tool calls, ` +
    `but ${requirements.minCalls} are required`
  );
}
```

**Pros:**
- Simple to implement
- Guaranteed tool usage

**Cons:**
- Arbitrary threshold
- Doesn't ensure *meaningful* tool usage
- Agent might call tools superficially to meet quota

### Option 2: Verification Attestation

Agent must explicitly state what it verified:

```typescript
// Add to response format
`VERIFICATION:
- Verified: [what claim] via [which tool call]
- Verified: [what claim] via [which tool call]
- Unverified: [what claim] (reason)

CONTENT:
...`

// Parser validates attestations match actual tool calls
function validateAttestations(attestations: Attestation[], toolCalls: ToolCall[]): boolean {
  for (const attestation of attestations) {
    if (!attestation.unverified) {
      const matchingCall = toolCalls.find(c =>
        c.name === attestation.tool &&
        c.input.path === attestation.path
      );
      if (!matchingCall) {
        return false; // Claimed verification without tool call
      }
    }
  }
  return true;
}
```

**Pros:**
- Links claims to evidence
- Transparent about what's verified
- Allows unverified content with disclosure

**Cons:**
- Complex to implement
- LLM might fabricate attestations
- Additional parsing complexity

### Option 3: Tool-Call-to-Claim Ratio

Track ratio of tools used vs. claims made:

```typescript
interface ClaimMetrics {
  claimsCount: number;      // Claims in output
  toolCallsCount: number;   // Tool calls made
  uniqueFilesRead: number;  // Distinct files read
  ratio: number;            // toolCalls / claims
}

// Warn if ratio is suspiciously low
if (metrics.ratio < 0.3 && metrics.claimsCount > 5) {
  console.warn(`Agent made ${metrics.claimsCount} claims but only ` +
               `${metrics.toolCallsCount} tool calls`);
  // Either flag for review or reject
}
```

**Pros:**
- Adapts to output size
- Catches egregious cases

**Cons:**
- "Claims" hard to count automatically
- Threshold is still arbitrary

### Option 4: Retry Without Tools = Failure

If agent produces content with 0 tool calls, retry with more explicit instructions:

```typescript
async function runWithToolEnforcement(agent, context) {
  let attempts = 0;
  const maxAttempts = 2;

  while (attempts < maxAttempts) {
    const result = await agent.run(target, context);

    if (result.toolCalls.length > 0) {
      return result;  // Success - tools were used
    }

    attempts++;
    if (attempts < maxAttempts) {
      // Retry with explicit reminder
      context.additionalInstructions =
        'IMPORTANT: You MUST use the provided tools to verify claims. ' +
        'Read source files before documenting. Your previous attempt did not use tools.';
    }
  }

  // Still no tool usage after retries
  throw new NoVerificationError(`Agent ${agent.type} did not use verification tools`);
}
```

**Pros:**
- Gives LLM second chance
- Clear failure mode

**Cons:**
- Adds latency and cost
- LLM might still not use tools

## Recommended Approach

Implement a **layered approach**:

1. **Logging (immediate)**: Track tool usage metrics per agent type
2. **Minimum requirement (short-term)**: Require at least 1 `read_file` call for analysis agents
3. **Attestation (medium-term)**: Add verification section to response format

### Implementation Sketch

```typescript
// src/executor/tool-enforcement.ts

export interface ToolEnforcementConfig {
  minToolCalls?: number;
  requiredTools?: string[];
  warnOnly?: boolean;  // Log warning vs. throw error
}

export const DEFAULT_TOOL_REQUIREMENTS: Record<AgentType, ToolEnforcementConfig> = {
  // Analysis agents - HIGH enforcement (they cite specific code)
  'code-change': { minToolCalls: 1, requiredTools: ['read_file'] },
  'pattern': { minToolCalls: 2, requiredTools: ['read_file'] },
  'security': { minToolCalls: 1, requiredTools: ['read_file'] },
  'technical-debt': { minToolCalls: 1, requiredTools: ['read_file'] },

  // Exploration agents - VERY HIGH enforcement
  'codebase-explorer': { minToolCalls: 3, requiredTools: ['read_file', 'list_directory'] },

  // Synthesis agents - MEDIUM enforcement (they transform existing content)
  'writer': { minToolCalls: 1, warnOnly: true },
  'overview': { minToolCalls: 0, warnOnly: true },

  // Meta agents - LOW enforcement (they work on wiki content)
  'quality': { minToolCalls: 0 },
  'link': { minToolCalls: 0 },
};

export function validateToolUsage(
  agentType: AgentType,
  toolCalls: ToolCall[],
  config: ToolEnforcementConfig
): { valid: boolean; message: string } {
  const callCount = toolCalls.length;
  const callsByName = new Map<string, number>();

  for (const call of toolCalls) {
    callsByName.set(call.name, (callsByName.get(call.name) ?? 0) + 1);
  }

  // Check minimum calls
  if (config.minToolCalls && callCount < config.minToolCalls) {
    return {
      valid: false,
      message: `Agent made ${callCount} tool calls, minimum ${config.minToolCalls} required`,
    };
  }

  // Check required tools
  if (config.requiredTools) {
    for (const tool of config.requiredTools) {
      if (!callsByName.has(tool)) {
        return {
          valid: false,
          message: `Agent did not use required tool: ${tool}`,
        };
      }
    }
  }

  return { valid: true, message: 'OK' };
}
```

## Metrics to Track

After implementing enforcement:

- **Tool usage rate**: % of agent runs that use tools
- **Tool calls per agent type**: Average tool calls by agent
- **Files read vs. files cited**: Are cited files actually read?
- **Verification failures**: How often does enforcement reject output?

## Related Files

- `src/executor/tool-enforcement.ts` - **NEW** Tool enforcement module
- `src/agents/base-agent.ts` - ToolMetrics interface and extractToolMetrics()
- `src/agents/agent-helpers.ts` - Tool executor creation
- `src/executor/executor.ts` - Agent execution with enforcement integration
- `src/services/llm/codebase-tools.ts` - Tool definitions
- `src/services/llm/llm-service.ts` - Tool calling interface
