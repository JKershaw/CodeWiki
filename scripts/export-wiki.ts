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

  // Group pages by category (first part of path)
  const categories = new Map<string, WikiPage[]>();
  for (const page of pages) {
    const category = page.path.split('/')[0] || 'uncategorized';
    if (!categories.has(category)) {
      categories.set(category, []);
    }
    categories.get(category)!.push(page);
  }

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

    const fullContent = metadata + '\n' + page.content;

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
  const lines: string[] = [
    '# Wiki Index',
    '',
    `Generated: ${new Date().toISOString()}`,
    '',
    `Total pages: ${pages.length}`,
    '',
    '## Categories',
    '',
  ];

  // Sort categories
  const sortedCategories = Array.from(categories.entries()).sort((a, b) =>
    a[0].localeCompare(b[0])
  );

  for (const [category, categoryPages] of sortedCategories) {
    lines.push(`### ${category.charAt(0).toUpperCase() + category.slice(1)}`);
    lines.push('');

    // Sort pages by title
    const sortedPages = categoryPages.sort((a, b) => a.title.localeCompare(b.title));

    for (const page of sortedPages) {
      const confidence = page.confidence >= 0.8 ? '🟢' : page.confidence >= 0.5 ? '🟡' : '🔴';
      lines.push(`- ${confidence} [${page.title}](${page.path}.md)`);
    }
    lines.push('');
  }

  // Add stats
  lines.push('## Statistics');
  lines.push('');
  lines.push('| Category | Pages | Avg Confidence |');
  lines.push('|----------|-------|----------------|');

  for (const [category, categoryPages] of sortedCategories) {
    const avgConfidence = categoryPages.reduce((sum, p) => sum + p.confidence, 0) / categoryPages.length;
    lines.push(`| ${category} | ${categoryPages.length} | ${(avgConfidence * 100).toFixed(0)}% |`);
  }

  return lines.join('\n');
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
