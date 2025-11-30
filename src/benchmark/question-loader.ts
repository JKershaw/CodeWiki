/**
 * Loader for benchmark questions from YAML.
 */

import { readFile } from 'fs/promises';
import { join, dirname } from 'path';
import { fileURLToPath } from 'url';
import { parse as parseYaml } from 'yaml';
import type { BenchmarkQuestion, BenchmarkCategory, BenchmarkDifficulty } from '../domain/benchmark.js';

const __dirname = dirname(fileURLToPath(import.meta.url));

interface QuestionsFile {
  questions: Array<{
    id: string;
    question: string;
    category: string;
    difficulty: string;
    verificationHints?: string[];
  }>;
}

/**
 * Load benchmark questions from the YAML file.
 */
export async function loadQuestions(): Promise<BenchmarkQuestion[]> {
  const filePath = join(__dirname, 'questions.yaml');
  const content = await readFile(filePath, 'utf-8');
  const data = parseYaml(content) as QuestionsFile;

  return data.questions.map(q => {
    const question: BenchmarkQuestion = {
      id: q.id,
      question: q.question,
      category: q.category as BenchmarkCategory,
      difficulty: q.difficulty as BenchmarkDifficulty,
    };
    if (q.verificationHints) {
      question.verificationHints = q.verificationHints;
    }
    return question;
  });
}

/**
 * Load a subset of questions by ID.
 */
export async function loadQuestionsByIds(ids: string[]): Promise<BenchmarkQuestion[]> {
  const allQuestions = await loadQuestions();
  const idSet = new Set(ids);
  return allQuestions.filter(q => idSet.has(q.id));
}

/**
 * Load questions filtered by category.
 */
export async function loadQuestionsByCategory(category: BenchmarkCategory): Promise<BenchmarkQuestion[]> {
  const allQuestions = await loadQuestions();
  return allQuestions.filter(q => q.category === category);
}
