/**
 * Domain types for the Wiki Benchmark system.
 *
 * The benchmark measures wiki quality by asking fixed questions,
 * grading answers against actual code, and tracking progress over iterations.
 */

// ============================================================================
// Benchmark Question
// ============================================================================

/**
 * A question used to evaluate wiki quality.
 * Questions are defined in YAML and loaded at runtime.
 */
export interface BenchmarkQuestion {
  /** Unique identifier for the question */
  id: string;
  /** The question text */
  question: string;
  /** Category of knowledge being tested */
  category: BenchmarkCategory;
  /** Difficulty level (affects scoring weight) */
  difficulty: BenchmarkDifficulty;
  /** Optional hints for where to verify in code */
  verificationHints?: string[];
}

export type BenchmarkCategory =
  | 'architecture'
  | 'patterns'
  | 'decisions'
  | 'conventions'
  | 'security'
  | 'howto';

export type BenchmarkDifficulty = 'easy' | 'medium' | 'hard';

// ============================================================================
// Benchmark Result (per question)
// ============================================================================

/**
 * Result of evaluating a single question.
 */
export interface BenchmarkResult {
  /** Reference to the question */
  questionId: string;
  /** What the wiki answered */
  wikiAnswer: string;
  /** Grade assigned by the grader */
  grade: BenchmarkGrade;
  /** Grader's confidence in the grade (0-1) */
  confidence: number;
  /** Explanation of why this grade was given */
  reasoning: string;
  /** Files checked to verify the answer */
  codeReferences: string[];
  /** Time taken to evaluate this question */
  durationMs: number;
  /** LLM cost for this evaluation */
  costUsd: number;
}

export type BenchmarkGrade = 'accurate' | 'partial' | 'inaccurate' | 'no_answer';

// ============================================================================
// Benchmark Summary
// ============================================================================

/**
 * Summary statistics for a benchmark run.
 */
export interface BenchmarkSummary {
  /** Total questions evaluated */
  totalQuestions: number;
  /** Count of accurate answers */
  accurate: number;
  /** Count of partial answers */
  partial: number;
  /** Count of inaccurate answers */
  inaccurate: number;
  /** Count of no answers */
  noAnswer: number;
  /** Overall score (0-100) */
  score: number;
  /** Breakdown by category */
  byCategory: Record<string, CategoryScore>;
  /** Breakdown by difficulty */
  byDifficulty: Record<BenchmarkDifficulty, CategoryScore>;
}

export interface CategoryScore {
  score: number;
  total: number;
  accurate: number;
  partial: number;
  inaccurate: number;
  noAnswer: number;
}

// ============================================================================
// Benchmark Run
// ============================================================================

/**
 * A complete benchmark run, tracking wiki quality at a point in time.
 */
export interface BenchmarkRun {
  id: string;
  /** Reference to the repository */
  repoId: string;
  /** Reference to the wiki being benchmarked */
  wikiId: string;
  /** Wiki iteration count when benchmark was run */
  iterationCount: number;
  /** Current status of the benchmark */
  status: BenchmarkRunStatus;
  /** When the benchmark started */
  startedAt: Date;
  /** When the benchmark completed */
  completedAt: Date | null;
  /** Individual question results */
  results: BenchmarkResult[];
  /** Aggregated summary */
  summary: BenchmarkSummary;
  /** Total LLM cost for the benchmark */
  totalCostUsd: number;
  /** Error message if failed */
  error: string | null;
}

export type BenchmarkRunStatus = 'running' | 'completed' | 'failed';

// ============================================================================
// Factory Functions
// ============================================================================

/**
 * Create a new benchmark run in running state.
 */
export function createBenchmarkRun(params: {
  id: string;
  repoId: string;
  wikiId: string;
  iterationCount: number;
}): BenchmarkRun {
  return {
    id: params.id,
    repoId: params.repoId,
    wikiId: params.wikiId,
    iterationCount: params.iterationCount,
    status: 'running',
    startedAt: new Date(),
    completedAt: null,
    results: [],
    summary: createEmptySummary(),
    totalCostUsd: 0,
    error: null,
  };
}

/**
 * Create an empty summary.
 */
export function createEmptySummary(): BenchmarkSummary {
  return {
    totalQuestions: 0,
    accurate: 0,
    partial: 0,
    inaccurate: 0,
    noAnswer: 0,
    score: 0,
    byCategory: {},
    byDifficulty: {
      easy: createEmptyCategoryScore(),
      medium: createEmptyCategoryScore(),
      hard: createEmptyCategoryScore(),
    },
  };
}

/**
 * Create an empty category score.
 */
export function createEmptyCategoryScore(): CategoryScore {
  return {
    score: 0,
    total: 0,
    accurate: 0,
    partial: 0,
    inaccurate: 0,
    noAnswer: 0,
  };
}

// ============================================================================
// Scoring Utilities
// ============================================================================

/**
 * Get the score value for a grade.
 * accurate = 1.0, partial = 0.5, others = 0
 */
export function gradeToScore(grade: BenchmarkGrade): number {
  switch (grade) {
    case 'accurate':
      return 1.0;
    case 'partial':
      return 0.5;
    case 'inaccurate':
    case 'no_answer':
      return 0;
  }
}

/**
 * Get the weight multiplier for a difficulty level.
 * easy = 1.0, medium = 1.5, hard = 2.0
 */
export function difficultyWeight(difficulty: BenchmarkDifficulty): number {
  switch (difficulty) {
    case 'easy':
      return 1.0;
    case 'medium':
      return 1.5;
    case 'hard':
      return 2.0;
  }
}

/**
 * Calculate the summary from results and questions.
 */
export function calculateSummary(
  results: BenchmarkResult[],
  questions: BenchmarkQuestion[]
): BenchmarkSummary {
  const questionMap = new Map(questions.map(q => [q.id, q]));

  const summary: BenchmarkSummary = createEmptySummary();
  summary.totalQuestions = results.length;

  let totalWeight = 0;
  let weightedScore = 0;

  for (const result of results) {
    const question = questionMap.get(result.questionId);
    if (!question) continue;

    // Update grade counts
    switch (result.grade) {
      case 'accurate':
        summary.accurate++;
        break;
      case 'partial':
        summary.partial++;
        break;
      case 'inaccurate':
        summary.inaccurate++;
        break;
      case 'no_answer':
        summary.noAnswer++;
        break;
    }

    // Calculate weighted score
    const weight = difficultyWeight(question.difficulty);
    const score = gradeToScore(result.grade);
    totalWeight += weight;
    weightedScore += score * weight;

    // Update category breakdown
    if (!summary.byCategory[question.category]) {
      summary.byCategory[question.category] = createEmptyCategoryScore();
    }
    updateCategoryScore(summary.byCategory[question.category]!, result.grade);

    // Update difficulty breakdown
    updateCategoryScore(summary.byDifficulty[question.difficulty], result.grade);
  }

  // Calculate final scores
  summary.score = totalWeight > 0 ? (weightedScore / totalWeight) * 100 : 0;

  // Calculate category scores
  for (const category of Object.values(summary.byCategory)) {
    category.score = calculateCategoryScorePercent(category);
  }
  for (const difficulty of Object.values(summary.byDifficulty)) {
    difficulty.score = calculateCategoryScorePercent(difficulty);
  }

  return summary;
}

/**
 * Update a category score with a result grade.
 */
function updateCategoryScore(category: CategoryScore, grade: BenchmarkGrade): void {
  category.total++;
  switch (grade) {
    case 'accurate':
      category.accurate++;
      break;
    case 'partial':
      category.partial++;
      break;
    case 'inaccurate':
      category.inaccurate++;
      break;
    case 'no_answer':
      category.noAnswer++;
      break;
  }
}

/**
 * Calculate percentage score for a category.
 */
function calculateCategoryScorePercent(category: CategoryScore): number {
  if (category.total === 0) return 0;
  const score = category.accurate + category.partial * 0.5;
  return (score / category.total) * 100;
}
