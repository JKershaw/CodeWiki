# Orchestrator Strategy Analysis

This document analyzes the current orchestrator strategy, identifies blind spots and issues, and proposes an ideal strategy.

## Current Strategy Overview

The orchestrator operates in two modes:
1. **Deterministic mode** (default): Uses fixed strategies in priority order
2. **LLM-powered mode**: Uses Claude to make intelligent decisions with tool access

### Current Decision Flow

1. Check if bootstrap needed (empty wiki)
2. If LLM mode: gather context, build prompt, let LLM decide
3. Otherwise: execute deterministic strategies in order:
   - Codebase exploration (document current code)
   - Synthesis (create overviews, guides)
   - Meta agents (linking, quality, consistency)
   - Commit analysis (add historical context)

### Information Available to Orchestrator

From `OrchestratorContext`:
- `wikiPages`: Total page count
- `categoryCounts`: Pages per category
- `avgConfidence`: Average confidence score
- `lowConfidencePages`: Pages with confidence < 0.5
- `shallowPages`: Pages with < 500 chars
- `pagesLackingExamples`: Pages without code blocks
- `pagesWithoutLinks`: Pages with no outgoing links
- `directoryCoverage`: Which directories are mentioned in wiki
- `fileCoverageTree`: Prioritized file-level coverage view
- `iterationPhase`: early/mid/late based on progress %

---

## Identified Blind Spots & Issues

### 1. Page Count as Primary Progress Indicator

**Problem:** The orchestrator heavily relies on `wikiPages.length` (page count) as a proxy for wiki maturity.

**Code evidence:**
```typescript
// strategies.ts:83-86
const baseCoverageThreshold = wikiPageCount < 5 ? 60
  : wikiPageCount < 10 ? 40
  : wikiPageCount < 20 ? 30
  : 20;

// strategies.ts:447-448
if (wikiPages.length < 3) {
  return { workItems: [] };
}
```

**Blind spots:**
- 10 stub pages ≠ 5 comprehensive pages, but system treats them similarly
- Doesn't distinguish between 10 pages covering critical code vs 10 pages about trivial utilities
- No awareness of content redundancy (could have 5 pages saying the same thing)
- A wiki could have 20 low-quality pages and still trigger "mature wiki" thresholds

---

### 2. Binary Coverage Calculation

**Problem:** Coverage is 0% or 100% per file based solely on string mention.

**Code evidence:**
```typescript
// file-coverage-tree.ts:142-158
export function calculateFileCoverage(filePath: string, wikiPages: WikiPageLike[]): number {
  // ...
  if (page.content.includes(filePath) || page.content.includes(fileName)) {
    return 100;  // Single mention = fully covered
  }
  // ...
  return 0;
}
```

**Blind spots:**
- A single mention in a commit log counts as "100% covered"
- No distinction between "mentioned in passing" vs "comprehensively documented"
- Doesn't consider semantic coverage (does the wiki explain what the code does?)
- A page saying "foo.ts was modified" counts the same as a detailed explanation
- File could be mentioned in an unrelated context

---

### 3. Arbitrary Magic Number Thresholds

The codebase is full of hardcoded thresholds with no data backing:

| Threshold | Location | Purpose |
|-----------|----------|---------|
| 3 pages | strategies.ts:447 | Start synthesis |
| 5 pages | strategies.ts:502 | Create project overview |
| 15 pages | strategies.ts:558 | Create testing guide |
| 500 chars | context-gatherer.ts:278 | "Shallow" page |
| 0.5 confidence | context-gatherer.ts:254 | "Low confidence" |
| 0.7 confidence | strategies.ts:363 | Trigger quality agent |
| 20 iterations | strategies.ts:295 | Meta agent cooldown |
| 30% unlinked | strategies.ts:319 | Trigger link agent |
| 40% coverage | file-coverage-tree.ts:102 | Low coverage warning |
| 75 LOC | context-gatherer.ts:541 | Default estimated LOC |

**Issues:**
- No validation these thresholds produce good outcomes
- Same thresholds for all codebases regardless of size/complexity
- No mechanism to tune thresholds based on results

---

### 4. No Semantic Understanding of Content Quality

**Problem:** Quality metrics are based on superficial heuristics.

**Code evidence:**
```typescript
// context-gatherer.ts:275-280 - Shallow detection
const shallowPagesList = wikiPages
  .filter(p => {
    // ...
    return p.content.length < 500;  // Just character count
  })

// context-gatherer.ts:284-289 - Example detection
const pagesLackingExamplesList = wikiPages
  .filter(p => {
    // ...
    return !p.content.includes('```');  // Just presence of code fence
  })

// context-gatherer.ts:234-247 - Rewrite detection
const commitIndicators = [
  'this commit ', 'this change ', 'this patch ',
  // ... simple string patterns
];
```

**Blind spots:**
- A 499-char page with perfect content is "shallow"
- A page with one empty code block counts as "has examples"
- Conceptual pages that legitimately don't need code are flagged
- No assessment of whether explanations are accurate or helpful
- Can't detect factual errors or outdated information

---

### 5. No Understanding of Code Importance

**Problem:** All files are treated as equally important to document.

**Code evidence:**
```typescript
// file-coverage-tree.ts:124-128
export function calculatePriorityScore(coveragePercent: number, loc: number): number {
  const coverageFactor = 1 - coveragePercent / 100;
  const sizeFactor = Math.log(loc + 1);  // Only considers size
  return coverageFactor * sizeFactor;
}
```

**Blind spots:**
- Entry points (main.ts, index.ts) not prioritized over internal utilities
- Frequently modified files (hotspots) not considered
- Files with many dependents not prioritized
- Public API vs internal implementation treated same
- Critical paths (auth, payments) not identified
- A 1000-line auto-generated file scores higher than a 100-line critical module

---

### 6. No Feedback Loop from Wiki Consumers

**Problem:** No way to know if documentation is actually useful.

**Missing signals:**
- No tracking of page views or search queries
- No user feedback mechanism (helpful/not helpful)
- No understanding of what users search for but can't find
- No measurement of time-to-answer for common questions
- No detection of frequently visited but low-rated pages
- No identification of documentation gaps from user perspective

---

### 7. Simplistic Phase Detection

**Problem:** Iteration phase is based purely on progress percentage.

**Code evidence:**
```typescript
// context-gatherer.ts:155-159
private getIterationPhase(progressPercent: number): IterationPhase {
  if (progressPercent < 30) return 'early';
  if (progressPercent < 70) return 'mid';
  return 'late';
}
```

**Blind spots:**
- 70% through iterations but wiki still poor → treated as "late phase"
- Doesn't consider actual wiki quality or coverage achieved
- No adaptation if progress is slower/faster than expected
- Same phase boundaries for 10-iteration run vs 100-iteration run

---

### 8. Cooldown is Time-Based, Not Outcome-Based

**Problem:** Meta agents run on fixed iteration cooldowns regardless of results.

**Code evidence:**
```typescript
// strategies.ts:295-306
const META_AGENT_COOLDOWN_RUNS = 20;

const hasRunWithinCooldown = (agentType: string): boolean => {
  const recentWindow = completedRuns.slice(0, META_AGENT_COOLDOWN_RUNS);
  return recentWindow.some(r => r.agentType === agentType);
};
```

**Blind spots:**
- Link agent ran but didn't link anything → still waits 20 iterations
- Quality agent ran but failed to improve pages → no retry
- No tracking of meta agent effectiveness
- No escalation if issues persist across runs

---

### 9. No Dependency-Aware Prioritization

**Problem:** File importance doesn't consider code relationships.

**Missing considerations:**
- Files imported by many others should document API contracts first
- Circular dependencies might need holistic documentation
- Tightly coupled modules should be documented together
- No understanding of component boundaries

---

### 10. Concurrent Work Coordination Issues

**Problem:** Multiple workers can claim overlapping work.

**Code evidence:**
```typescript
// strategies.ts:186-222 - Exploration strategy
const lowCoverageDirs = context.directoryCoverage
  .filter(d => d.coveragePercent < thresholds.coverageThreshold)
  .slice(0, thresholds.maxDirectories);

for (const dir of lowCoverageDirs) {
  // Only checks existingWorkKeys, not pending work from other workers
  if (ctx.existingWorkKeys.has(key)) continue;
```

**Blind spots:**
- Two workers could both schedule `src/services/` exploration before either starts
- Race condition window between check and work creation
- No awareness of what other workers are currently processing

---

### 11. Confidence Score Reliability

**Problem:** Heavy reliance on `confidence` scores that may not be calibrated.

**Issues:**
- Confidence is set by individual agents with no calibration
- Different agents may use different confidence scales
- No validation that confidence correlates with actual quality
- Bootstrap might set high confidence on auto-generated stubs

---

### 12. No Cross-Page Consistency Awareness

**Problem:** Pages documented separately might conflict.

**Missing:**
- No detection of contradictory information across pages
- API changes might be documented on one page but not others
- Terminology inconsistency across pages
- Architecture descriptions might diverge

---

## Ideal Strategy Proposal

### 1. Multi-Dimensional Quality Scoring

Replace page count with a composite quality score:

```typescript
interface WikiQualityScore {
  // Coverage dimension
  codebaseCoverage: number;      // % of important code documented
  apiDocumentation: number;       // % of public APIs with docs

  // Depth dimension
  semanticDepth: number;          // LLM-assessed explanation quality
  exampleQuality: number;         // Working, relevant examples

  // Freshness dimension
  codeAlignment: number;          // Wiki matches current code
  lastVerified: Date;             // When content was last validated

  // Usability dimension
  navigability: number;           // Can users find what they need?
  searchability: number;          // Are key terms indexed?
}
```

### 2. Importance-Weighted Coverage

Weight coverage by code importance:

```typescript
interface FileImportance {
  path: string;

  // Static analysis signals
  dependentCount: number;         // Files that import this
  dependencyCount: number;        // Files this imports
  isEntryPoint: boolean;          // Main, index, cli entry points
  isPublicApi: boolean;           // Exported to package consumers

  // Historical signals
  changeFrequency: number;        // Commits touching this file
  authorCount: number;            // Distinct contributors
  bugFixCount: number;            // Bug fix commits

  // Computed importance
  importanceScore: number;        // Weighted combination
}
```

### 3. Semantic Coverage Assessment

Use LLM to assess actual coverage quality:

```typescript
interface SemanticCoverage {
  filePath: string;

  // What should be documented
  mainPurpose: string;            // What does this file do?
  keyAbstractions: string[];      // Main classes/functions
  publicInterface: string[];      // Public API surface

  // What is documented
  documentedAspects: string[];    // What wiki explains
  undocumentedAspects: string[];  // Missing explanations

  // Quality assessment
  explanationAccuracy: number;    // Does wiki match code?
  explanationCompleteness: number;// How much is covered?
  exampleRelevance: number;       // Do examples help?
}
```

### 4. Adaptive Thresholds

Learn thresholds from outcomes:

```typescript
interface AdaptiveConfig {
  // Base thresholds
  baseThresholds: Record<string, number>;

  // Outcome tracking
  outcomeHistory: Array<{
    threshold: string;
    value: number;
    resultQuality: number;
  }>;

  // Computed optimal thresholds
  computeOptimalThreshold(name: string): number;
}
```

### 5. User Signal Integration

Incorporate usage feedback:

```typescript
interface UsageSignals {
  // Direct feedback
  helpfulRatings: Map<string, number>;   // Page -> avg rating
  reportedIssues: Map<string, string[]>; // Page -> issues

  // Inferred signals
  searchMisses: string[];                // Queries with no results
  exitAfterSearch: string[];             // Pages users left quickly
  editSuggestions: Map<string, string[]>;// User-proposed changes

  // Derived priorities
  getPriorityPages(): string[];          // Pages needing attention
  getDocumentationGaps(): string[];      // Missing topics
}
```

### 6. Outcome-Based Meta Agent Scheduling

Schedule meta agents based on their effectiveness:

```typescript
interface MetaAgentEffectiveness {
  agentType: string;

  // Run history
  runs: Array<{
    timestamp: Date;
    inputState: WikiQualityScore;
    outputState: WikiQualityScore;
    pagesAffected: number;
  }>;

  // Computed metrics
  avgQualityImprovement: number;
  successRate: number;

  // Scheduling decision
  shouldRun(currentState: WikiQualityScore): boolean;
  expectedImpact(): number;
}
```

### 7. Coordinated Concurrent Work

Prevent overlap with explicit work partitioning:

```typescript
interface WorkPartition {
  // Assigned regions
  workerId: string;
  assignedPaths: string[];       // Exclusive ownership

  // Coordination
  claimPath(path: string): boolean;
  releasePath(path: string): void;

  // Conflict detection
  detectOverlap(otherPartition: WorkPartition): string[];
}
```

### 8. Continuous Verification

Regularly verify wiki accuracy:

```typescript
interface VerificationJob {
  pagePath: string;
  lastVerified: Date;

  // Verification result
  codeStillExists: boolean;      // Referenced code still there?
  apisStillValid: boolean;       // API signatures match?
  examplesStillWork: boolean;    // Code examples compile/run?

  // Staleness detection
  suspectedStaleContent: string[];
  recommendedUpdates: string[];
}
```

### 9. Holistic Documentation Planning

Plan documentation at system level:

```typescript
interface DocumentationPlan {
  // System understanding
  componentMap: Map<string, string[]>;     // Component -> files
  dataFlows: Array<{from: string, to: string}>;
  entryPoints: string[];

  // Documentation strategy
  documentationOrder: string[];            // Optimal order
  groupings: Map<string, string[]>;        // Related files to document together

  // Progress tracking
  plannedPages: Map<string, PagePlan>;
  actualPages: Map<string, string>;        // Page path -> content hash
}
```

### 10. Quality Gates

Enforce quality before marking work complete:

```typescript
interface QualityGate {
  check(page: WikiPage): QualityResult;
}

interface QualityResult {
  passed: boolean;

  // Individual checks
  hasSubstantiveContent: boolean;  // Not just a stub
  referencesExist: boolean;        // Linked code exists
  linksValid: boolean;             // Internal links resolve
  noContradictions: boolean;       // Consistent with other pages

  // Remediation
  issues: string[];
  suggestedFixes: string[];
}
```

---

## Summary of Key Improvements

| Current Approach | Proposed Improvement |
|-----------------|---------------------|
| Page count as progress | Multi-dimensional quality score |
| Binary mention = covered | Semantic coverage assessment |
| All files equal importance | Dependency + history weighted importance |
| Fixed magic thresholds | Adaptive thresholds from outcomes |
| No user feedback | Usage signals integration |
| Time-based cooldowns | Outcome-based scheduling |
| Independent work items | Coordinated partitioned work |
| One-time generation | Continuous verification |
| File-by-file documentation | System-level documentation planning |
| Implicit quality assumptions | Explicit quality gates |

The ideal orchestrator would understand not just *what* is documented, but *how well* it's documented, *whether* it's accurate, and *if* users find it useful. It would adapt its strategy based on measured outcomes rather than relying on hardcoded heuristics.
