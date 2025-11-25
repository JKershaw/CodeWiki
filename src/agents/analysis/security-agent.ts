import type { Agent, AgentContext, AgentRunResult } from '../base-agent.js';
import { createAgentResult, createFinding } from '../base-agent.js';
import type { AgentType } from '../../domain/agent-run.js';
import type { WikiPageUpdate } from '../../domain/wiki-page.js';

/**
 * Security Agent - Audits commits for security-relevant changes.
 *
 * This agent looks for authentication/authorization changes, cryptographic
 * code, input validation, security configurations, and potential vulnerabilities.
 */
export class SecurityAgent implements Agent {
  readonly type: AgentType = 'security';

  async runOnCommit(commitId: string, context: AgentContext): Promise<AgentRunResult> {
    const commit = await context.repos.commits.findById(commitId);
    if (!commit) {
      throw new Error(`Commit not found: ${commitId}`);
    }

    const diff = await context.git.getCommitDiff(context.repoId, commit.sha);
    const prompt = this.buildPrompt(commit, diff);

    const completion = await context.llm.complete({
      system: SYSTEM_PROMPT,
      messages: [{ role: 'user', content: prompt }],
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
    const analysis: ParsedAnalysis = {
      summary: '',
      securityRelevance: 'none',
      findings: [],
      vulnerabilities: [],
      recommendations: [],
      wikiUpdates: [],
      confidence: 0.5,
    };

    // Parse summary
    const summaryMatch = response.match(/SUMMARY:\s*([\s\S]*?)(?=SECURITY_RELEVANCE:|FINDINGS:|$)/i);
    if (summaryMatch) {
      analysis.summary = summaryMatch[1]!.trim();
    }

    // Parse security relevance
    const relevanceMatch = response.match(/SECURITY_RELEVANCE:\s*(\w+)/i);
    if (relevanceMatch) {
      analysis.securityRelevance = relevanceMatch[1]!.toLowerCase() as SecurityRelevance;
    }

    // Parse findings
    const findingsMatch = response.match(/FINDINGS:\s*([\s\S]*?)(?=VULNERABILITIES:|RECOMMENDATIONS:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
    if (findingsMatch) {
      const findingLines = findingsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of findingLines) {
        const match = line.match(/^-\s*\[([^\]]+)\]\s*\[SEVERITY:(\w+)\]\s*(.+?)(?:\s*\[([^\]]*)\])?$/i);
        if (match) {
          analysis.findings.push({
            type: match[1]!.trim(),
            importance: mapSeverityToImportance(match[2]!.toLowerCase()),
            description: match[3]!.trim(),
            paths: match[4]?.split(',').map(p => p.trim()).filter(p => p) ?? [],
          });
        }
      }
    }

    // Parse vulnerabilities
    const vulnsMatch = response.match(/VULNERABILITIES:\s*([\s\S]*?)(?=RECOMMENDATIONS:|WIKI_UPDATES:|CONFIDENCE:|$)/i);
    if (vulnsMatch) {
      const vulnLines = vulnsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of vulnLines) {
        analysis.vulnerabilities.push(line.replace(/^-\s*/, '').trim());
      }
    }

    // Parse recommendations
    const recsMatch = response.match(/RECOMMENDATIONS:\s*([\s\S]*?)(?=WIKI_UPDATES:|CONFIDENCE:|$)/i);
    if (recsMatch) {
      const recLines = recsMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of recLines) {
        analysis.recommendations.push(line.replace(/^-\s*/, '').trim());
      }
    }

    // Parse wiki updates
    const updatesMatch = response.match(/WIKI_UPDATES:\s*([\s\S]*?)(?=CONFIDENCE:|$)/i);
    if (updatesMatch) {
      const updateLines = updatesMatch[1]!.trim().split('\n').filter(l => l.startsWith('-'));
      for (const line of updateLines) {
        const match = line.match(/^-\s*\[([^\]]+)\]\s*\[(create|update)\]\s*(.+)$/i);
        if (match) {
          analysis.wikiUpdates.push({
            path: match[1]!.trim(),
            action: match[2]!.toLowerCase() as 'create' | 'update',
            description: match[3]!.trim(),
          });
        }
      }
    }

    // Parse confidence
    const confidenceMatch = response.match(/CONFIDENCE:\s*([\d.]+)/i);
    if (confidenceMatch) {
      analysis.confidence = parseFloat(confidenceMatch[1]!);
    }

    return analysis;
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

function mapSeverityToImportance(severity: string): 'low' | 'medium' | 'high' {
  if (severity === 'critical' || severity === 'high') return 'high';
  if (severity === 'medium') return 'medium';
  return 'low';
}

const SYSTEM_PROMPT = `You are a security audit agent for CodeWiki, a system that generates living documentation from Git repositories.

Your job is to analyze commits for security implications. Look for:

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
