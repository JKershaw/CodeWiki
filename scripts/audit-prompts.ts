#!/usr/bin/env npx tsx
/**
 * Prompt Audit Script - Static analysis of all agent prompts.
 *
 * Scans the codebase for SYSTEM_PROMPT definitions and reports:
 * - Character counts
 * - Estimated token counts (chars / 4 rough estimate)
 * - Location of each prompt
 *
 * Usage: npx tsx scripts/audit-prompts.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

interface ComplexityMetrics {
  sections: number;        // ## headers
  listItems: number;       // bullet points and numbered lists
  codeBlocks: number;      // ``` fenced blocks
  conditionals: number;    // if, when, unless, otherwise
  negations: number;       // don't, never, not, avoid, do NOT
  emphasisMarkers: number; // MUST, REQUIRED, CRITICAL, IMPORTANT, NEVER
  imperativeVerbs: number; // use, create, write, ensure, call, return, etc.
  avgSentenceLength: number;
  complexityScore: number; // weighted composite score
}

interface PromptInfo {
  file: string;
  varName: string;
  charCount: number;
  estimatedTokens: number;
  lineNumber: number;
  promptContent: string;   // actual prompt text for complexity analysis
  complexity: ComplexityMetrics;
}

/**
 * Analyze complexity metrics for a prompt.
 */
function analyzeComplexity(content: string): ComplexityMetrics {
  // Count markdown sections (## headers)
  const sections = (content.match(/^#{1,4}\s+/gm) || []).length;

  // Count list items (bullet points and numbered lists)
  const listItems = (content.match(/^[\s]*[-*+]\s+|^[\s]*\d+\.\s+/gm) || []).length;

  // Count code blocks
  const codeBlocks = (content.match(/```/g) || []).length / 2; // pairs of ```

  // Count conditionals (case-insensitive word boundaries)
  const conditionalPatterns = /\b(if|when|unless|otherwise|whether|in case|provided that)\b/gi;
  const conditionals = (content.match(conditionalPatterns) || []).length;

  // Count negations
  const negationPatterns = /\b(don't|dont|do not|never|not|avoid|cannot|can't|shouldn't|should not|won't|will not|isn't|aren't)\b/gi;
  const negations = (content.match(negationPatterns) || []).length;

  // Count emphasis markers (uppercase)
  const emphasisPatterns = /\b(MUST|REQUIRED|CRITICAL|IMPORTANT|NEVER|ALWAYS|DO NOT|MANDATORY|WARNING|NOTE|CAUTION)\b/g;
  const emphasisMarkers = (content.match(emphasisPatterns) || []).length;

  // Count imperative verbs (common instruction verbs at start of sentences/bullets)
  const imperativePatterns = /\b(use|create|write|ensure|call|return|check|verify|include|exclude|add|remove|set|get|make|keep|avoid|follow|implement|handle|process|parse|extract|generate|output|respond|analyze|document|describe|explain|provide|specify|define|consider|note|remember|always|never)\b/gi;
  const imperativeVerbs = (content.match(imperativePatterns) || []).length;

  // Calculate average sentence length
  // Split on sentence endings, filter out empty strings
  const sentences = content.split(/[.!?]+/).filter(s => s.trim().length > 0);
  const totalWords = sentences.reduce((sum, s) => sum + s.trim().split(/\s+/).length, 0);
  const avgSentenceLength = sentences.length > 0 ? Math.round(totalWords / sentences.length) : 0;

  // Calculate weighted complexity score
  // Higher weights for factors that tend to confuse simpler models
  const complexityScore = Math.round(
    (sections * 2) +
    (listItems * 1) +
    (codeBlocks * 3) +
    (conditionals * 4) +      // Conditionals add branching complexity
    (negations * 5) +         // Negations are hard to follow
    (emphasisMarkers * 3) +   // Emphasis suggests critical rules
    (imperativeVerbs * 0.5) + // Many instructions
    (avgSentenceLength * 0.5) // Longer sentences = harder to parse
  );

  return {
    sections,
    listItems,
    codeBlocks: Math.floor(codeBlocks),
    conditionals,
    negations,
    emphasisMarkers,
    imperativeVerbs,
    avgSentenceLength,
    complexityScore,
  };
}

/**
 * Recursively find all TypeScript files in a directory.
 */
function findTsFiles(dir: string): string[] {
  const files: string[] = [];
  const entries = fs.readdirSync(dir, { withFileTypes: true });

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory() && !entry.name.startsWith('.') && entry.name !== 'node_modules') {
      files.push(...findTsFiles(fullPath));
    } else if (entry.isFile() && (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx'))) {
      files.push(fullPath);
    }
  }

  return files;
}

/**
 * Extract the string content from a template literal or regular string.
 * Handles multiline template literals with backticks.
 */
function extractStringContent(content: string, startIndex: number): { value: string; endIndex: number } | null {
  // Skip whitespace and find the string start
  let i = startIndex;
  while (i < content.length && /\s/.test(content[i]!)) i++;

  if (i >= content.length) return null;

  const quote = content[i];
  if (quote !== '`' && quote !== '"' && quote !== "'") return null;

  i++; // Skip opening quote
  let value = '';
  let escaped = false;

  while (i < content.length) {
    const char = content[i]!;

    if (escaped) {
      value += char;
      escaped = false;
    } else if (char === '\\') {
      escaped = true;
    } else if (char === quote) {
      return { value, endIndex: i };
    } else {
      value += char;
    }
    i++;
  }

  return null; // Unclosed string
}

/**
 * Find all SYSTEM_PROMPT-like definitions in a file.
 */
function findPromptsInFile(filePath: string): PromptInfo[] {
  const prompts: PromptInfo[] = [];
  const content = fs.readFileSync(filePath, 'utf-8');
  const lines = content.split('\n');

  // Pattern to match prompt variable definitions
  // Matches: const SYSTEM_PROMPT = `...`, export const PROMPT = "...", etc.
  const promptPatterns = [
    /(?:export\s+)?(?:const|let|var)\s+((?:SYSTEM_)?PROMPT(?:_\w+)?)\s*(?::\s*string\s*)?=\s*/g,
    /(?:export\s+)?(?:const|let|var)\s+(\w*SYSTEM_PROMPT\w*)\s*(?::\s*string\s*)?=\s*/g,
    /(?:export\s+)?(?:const|let|var)\s+(\w+_PROMPT)\s*(?::\s*string\s*)?=\s*/g,
  ];

  for (const pattern of promptPatterns) {
    let match;
    while ((match = pattern.exec(content)) !== null) {
      const varName = match[1]!;
      const matchEnd = match.index + match[0].length;

      // Find line number
      let lineNumber = 1;
      for (let i = 0; i < match.index; i++) {
        if (content[i] === '\n') lineNumber++;
      }

      // Extract the string value
      const extracted = extractStringContent(content, matchEnd);
      if (extracted) {
        // Avoid duplicates
        const exists = prompts.some(p => p.varName === varName && p.lineNumber === lineNumber);
        if (!exists) {
          prompts.push({
            file: filePath,
            varName,
            charCount: extracted.value.length,
            estimatedTokens: Math.ceil(extracted.value.length / 4),
            lineNumber,
            promptContent: extracted.value,
            complexity: analyzeComplexity(extracted.value),
          });
        }
      }
    }
  }

  return prompts;
}

/**
 * Format file path relative to project root.
 */
function relativePath(filePath: string): string {
  const projectRoot = path.resolve(__dirname, '..');
  return path.relative(projectRoot, filePath);
}

/**
 * Main audit function.
 */
function runAudit(): void {
  console.log('='.repeat(80));
  console.log('PROMPT AUDIT REPORT');
  console.log('='.repeat(80));
  console.log();

  const agentsDir = path.resolve(__dirname, '../src/agents');
  const servicesDir = path.resolve(__dirname, '../src/services');

  const allFiles = [
    ...findTsFiles(agentsDir),
    ...findTsFiles(servicesDir),
  ];

  const allPrompts: PromptInfo[] = [];

  for (const file of allFiles) {
    const prompts = findPromptsInFile(file);
    allPrompts.push(...prompts);
  }

  // Sort by character count descending
  allPrompts.sort((a, b) => b.charCount - a.charCount);

  // Print results
  console.log('PROMPTS BY SIZE (largest first):');
  console.log('-'.repeat(80));
  console.log(
    'Variable Name'.padEnd(35) +
    'Chars'.padStart(10) +
    'Est.Tokens'.padStart(12) +
    '  Location'
  );
  console.log('-'.repeat(80));

  for (const prompt of allPrompts) {
    const location = `${relativePath(prompt.file)}:${prompt.lineNumber}`;
    console.log(
      prompt.varName.padEnd(35) +
      prompt.charCount.toString().padStart(10) +
      prompt.estimatedTokens.toString().padStart(12) +
      `  ${location}`
    );
  }

  console.log('-'.repeat(80));
  console.log();

  // Summary statistics
  const totalChars = allPrompts.reduce((sum, p) => sum + p.charCount, 0);
  const totalTokens = allPrompts.reduce((sum, p) => sum + p.estimatedTokens, 0);
  const avgChars = Math.round(totalChars / allPrompts.length);
  const avgTokens = Math.round(totalTokens / allPrompts.length);
  const maxChars = allPrompts[0]?.charCount ?? 0;
  const maxTokens = allPrompts[0]?.estimatedTokens ?? 0;

  console.log('SIZE SUMMARY:');
  console.log('-'.repeat(40));
  console.log(`Total prompts found:     ${allPrompts.length}`);
  console.log(`Total characters:        ${totalChars.toLocaleString()}`);
  console.log(`Total estimated tokens:  ${totalTokens.toLocaleString()}`);
  console.log(`Average chars/prompt:    ${avgChars.toLocaleString()}`);
  console.log(`Average tokens/prompt:   ${avgTokens.toLocaleString()}`);
  console.log(`Largest prompt (chars):  ${maxChars.toLocaleString()}`);
  console.log(`Largest prompt (tokens): ${maxTokens.toLocaleString()}`);
  console.log();

  // Complexity analysis
  console.log('='.repeat(100));
  console.log('COMPLEXITY ANALYSIS');
  console.log('='.repeat(100));
  console.log();

  // Sort by complexity score descending
  const byComplexity = [...allPrompts].sort((a, b) => b.complexity.complexityScore - a.complexity.complexityScore);

  console.log('PROMPTS BY COMPLEXITY SCORE (highest first):');
  console.log('-'.repeat(100));
  console.log(
    'Variable Name'.padEnd(30) +
    'Score'.padStart(7) +
    'Sects'.padStart(7) +
    'Lists'.padStart(7) +
    'Code'.padStart(6) +
    'Cond'.padStart(6) +
    'Neg'.padStart(5) +
    'Emph'.padStart(6) +
    'Verbs'.padStart(7) +
    'AvgSnt'.padStart(8) +
    '  Location'
  );
  console.log('-'.repeat(100));

  for (const prompt of byComplexity) {
    const c = prompt.complexity;
    const location = `${relativePath(prompt.file)}:${prompt.lineNumber}`;
    console.log(
      prompt.varName.substring(0, 29).padEnd(30) +
      c.complexityScore.toString().padStart(7) +
      c.sections.toString().padStart(7) +
      c.listItems.toString().padStart(7) +
      c.codeBlocks.toString().padStart(6) +
      c.conditionals.toString().padStart(6) +
      c.negations.toString().padStart(5) +
      c.emphasisMarkers.toString().padStart(6) +
      c.imperativeVerbs.toString().padStart(7) +
      c.avgSentenceLength.toString().padStart(8) +
      `  ${location}`
    );
  }

  console.log('-'.repeat(100));
  console.log();

  // Complexity summary
  const avgComplexity = Math.round(allPrompts.reduce((sum, p) => sum + p.complexity.complexityScore, 0) / allPrompts.length);
  const maxComplexity = byComplexity[0]?.complexity.complexityScore ?? 0;
  const totalNegations = allPrompts.reduce((sum, p) => sum + p.complexity.negations, 0);
  const totalConditionals = allPrompts.reduce((sum, p) => sum + p.complexity.conditionals, 0);
  const totalEmphasis = allPrompts.reduce((sum, p) => sum + p.complexity.emphasisMarkers, 0);

  console.log('COMPLEXITY SUMMARY:');
  console.log('-'.repeat(40));
  console.log(`Average complexity score:  ${avgComplexity}`);
  console.log(`Highest complexity score:  ${maxComplexity}`);
  console.log(`Total negations:           ${totalNegations}`);
  console.log(`Total conditionals:        ${totalConditionals}`);
  console.log(`Total emphasis markers:    ${totalEmphasis}`);
  console.log();

  // High complexity warnings
  const COMPLEXITY_THRESHOLD = 100;
  const complexPrompts = byComplexity.filter(p => p.complexity.complexityScore > COMPLEXITY_THRESHOLD);

  if (complexPrompts.length > 0) {
    console.log(`HIGH COMPLEXITY WARNINGS (score > ${COMPLEXITY_THRESHOLD}):`);
    console.log('-'.repeat(60));
    for (const prompt of complexPrompts) {
      const c = prompt.complexity;
      const factors: string[] = [];
      if (c.negations >= 5) factors.push(`${c.negations} negations`);
      if (c.conditionals >= 5) factors.push(`${c.conditionals} conditionals`);
      if (c.emphasisMarkers >= 5) factors.push(`${c.emphasisMarkers} emphasis`);
      if (c.sections >= 8) factors.push(`${c.sections} sections`);
      if (c.listItems >= 15) factors.push(`${c.listItems} list items`);

      console.log(`  ⚠️  ${prompt.varName}: score ${c.complexityScore}`);
      if (factors.length > 0) {
        console.log(`      Contributing factors: ${factors.join(', ')}`);
      }
    }
    console.log();
  }

  // Warnings for large prompts
  const WARNING_THRESHOLD = 2000; // chars
  const largePrompts = allPrompts.filter(p => p.charCount > WARNING_THRESHOLD);

  if (largePrompts.length > 0) {
    console.log(`SIZE WARNINGS (prompts > ${WARNING_THRESHOLD} chars):`);
    console.log('-'.repeat(40));
    for (const prompt of largePrompts) {
      console.log(`  ⚠️  ${prompt.varName}: ${prompt.charCount} chars (~${prompt.estimatedTokens} tokens)`);
    }
    console.log();
  }

  console.log('='.repeat(80));
  console.log('Static audit complete.');
}

/**
 * Runtime audit using the agent registry.
 * Phase 2: Validates prompts exposed via getSystemPrompt() interface.
 */
async function runRuntimeAudit(): Promise<void> {
  console.log();
  console.log('='.repeat(80));
  console.log('RUNTIME AUDIT (via Agent Registry)');
  console.log('='.repeat(80));
  console.log();

  // Dynamically import the registry to get runtime prompt access
  const { getAgentPrompt, getAvailableAgentTypes } = await import('../src/agents/registry.js');

  const agentTypes = getAvailableAgentTypes();
  const runtimePrompts: Array<{ type: string; charCount: number; estimatedTokens: number }> = [];

  console.log('AGENT PROMPTS (via getSystemPrompt()):');
  console.log('-'.repeat(80));
  console.log(
    'Agent Type'.padEnd(30) +
    'Chars'.padStart(10) +
    'Est.Tokens'.padStart(12) +
    '  Status'
  );
  console.log('-'.repeat(80));

  for (const type of agentTypes) {
    const prompt = getAgentPrompt(type);
    if (prompt) {
      const charCount = prompt.length;
      const estimatedTokens = Math.ceil(charCount / 4);
      runtimePrompts.push({ type, charCount, estimatedTokens });
      console.log(
        type.padEnd(30) +
        charCount.toString().padStart(10) +
        estimatedTokens.toString().padStart(12) +
        '  ✓ exposed'
      );
    } else {
      console.log(
        type.padEnd(30) +
        '-'.padStart(10) +
        '-'.padStart(12) +
        '  ✗ no prompt (pure computation)'
      );
    }
  }

  console.log('-'.repeat(80));
  console.log();

  // Runtime summary
  const totalChars = runtimePrompts.reduce((sum, p) => sum + p.charCount, 0);
  const totalTokens = runtimePrompts.reduce((sum, p) => sum + p.estimatedTokens, 0);

  console.log('RUNTIME SUMMARY:');
  console.log('-'.repeat(40));
  console.log(`Agents with prompts:     ${runtimePrompts.length}`);
  console.log(`Agents without prompts:  ${agentTypes.length - runtimePrompts.length}`);
  console.log(`Total runtime chars:     ${totalChars.toLocaleString()}`);
  console.log(`Total runtime tokens:    ${totalTokens.toLocaleString()}`);
  console.log();

  // Sort by size for top 5
  runtimePrompts.sort((a, b) => b.charCount - a.charCount);
  console.log('TOP 5 LARGEST RUNTIME PROMPTS:');
  console.log('-'.repeat(40));
  for (const prompt of runtimePrompts.slice(0, 5)) {
    console.log(`  ${prompt.type}: ${prompt.charCount} chars (~${prompt.estimatedTokens} tokens)`);
  }

  console.log();
  console.log('='.repeat(80));
  console.log('Runtime audit complete.');
}

// Run both audits
async function main(): Promise<void> {
  runAudit();
  await runRuntimeAudit();
}

main().catch(console.error);
