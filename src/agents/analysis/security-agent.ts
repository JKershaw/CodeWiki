import type { Agent, AgentContext, AgentRunResult, WorkTarget } from '../base-agent.js';
import { createAgentResult, createFinding, isCommitTarget, extractToolMetrics } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';
import { createGetCommitQuery, handleGetCommit } from '../../queries/index.js';
import { getCommitDiff, createCodebaseToolExecutor } from '../agent-helpers.js';
import {
  createParseContext,
  parseSection,
  parseChoice,
  parseListItemsWithFallback,
  parseStringList,
  parseConfidence,
  mapSeverity,
  type ItemPattern,
} from '../parsing/index.js';

/**
 * Security Agent - Audits commits for security-relevant changes.
 *
 * This agent looks for authentication/authorization changes, cryptographic
 * code, input validation, security configurations, and potential vulnerabilities.
 */
export class SecurityAgent implements Agent {
  readonly type: AgentType = 'security';

  getSystemPrompt(): string {
    return SYSTEM_PROMPT;
  }

  canHandle(target: WorkTarget): boolean {
    return isCommitTarget(target);
  }

  async run(target: WorkTarget, context: AgentContext): Promise<AgentRunResult> {
    if (!isCommitTarget(target)) {
      throw new Error(`SecurityAgent cannot handle target type: ${target.type}`);
    }
    return this.runOnCommit(target.commitId, context);
  }

  async runOnCommit(commitId: string, context: AgentContext): Promise<AgentRunResult> {
    // Get the commit via CQRS query
    const commitQuery = createGetCommitQuery(commitId);
    const commitResult = await handleGetCommit(commitQuery, context.repos);
    if (!commitResult.success || !commitResult.data) {
      throw new Error(`Commit not found: ${commitId}`);
    }
    const commit = commitResult.data;

    const diff = await getCommitDiff(context, commit.sha);
    const prompt = this.buildPrompt(commit, diff);

    // Set up codebase exploration tools for verification
    const toolExecutor = createCodebaseToolExecutor(context);

    const completion = await context.llm.completeWithTools({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
      tools: toolExecutor?.tools.map(t => ({
        name: t.name,
        description: t.description,
        inputSchema: t.inputSchema,
      })) ?? [],
      executeTools: toolExecutor?.executeTools ?? (async () => []),
      maxToolRounds: 5,
      maxTokens: 2000,
      temperature: 0.2, // Lower temperature for security analysis
    });

    const analysis = this.parseResponse(completion.content);
    const updates = this.generateUpdates(commit, analysis);

    return {
      result: createAgentResult({
        summary: analysis.summary,
        findings: analysis.findings.map(f => createFinding({
          type: f.type,
          description: f.description,
          relatedPaths: f.paths,
          importance: f.importance,
        })),
        confidence: analysis.confidence,
      }),
      updates,
      costUsd: completion.costUsd,
      toolMetrics: extractToolMetrics(completion),
    };
  }

  private buildPrompt(commit: { sha: string; message: string; authorName: string; committedAt: Date; diffSummary: { affectedFiles: string[]; linesAdded: number; linesDeleted: number } }, diff: string): string {
    const truncatedDiff = diff.length > 12000 ? diff.slice(0, 12000) + '\n... (diff truncated)' : diff;

    return `Perform a security audit of this commit.

## Commit Information

**SHA:** ${commit.sha.slice(0, 8)}
**Message:** ${commit.message}
**Author:** ${commit.authorName}
**Date:** ${commit.committedAt.toISOString()}
**Files Changed:** ${commit.diffSummary.affectedFiles.length}
**Lines:** +${commit.diffSummary.linesAdded} / -${commit.diffSummary.linesDeleted}

## Affected Files

${commit.diffSummary.affectedFiles.map(f => `- ${f}`).join('\n')}

## Diff

\`\`\`diff
${truncatedDiff}
\`\`\`

## Available Tools

You have access to tools to explore the source code:
- **read_file**: Read source files to verify security implementations
- **search_files**: Find files by pattern to locate security-related code
- **list_directory**: Explore project structure

**Use these tools to**:
- Read the full file to understand the complete security context
- Verify how authentication/authorization is implemented
- Check for proper input validation patterns
- Find related security configurations
- Trace data flow for potential injection vectors

Analyze for:
1. Authentication/authorization changes
2. Cryptographic code (hashing, encryption, keys)
3. Input validation and sanitization
4. Security configuration changes
5. Secrets or credentials handling
6. SQL injection, XSS, CSRF vulnerabilities
7. File/path traversal risks
8. Dependency security implications
9. Access control changes
10. Audit logging changes

Format your response as:

SUMMARY:
[Brief security assessment of the commit]

SECURITY_RELEVANCE:
[One of: critical, high, medium, low, none]

FINDINGS:
- [CATEGORY] [SEVERITY:critical/high/medium/low] [Description] [Affected paths]

VULNERABILITIES:
- [Vulnerability type] [Description] [CWE if known]

RECOMMENDATIONS:
- [Recommendation for improving security]

WIKI_UPDATES:
- [PAGE_PATH] [ACTION:create/update] [Content description]

CONFIDENCE: [0-1 value]
`;
  }

  private parseResponse(response: string): ParsedAnalysis {
    const ctx = createParseContext('security', response);

    // Parse summary
    const summary = parseSection(ctx, 'SUMMARY', /SUMMARY:\s*([\s\S]*?)(?=SECURITY_RELEVANCE:|FINDINGS:|$)/i) ?? '';

    // Parse security relevance using parseChoice
    const securityRelevance = parseChoice(
      ctx,
      'SECURITY_RELEVANCE',
      /SECURITY_RELEVANCE:\s*(\w+)/i,
      ['critical', 'high', 'medium', 'low', 'none'] as const,
      { defaultValue: 'none' }
    ) ?? 'none';

    // Define finding patterns
    const findingPatterns: ItemPattern<ParsedAnalysis['findings'][0]>[] = [
      {
        pattern: /^-\s*\[([^\]]+)\]\s*\[SEVERITY:(\w+)\]\s*(.+?)(?:\s*\[([^\]]*)\])?$/i,
        mapper: (m) => ({
          type: m[1]!.trim(),
          importance: mapSeverity(m[2]!),
          description: m[3]!.trim(),
          paths: m[4]?.split(',').map(p => p.trim()).filter(p => p) ?? [],
        }),
      },
    ];

    const findings = parseListItemsWithFallback(
      ctx,
      'FINDINGS',
      /FINDINGS:\s*([\s\S]*?)(?=VULNERABILITIES:|RECOMMENDATIONS:|WIKI_UPDATES:|CONFIDENCE:|$)/i,
      findingPatterns
    );

    // Parse vulnerabilities as string list
    const vulnerabilities = parseStringList(
      ctx,
      'VULNERABILITIES',
      /VULNERABILITIES:\s*([\s\S]*?)(?=RECOMMENDATIONS:|WIKI_UPDATES:|CONFIDENCE:|$)/i
    );

    // Parse recommendations as string list
    const recommendations = parseStringList(
      ctx,
      'RECOMMENDATIONS',
      /RECOMMENDATIONS:\s*([\s\S]*?)(?=WIKI_UPDATES:|CONFIDENCE:|$)/i
    );

    // Define wiki update patterns
    const wikiUpdatePatterns: ItemPattern<ParsedAnalysis['wikiUpdates'][0]>[] = [
      {
        pattern: /^-\s*\[([^\]]+)\]\s*\[(create|update)\]\s*(.+)$/i,
        mapper: (m) => ({
          path: m[1]!.trim(),
          action: m[2]!.toLowerCase() as 'create' | 'update',
          description: m[3]!.trim(),
        }),
      },
    ];

    const wikiUpdates = parseListItemsWithFallback(
      ctx,
      'WIKI_UPDATES',
      /WIKI_UPDATES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i,
      wikiUpdatePatterns
    );

    // Parse confidence
    const confidence = parseConfidence(ctx, { defaultValue: 0.5 });

    return {
      summary,
      securityRelevance,
      findings,
      vulnerabilities,
      recommendations,
      wikiUpdates,
      confidence,
    };
  }

  private generateUpdates(
    commit: { sha: string; message: string; diffSummary: { affectedFiles: string[] } },
    analysis: ParsedAnalysis
  ): WikiPageUpdate[] {
    const updates: WikiPageUpdate[] = [];

    // Only create wiki content for security-relevant commits
    if (analysis.securityRelevance === 'none') {
      return updates;
    }

    // Create security audit page for significant findings
    if (analysis.securityRelevance === 'critical' || analysis.securityRelevance === 'high' ||
        analysis.vulnerabilities.length > 0) {
      const pagePath = `security/audit-${commit.sha.slice(0, 8)}`;

      const content = `# Security Audit: Commit ${commit.sha.slice(0, 8)}

**Relevance Level:** ${analysis.securityRelevance.toUpperCase()}

## Summary

${analysis.summary}

## Findings

${analysis.findings.map(f => `### ${f.type} (${f.importance})

${f.description}

${f.paths.length > 0 ? `**Affected files:** ${f.paths.map(p => `\`${p}\``).join(', ')}` : ''}`).join('\n\n')}

${analysis.vulnerabilities.length > 0 ? `## Potential Vulnerabilities

${analysis.vulnerabilities.map(v => `- ${v}`).join('\n')}` : ''}

${analysis.recommendations.length > 0 ? `## Recommendations

${analysis.recommendations.map(r => `- ${r}`).join('\n')}` : ''}

## Files Reviewed

${commit.diffSummary.affectedFiles.map(f => `- \`${f}\``).join('\n')}

---
*Security audit from commit ${commit.sha.slice(0, 8)}*
`;

      updates.push({
        type: 'create',
        path: pagePath,
        content,
        sourceCommitId: commit.sha,
        agentRunId: '',
        confidenceDelta: analysis.securityRelevance === 'critical' ? 0.5 : 0.3,
      });
    }

    // Update security overview page
    if (analysis.findings.length > 0) {
      updates.push({
        type: 'update',
        path: 'security/overview',
        content: `# Security Overview

## Recent Security Changes

- **${commit.sha.slice(0, 8)}** (${analysis.securityRelevance}): ${analysis.summary.slice(0, 100)}

${analysis.recommendations.length > 0 ? `## Security Recommendations

${analysis.recommendations.map(r => `- ${r}`).join('\n')}` : ''}

---
*Last updated from commit ${commit.sha.slice(0, 8)}*
`,
        sourceCommitId: commit.sha,
        agentRunId: '',
        confidenceDelta: 0.1,
      });
    }

    return updates;
  }
}

type SecurityRelevance = 'critical' | 'high' | 'medium' | 'low' | 'none';

interface ParsedAnalysis {
  summary: string;
  securityRelevance: SecurityRelevance;
  findings: Array<{
    type: string;
    importance: 'low' | 'medium' | 'high';
    description: string;
    paths: string[];
  }>;
  vulnerabilities: string[];
  recommendations: string[];
  wikiUpdates: Array<{
    path: string;
    action: 'create' | 'update';
    description: string;
  }>;
  confidence: number;
}


const SYSTEM_PROMPT = `You are a security audit agent for CodeWiki, a system that generates living documentation from Git repositories.

Your job is to analyze commits for security implications.

## CRITICAL: Verify Before Documenting

You have access to tools (read_file, search_files, list_directory) to explore the source code. USE THEM:

1. **Read the full file** to understand the complete security context, not just the diff
2. **Trace data flow** by reading related files to identify actual injection vectors
3. **Verify authentication/authorization** implementations by reading the full auth code
4. **Check security configurations** in related config files

If you cannot verify a security concern, note it as "potential" or "needs review" rather than definitive.

Look for:

1. **Authentication & Authorization**: Login flows, session management, role-based access
2. **Cryptography**: Hashing algorithms, encryption, key management, secure random
3. **Input Validation**: Sanitization, escaping, parameterized queries
4. **Configuration**: Security headers, CORS, CSP, secrets management
5. **Vulnerabilities**: OWASP Top 10, injection, XSS, CSRF, path traversal
6. **Dependencies**: Known vulnerable packages, security updates
7. **Audit Trail**: Logging of security events, access logs

Security Relevance Levels:
- **critical**: Direct vulnerability, exposed credentials, broken authentication
- **high**: Security-sensitive code changes, crypto implementation
- **medium**: Input handling, authorization logic, security configuration
- **low**: Minor security-adjacent changes, documentation
- **none**: No security relevance

Be thorough but avoid false positives. Focus on actual security implications rather than stylistic concerns.

Your confidence should reflect:
- 0.9+: Clear security issue or secure implementation
- 0.7-0.9: Security-relevant code with minor uncertainty
- 0.5-0.7: Potentially security-relevant, needs review
- <0.5: Uncertain security implications`;
