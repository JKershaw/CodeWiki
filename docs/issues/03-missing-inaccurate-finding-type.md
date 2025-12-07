# Issue 3: Missing INACCURATE Finding Type

## Summary

The Consolidation Agent handles findings from meta agents, but there's no finding type for "content doesn't match source code." Even if a SourceVerificationAgent detected inaccuracies, Consolidation couldn't process them.

## Severity: MEDIUM

## Current Finding Types

From `src/domain/finding.ts`:

```typescript
export type FindingType =
  | 'duplicate_title'      // Two pages with same/similar title
  | 'similar_content'      // Pages with overlapping content
  | 'broken_link'          // Link to non-existent page
  | 'orphaned_page'        // Page with no links to/from it
  | 'terminology'          // Inconsistent terminology across pages
  | 'category_mismatch'    // Content in wrong category
  | 'contradiction'        // Contradictory information between pages
  | 'low_quality';         // Page flagged as low quality
```

### What's Missing

No type exists for:
- `'inaccurate'` - Content doesn't match source code
- `'outdated'` - Content references removed/changed code
- `'fabricated'` - Content cites non-existent files/functions

### Registered Handlers

From `src/agents/consolidation/finding-handler-registry.ts`:

```typescript
export function createDefaultHandlerRegistry(): FindingHandlerRegistry {
  const registry = new FindingHandlerRegistry();

  registry.register(new DuplicateHandler());
  registry.register(new BrokenLinkHandler());
  registry.register(new TerminologyHandler());
  registry.register(new OrphanedPageHandler());
  registry.register(new CategoryMismatchHandler());
  registry.register(new ContradictionHandler());

  return registry;
}
```

No `InaccuracyHandler` exists.

## The Gap

### Scenario: Detected but Unhandled

1. SourceVerificationAgent runs (proposed in Issue 2)
2. Finds: "Page claims UserService uses JWT, but code uses sessions"
3. Creates finding:
   ```typescript
   {
     type: 'inaccurate',  // Not a valid FindingType!
     description: 'UserService authentication claim is incorrect',
     affectedPaths: ['architecture/authentication'],
     severity: 'high',
   }
   ```
4. ConsolidationAgent runs
5. `registry.getHandler('inaccurate')` returns `undefined`
6. Finding is skipped with warning: "No handler for finding type: inaccurate"
7. Inaccuracy persists

## Proposed Solution

### Step 1: Add Finding Type

```typescript
// src/domain/finding.ts

export type FindingType =
  | 'duplicate_title'
  | 'similar_content'
  | 'broken_link'
  | 'orphaned_page'
  | 'terminology'
  | 'category_mismatch'
  | 'contradiction'
  | 'low_quality'
  | 'inaccurate';  // NEW

export interface FindingMetadata {
  // ... existing fields ...

  /** For inaccurate: the incorrect claim */
  claim?: string;
  /** For inaccurate: the source file that contradicts it */
  sourceFile?: string;
  /** For inaccurate: what the code actually does */
  actualBehavior?: string;
  /** For inaccurate: relevant code snippet */
  codeSnippet?: string;
}

// Update priority
export const FindingPriority: Record<FindingType, number> = {
  inaccurate: 95,         // Very high - factual errors (NEW)
  contradiction: 100,
  broken_link: 90,
  duplicate_title: 80,
  similar_content: 60,
  terminology: 50,
  category_mismatch: 40,
  orphaned_page: 30,
  low_quality: 20,
};
```

### Step 2: Create InaccuracyHandler

```typescript
// src/agents/consolidation/handlers/inaccuracy-handler.ts

import type { Finding, FindingType } from '../../../domain/finding.js';
import type { AgentContext, WikiPageUpdate } from '../../base-agent.js';
import type { WikiPage } from '../../../domain/wiki-page.js';
import { FindingHandler } from '../finding-handler.js';
import { createCodebaseToolExecutor } from '../../agent-helpers.js';

/**
 * Handler for inaccurate content findings.
 *
 * This handler:
 * 1. Reads the source file mentioned in the finding
 * 2. Generates corrected content based on actual code
 * 3. Updates the wiki page with accurate information
 */
export class InaccuracyHandler extends FindingHandler {
  readonly supportedTypes: FindingType[] = ['inaccurate'];

  async handle(
    finding: Finding,
    context: AgentContext,
    page: WikiPage
  ): Promise<WikiPageUpdate[]> {
    const metadata = finding.metadata;

    if (!metadata?.sourceFile) {
      console.warn('InaccuracyHandler: No source file in finding metadata');
      return [];
    }

    // Set up tools to read source
    const toolExecutor = createCodebaseToolExecutor(context);
    if (!toolExecutor) {
      console.warn('InaccuracyHandler: No tool executor available');
      return [];
    }

    // Read the source file
    const sourceResult = await toolExecutor.executeTools([{
      id: 'read-source',
      name: 'read_file',
      input: { path: metadata.sourceFile },
    }]);

    const sourceContent = sourceResult[0]?.result;
    if (!sourceContent || sourceContent.startsWith('Error')) {
      console.warn(`InaccuracyHandler: Could not read ${metadata.sourceFile}`);
      return [];
    }

    // Generate corrected content
    const correctedContent = await this.generateCorrection(
      finding,
      page,
      sourceContent,
      context
    );

    if (!correctedContent) {
      return [];
    }

    return [{
      type: 'update',
      path: page.path,
      title: page.title,
      content: correctedContent,
      confidenceDelta: 0.15,  // Boost confidence after correction
      agentRunId: '',  // Set by executor
    }];
  }

  private async generateCorrection(
    finding: Finding,
    page: WikiPage,
    sourceContent: string,
    context: AgentContext
  ): Promise<string | null> {
    const prompt = this.buildCorrectionPrompt(finding, page, sourceContent);

    const completion = await context.llm.complete({
      system: CORRECTION_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      maxTokens: 2000,
      temperature: 0.3,
    });

    return this.parseCorrection(completion.content);
  }

  private buildCorrectionPrompt(
    finding: Finding,
    page: WikiPage,
    sourceContent: string
  ): string {
    const metadata = finding.metadata!;

    return `## Task

Correct inaccurate content in a wiki page based on actual source code.

## The Inaccuracy

**Incorrect claim:** ${metadata.claim || finding.description}

**Source file:** ${metadata.sourceFile}

**What the code actually shows:**
\`\`\`
${sourceContent.slice(0, 3000)}
\`\`\`

## Current Wiki Page

**Path:** ${page.path}
**Title:** ${page.title}

**Content:**
${page.content}

## Instructions

1. Locate the inaccurate claim in the wiki content
2. Replace it with accurate information based on the source code
3. Preserve the overall structure and other content
4. Make the correction clearly sourced from the code

## Required Output

CORRECTED_CONTENT:
[The full corrected page content]

CHANGES_MADE:
[Brief description of what was corrected]
`;
  }

  private parseCorrection(response: string): string | null {
    const match = response.match(/CORRECTED_CONTENT:\s*([\s\S]*?)(?=CHANGES_MADE:|$)/i);
    return match?.[1]?.trim() || null;
  }
}

const CORRECTION_SYSTEM_PROMPT = `You correct inaccurate wiki documentation based on source code.

Guidelines:
- Make minimal changes - only fix the inaccuracy
- Preserve the page structure and other content
- Use specific details from the source code
- Include code snippets where helpful
- Cite the source file for transparency

Do NOT:
- Rewrite the entire page
- Add speculation beyond what the code shows
- Remove content that isn't related to the inaccuracy
`;
```

### Step 3: Register the Handler

```typescript
// src/agents/consolidation/finding-handler-registry.ts

import { InaccuracyHandler } from './handlers/inaccuracy-handler.js';

export function createDefaultHandlerRegistry(): FindingHandlerRegistry {
  const registry = new FindingHandlerRegistry();

  registry.register(new DuplicateHandler());
  registry.register(new BrokenLinkHandler());
  registry.register(new TerminologyHandler());
  registry.register(new OrphanedPageHandler());
  registry.register(new CategoryMismatchHandler());
  registry.register(new ContradictionHandler());
  registry.register(new InaccuracyHandler());  // NEW

  return registry;
}
```

### Step 4: Export the Handler

```typescript
// src/agents/consolidation/handlers/index.ts

export { BrokenLinkHandler } from './broken-link-handler.js';
export { CategoryMismatchHandler } from './category-mismatch-handler.js';
export { ContradictionHandler } from './contradiction-handler.js';
export { DuplicateHandler } from './duplicate-handler.js';
export { OrphanedPageHandler } from './orphaned-page-handler.js';
export { TerminologyHandler } from './terminology-handler.js';
export { InaccuracyHandler } from './inaccuracy-handler.js';  // NEW
```

## Finding Creation Example

When SourceVerificationAgent detects an inaccuracy:

```typescript
// In SourceVerificationAgent.verifyClaim()

if (!verification.accurate) {
  return createFinding({
    id: uuid(),
    wikiId: context.wikiId,
    repoId: context.repoId,
    sourceAgentRunId: agentRunId,
    type: 'inaccurate',
    description: `Claim "${claim.text}" does not match source code in ${claim.filePath}`,
    affectedPaths: [page.path],
    severity: this.getSeverity(claim),
    metadata: {
      claim: claim.text,
      sourceFile: claim.filePath,
      actualBehavior: verification.actual,
      codeSnippet: verification.evidence,
    },
  });
}
```

## Consolidation Flow

```
1. SourceVerificationAgent detects inaccuracy
                ↓
2. Creates Finding { type: 'inaccurate', metadata: {...} }
                ↓
3. Finding saved to FindingsRepository
                ↓
4. Orchestrator schedules ConsolidationAgent work
                ↓
5. ConsolidationAgent.run()
   - Groups findings by type
   - For 'inaccurate' findings:
     - registry.getHandler('inaccurate') → InaccuracyHandler
     - handler.handle(finding, context, page)
                ↓
6. InaccuracyHandler
   - Reads source file via tools
   - Generates corrected content via LLM
   - Returns WikiPageUpdate
                ↓
7. Wiki page updated with accurate content
8. Finding marked as 'addressed'
```

## Test Cases

```typescript
// tests/integration/inaccuracy-handler.test.ts

describe('InaccuracyHandler', () => {
  it('should correct inaccurate claims based on source', async () => {
    const finding = createFinding({
      type: 'inaccurate',
      description: 'JWT claim is incorrect',
      affectedPaths: ['architecture/auth'],
      metadata: {
        claim: 'Uses JWT tokens for authentication',
        sourceFile: 'src/auth/session.ts',
        actualBehavior: 'Uses cookie-based sessions',
      },
    });

    const page = createWikiPage({
      path: 'architecture/auth',
      content: 'The auth system uses JWT tokens for authentication.',
    });

    // Mock source file content
    mockLLM.addFileContent('src/auth/session.ts', `
      export class SessionManager {
        createSession(userId: string): Cookie {
          return { name: 'session', value: encrypt(userId), httpOnly: true };
        }
      }
    `);

    const updates = await handler.handle(finding, context, page);

    expect(updates).toHaveLength(1);
    expect(updates[0].content).toContain('cookie-based sessions');
    expect(updates[0].content).not.toContain('JWT tokens');
  });

  it('should preserve unrelated content', async () => {
    // Page has multiple sections, only one is inaccurate
    const page = createWikiPage({
      content: `
        # Authentication

        The auth system uses JWT tokens.  // Inaccurate

        ## Authorization

        Permissions are role-based.  // Accurate - should be preserved
      `,
    });

    const updates = await handler.handle(finding, context, page);

    expect(updates[0].content).toContain('Permissions are role-based');
  });

  it('should handle missing source file gracefully', async () => {
    const finding = createFinding({
      metadata: { sourceFile: 'src/nonexistent.ts' },
    });

    const updates = await handler.handle(finding, context, page);

    expect(updates).toHaveLength(0);  // No update if can't verify
  });
});
```

## Priority Considerations

The `inaccurate` finding type should be **high priority** (95):

```typescript
export const FindingPriority: Record<FindingType, number> = {
  contradiction: 100,     // Highest - two pages disagree
  inaccurate: 95,         // Very high - wiki disagrees with code
  broken_link: 90,
  duplicate_title: 80,
  // ...
};
```

Rationale:
- Inaccuracies damage trust in documentation
- Users may make wrong decisions based on incorrect info
- Security/auth inaccuracies could be dangerous

## Metrics to Track

After implementing:

- **Inaccuracy detection rate**: Findings of type 'inaccurate' created
- **Correction success rate**: % of inaccuracy findings successfully addressed
- **Inaccuracy sources**: Which original agents produce most inaccuracies
- **Time to correction**: How long between detection and fix
- **Regression rate**: Previously-corrected pages becoming inaccurate again

## Related Files

- `src/domain/finding.ts` - Finding type definitions
- `src/agents/consolidation/finding-handler-registry.ts` - Handler registration
- `src/agents/consolidation/handlers/` - Existing handlers
- `src/agents/consolidation/consolidation-agent.ts` - Main consolidation logic
