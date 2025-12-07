# Issue 6: Orchestrator Cannot Learn from Results

## Severity: MEDIUM

## Summary

The orchestrator decides what work to prioritize, but it has no access to benchmark results or quality scores. It might keep scheduling work that doesn't improve quality while ignoring work that would.

---

## The Orchestrator's View

### What the Orchestrator Sees

```typescript
// Orchestrator receives:
- Commit coverage stats (% processed per agent type)
- Work queue status (pending, completed, failed items)
- Wiki page count and coverage tree
- Open findings (from meta agents)
- Directory exploration coverage
```

### What the Orchestrator Cannot See

```typescript
// Orchestrator cannot access:
- Benchmark question scores (which topics score poorly)
- Quality benchmark results (which dimensions are weak)
- Page-level accuracy grades
- Historical improvement trends
- Which agent outputs consistently score poorly
```

---

## The Disconnect

### Scenario: Systematic Blindspot

1. Pattern Agent consistently misidentifies patterns in `src/repositories/`
2. Wiki pages about repositories score 30% accuracy on benchmarks
3. Self-improvement agent identifies this in its report
4. But orchestrator keeps scheduling Pattern Agent for new commits
5. More incorrect pattern documentation accumulates
6. Nothing changes until human reads report and intervenes

### What Should Happen

1. Pattern Agent produces low-accuracy output for repositories
2. Benchmark results show this area is weak
3. Orchestrator sees: "repository patterns need attention"
4. Orchestrator prioritizes: CodebaseExplorerAgent for `src/repositories/`
5. Or: Schedules re-analysis with different approach
6. Next benchmark shows improvement

---

## Evidence from Architecture

### Orchestrator Strategies

```typescript
// src/agents/orchestrator/strategies.ts

// Strategies prioritize based on:
- Commit recency (recent first)
- Coverage gaps (unprocessed commits)
- Finding count (pages with issues)
- Exploration targets (undocumented areas)

// Strategies do NOT consider:
- Benchmark accuracy scores
- Quality dimension scores
- Historical agent performance
- Content correctness
```

### Benchmark System Is Isolated

```typescript
// src/benchmark/benchmark-runner.ts
// Runs after wiki generation
// Stores results in BenchmarkRepository
// Never accessed by orchestrator

// src/agents/orchestrator/orchestrator.ts
// Has no dependency on BenchmarkRepository
// Cannot query benchmark results
```

---

## Impact on Wiki Quality

### 1. Repeated Mistakes

If an agent type consistently produces poor output for certain topics, the orchestrator has no way to:
- Deprioritize that agent for those topics
- Try a different approach
- Skip generating content for known-weak areas

### 2. Ignored Improvement Opportunities

If benchmarks show specific questions that consistently fail:
- Those topics need attention
- But orchestrator doesn't know about them
- Continues scheduling based on coverage, not quality

### 3. No Adaptive Prioritization

A smart orchestrator would:
- See that architecture pages score high
- See that getting-started guides score low
- Prioritize work on getting-started content

Current orchestrator:
- Schedules based on coverage stats
- Treats all pages equally
- Quality differences invisible

---

## The Intentional Design

This separation was intentional:
- Benchmarks run **after** wiki generation
- Self-improvement is **offline** analysis
- Avoids tight coupling between generation and evaluation

But it creates a human bottleneck:
```
Generation → Benchmarks → Self-Improvement → Human Review → Manual Fixes
                                                    ↑
                                              This is slow
```

---

## Potential Risks of Adding Feedback

### 1. Gaming Metrics
If orchestrator optimizes for benchmark scores, agents might:
- Produce content that scores well but isn't useful
- Focus on benchmark questions, ignore other topics

### 2. Feedback Loops
If orchestrator keeps re-running agents on low-scoring pages:
- Might never converge
- Might waste resources on inherently hard topics

### 3. Stale Data
If benchmark data is from a previous run:
- Orchestrator might prioritize based on outdated scores
- Need to handle data freshness

---

## Recommended Approach

### Immediate (Low Risk)
1. **Read-only benchmark visibility**
   Let orchestrator see benchmark results but don't change algorithms yet.
   ```typescript
   // Add to orchestrator context
   const lastBenchmark = await benchmarkRepo.getLatest(repoId);
   const lowScoringTopics = lastBenchmark.questions
     .filter(q => q.grade !== 'accurate')
     .map(q => q.topic);
   ```

2. **Log orchestrator decisions with benchmark context**
   See if decisions would change if orchestrator could see scores.

### Short-term (Moderate Risk)
3. **Soft prioritization hint**
   Orchestrator can see low-scoring topics but only uses as tiebreaker.
   ```typescript
   // When two work items have equal priority:
   // Prefer one that addresses a low-scoring topic
   ```

4. **Dedicated quality improvement mode**
   Separate run mode where orchestrator explicitly focuses on benchmark gaps.

### Medium-term (Needs Care)
5. **Adaptive orchestration**
   - Monitor improvement rate per topic
   - Deprioritize topics that don't improve despite work
   - Escalate stuck topics for human review

6. **Agent effectiveness tracking**
   - Track which agent outputs score well/poorly
   - Adjust agent selection for topic types

---

## Implementation Sketch

```typescript
// Add to orchestrator.ts

interface BenchmarkInsight {
  lowAccuracyTopics: string[];
  stuckQuestions: { question: string; iterations: number }[];
  weakQualityDimensions: string[];
}

async function getBenchmarkInsights(repoId: string): Promise<BenchmarkInsight> {
  const runs = await benchmarkRepo.getRecent(repoId, 5);

  return {
    lowAccuracyTopics: findLowAccuracyTopics(runs),
    stuckQuestions: findStuckQuestions(runs),
    weakQualityDimensions: findWeakDimensions(runs)
  };
}

// In work prioritization:
function prioritizeWork(items: WorkItem[], insights: BenchmarkInsight) {
  return items.sort((a, b) => {
    // Existing priority logic
    const basePriority = a.priority - b.priority;

    // Bonus for addressing low-accuracy topics
    const aBonus = addressesLowAccuracyTopic(a, insights) ? 10 : 0;
    const bBonus = addressesLowAccuracyTopic(b, insights) ? 10 : 0;

    return (basePriority + aBonus) - bBonus;
  });
}
```

---

## Metrics to Track

If implementing feedback loop:
- Benchmark score improvement rate (should increase)
- Orchestrator decision changes due to benchmark data
- Convergence rate for low-scoring topics
- False positive rate (topics marked low that are actually fine)
