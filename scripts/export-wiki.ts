#!/usr/bin/env node
/**
 * Export wiki pages to markdown files.
 *
 * Usage:
 *   node scripts/export-wiki.ts <input> [output-dir]
 *
 * Input can be:
 *   - A directory containing wiki-pages.json
 *   - A JSON file with wiki pages array
 *
 * Examples:
 *   node scripts/export-wiki.ts .codewiki-data ./wiki-output
 *   node scripts/export-wiki.ts examples/real-llm/full-processing.json ./examples/real-llm/markdown
 */

import * as fs from 'fs/promises';
import * as path from 'path';

interface WikiPage {
  id: string;
  repoId: string;
  path: string;
  title: string;
  content: string;
  confidence: number;
  links: string[];
  sourceCommits: string[];
  createdAt: string;
  updatedAt: string;
}

/** Valid wiki page paths for link resolution */
let validPaths: Set<string> = new Set();

async function loadPages(input: string): Promise<WikiPage[]> {
  const stat = await fs.stat(input);

  if (stat.isDirectory()) {
    // Look for wiki-pages.json in directory
    const pagesFile = path.join(input, 'wiki-pages.json');
    const content = await fs.readFile(pagesFile, 'utf-8');
    return JSON.parse(content);
  } else {
    // Direct JSON file
    const content = await fs.readFile(input, 'utf-8');
    return JSON.parse(content);
  }
}

/**
 * Fix internal wiki links in content to use .md extension.
 * Handles both formats:
 *   [Title](path/to/page) → [Title](path/to/page.md)
 *   [Title](path/to/page.md) → unchanged
 */
function fixInternalLinks(content: string, pageTitles: Map<string, string>): string {
  // Match markdown links: [text](url)
  return content.replace(/\[([^\]]+)\]\(([^)]+)\)/g, (match, text, url) => {
    // Skip external links
    if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('#')) {
      return match;
    }

    // Skip if already has .md extension
    if (url.endsWith('.md')) {
      return match;
    }

    // Check if this is a valid internal wiki path
    const cleanPath = url.replace(/^\//, ''); // Remove leading slash if present
    if (validPaths.has(cleanPath)) {
      return `[${text}](${cleanPath}.md)`;
    }

    // Not a known wiki path, leave unchanged
    return match;
  });
}

async function exportWiki(input: string, outputDir: string): Promise<void> {
  console.log(`Exporting wiki from ${input} to ${outputDir}\n`);

  let pages: WikiPage[];

  try {
    pages = await loadPages(input);
  } catch (error) {
    console.error(`Error loading pages from ${input}:`, error);
    process.exit(1);
  }

  if (pages.length === 0) {
    console.log('No pages to export');
    return;
  }

  console.log(`Found ${pages.length} pages to export\n`);

  // Create output directory
  await fs.mkdir(outputDir, { recursive: true });

  // Build valid paths set for link resolution
  validPaths = new Set(pages.map(p => p.path));

  // Group pages by category (first part of path)
  const categories = new Map<string, WikiPage[]>();
  for (const page of pages) {
    const category = page.path.split('/')[0] || 'uncategorized';
    if (!categories.has(category)) {
      categories.set(category, []);
    }
    categories.get(category)!.push(page);
  }

  // Build page title lookup for better link text
  const pageTitles = new Map(pages.map(p => [p.path, p.title]));

  // Export each page
  for (const page of pages) {
    const pagePath = path.join(outputDir, `${page.path}.md`);
    const pageDir = path.dirname(pagePath);

    // Create directory if needed
    await fs.mkdir(pageDir, { recursive: true });

    // Build page content with metadata header
    const metadata = [
      '---',
      `title: "${page.title.replace(/"/g, '\\"')}"`,
      `confidence: ${page.confidence.toFixed(2)}`,
      `created: ${page.createdAt}`,
      `updated: ${page.updatedAt}`,
      page.sourceCommits.length > 0 ? `commits: [${page.sourceCommits.slice(0, 3).join(', ')}]` : null,
      '---',
      '',
    ].filter(Boolean).join('\n');

    // Fix internal links in content (add .md extension)
    const fixedContent = fixInternalLinks(page.content, pageTitles);

    const fullContent = metadata + '\n' + fixedContent;

    await fs.writeFile(pagePath, fullContent);
    console.log(`  ✓ ${page.path}.md`);
  }

  // Create index.md
  const indexContent = generateIndex(pages, categories);
  await fs.writeFile(path.join(outputDir, 'index.md'), indexContent);
  console.log(`  ✓ index.md`);

  console.log(`\n✅ Exported ${pages.length} pages to ${outputDir}`);
}

function generateIndex(pages: WikiPage[], categories: Map<string, WikiPage[]>): string {
  const lines: string[] = [];

  // Sort categories
  const sortedCategories = Array.from(categories.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  // Calculate stats
  const avgConfidence = pages.reduce((sum, p) => sum + p.confidence, 0) / pages.length;

  // Generate overview section
  lines.push('# Project Wiki');
  lines.push('');
  lines.push('Welcome to the project wiki. This documentation is automatically generated from the Git history,');
  lines.push('capturing not just what the code does, but why it exists and how it evolved.');
  lines.push('');

  // Quick stats
  lines.push(`> **${pages.length} pages** across **${categories.size} categories** • Average confidence: **${(avgConfidence * 100).toFixed(0)}%**`);
  lines.push('');

  // Category descriptions with key pages
  lines.push('## Documentation');
  lines.push('');

  // Define category descriptions and icons
  const categoryInfo: Record<string, { icon: string; description: string }> = {
    architecture: { icon: '🏗️', description: 'System design, patterns, and technical decisions' },
    decisions: { icon: '📋', description: 'Architecture Decision Records (ADRs) and rationale' },
    security: { icon: '🔒', description: 'Security audits, vulnerabilities, and recommendations' },
    guides: { icon: '📖', description: 'How-to guides and tutorials' },
    patterns: { icon: '🎨', description: 'Design patterns and coding conventions' },
    conventions: { icon: '📐', description: 'Coding standards and style guidelines' },
    planning: { icon: '📅', description: 'Project plans and roadmaps' },
    history: { icon: '📜', description: 'Feature histories and evolution' },
    commits: { icon: '🔄', description: 'Individual commit documentation' },
  };

  // Group non-commit categories first
  const primaryCategories = sortedCategories.filter(([cat]) => cat !== 'commits');
  const commitCategory = sortedCategories.find(([cat]) => cat === 'commits');

  for (const [category, categoryPages] of primaryCategories) {
    const info = categoryInfo[category] || { icon: '📁', description: '' };
    const catAvgConfidence = categoryPages.reduce((sum, p) => sum + p.confidence, 0) / categoryPages.length;

    lines.push(`### ${info.icon} ${capitalize(category)}`);
    if (info.description) {
      lines.push('');
      lines.push(info.description);
    }
    lines.push('');

    // Show top pages (highest confidence, max 5)
    const topPages = [...categoryPages]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    for (const page of topPages) {
      const confidence = page.confidence >= 0.8 ? '🟢' : page.confidence >= 0.5 ? '🟡' : '🔴';
      lines.push(`- ${confidence} [${page.title}](${page.path}.md)`);
    }

    if (categoryPages.length > 5) {
      lines.push(`- *...and ${categoryPages.length - 5} more*`);
    }
    lines.push('');
  }

  // Commits section (collapsed or summarized)
  if (commitCategory) {
    const [, commitPages] = commitCategory;
    lines.push(`### 🔄 Commits`);
    lines.push('');
    lines.push(`Documentation for ${commitPages.length} individual commits. Each commit page captures`);
    lines.push('what changed, why, and any significant findings from analysis.');
    lines.push('');

    // Show only recent/high-confidence commits
    const topCommits = [...commitPages]
      .sort((a, b) => b.confidence - a.confidence)
      .slice(0, 5);

    for (const page of topCommits) {
      const confidence = page.confidence >= 0.8 ? '🟢' : page.confidence >= 0.5 ? '🟡' : '🔴';
      lines.push(`- ${confidence} [${page.title}](${page.path}.md)`);
    }

    if (commitPages.length > 5) {
      lines.push(`- *...and ${commitPages.length - 5} more commits*`);
    }
    lines.push('');
  }

  // Statistics section
  lines.push('---');
  lines.push('');
  lines.push('## Statistics');
  lines.push('');
  lines.push('| Category | Pages | Avg Confidence |');
  lines.push('|----------|-------|----------------|');

  for (const [category, categoryPages] of sortedCategories) {
    const catAvgConfidence = categoryPages.reduce((sum, p) => sum + p.confidence, 0) / categoryPages.length;
    lines.push(`| ${capitalize(category)} | ${categoryPages.length} | ${(catAvgConfidence * 100).toFixed(0)}% |`);
  }

  lines.push('');
  lines.push('---');
  lines.push(`*Generated: ${new Date().toISOString()}*`);

  return lines.join('\n');
}

function capitalize(str: string): string {
  return str.charAt(0).toUpperCase() + str.slice(1);
}

// Main
const args = process.argv.slice(2);

if (args.length < 1) {
  console.log('Usage: node scripts/export-wiki.ts <input> [output-dir]');
  console.log('');
  console.log('Input can be:');
  console.log('  - A directory containing wiki-pages.json');
  console.log('  - A JSON file with wiki pages array');
  console.log('');
  console.log('Examples:');
  console.log('  node scripts/export-wiki.ts .codewiki-data ./wiki-output');
  console.log('  node scripts/export-wiki.ts examples/real-llm/full-processing.json ./examples/real-llm/markdown');
  process.exit(1);
}

const input = args[0]!;
const outputDir = args[1] || path.join(path.dirname(input), 'markdown');

exportWiki(input, outputDir).catch(console.error);
