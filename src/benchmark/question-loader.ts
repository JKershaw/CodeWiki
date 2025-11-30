/**
 * Loader for benchmark questions from markdown files.
 *
 * Questions are stored in markdown files in the questions/ folder.
 * Files are named after the repository they target (e.g., CodeWiki.md).
 * Falls back to default.md if no repo-specific file exists.
 */

import { readFile, access } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import type { BenchmarkQuestion, BenchmarkCategory, BenchmarkDifficulty } from '../domain/benchmark.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const QUESTIONS_DIR = join(__dirname, 'questions');

/**
 * Parse a markdown file into benchmark questions.
 */
function parseMarkdownQuestions(content: string): BenchmarkQuestion[] {
  const questions: BenchmarkQuestion[] = [];

  // Split by level-2 headings (## question-id)
  const sections = content.split(/^## /m).slice(1); // Skip content before first ##

  for (const section of sections) {
    const lines = section.trim().split('\n');
    if (lines.length === 0) continue;

    // First line is the question ID
    const firstLine = lines[0];
    if (!firstLine) continue;
    const id = firstLine.trim();
    if (!id) continue;

    let category: BenchmarkCategory | null = null;
    let difficulty: BenchmarkDifficulty | null = null;
    let hints: string[] = [];
    let questionTextStart = 1;

    // Parse metadata lines
    for (let i = 1; i < lines.length; i++) {
      const currentLine = lines[i];
      if (currentLine === undefined) continue;
      const line = currentLine.trim();

      // Check for metadata patterns
      const categoryMatch = line.match(/^\*?\*?Category:?\*?\*?\s*(.+)$/i);
      const difficultyMatch = line.match(/^\*?\*?Difficulty:?\*?\*?\s*(.+)$/i);
      const hintsMatch = line.match(/^\*?\*?Hints?:?\*?\*?\s*(.+)$/i);

      if (categoryMatch?.[1]) {
        category = categoryMatch[1].trim().toLowerCase() as BenchmarkCategory;
        questionTextStart = i + 1;
      } else if (difficultyMatch?.[1]) {
        difficulty = difficultyMatch[1].trim().toLowerCase() as BenchmarkDifficulty;
        questionTextStart = i + 1;
      } else if (hintsMatch?.[1]) {
        hints = hintsMatch[1]
          .split(',')
          .map(h => h.trim())
          .filter(h => h.length > 0);
        questionTextStart = i + 1;
      } else if (line.startsWith('-') && (line.includes('Category') || line.includes('Difficulty') || line.includes('Hint'))) {
        // Handle bulleted format: - **Category:** value
        const bulletCategoryMatch = line.match(/Category:?\*?\*?\s*(.+)$/i);
        const bulletDifficultyMatch = line.match(/Difficulty:?\*?\*?\s*(.+)$/i);
        const bulletHintsMatch = line.match(/Hints?:?\*?\*?\s*(.+)$/i);

        if (bulletCategoryMatch?.[1]) {
          category = bulletCategoryMatch[1].trim().toLowerCase() as BenchmarkCategory;
        } else if (bulletDifficultyMatch?.[1]) {
          difficulty = bulletDifficultyMatch[1].trim().toLowerCase() as BenchmarkDifficulty;
        } else if (bulletHintsMatch?.[1]) {
          hints = bulletHintsMatch[1]
            .split(',')
            .map(h => h.trim())
            .filter(h => h.length > 0);
        }
        questionTextStart = i + 1;
      } else if (line.length > 0 && !line.startsWith('-')) {
        // Non-empty, non-metadata line - this is where the question starts
        break;
      }
    }

    // Extract question text (everything after metadata)
    const questionText = lines
      .slice(questionTextStart)
      .join('\n')
      .trim();

    // Validate required fields
    if (!category || !difficulty || !questionText) {
      console.warn(`Skipping question "${id}": missing required fields (category: ${category}, difficulty: ${difficulty}, question: ${!!questionText})`);
      continue;
    }

    const question: BenchmarkQuestion = {
      id,
      question: questionText,
      category,
      difficulty,
    };

    if (hints.length > 0) {
      question.verificationHints = hints;
    }

    questions.push(question);
  }

  return questions;
}

/**
 * Check if a file exists.
 */
async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

/**
 * Load benchmark questions for a specific repository.
 * Falls back to default.md if no repo-specific file exists.
 *
 * @param repoName - The repository name to load questions for (optional)
 */
export async function loadQuestions(repoName?: string): Promise<BenchmarkQuestion[]> {
  let filePath: string;

  if (repoName) {
    // Try repo-specific file first
    const repoFilePath = join(QUESTIONS_DIR, `${repoName}.md`);
    if (await fileExists(repoFilePath)) {
      filePath = repoFilePath;
    } else {
      // Fall back to default
      filePath = join(QUESTIONS_DIR, 'default.md');
    }
  } else {
    // No repo specified, use default
    filePath = join(QUESTIONS_DIR, 'default.md');
  }

  const content = await readFile(filePath, 'utf-8');
  return parseMarkdownQuestions(content);
}

/**
 * Load a subset of questions by ID.
 *
 * @param ids - Array of question IDs to load
 * @param repoName - The repository name to load questions for (optional)
 */
export async function loadQuestionsByIds(ids: string[], repoName?: string): Promise<BenchmarkQuestion[]> {
  const allQuestions = await loadQuestions(repoName);
  const idSet = new Set(ids);
  return allQuestions.filter(q => idSet.has(q.id));
}

/**
 * Load questions filtered by category.
 *
 * @param category - The category to filter by
 * @param repoName - The repository name to load questions for (optional)
 */
export async function loadQuestionsByCategory(category: BenchmarkCategory, repoName?: string): Promise<BenchmarkQuestion[]> {
  const allQuestions = await loadQuestions(repoName);
  return allQuestions.filter(q => q.category === category);
}

/**
 * List available question files.
 */
export async function listQuestionFiles(): Promise<string[]> {
  const { readdir } = await import('fs/promises');
  const files = await readdir(QUESTIONS_DIR);
  return files
    .filter(f => f.endsWith('.md') && f !== 'README.md')
    .map(f => f.replace('.md', ''));
}
