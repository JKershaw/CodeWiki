import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isWikiTarget } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPage } from '../../domain/wiki-page.js';
import { createFinding as createDomainFinding } from '../../domain/finding.js';
import { createListWikiPagesQuery, handleListWikiPages } from '../../queries/index.js';
import { createCodebaseToolExecutor } from '../agent-helpers.js';
import { randomUUID } from 'crypto';

/**
 * Source Verification Agent - Verifies wiki content matches actual source code.
 *
 * This meta-agent:
 * - Extracts verifiable claims from wiki pages (file paths, function signatures, behaviors)
 * - Reads the referenced source code using tools
 * - Compares claims to actual implementation
 * - Creates 'inaccurate' findings for mismatches
 *
 * Unlike other meta-agents, this one verifies wiki-to-source accuracy,
 * not just wiki-internal consistency.
 */
export class SourceVerificationAgent implements Agent {
  readonly type: AgentType = 'source-verification';

  // Configuration
  private readonly MAX_PAGES_PER_RUN = 5;
  private readonly MAX_CLAIMS_PER_PAGE = 5;
  private readonly LOW_CONFIDENCE_THRESHOLD = 0.6;

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isWikiTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isWikiTarget(target)) {
      throw new Error(`SourceVerificationAgent cannot handle target type: ${target.type}`);
    }
    return this.runOnWiki(context);
  }

  async runOnCommit(_commitId: string, _context: AgentContext): Promise<AgentRunResult> {
    throw new Error('SourceVerificationAgent does not run on commits. Use run() with WikiTarget instead.');
  }

  async runOnWiki(context: AgentContext): Promise<AgentRunResult> {
    // Check if we have tool access for source verification
    const toolExecutor = createCodebaseToolExecutor(context);
    if (!toolExecutor) {
      return {
        result: createAgentResult({
          summary: 'Cannot verify sources: no tool executor available (GitHub repo without local access)',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Get wiki pages via CQRS query
    const pagesQuery = createListWikiPagesQuery(context.wikiId);
    const pagesResult = await handleListWikiPages(pagesQuery, context.repos);
    const pages = pagesResult.data || [];

    if (pages.length < 2) {
      return {
        result: createAgentResult({
          summary: 'Not enough pages for source verification',
          findings: [],
          confidence: 1.0,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    // Select pages that likely have verifiable claims
    const pagesToVerify = this.selectPagesForVerification(pages);

    if (pagesToVerify.length === 0) {
      return {
        result: createAgentResult({
          summary: 'No pages with verifiable code claims found',
          findings: [],
          confidence: 0.9,
        }),
        updates: [],
        costUsd: 0,
      };
    }

    let totalCost = 0;
    const inaccuracyFindings: InaccuracyFinding[] = [];

    for (const page of pagesToVerify) {
      // Extract verifiable claims from the page
      const { claims, cost: extractCost } = await this.extractClaims(page, context);
      totalCost += extractCost;

      // Verify each claim against source code
      for (const claim of claims.slice(0, this.MAX_CLAIMS_PER_PAGE)) {
        const { accurate, reason, evidence, cost: verifyCost } = await this.verifyClaim(
          claim,
          toolExecutor,
          context
        );
        totalCost += verifyCost;

        if (!accurate) {
          inaccuracyFindings.push({
            pagePath: page.path,
            claim: claim.text,
            sourceFile: claim.filePath || 'unknown',
            reason,
            evidence,
            severity: this.getSeverity(claim),
          });
        }
      }
    }

    // Create domain findings for inaccuracies
    const domainFindings = inaccuracyFindings.map(f =>
      createDomainFinding({
        id: randomUUID(),
        wikiId: context.wikiId,
        repoId: context.repoId,
        sourceAgentRunId: '', // Set by executor
        type: 'inaccurate',
        description: f.reason,
        affectedPaths: [f.pagePath],
        severity: f.severity,
        metadata: {
          claim: f.claim,
          sourceFile: f.sourceFile,
          actualBehavior: f.reason,
          codeSnippet: f.evidence,
        },
      })
    );

    // Save findings to repository if any were found
    if (domainFindings.length > 0 && context.repos.findings) {
      for (const finding of domainFindings) {
        await context.repos.findings.save(finding);
      }
    }

    return {
      result: createAgentResult({
        summary: `Verified ${pagesToVerify.length} pages, found ${inaccuracyFindings.length} inaccuracies`,
        findings: inaccuracyFindings.map(f =>
          createFinding({
            type: 'INACCURATE',
            description: `${f.claim} - ${f.reason}`,
            relatedPaths: [f.pagePath, f.sourceFile],
            importance: f.severity,
          })
        ),
        confidence: 0.8,
      }),
      updates: [],
      costUsd: totalCost,
    };
  }

  private selectPagesForVerification(pages: WikiPage[]): WikiPage[] {
    // Prioritize pages that:
    // 1. Reference specific files (have backtick paths)
    // 2. Have lower confidence
    // 3. Aren't overview/index pages

    const scored = pages
      .filter(p => !p.path.includes('overview') && !p.path.includes('index'))
      .filter(p => this.hasCodeClaims(p.content))
      .map(page => ({
        page,
        score: this.calculateVerificationPriority(page),
      }));

    scored.sort((a, b) => b.score - a.score);

    return scored
      .slice(0, this.MAX_PAGES_PER_RUN)
      .map(s => s.page);
  }

  private calculateVerificationPriority(page: WikiPage): number {
    let score = 0;

    // Low confidence = high priority for verification
    if (page.confidence < this.LOW_CONFIDENCE_THRESHOLD) {
      score += 3;
    } else if (page.confidence < 0.8) {
      score += 1;
    }

    // More code references = more to verify
    const fileRefs = (page.content.match(/`[^`]+\.(ts|js|tsx|jsx)`/g) || []).length;
    score += Math.min(fileRefs, 3);

    // Code blocks with specific patterns
    if (/```(typescript|javascript)[\s\S]*?```/.test(page.content)) {
      score += 1;
    }

    return score;
  }

  private hasCodeClaims(content: string): boolean {
    // Look for file paths, function calls, code blocks
    return (
      /`[^`]+\.(ts|js|tsx|jsx)`/.test(content) ||
      /```(typescript|javascript)/.test(content) ||
      /function\s+\w+|class\s+\w+|const\s+\w+\s*=/.test(content)
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
        content: `Extract verifiable claims from this wiki page:\n\n**Title:** ${page.title}\n**Path:** ${page.path}\n\n${page.content}`,
      }],
      maxTokens: 1500,
      temperature: 0.3,
    });

    const claims = this.parseClaims(completion.content);
    return { claims, cost: completion.costUsd };
  }

  private parseClaims(response: string): Claim[] {
    const claims: Claim[] = [];

    // Parse claims in format:
    // CLAIM: [text]
    // FILE: [path]
    // TYPE: [type]
    const claimMatches = response.matchAll(
      /CLAIM:\s*(.+?)(?:\n|$)\s*FILE:\s*(.+?)(?:\n|$)\s*TYPE:\s*(\w+)/gi
    );

    for (const match of claimMatches) {
      claims.push({
        text: match[1]!.trim(),
        filePath: match[2]!.trim(),
        claimType: match[3]!.toLowerCase() as Claim['claimType'],
      });
    }

    return claims;
  }

  private async verifyClaim(
    claim: Claim,
    toolExecutor: NonNullable<ReturnType<typeof createCodebaseToolExecutor>>,
    context: AgentContext
  ): Promise<{ accurate: boolean; reason: string; evidence: string; cost: number }> {
    // First, try to read the source file
    let sourceContent = '';

    if (claim.filePath && claim.filePath !== 'unknown') {
      const results = await toolExecutor.executeTools([{
        id: 'read-source',
        name: 'read_file',
        input: { path: claim.filePath },
      }]);

      sourceContent = results[0]?.result || '';

      if (sourceContent.startsWith('Error')) {
        // File doesn't exist - this might be an inaccuracy
        return {
          accurate: false,
          reason: `Referenced file "${claim.filePath}" does not exist`,
          evidence: sourceContent,
          cost: 0,
        };
      }
    } else {
      // No file path specified, skip verification
      return {
        accurate: true,
        reason: 'No specific file referenced',
        evidence: '',
        cost: 0,
      };
    }

    // Use LLM to verify the claim against source code
    const completion = await context.llm.complete({
      system: VERIFICATION_PROMPT,
      messages: [{
        role: 'user',
        content: `Verify this claim against the source code:

**Claim:** "${claim.text}"
**File:** ${claim.filePath}

**Source code:**
\`\`\`
${sourceContent.slice(0, 3000)}
\`\`\`

Does the source code support this claim?`,
      }],
      maxTokens: 800,
      temperature: 0.2,
    });

    const result = this.parseVerification(completion.content);
    return { ...result, cost: completion.costUsd };
  }

  private parseVerification(response: string): { accurate: boolean; reason: string; evidence: string } {
    const accurateMatch = response.match(/ACCURATE:\s*(true|false)/i);
    const reasonMatch = response.match(/REASON:\s*(.+?)(?=EVIDENCE:|$)/is);
    const evidenceMatch = response.match(/EVIDENCE:\s*(.+?)$/is);

    return {
      accurate: accurateMatch?.[1]?.toLowerCase() === 'true',
      reason: reasonMatch?.[1]?.trim() || 'Unable to verify claim',
      evidence: evidenceMatch?.[1]?.trim() || '',
    };
  }

  private getSeverity(claim: Claim): 'high' | 'medium' | 'low' {
    // Security/auth claims are high severity
    if (/auth|security|password|token|credential|encrypt|secret/i.test(claim.text)) {
      return 'high';
    }
    // API/interface claims are medium
    if (/api|interface|function|method|parameter|return/i.test(claim.text)) {
      return 'medium';
    }
    return 'low';
  }
}

interface Claim {
  text: string;
  filePath?: string;
  claimType: 'existence' | 'behavior' | 'signature' | 'constant';
}

interface InaccuracyFinding {
  pagePath: string;
  claim: string;
  sourceFile: string;
  reason: string;
  evidence: string;
  severity: 'high' | 'medium' | 'low';
}

const SYSTEM_PROMPT = `You are a Source Verification Agent for CodeWiki. Your job is to verify that wiki documentation accurately reflects the actual source code.

Unlike quality checks that assess writing style, you verify FACTUAL ACCURACY:
- Does the wiki correctly describe what files exist?
- Do function signatures match the actual code?
- Are behavioral claims (e.g., "retries 3 times") accurate?
- Do constant values match the code?

You use tools to read actual source files and compare them to wiki claims.

When you find inaccuracies, you create findings that describe:
1. What the wiki claims
2. What the code actually shows
3. The severity of the mismatch`;

const CLAIM_EXTRACTION_PROMPT = `You extract verifiable technical claims from wiki documentation.

A verifiable claim is a statement that can be checked against source code:
- File existence: "The config is stored in src/config.ts"
- Function signatures: "authenticate(user: string, password: string)"
- Behaviors: "Retries up to 3 times with exponential backoff"
- Constants: "Default timeout is 5000ms"
- Dependencies: "Uses Redis for session storage"

For each claim, output in this exact format:
CLAIM: [the exact claim text from the wiki]
FILE: [file path if mentioned, or "unknown" if not specified]
TYPE: [existence|behavior|signature|constant]

Skip:
- Vague claims ("the system is fast")
- Subjective statements ("this is a good pattern")
- Claims about wiki structure or organization
- High-level architecture descriptions without specific code references

Focus on claims that reference specific files, functions, or behaviors.`;

const VERIFICATION_PROMPT = `You verify technical claims against source code.

Given a claim and the actual source code:
1. Determine if the claim is accurate based on the code
2. If inaccurate, explain what the code actually shows
3. Provide evidence from the code

Output in this exact format:
ACCURATE: [true|false]
REASON: [Explanation - if accurate, briefly confirm; if not, explain the mismatch]
EVIDENCE: [Relevant code snippet or specific line that proves/disproves the claim]

Be strict: if the claim says "X uses Y" but the code shows "X uses Z", that's inaccurate.
Be lenient on minor wording differences if the meaning is the same.`;
