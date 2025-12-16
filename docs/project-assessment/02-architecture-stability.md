# Architecture Stability Assessment

**Assessment Date:** 2025-12-16
**Repository:** CodeWiki
**Total Commits Analyzed:** 338
**Assessment Scope:** Complete git history and source code structure

---

## Executive Summary

The CodeWiki project exhibits **moderate architectural instability** with clear hotspots in the orchestrator and coverage calculation systems. While the codebase has good separation of concerns at the top level (agents, commands, queries, domain), there are concerning patterns of repeated fixes in the same areas, suggesting underlying design issues rather than simple bugs.

**Key Concerns:**
- **22% of all commits** (74/338) are coverage-related fixes
- **15% of all commits** (52/338) are orchestrator-related fixes
- The top 5 most-changed files are all part of the orchestrator/coverage system
- Evidence of design churn: same issues fixed multiple times in slightly different ways

**Positive Aspects:**
- Clear CQRS architecture (commands/queries separation)
- Good domain model isolation
- Comprehensive test coverage following source changes
- Well-documented known issues

---

## 1. File Churn Hotspots

### Top 20 Most-Changed Files

| Rank | File | Changes | Analysis |
|------|------|---------|----------|
| 1 | `src/agents/analysis/codebase-explorer-agent.ts` | 20 | Coverage tracking, depth traversal, prompt reliability issues |
| 2 | `src/commands/update-wiki-page.ts` | 19 | Link extraction, content merging, similarity detection fixes |
| 3 | `src/agents/orchestrator/context-gatherer.ts` | 19 | Coverage calculation, directory expansion bugs |
| 4 | `src/agents/orchestrator/strategies.ts` | 18 | Work deduplication, coverage-aware features, cooldown fixes |
| 5 | `src/agents/orchestrator/orchestrator.ts` | 18 | Phase management, work generation logic |
| 6 | `src/executor/executor.ts` | 16 | Agent execution, error handling |
| 7 | `src/agents/meta/link-agent.ts` | 15 | Link generation, merge logic, scheduling |
| 8 | `tests/unit/update-wiki-page.test.ts` | 12 | Following source changes (good) |
| 9 | `src/agents/orchestrator/phased-orchestrator.ts` | 12 | Phase transition logic |
| 10 | `tests/unit/context-gatherer-unified.test.ts` | 9 | Following source changes (good) |
| 11 | `tests/integration/wiki-analysis.test.ts` | 9 | Following source changes (good) |
| 12 | `src/domain/wiki-page.ts` | 9 | Field additions, tracking data |
| 13 | `src/analysis/self-improvement-agent.ts` | 9 | Prompt improvements, tool usage |
| 14 | `src/agents/synthesis/overview-agent.ts` | 9 | Link generation, content quality |
| 15 | `src/agents/meta/category-agent.ts` | 9 | Category assignment logic |
| 16 | `src/agents/analysis/code-change-agent.ts` | 9 | Commit analysis improvements |
| 17 | `src/agents/orchestrator/prompts.ts` | 8 | LLM prompt tuning |
| 18 | `src/agents/meta/quality-agent.ts` | 8 | Quality scoring adjustments |
| 19 | `src/agents/analysis/pattern-agent.ts` | 8 | Pattern detection refinements |
| 20 | `tests/unit/link-agent.test.ts` | 8 | Following source changes (good) |

### File Size Analysis

Largest files (by line count):

| File | Lines | Concern Level |
|------|-------|---------------|
| `src/agents/orchestrator/phased-orchestrator.ts` | 1,330 | ⚠️ High - May need splitting |
| `src/agents/orchestrator/orchestrator.ts` | 941 | ⚠️ High - Complex orchestration logic |
| `src/agents/analysis/codebase-explorer-agent.ts` | 925 | ⚠️ High - High churn + large size |
| `src/web/routes/repos.ts` | 922 | ⚠️ High - Route handler too large |
| `src/executor/executor.ts` | 886 | ⚠️ Moderate - Central execution logic |

---

## 2. Repeated Fix Patterns

Analysis of commit messages reveals **systematic instability** in specific subsystems:

### Coverage System (74 commits - 22% of all commits)

**Recent coverage-related fixes:**
- "Fix coverage stagnation by tracking filesAccessed on existing pages"
- "Fix coverage tree to use tracked coverage instead of text-based matching"
- "Fix coverage spike by removing directory expansion for targetPaths"
- "Fix directory expansion bug in context-gatherer that caused coverage regression"
- "Fix file tracking in merge operations and directory coverage"
- "Fix coverage tracking through EditRequest queue"
- "Switch to filesAccessed-based coverage for orchestrator work selection"
- "Fix coverage over-reporting from directory mentions in content"
- "Fix file coverage calculation bugs"
- "Unify coverage systems: work generation uses graduated scoring"

**Pattern identified:** The coverage calculation system has been repeatedly redesigned with different approaches:
1. Text-based matching (original)
2. Directory-based coverage
3. File-based tracking with filesAccessed
4. Graduated scoring system
5. Multiple bug fixes for each approach

**Root cause:** Fundamental design instability - the team hasn't settled on a correct model for "coverage"

### Orchestrator System (52 commits - 15% of all commits)

**Recent orchestrator-related fixes:**
- "Fix orchestrator premature exhaustion when work is in progress"
- "Fix Phase 2 orchestrator loop caused by coverage calculation bugs"
- "Fix orchestrator strategy system and fix coverage calculation"
- "Implement depth-first focus strategy for orchestrator"
- "Add iteration awareness to orchestrator for phase-based prioritization"
- "Prevent duplicate work items with deterministic IDs" (appears twice!)
- "Simplify orchestrator strategy system and fix coverage calculation"
- "Implement coverage-aware codebase explorer"

**Pattern identified:** The orchestrator keeps needing fixes for:
- Work item deduplication (solved multiple times)
- Phase transition logic
- Strategy selection
- Coverage integration

**Root cause:** Tight coupling between orchestrator, coverage, and work generation creates cascading changes

### Content Management (19 commits on update-wiki-page.ts)

**Repeated fixes:**
- Link extraction and merging
- Content similarity detection
- File tracking through update pipeline
- Intelligent merge vs simple append
- Title extraction edge cases

**Pattern identified:** The wiki page update command is a central integration point that absorbs complexity from:
- Multiple agent types
- Different content merge strategies
- Link management
- Coverage tracking
- History recording

---

## 3. Coupling Analysis

### High Coupling Cluster: Orchestrator System

Files that frequently change together:

```
src/agents/orchestrator/
├── context-gatherer.ts (19 changes)
├── strategies.ts (18 changes)
├── orchestrator.ts (18 changes)
├── phased-orchestrator.ts (12 changes)
├── file-coverage-tree.ts (7 changes)
├── prompts.ts (8 changes)
└── smart-coverage-filter.ts (3 changes)
```

**Analysis:** These files form a tightly coupled subsystem. Changes to coverage calculation ripple through all of them. Evidence from git log shows they often change together in the same commit.

**Coupling to external systems:**
- `src/domain/wiki-page.ts` (9 changes) - Coverage tracking fields added
- `src/commands/update-wiki-page.ts` (19 changes) - File tracking integration
- `src/domain/work-item.ts` (7 changes) - Work generation coupling

### Medium Coupling: Agent System

Each agent is relatively independent, BUT:
- All agents depend on `base-agent.ts` (6 changes)
- All agents use `response-parser.ts` (781 lines, parsing logic)
- Agents share `agent-helpers.ts` (utils)

**Positive:** Good separation between agent types (analysis vs synthesis vs meta)
**Concern:** Changes to base agent or parser affect all agents

### Import Dependency Analysis

**orchestrator.ts imports:**
```typescript
- repositories/index.js
- domain/work-item.js
- domain/work-target.js
- domain/agent-run.js
- services/llm/llm-service.js
- services/repository/unified-repo-access.js
- services/llm/codebase-tools.js
- agents/registry.js
- ./context-gatherer.js  (tight coupling)
- ./phased-orchestrator.js  (tight coupling)
```

**executor.ts imports:**
```typescript
- repositories/index.js
- services/git/git-service.js
- services/llm/llm-service.js
- domain/work-item.js
- agents/orchestrator/orchestrator.js  (coupling)
- agents/registry.js
- services/repository/repository-service.js
- domain/edit-request.js
```

**Observation:** Both orchestrator and executor are highly connected integration points. Changes anywhere in the system can require updates to these central components.

---

## 4. Directory Structure Assessment

```
src/
├── agents/              ✅ Good: Clear separation by agent type
│   ├── analysis/        (commit analyzers)
│   ├── consolidation/   (finding handlers)
│   ├── meta/            (quality, linking, structure)
│   ├── orchestrator/    ⚠️ Complex subsystem, high churn
│   ├── parsing/         (response parsing)
│   ├── research/        (MCP research agent)
│   ├── spec/            (specification agent)
│   └── synthesis/       (overview, guides)
├── commands/            ✅ Good: CQRS command handlers
├── queries/             ✅ Good: CQRS query handlers
├── domain/              ✅ Good: Domain models, minimal dependencies
├── executor/            ⚠️ Central integration point
├── repositories/        ✅ Good: Clear interface/implementation split
│   ├── interfaces/
│   ├── file-based/
│   └── mongo-based/
├── services/            ✅ Good: External service abstractions
│   ├── auth/
│   ├── git/
│   ├── github/
│   ├── llm/
│   └── repository/
├── utils/               ✅ Good: Shared utilities
└── web/                 ✅ Good: Web layer separated
    ├── routes/
    ├── views/
    └── public/
```

**Overall structure rating: 8/10**

**Strengths:**
- Clear CQRS architecture (commands/queries)
- Domain models isolated
- Repository pattern well-implemented
- Service layer abstractions

**Weaknesses:**
- Orchestrator subsystem is too complex (7 files, 4,600+ lines)
- Executor is a god class (886 lines, high coupling)
- Some web routes are too large (repos.ts: 922 lines)

---

## 5. Architectural Smells Identified

### Smell #1: God Class - Executor

**File:** `src/executor/executor.ts` (886 lines)

**Responsibilities:**
- Work item execution
- Agent lifecycle management
- Error handling and retries
- Edit request processing
- Continuous worker pool management
- Progress tracking
- Repository access coordination

**Issue:** Single file doing too much. Changes to any of these concerns require modifying this file.

**Evidence:** 16 changes across git history

### Smell #2: Feature Envy - Coverage Calculation

The coverage calculation logic is spread across multiple files:
- `file-coverage-tree.ts` - Building coverage tree
- `context-gatherer.ts` - Calculating coverage stats
- `strategies.ts` - Using coverage for decisions
- `codebase-explorer-agent.ts` - Coverage-aware file selection

**Issue:** Coverage is a cross-cutting concern that creates coupling. No single source of truth.

**Evidence:** 74 commits touching these files for coverage-related changes

### Smell #3: Primitive Obsession - Coverage Representation

Coverage is represented as:
- Numbers (0-100 percentages)
- Booleans (isCovered)
- Strings (file paths)
- Objects with various shapes

**Issue:** No strong type for "coverage" - easy to mix up different coverage concepts

**Code evidence:**
```typescript
// Different coverage representations found:
calculateFileCoverage(): number        // Returns 0-100
undocumentedRatio: number             // Returns 0-1
isCovered: boolean                    // Binary
filesAccessed: string[]               // List of files
```

### Smell #4: Shotgun Surgery - Adding Tracking Fields

To add a new tracking field to wiki pages requires changes to:
1. `domain/wiki-page.ts` - Add field to interface
2. `commands/update-wiki-page.ts` - Wire through create/update
3. `repositories/file-based/file-wiki-page-repository.ts` - Persistence
4. `repositories/mongo-based/mongo-wiki-page-repository.ts` - Persistence
5. `repositories/interfaces/wiki-page-repository.ts` - Update interface
6. `agents/orchestrator/context-gatherer.ts` - Use in coverage calc

**Evidence:** Recent addition of `synthesisType` field touched 6+ files

### Smell #5: Magic Numbers

Hardcoded thresholds throughout strategies:
```typescript
const FILE_COVERAGE_THRESHOLD = 50;
const MAX_DIRECTORIES_PER_RUN = 5;
const META_AGENT_COOLDOWN_RUNS = 10;
// And many more in strategies.ts
```

**Issue:** No data backing these numbers, chosen arbitrarily

---

## 6. Test Coupling Analysis

**Good news:** Tests follow source file changes closely

Most changed test files mirror most changed source files:
- `update-wiki-page.test.ts` (12 changes) follows `update-wiki-page.ts` (19 changes)
- `context-gatherer-unified.test.ts` (9 changes) follows `context-gatherer.ts` (19 changes)
- `link-agent.test.ts` (8 changes) follows `link-agent.ts` (15 changes)

**This is healthy** - it means tests are being updated with the code.

**Test organization:**
```
tests/
├── unit/              ✅ Unit tests for individual modules
├── integration/       ✅ Integration tests for subsystems
├── llm/              ✅ Real LLM semantic accuracy tests
├── e2e/              ✅ End-to-end Playwright tests
├── helpers/          ✅ Shared test utilities
└── fixtures/         ✅ Test data
```

---

## 7. Circular Dependencies

**Manual inspection found:** ❌ No circular dependencies detected

The codebase follows a clean layering:
```
Web Layer (routes)
  ↓
Commands/Queries (CQRS)
  ↓
Domain Models + Agents
  ↓
Repositories + Services
  ↓
External Systems (Git, LLM, Database)
```

**Positive finding:** Good dependency flow, no circular imports

---

## 8. Historical Stability Trends

### Commit Pattern Analysis

**First 50 commits (early development):**
- Feature additions
- Initial agent implementations
- Core infrastructure

**Commits 51-200 (growth phase):**
- Orchestrator improvements
- Coverage system iteration
- Agent refinements

**Recent 50 commits (current state):**
- **16 coverage-related fixes** (32% of recent commits!)
- **8 orchestrator fixes** (16% of recent commits!)
- Pattern: fixing the same systems repeatedly

### Stability Metric: Fix Density

| Subsystem | Total Changes | Fix Changes | Fix Ratio |
|-----------|---------------|-------------|-----------|
| Coverage system | 74 | ~60 | 81% fixes |
| Orchestrator | 52 | ~40 | 77% fixes |
| Update wiki page | 19 | ~15 | 79% fixes |
| Agents (general) | ~100 | ~30 | 30% fixes |
| Domain models | ~20 | ~5 | 25% fixes |

**Interpretation:**
- Coverage and orchestrator are in a state of constant repair
- Agents and domain are more stable (more feature additions than fixes)

---

## 9. Architectural Concerns by Severity

### CRITICAL Concerns

1. **Coverage System Instability**
   - 74 commits (22% of all commits) fixing coverage issues
   - Multiple redesigns indicate fundamental design problem
   - Current graduated scoring approach is the 5th iteration
   - **Impact:** Orchestrator decisions are based on unstable foundation

2. **Orchestrator Complexity**
   - 7 files, 4,600+ lines of interconnected code
   - 52 commits of fixes and adjustments
   - Two different orchestrator implementations (deterministic + phased)
   - **Impact:** Hard to understand, hard to modify, high change risk

### HIGH Concerns

3. **Executor God Class**
   - 886 lines, too many responsibilities
   - 16 changes indicating high touch rate
   - Central integration point = bottleneck for changes
   - **Impact:** Changes to agent execution affect entire system

4. **Tight Coupling: Orchestrator ↔ Coverage**
   - Changes to coverage calculation require orchestrator updates
   - Changes to orchestrator require coverage system updates
   - **Impact:** Simple changes become complex

### MEDIUM Concerns

5. **Large Web Routes**
   - `repos.ts`: 922 lines
   - Multiple responsibilities in single route handlers
   - **Impact:** Web layer maintenance burden

6. **Repeated Fix Pattern**
   - Same issues fixed multiple times in slightly different ways
   - Work item deduplication fixed at least 3 times
   - Coverage bugs keep returning
   - **Impact:** Suggests incomplete fixes or missing root cause analysis

### LOW Concerns

7. **Magic Numbers**
   - Hardcoded thresholds without data backing
   - **Impact:** Potentially suboptimal orchestrator decisions

8. **Primitive Obsession**
   - Coverage represented in multiple primitive forms
   - **Impact:** Code clarity, easier to make mistakes

---

## 10. Recommendations for Stabilization

### Immediate Actions (High Impact, Low Effort)

1. **Freeze coverage calculation approach**
   - Document the current graduated scoring as the "final" approach
   - Add comprehensive tests to prevent regression
   - Resist temptation to redesign again
   - **Effort:** 1 week (documentation + tests)

2. **Add stability tests**
   - Create regression tests for the top 10 most-fixed bugs
   - Prevent coverage calculation from changing unexpectedly
   - **Effort:** 2 days

3. **Document architectural boundaries**
   - Write explicit contracts between orchestrator, coverage, and strategies
   - Make coupling explicit and intentional
   - **Effort:** 3 days

### Short-term Actions (High Impact, Medium Effort)

4. **Refactor Executor**
   - Split into smaller, focused classes:
     - `WorkItemExecutor` - Execute single work item
     - `AgentLifecycleManager` - Agent creation and cleanup
     - `ExecutionOrchestrator` - Coordinate multiple executions
     - `ProgressTracker` - Track and report progress
   - **Effort:** 2 weeks
   - **Risk:** Medium (core component, needs careful testing)

5. **Simplify Orchestrator Subsystem**
   - Merge `orchestrator.ts` and `phased-orchestrator.ts` (pick one approach)
   - Move coverage tree building to dedicated module
   - Reduce file count from 7 to 4
   - **Effort:** 2 weeks
   - **Risk:** Medium

6. **Create Coverage Domain Model**
   - Replace primitives with `FileCoverage` type
   - Single source of truth for coverage calculations
   - Clear interface: `FileCoverage.calculate(file, pages): Coverage`
   - **Effort:** 1 week

### Long-term Actions (High Impact, High Effort)

7. **Architectural Review**
   - Formal review of orchestrator architecture
   - Consider Event Sourcing for orchestrator decisions (provenance)
   - Evaluate if current CQRS implementation is sufficient
   - **Effort:** 1 month

8. **Reduce Coupling**
   - Introduce Domain Events for orchestrator → coverage communication
   - Use Dependency Injection more consistently
   - Clear ownership: who owns coverage calculation?
   - **Effort:** 1 month

9. **Performance Monitoring**
   - Add metrics for orchestrator decision time
   - Track coverage calculation performance
   - Identify bottlenecks before they become stability issues
   - **Effort:** 2 weeks

### Preventive Measures

10. **Code Review Checklist**
    - New coverage-related code requires explicit justification
    - Changes to orchestrator require architecture review
    - No magic numbers without constants + documentation
    - **Effort:** Ongoing

11. **Change Impact Analysis**
    - Before committing, analyze which files will change together
    - If >5 files change for small feature, reconsider design
    - **Effort:** Ongoing

---

## 11. Stability Score by Subsystem

| Subsystem | Churn | Coupling | Size | Bugs | Stability Score | Grade |
|-----------|-------|----------|------|------|-----------------|-------|
| Domain Models | Low | Low | Small | Few | 9/10 | A |
| Repositories | Low | Medium | Medium | Few | 8/10 | B+ |
| Agents (Analysis) | Medium | Low | Medium | Medium | 7/10 | B- |
| Agents (Synthesis) | Medium | Low | Medium | Medium | 7/10 | B- |
| Agents (Meta) | Medium | Medium | Medium | Medium | 6/10 | C+ |
| Services | Low | Medium | Medium | Few | 7/10 | B- |
| Commands/Queries | Low | Low | Small | Few | 8/10 | B+ |
| **Coverage System** | **Very High** | **High** | **Medium** | **Many** | **3/10** | **F** |
| **Orchestrator** | **Very High** | **Very High** | **Large** | **Many** | **3/10** | **F** |
| **Executor** | **High** | **Very High** | **Large** | **Medium** | **4/10** | **D** |
| Web Layer | Medium | Medium | Large | Few | 6/10 | C+ |
| Overall | - | - | - | - | **6/10** | **C+** |

---

## 12. Conclusion

The CodeWiki project demonstrates **moderate architectural stability** with clear problem areas:

✅ **Strengths:**
- Well-structured CQRS architecture
- Good separation of concerns in domain models
- No circular dependencies
- Tests follow source changes (healthy)
- Active documentation of known issues

⚠️ **Concerns:**
- Coverage system in constant flux (81% of changes are fixes)
- Orchestrator complexity and instability (77% of changes are fixes)
- God class pattern in Executor
- Tight coupling creates cascading changes

🎯 **Overall Assessment:**
The project is **architecturally sound at the macro level** but has **unstable subsystems** that require repeated fixes. The root cause is not poor architecture per se, but rather:
1. **Insufficient design validation** before implementation (coverage system redesigned 5 times)
2. **Feature creep** in central components (executor, orchestrator)
3. **Premature optimization** (complex strategies before understanding the problem)

**Recommended Priority:**
1. Stabilize coverage calculation (highest pain point)
2. Refactor executor to reduce god class pattern
3. Simplify orchestrator (pick one approach, remove the other)
4. Add architectural guardrails to prevent future instability

With focused refactoring effort over 1-2 months, this project could achieve **high stability** (8/10). The foundation is solid; the specific subsystems need attention.

---

**Assessment Completed By:** Automated Analysis
**Next Steps:** Review with team, prioritize recommendations, create refactoring roadmap
