# Issue 2: No Source Verification Meta Agent

## Summary

The meta agents review wiki quality but none verify that wiki content matches actual source code. They check wiki-internal consistency (page-to-page), not wiki-to-codebase accuracy (page-to-source).

## Severity: HIGH

## Current Meta Agent Landscape

### What Meta Agents Currently Check

| Agent | Purpose | Checks Source? |
|-------|---------|----------------|
| **QualityAgent** | Content clarity, structure, citations | No - checks writing quality |
| **ConsistencyAgent** | Contradictions between pages | No - compares pages to pages |
| **LinkAgent** | Cross-reference validity | No - checks links exist |
| **StructureAgent** | Wiki organization | No - checks hierarchy |
| **WikiEditorAgent** | Temporal ordering of edits | No - manages edit flow |

### QualityAgent Deep Dive

The QualityAgent (`src/agents/meta/quality-agent.ts`) checks:

```typescript
// Quick checks (no LLM)
- hasEmptySections(content)     // Empty section headers
- hasSourceCitations(content)   // Has commit refs or file paths
- content.length < MIN_LENGTH   // Very short content
- confidence < THRESHOLD        // Low confidence score

// LLM-based checks
- Clarity: Is content well-written?
- Accuracy: "Does the content seem accurate based on what's described?"
- Completeness: Missing pieces?
- Usefulness: Would a developer find this helpful?
- Depth: Does it explain HOW, not just WHAT?
```

**Critical observation**: The "accuracy" check asks the LLM if content "seems accurate based on what's described" - but the LLM only sees the wiki page, not the source code. It's checking internal consistency, not factual accuracy.

### ConsistencyAgent Checks

From the system prompt:

```
Look for:
- Same concept described differently in two places
- Conflicting information about how something works
- Outdated references to removed functionality
```

This catches page-to-page contradictions but not page-to-code inaccuracies.

## The Gap

### Scenario: Undetected Inaccuracy

1. **CodeChangeAgent** analyzes a commit and writes:
   > "The UserService authenticates using JWT tokens with 24-hour expiry"

2. **But the actual code** (`src/services/user-service.ts`) uses:
   > Cookie-based sessions with 1-hour expiry

3. **QualityAgent runs**: "Page is well-structured, has citations" ✓
4. **ConsistencyAgent runs**: "No contradictions with other wiki pages" ✓
5. **No agent checks**: Does the wiki match the source code?
6. **Result**: Inaccurate documentation persists indefinitely

### What Would Catch This

A **SourceVerificationAgent** that:
1. Extracts verifiable claims from wiki pages
2. Reads the referenced source code
3. Compares claims to actual implementation
4. Creates `INACCURATE` findings for mismatches

## Proposed: SourceVerificationAgent

### Design Overview

```
Wiki Pages → Extract Claims → Verify Against Source → Create Findings
                                      ↓
                             read_file, search_files
```

### Claims to Verify

Not all wiki content is verifiable. Focus on:

| Claim Type | Example | How to Verify |
|------------|---------|---------------|
| **File paths** | "The config is in `src/config.ts`" | Check file exists |
| **Function signatures** | "`authenticate(user, password)`" | Read file, check signature |
| **Behaviors** | "Tokens expire after 24 hours" | Read implementation |
| **Dependencies** | "Uses Redis for caching" | Check imports/package.json |
| **Constants** | "Max retry count is 3" | Find constant definition |

### Implementation Sketch

```typescript
// src/agents/meta/source-verification-agent.ts

export class SourceVerificationAgent implements Agent {
  readonly type: AgentType = 'source-verification';

  getSystemPrompt(): string {
    return SOURCE_VERIFICATION_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isWikiTarget(target);
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
    const pages = await getWikiPages(context.wikiId);
    const findings: Finding[] = [];
    let totalCost = 0;

    // Prioritize pages with code claims
    const pagesToVerify = this.selectPagesForVerification(pages);

    for (const page of pagesToVerify) {
      const { claims, cost: extractCost } = await this.extractClaims(page, context);
      totalCost += extractCost;

      for (const claim of claims) {
        const { accurate, reason, cost: verifyCost } = await this.verifyClaim(
          claim,
          context
        );
        totalCost += verifyCost;

        if (!accurate) {
          findings.push(createFinding({
            id: uuid(),
            wikiId: context.wikiId,
            repoId: context.repoId,
            sourceAgentRunId: '',  // Set by executor
            type: 'inaccurate',
            description: reason,
            affectedPaths: [page.path],
            severity: this.getSeverity(claim),
            metadata: {
              claim: claim.text,
              sourceFile: claim.filePath,
              lineNumber: claim.lineNumber,
            },
          }));
        }
      }
    }

    return {
      result: createAgentResult({
        summary: `Verified ${pagesToVerify.length} pages, found ${findings.length} inaccuracies`,
        findings: findings.map(f => ({
          type: f.type,
          description: f.description,
          relatedPaths: f.affectedPaths,
          importance: f.severity,
        })),
        confidence: 0.8,
      }),
      updates: [],
      costUsd: totalCost,
    };
  }

  private selectPagesForVerification(pages: WikiPage[]): WikiPage[] {
    // Prioritize pages that:
    // 1. Reference specific files (have backtick paths)
    // 2. Make behavioral claims
    // 3. Haven't been verified recently
    // 4. Have lower confidence

    return pages
      .filter(p => this.hasCodeClaims(p.content))
      .sort((a, b) => a.confidence - b.confidence)
      .slice(0, 5);  // Verify 5 pages per run
  }

  private hasCodeClaims(content: string): boolean {
    // Look for file paths, function calls, code blocks
    return (
      /`[^`]+\.(ts|js|tsx|jsx)`/.test(content) ||
      /```(typescript|javascript)/.test(content) ||
      /function\s+\w+|class\s+\w+|const\s+\w+/.test(content)
    );
  }

  private async extractClaims(
    page: WikiPage,
    context: AgentContext
  ): Promise<{ claims: Claim[]; cost: number }> {
    const completion = await context.llm.complete({
      system: CLAIM_EXTRACTION_PROMPT,
      messages: [{
        role: 'user',
        content: `Extract verifiable claims from this wiki page:\n\n${page.content}`
      }],
      maxTokens: 1500,
    });

    const claims = this.parseClaims(completion.content);
    return { claims, cost: completion.costUsd };
  }

  private async verifyClaim(
    claim: Claim,
    context: AgentContext
  ): Promise<{ accurate: boolean; reason: string; cost: number }> {
    // Set up tools
    const toolExecutor = createCodebaseToolExecutor(context);

    // Verify using tools
    const completion = await context.llm.completeWithTools({
      system: VERIFICATION_PROMPT,
      messages: [{
        role: 'user',
        content: `Verify this claim:\n\nClaim: "${claim.text}"\nFile: ${claim.filePath}\n\nUse read_file to check the actual implementation.`
      }],
      tools: toolExecutor?.tools ?? [],
      executeTools: toolExecutor?.executeTools ?? (async () => []),
      maxToolRounds: 3,
      maxTokens: 1000,
    });

    const result = this.parseVerification(completion.content);
    return { ...result, cost: completion.costUsd };
  }

  private getSeverity(claim: Claim): 'high' | 'medium' | 'low' {
    // Security/auth claims are high severity
    if (/auth|security|password|token|credential/i.test(claim.text)) {
      return 'high';
    }
    // API/interface claims are medium
    if (/api|interface|function|method|parameter/i.test(claim.text)) {
      return 'medium';
    }
    return 'low';
  }
}

interface Claim {
  text: string;           // The claim itself
  filePath?: string;      // File being referenced
  lineNumber?: number;    // Line being referenced
  claimType: 'existence' | 'behavior' | 'signature' | 'constant';
}
```

### System Prompts

```typescript
const CLAIM_EXTRACTION_PROMPT = `You extract verifiable technical claims from wiki documentation.

A verifiable claim is a statement that can be checked against source code:
- File existence: "The config is stored in src/config.ts"
- Function signatures: "authenticate(user: string, password: string)"
- Behaviors: "Retries up to 3 times with exponential backoff"
- Constants: "Default timeout is 5000ms"
- Dependencies: "Uses Redis for session storage"

For each claim, output:
CLAIM: [the exact claim text]
FILE: [file path if mentioned, or likely location]
TYPE: [existence|behavior|signature|constant]

Skip:
- Vague claims ("the system is fast")
- Subjective statements ("this is a good pattern")
- Claims about wiki structure
`;

const VERIFICATION_PROMPT = `You verify technical claims against source code.

Given a claim and file path:
1. Use read_file to get the actual source code
2. Compare the claim to what you find
3. Report if the claim is accurate or not

Output:
ACCURATE: [true|false]
REASON: [explanation of match or mismatch]
EVIDENCE: [relevant code snippet if found]
`;
```

### Registration and Scheduling

```typescript
// Add to src/agents/registry.ts
export const META_AGENTS: AgentType[] = [
  'wiki-editor',
  'link',
  'structure',
  'quality',
  'consistency',
  'source-verification',  // NEW
];

// Add to orchestrator strategies
function metaAgentsStrategy(ctx: StrategyContext): WorkItem[] {
  // ... existing code ...

  // Schedule source verification periodically
  if (wikiPages > 10 && !hasRecentSourceVerification(ctx)) {
    workItems.push(createWorkItem({
      agentType: 'source-verification',
      priority: Priority.META,
    }));
  }
}
```

## Integration with Consolidation

The SourceVerificationAgent creates findings, but Consolidation needs to handle them. This requires:

1. Adding `'inaccurate'` to FindingType (see Issue 3)
2. Creating InaccuracyHandler for Consolidation

## When to Run

The SourceVerificationAgent should run:

1. **Periodically**: Every N iterations (e.g., every 50)
2. **After batch completions**: When a set of analysis agents finish
3. **On low-confidence pages**: Pages under 0.6 confidence
4. **Before publishing**: If implementing draft → publish workflow

## Cost Considerations

Source verification is expensive:
- Claim extraction: ~1 LLM call per page
- Verification: ~1-3 LLM calls + tool calls per claim
- Typical page might have 5-10 verifiable claims

**Mitigation strategies:**
- Verify only lowest-confidence pages
- Sample verification (random subset)
- Cache verification results
- Skip recently-verified claims

## Metrics to Track

- **Pages verified per run**: How many pages checked
- **Claims per page**: Average verifiable claims found
- **Inaccuracy rate**: % of claims that fail verification
- **Inaccuracy by agent**: Which original agents produce most inaccuracies
- **Fix success rate**: How many inaccuracies get corrected

## Related Files

- `src/agents/meta/quality-agent.ts` - Current quality checking
- `src/agents/meta/consistency-agent.ts` - Page-to-page checks
- `src/agents/consolidation/` - Finding handling
- `src/domain/finding.ts` - Finding types
