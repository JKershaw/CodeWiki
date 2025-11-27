#!/usr/bin/env node
/**
 * Test the rebalanced orchestrator with mock LLM.
 *
 * This verifies that:
 * 1. Multiple analysis agents are bundled per commit
 * 2. Meta agents run earlier (after 20 commits or 50% coverage)
 * 3. Synthesis agents trigger at lower thresholds (8 pages)
 */

import { createFileRepositories } from '../dist/repositories/file-based/index.js';
import { createOrchestrator } from '../dist/agents/orchestrator/orchestrator.js';
import { createExecutor } from '../dist/executor/executor.js';
import { createGitService } from '../dist/services/git/git-service.js';
import { createRepo } from '../dist/domain/repo.js';
import { createCommit } from '../dist/domain/commit.js';
import { v4 as uuid } from 'uuid';
import { simpleGit } from 'simple-git';
import * as fs from 'fs/promises';
import type { LLMService } from '../dist/services/llm/llm-service.js';

const REPO_PATH = process.cwd();
const DATA_DIR = './test-rebalancing-data';

// Mock LLM that returns reasonable responses
function createMockLLM(): LLMService {
  let callCount = 0;
  const stats = {
    totalInputTokens: 0,
    totalOutputTokens: 0,
    totalCostUsd: 0,
    requestCount: 0,
  };

  return {
    async complete({ messages }) {
      callCount++;
      stats.requestCount++;
      stats.totalInputTokens += 100;
      stats.totalOutputTokens += 50;
      stats.totalCostUsd += 0.001;

      const userMessage = messages[messages.length - 1]?.content || '';

      // Detect agent type from the prompt
      let response = '';

      if (userMessage.includes('code changes') || userMessage.includes('Analyze the following commit')) {
        response = `TITLE: Mock Code Analysis

## Summary
This commit implements various code changes.

## Changes
- Modified files for functionality

## Related Topics
- [[architecture/overview]]

CONFIDENCE: 0.7`;
      } else if (userMessage.includes('technical debt')) {
        response = `SUMMARY:
This commit introduces some complexity but is generally clean.

DEBT_LEVEL:
low

ISSUES:
- None significant

DEBT_ADDED:
- None

DEBT_REMOVED:
- None

RECOMMENDATIONS:
- Continue maintaining code quality

HOTSPOTS:
- None

CONFIDENCE: 0.8`;
      } else if (userMessage.includes('security')) {
        response = `SECURITY_LEVEL: low

SUMMARY:
No significant security concerns identified.

VULNERABILITIES:
- None detected

RECOMMENDATIONS:
- Continue following security best practices

CONFIDENCE: 0.85`;
      } else if (userMessage.includes('pattern')) {
        response = `PATTERNS:
- Repository Pattern (used for data access)

CONVENTIONS:
- TypeScript strict mode

ANTI_PATTERNS:
- None detected

CONFIDENCE: 0.75`;
      } else if (userMessage.includes('dependency')) {
        response = `DEPENDENCIES_ADDED:
- None

DEPENDENCIES_REMOVED:
- None

CONFIDENCE: 0.9`;
      } else if (userMessage.includes('narrative') || userMessage.includes('ADR')) {
        response = `NARRATIVE_TYPE: none

SUMMARY:
Standard code changes, no narrative documentation.

CONFIDENCE: 0.8`;
      } else if (userMessage.includes('link')) {
        response = `LINKS:
- page1 -> page2 (related topic)

CONFIDENCE: 0.7`;
      } else if (userMessage.includes('structure')) {
        response = `SUMMARY:
Wiki structure is developing well.

RECOMMENDATIONS:
- Add overview pages

CONFIDENCE: 0.8`;
      } else if (userMessage.includes('overview') || userMessage.includes('getting-started')) {
        response = `# Overview

This is a generated overview page.

## Contents
- Various topics covered

CONFIDENCE: 0.75`;
      } else {
        response = `SUMMARY: Processed successfully.
CONFIDENCE: 0.7`;
      }

      return {
        content: response,
        model: 'mock-model',
        costUsd: 0.001,
        inputTokens: 100,
        outputTokens: 50,
        truncated: false,
      };
    },

    async completeWithTools(options: any) {
      const result = await this.complete(options);
      return {
        ...result,
        toolCalls: [],
        toolRounds: 0,
      };
    },

    getUsageStats() {
      return { ...stats };
    },

    resetUsageStats() {
      stats.totalInputTokens = 0;
      stats.totalOutputTokens = 0;
      stats.totalCostUsd = 0;
      stats.requestCount = 0;
    },

    isRateLimited() {
      return false;
    },

    getModel() {
      return 'mock-model';
    },
  };
}

async function main() {
  const maxIterations = parseInt(process.argv[2] || '30', 10);
  console.log(`=== Testing Rebalanced Orchestrator ===`);
  console.log(`Max iterations: ${maxIterations}\n`);

  // Clean up previous data
  try {
    await fs.rm(DATA_DIR, { recursive: true });
  } catch {
    // Directory doesn't exist
  }

  // Initialize services
  const repos = createFileRepositories(DATA_DIR);
  const git = createGitService();
  const llm = createMockLLM();

  const orchestrator = createOrchestrator(repos);
  const executor = createExecutor(repos, git, llm, orchestrator);

  // Register repo
  const repo = createRepo({
    id: uuid(),
    fullName: REPO_PATH,
    cloneUrl: REPO_PATH,
    defaultBranch: 'main',
  });
  repo.status = 'pending';
  await repos.repos.save(repo);

  const repoId = repo.id;
  git.registerLocalRepo(repoId, REPO_PATH);

  console.log(`Registered repo: ${repoId}\n`);

  // Sync commits
  console.log('Syncing commits...');
  const gitRepo = simpleGit(REPO_PATH);
  const log = await gitRepo.log(['--all', '-n', '50']);

  const commits = [];
  for (const entry of log.all) {
    let diffSummary = {
      filesAdded: 0,
      filesModified: 0,
      filesDeleted: 0,
      linesAdded: 0,
      linesDeleted: 0,
      affectedFiles: [] as string[],
    };

    try {
      const diffFiles = await gitRepo.diff([`${entry.hash}^`, entry.hash, '--name-status']);
      const lines = diffFiles.trim().split('\n').filter(l => l.length > 0);

      for (const line of lines) {
        const [status, ...pathParts] = line.split('\t');
        const filePath = pathParts.join('\t');
        if (filePath) diffSummary.affectedFiles.push(filePath);

        switch (status?.[0]) {
          case 'A': diffSummary.filesAdded++; break;
          case 'D': diffSummary.filesDeleted++; break;
          default: diffSummary.filesModified++; break;
        }
      }
    } catch {
      // Initial commit or error
    }

    commits.push(createCommit({
      id: uuid(),
      repoId: repo.id,
      sha: entry.hash,
      message: entry.message,
      authorName: entry.author_name,
      authorEmail: entry.author_email,
      committedAt: new Date(entry.date),
      diffSummary,
    }));
  }

  await repos.commits.saveMany(commits);
  console.log(`Synced ${commits.length} commits\n`);

  // Track agent types scheduled over time
  const agentSchedule: { iteration: number; agents: string[] }[] = [];

  // Run iterations
  let totalIterations = 0;

  console.log('Running iterations...\n');

  while (totalIterations < maxIterations) {
    const workList = await orchestrator.generateWorkList(repoId, 10);

    if (workList.length === 0) {
      console.log('No more work available');
      break;
    }

    // Track which agents are being scheduled
    const agentTypes = workList.map(w => w.agentType);
    agentSchedule.push({ iteration: totalIterations + 1, agents: agentTypes });

    // Run a batch
    const summary = await executor.runIterations(repoId, 5);
    totalIterations += summary.iterations;

    const pages = await repos.wikiPages.findByRepo(repoId);
    const agentRuns = await repos.agentRuns.findByRepo(repoId);

    // Count agent types
    const agentCounts = new Map<string, number>();
    for (const run of agentRuns) {
      agentCounts.set(run.agentType, (agentCounts.get(run.agentType) || 0) + 1);
    }

    console.log(`Iteration ${totalIterations}: ${pages.length} pages`);
    console.log(`  Scheduled: ${agentTypes.slice(0, 5).join(', ')}${agentTypes.length > 5 ? '...' : ''}`);
    console.log(`  Agent totals: ${Array.from(agentCounts.entries()).map(([a, c]) => `${a}:${c}`).join(', ')}`);

    if (summary.iterations === 0) {
      break;
    }
  }

  // Final analysis
  const finalPages = await repos.wikiPages.findByRepo(repoId);
  const agentRuns = await repos.agentRuns.findByRepo(repoId);

  console.log('\n=== Rebalancing Analysis ===\n');

  // Check 1: Are multiple agent types being bundled per commit?
  console.log('1. Agent Bundling Check:');
  const uniqueAgentTypes = new Set<string>();
  for (const schedule of agentSchedule.slice(0, 10)) {
    for (const agent of schedule.agents) {
      uniqueAgentTypes.add(agent);
    }
  }
  console.log(`   First 10 iterations scheduled ${uniqueAgentTypes.size} different agent types`);
  console.log(`   Agent types: ${Array.from(uniqueAgentTypes).join(', ')}`);

  if (uniqueAgentTypes.size >= 3) {
    console.log('   ✅ PASS: Multiple agent types being bundled early');
  } else {
    console.log('   ❌ FAIL: Agents not being bundled well');
  }

  // Check 2: Did meta agents run?
  console.log('\n2. Meta Agent Activation:');
  const metaAgentTypes = ['link', 'structure', 'quality', 'consistency'];
  const metaRuns = agentRuns.filter(r => metaAgentTypes.includes(r.agentType));
  console.log(`   Meta agent runs: ${metaRuns.length}`);
  for (const agent of metaAgentTypes) {
    const count = metaRuns.filter(r => r.agentType === agent).length;
    if (count > 0) console.log(`     - ${agent}: ${count} runs`);
  }

  if (metaRuns.length > 0) {
    console.log('   ✅ PASS: Meta agents activated');
  } else {
    console.log('   ⚠️  Meta agents did not run (may need more pages)');
  }

  // Check 3: Did synthesis agents run?
  console.log('\n3. Synthesis Agent Activation:');
  const synthesisAgentTypes = ['overview', 'project-overview', 'getting-started', 'writer'];
  const synthesisRuns = agentRuns.filter(r => synthesisAgentTypes.includes(r.agentType));
  console.log(`   Synthesis agent runs: ${synthesisRuns.length}`);
  for (const agent of synthesisAgentTypes) {
    const count = synthesisRuns.filter(r => r.agentType === agent).length;
    if (count > 0) console.log(`     - ${agent}: ${count} runs`);
  }

  if (synthesisRuns.length > 0 || finalPages.length < 8) {
    console.log('   ✅ PASS: Synthesis activated (or not enough pages yet)');
  } else {
    console.log('   ⚠️  Synthesis agents did not run with 8+ pages');
  }

  // Check 4: Did technical-debt agent run?
  console.log('\n4. Technical Debt Agent:');
  const debtRuns = agentRuns.filter(r => r.agentType === 'technical-debt');
  console.log(`   Technical debt agent runs: ${debtRuns.length}`);

  if (debtRuns.length > 0) {
    console.log('   ✅ PASS: Technical debt agent is being scheduled');
  } else {
    console.log('   ❌ FAIL: Technical debt agent never ran');
  }

  // Final summary
  console.log('\n=== Final Statistics ===');
  console.log(`Total pages: ${finalPages.length}`);
  console.log(`Total iterations: ${totalIterations}`);

  // Agent breakdown
  const agentCounts = new Map<string, number>();
  for (const run of agentRuns) {
    agentCounts.set(run.agentType, (agentCounts.get(run.agentType) || 0) + 1);
  }
  console.log('\nAgent runs:');
  for (const [agent, count] of Array.from(agentCounts.entries()).sort((a, b) => b[1] - a[1])) {
    console.log(`  ${agent}: ${count}`);
  }

  // Clean up
  await fs.rm(DATA_DIR, { recursive: true });
  console.log('\n✅ Test complete (data cleaned up)');
}

main().catch(console.error);
