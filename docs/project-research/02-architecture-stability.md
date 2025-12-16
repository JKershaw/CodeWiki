# Architecture Stability Analysis

## Executive Summary

CodeWiki exhibits a **highly unstable core architecture** centered around the orchestration layer. The project shows rapid development velocity (955 commits in 3 weeks, ~45 commits/day) with a concerning fix-to-commit ratio of 23% overall and 26.6% in the last week.

**Critical stability concerns:**
1. **Orchestration layer is the primary instability hotspot** - Three core files (orchestrator.ts, executor.ts, context-gatherer.ts) account for 159 total changes with 42 fixes
2. **Coverage calculation is fundamentally broken** - 63+ commits attempting to fix coverage issues, indicating architectural design problems
3. **Duplicate work item generation** - Recurring defect requiring multiple fix attempts
4. **Large, complex files** - Several 800-1300 line files in critical paths

**Areas of stability:**
- Individual agent implementations (relatively stable)
- Domain models (moderate churn, mostly additive)
- Test suite (well-maintained, tracks changes appropriately)
- Web UI (successfully refactored from monolith to modules)

## Top 20 Highest-Churn Files

| Rank | File | Commits | Fix Commits | Lines | Concern Level |
|------|------|---------|-------------|-------|---------------|
| 1 | `src/agents/orchestrator/orchestrator.ts` | 63 | 14 | 941 | CRITICAL |
| 2 | `src/executor/executor.ts` | 54 | 13 | 886 | CRITICAL |
| 3 | `src/web/public/app.js` | 48 | - | - | Medium (refactored) |
| 4 | `src/agents/orchestrator/context-gatherer.ts` | 42 | 15 | 738 | CRITICAL |
| 5 | `src/web/public/styles.css` | 38 | - | - | Low (cosmetic) |
| 6 | `src/web/server.ts` | 30 | 5 | - | Medium |
| 7 | `package.json` | 28 | - | - | Low (dependencies) |
| 8 | `src/agents/orchestrator/prompts.ts` | 27 | 8 | - | High |
| 9 | `src/commands/update-wiki-page.ts` | 25 | - | 626 | Medium |
| 10 | `src/agents/orchestrator/strategies.ts` | 25 | - | 661 | High |
| 11 | `src/agents/analysis/codebase-explorer-agent.ts` | 25 | - | 925 | Medium |
| 12 | `package-lock.json` | 24 | - | - | Low (auto-generated) |
| 13 | `src/analysis/prompts.ts` | 22 | - | - | Medium |
| 14 | `src/web/public/index.html` | 21 | - | - | Low |
| 15 | `src/services/llm/openrouter-llm-service.ts` | 21 | - | 744 | Medium |
| 16 | `src/agents/analysis/code-change-agent.ts` | 20 | - | 655 | Low |
| 17 | `src/agents/meta/link-agent.ts` | 19 | - | - | Low |
| 18 | `src/web/routes/repos.ts` | 18 | - | 922 | Medium |
| 19 | `src/cli.ts` | 16 | - | - | Low |
| 20 | `src/analysis/self-improvement-agent.ts` | 16 | - | - | Low |

## Directory-Level Analysis

Most active directories (by commit count):

| Directory | Changes | Analysis |
|-----------|---------|----------|
| `tests/unit` | 299 | Expected - tracks implementation changes |
| `src/agents/orchestrator` | 183 | **CRITICAL HOTSPOT** - core instability |
| `src/agents/analysis` | 116 | Moderate - feature additions |
| `src/web/public` | 107 | Successfully refactored to modules |
| `src/domain` | 100 | Healthy - mostly additive changes |
| `src/web/routes` | 96 | Moderate - feature growth |
| `tests/integration` | 94 | Expected - tracks features |
| `src/agents/synthesis` | 93 | Low - stable agent implementations |
| `src/repositories/file-based` | 89 | Medium - abstraction refactoring |
| `src/agents/meta` | 79 | Low - stable implementations |

### Orchestrator Subdirectory Breakdown

The orchestrator directory dominates source code churn:

- `orchestrator/` - 183 changes (38% of non-test changes to agents)
- `analysis/` - 116 changes
- `synthesis/` - 93 changes
- `meta/` - 79 changes

This 2:1 ratio compared to all other agent types combined indicates **fundamental architectural problems in the orchestration layer**.

## Architectural Concerns

### 1. The Coverage Calculation Crisis (CRITICAL)

**Evidence:**
- 63 commits related to "coverage"
- 72 commits mentioning coverage OR duplicates
- Multiple regression cycles visible in commit history

**Specific failures:**
- Coverage spikes (directory expansion bugs)
- Coverage stagnation (tracking issues)
- Coverage over-reporting (text-based matching)
- Coverage regression (multiple fixes, each introducing new bugs)
- Coverage tree bugs (switched between implementations multiple times)

**Sample commit messages:**
- "Fix coverage spike by removing directory expansion for targetPaths"
- "Fix coverage stagnation by tracking filesAccessed on existing pages"
- "Fix coverage tree to use tracked coverage instead of text-based matching"
- "Fix coverage over-reporting from directory mentions in content"
- "Fix file coverage calculation bugs"
- "Fix coverage regression"
- "Unify coverage systems: work generation uses graduated scoring"

**Root cause analysis:**
This represents a **fundamental design flaw**. Coverage calculation is not a leaf feature - it's a core abstraction that multiple systems depend on:
- Work item generation
- Orchestrator decision-making
- Progress tracking
- File/directory traversal

The fact that this system has been rewritten/fixed 10+ times in 3 weeks suggests:
1. No clear specification of what "coverage" means
2. Tight coupling between coverage and multiple subsystems
3. Insufficient integration testing
4. Reactive fixing rather than root cause analysis

**Recommendation:** Stop patching. Conduct a design review to:
1. Define a formal specification for coverage
2. Design a dedicated Coverage Service with clear interfaces
3. Write comprehensive integration tests BEFORE reimplementing
4. Consider whether coverage needs to be a first-class concept or can be computed

### 2. Duplicate Work Item Generation (HIGH)

**Evidence:**
- 14 commits related to "duplicate" or "duplication"
- Multiple fix attempts over project lifetime

**Specific failures:**
- Bootstrap agent duplication
- Duplicate work items from concurrent job queue
- Code duplication issues requiring semantic similarity checks

**Sample commit messages:**
- "Prevent duplicate work items with deterministic IDs" (appears TWICE)
- "Fix bootstrap agent duplication when filling concurrent job queue slots"
- "Fix code duplication with semantic similarity checks"
- "Add duplicatesFiltered display to processing progress UI"

**Root cause analysis:**
Work item uniqueness is being enforced at the wrong layer. Adding "deterministic IDs" is a patch, not a solution. The fact that this fix appears twice suggests:
1. Non-deterministic ID generation despite being called "deterministic"
2. Race conditions in concurrent work item creation
3. No database-level uniqueness constraints

**Recommendation:**
1. Move uniqueness enforcement to the data layer (unique constraints)
2. Use database transactions for work item creation
3. Design work items as immutable (create new instead of update)
4. Add integration tests for concurrent work item generation

### 3. Orchestrator State Machine Complexity (CRITICAL)

**Evidence:**
- orchestrator.ts: 941 lines, 63 commits, 14 fixes
- phased-orchestrator.ts: 1330 lines (NEW file, already problematic)
- Multiple "premature exhaustion" and "stagnation" fixes

**Specific failures:**
- "Fix orchestrator premature exhaustion when work is in progress"
- "Fix Phase 2 orchestrator loop caused by coverage calculation bugs"
- Multiple strategy system refactorings

**Sample recent commits to phased-orchestrator.ts:**
- "Fix coverage spike by removing directory expansion for targetPaths"
- "Prevent duplicate work items with deterministic IDs" (x2)
- "Fix Phase 2 orchestrator loop caused by coverage calculation bugs"
- "Fix coverage over-reporting from directory mentions in content"
- "Fix file coverage calculation bugs"

**Root cause analysis:**
The orchestrator is trying to do too much:
1. Decide what work to do (planning)
2. Gather context from repository (data access)
3. Calculate coverage (metrics)
4. Manage work queue (coordination)
5. Track progress (observability)
6. Handle LLM fallback logic (resilience)

This violates the Single Responsibility Principle at an architectural level.

**Recommendation:**
1. Split orchestrator into separate services:
   - WorkPlanner (generates work items)
   - CoverageCalculator (tracks what's documented)
   - ProgressTracker (metrics/observability)
   - WorkQueue (job scheduling)
2. Use event sourcing to track orchestrator decisions
3. Implement state machine formally (consider using a library)
4. Move the 1330-line phased-orchestrator into a proper phase management system

### 4. Executor Complexity (HIGH)

**Evidence:**
- executor.ts: 886 lines, 54 commits, 13 fixes
- Handles multiple concerns: work claiming, agent execution, edit processing, job queue

**Specific failures:**
- Coverage tracking through edit requests
- Premature exhaustion detection
- Priority handling removed then re-added
- Job queue optimization attempts

**Root cause analysis:**
The executor is the "god object" of the system. It coordinates everything but owns too much logic.

**Recommendation:**
1. Extract edit request handling to separate service
2. Move job queue to separate module
3. Executor should ONLY: claim work, run agent, report result
4. Use dependency injection to reduce coupling

### 5. Context Gatherer Instability (CRITICAL)

**Evidence:**
- context-gatherer.ts: 738 lines, 42 commits, 15 fixes (highest fix rate!)
- Multiple depth traversal bugs
- Directory expansion bugs
- File tracking bugs

**Sample commits:**
- "Fix directory expansion bug in context-gatherer that caused coverage regression"
- "Fix file tracking in merge operations and directory coverage"
- "Fix explorer depth traversal to discover deeply nested files"
- "Fix GitHub tree API truncation causing coverage instability"

**Root cause analysis:**
Context gathering is conflating multiple concerns:
1. Repository traversal (recursive file discovery)
2. Coverage calculation (what's documented)
3. Context windowing (what to send to LLM)
4. Priority file handling

The tight coupling with coverage means coverage bugs cascade into context bugs.

**Recommendation:**
1. Separate repository traversal from coverage
2. Use tested libraries for tree traversal (don't roll your own)
3. Add property-based tests for tree operations
4. Make context gathering deterministic (same inputs = same output)

## Coupling Patterns

### Tight Coupling Web

The following coupling patterns are evident:

1. **Orchestrator ↔ Coverage**
   - Orchestrator cannot make decisions without coverage
   - Coverage bugs break orchestration
   - Creates cascading failures

2. **ContextGatherer ↔ Coverage**
   - Context gathering depends on coverage calculation
   - Coverage changes break context gathering
   - Directory traversal tied to coverage

3. **Executor ↔ Orchestrator ↔ ContextGatherer**
   - All three change together frequently
   - Suggests they should be in the same module OR have cleaner interfaces
   - Current abstraction boundaries are wrong

4. **Domain Models ↔ Multiple Features**
   - work-item.ts: 13 changes (fields added for various features)
   - wiki-page.ts: 13 changes (fields added incrementally)
   - agent-run.ts: 13 changes
   - Suggests domain model is not stable

5. **Web UI ↔ Backend**
   - app.js had 57 commits before refactoring
   - Successfully split into modules (good outcome)
   - Shows what proper refactoring looks like

## Large File Analysis

Files exceeding 800 lines (complexity hotspots):

| File | Lines | Commits | Status |
|------|-------|---------|--------|
| `phased-orchestrator.ts` | 1330 | 13 | NEW - already problematic |
| `orchestrator.ts` | 941 | 63 | CRITICAL - needs splitting |
| `codebase-explorer-agent.ts` | 925 | 25 | Review needed |
| `repos.ts` (web route) | 922 | 18 | Consider splitting |
| `executor.ts` | 886 | 54 | CRITICAL - needs splitting |
| `technical-debt-agent.ts` | 814 | 13 | Monitor |
| `research-agent.ts` | 810 | 8 | Monitor |
| `response-parser.ts` | 781 | 6 | Stable (large but stable) |
| `self-improvement.ts` (route) | 779 | - | Monitor |
| `openrouter-llm-service.ts` | 744 | 21 | Review needed |
| `context-gatherer.ts` | 738 | 42 | CRITICAL - needs redesign |
| `pattern-agent.ts` | 734 | 15 | Monitor |
| `dependency-agent.ts` | 720 | 13 | Monitor |
| `file-coverage-tree.ts` | 675 | - | Related to coverage issues |

**Concern:** The three CRITICAL files are all in the orchestration/execution layer (orchestrator, executor, context-gatherer). This is where the architectural problems are concentrated.

## Refactoring Patterns

**Good refactoring (completed):**
1. ✅ Web UI: Refactored app.js monolith → modular architecture (19 modules)
2. ✅ Repository abstraction: Migrated to UnifiedRepoAccess
3. ✅ CQRS: Migrated agents to query layer
4. ✅ Response parsing: Centralized parser for agents
5. ✅ Test framework: Migrated from Vitest to Node test runner

**Active refactoring (in progress):**
1. 🔄 Orchestrator implementations (multiple implementations attempted)
2. 🔄 Coverage system (being unified/rewritten)
3. 🔄 Work queue logic (continuous optimization)

**Failed/problematic refactoring:**
1. ❌ Coverage tree: Multiple implementations tried, still buggy
2. ❌ Priority system: Added, removed, re-added
3. ❌ Strategy system: Refactored multiple times

**Pattern analysis:**
- Successful refactorings extract concerns cleanly (web UI → modules)
- Failed refactorings involve the orchestration layer
- Suggests: **orchestration layer has unclear responsibilities**

## Repeat Offenders

Files being "fixed" repeatedly (excluding initial implementation):

| File | Fix Count | Representative Fixes |
|------|-----------|---------------------|
| `context-gatherer.ts` | 15 | Directory expansion, depth traversal, file tracking, coverage regression |
| `orchestrator.ts` | 14 | Coverage calculation, premature exhaustion, duplication, strategy bugs |
| `executor.ts` | 13 | Coverage tracking, exhaustion detection, edit processing, queue issues |
| `prompts.ts` | 8 | Prompt-strategy misalignment |
| `web/server.ts` | 5 | Various web server issues |

**Analysis:** The top 3 repeat offenders are all part of the orchestration layer. This is not coincidence - it's architectural.

## Test Churn Analysis

Top test files by churn:

| Test File | Changes | Indicates |
|-----------|---------|-----------|
| `context-gatherer-depth.test.ts` | 13 | Depth traversal repeatedly broken |
| `update-wiki-page.test.ts` | 12 | Wiki update logic evolving |
| `analysis-tools.test.ts` | 12 | Analysis tools refactored |
| `repositories.spec.ts` (e2e) | 12 | Repository features growing |
| `link-agent.test.ts` | 10 | Link agent iterations |

**Positive:** High test churn in TDD context is good - shows tests tracking changes.

**Concern:** `context-gatherer-depth.test.ts` with 13 changes suggests this functionality was rewritten many times.

## Temporal Patterns

### Project Timeline
- **First commit:** 2025-11-25
- **Latest commit:** 2025-12-16
- **Duration:** 21 days
- **Total commits:** 955
- **Average velocity:** 45.5 commits/day

### Recent Velocity (Last 7 Days)
- **Commits:** 244
- **Daily velocity:** 34.9 commits/day
- **Fix commits:** 65
- **Fix ratio:** 26.6%

**Analysis:**
- Extremely high development velocity
- Fix ratio is increasing (23% overall → 26.6% recent)
- Suggests: development is outpacing architectural stability
- **Recommendation:** Slow down, refactor core architecture

### Coverage-Related Commits Timeline

Coverage issues appear in waves:
1. Initial implementation
2. First fix wave (coverage calculation bugs)
3. Regression (directory expansion bugs)
4. Second fix wave (tracking-based coverage)
5. Recent unification attempt

This cycle suggests each "fix" introduces new bugs because the **root architecture is unsound**.

## Risk Assessment

### Critical Risks (Address Immediately)

1. **Orchestration Layer Collapse**
   - Risk: Core system becomes unmaintainable
   - Evidence: 159 commits to 3 files, 42 fixes
   - Impact: Feature development grinds to halt
   - Mitigation: Architecture redesign sprint

2. **Coverage System Failure**
   - Risk: Cannot reliably track what's documented
   - Evidence: 63 commits, multiple regression cycles
   - Impact: Incorrect work generation, user frustration
   - Mitigation: Formal specification + rewrite with tests

3. **Duplicate Work Items**
   - Risk: Resource waste, user confusion
   - Evidence: Multiple fix attempts failed
   - Impact: Performance degradation, incorrect metrics
   - Mitigation: Database constraints + transactional creation

### High Risks (Address Soon)

1. **Technical Debt Accumulation**
   - High velocity with increasing fix ratio
   - Large, complex files in critical paths
   - Refactoring attempts failing

2. **Context Gatherer Instability**
   - 15 fixes to single file
   - Recursive tree operations error-prone
   - Coupled to coverage system

### Medium Risks (Monitor)

1. **Large Agent Files**
   - Several 700-900 line agent files
   - Not currently causing problems
   - May need splitting as features grow

2. **Web Route Size**
   - Some routes exceeding 900 lines
   - Successfully refactored UI before
   - Apply same pattern to routes

## Recommendations for Stabilization

### Immediate Actions (This Week)

1. **Stop adding features to orchestration layer**
   - Feature freeze on orchestrator, executor, context-gatherer
   - Focus on stability before capability

2. **Coverage System Design Review**
   - Write formal specification: what IS coverage?
   - Design new Coverage Service with clean interfaces
   - Write integration tests for specification
   - Implement once, correctly

3. **Add Database Constraints**
   - Unique constraints on work items
   - Foreign key constraints
   - Check constraints on state transitions

### Short-Term Actions (Next 2 Weeks)

1. **Orchestrator Decomposition**
   - Extract WorkPlanner service
   - Extract CoverageCalculator service
   - Extract ProgressTracker service
   - Keep Orchestrator as thin coordinator

2. **Executor Simplification**
   - Move edit request handling to separate service
   - Extract job queue to separate module
   - Reduce to core responsibility: run agents

3. **Context Gatherer Redesign**
   - Use proven libraries for tree traversal
   - Decouple from coverage calculation
   - Make deterministic (property-based tests)
   - Add comprehensive integration tests

4. **Integration Test Suite**
   - Coverage calculation scenarios
   - Work item uniqueness under concurrency
   - Orchestrator state transitions
   - End-to-end workflows

### Medium-Term Actions (Next Month)

1. **Architecture Documentation**
   - Document intended design (ADRs)
   - Create architecture diagrams
   - Define service boundaries
   - Establish design principles

2. **Reduce Large Files**
   - Split phased-orchestrator.ts (1330 lines)
   - Split orchestrator.ts (941 lines)
   - Split executor.ts (886 lines)
   - Target: no file > 500 lines

3. **Establish Metrics**
   - Track fix ratio per sprint
   - Track average file size
   - Track churn per directory
   - Set stability targets

4. **Code Review Standards**
   - No changes to orchestration layer without architectural review
   - Require integration tests for coverage changes
   - Limit PR size (no 500-line PRs)

### Long-Term Actions (Next Quarter)

1. **Formal State Machine**
   - Model orchestrator as explicit state machine
   - Use state machine library or framework
   - Generate diagrams from code
   - Property-based testing of state transitions

2. **Event Sourcing**
   - Track all orchestrator decisions as events
   - Enable replay for debugging
   - Build audit log
   - Support provenance tracking

3. **Architectural Testing**
   - Add architecture fitness functions
   - Enforce module boundaries
   - Detect circular dependencies
   - Prevent god objects

## Positive Observations

Despite the critical issues, several positives are evident:

1. **Active Testing Culture**
   - 299 unit test changes (highest churn)
   - 94 integration test changes
   - Tests track implementation changes
   - E2E tests being added

2. **Successful Refactorings**
   - Web UI successfully modularized
   - Repository abstraction completed
   - CQRS migration successful
   - Test framework migration successful

3. **Learning from Mistakes**
   - Each coverage fix attempts to address root cause
   - Duplicate ID issues led to deterministic IDs
   - Backward compatibility eventually removed

4. **Documentation Efforts**
   - Project research being conducted
   - Self-improvement analysis feature
   - Quality benchmarking in place

5. **Low Revert Rate**
   - Only 2 reverts in 955 commits
   - Shows confidence in changes
   - Suggests good testing before commit

## Conclusion

CodeWiki's architecture exhibits a **classic "big ball of mud" pattern concentrated in the orchestration layer**. The project has grown rapidly (45 commits/day) without establishing stable architectural foundations for its most critical components.

**The core problem is clear:** The orchestration layer (orchestrator + executor + context-gatherer) is trying to do too much, with unclear responsibilities and tight coupling to a fundamentally broken coverage calculation system.

**The good news:** The team demonstrates strong engineering practices (testing, refactoring, CQRS, clean code) in other areas. The web UI refactoring shows the team CAN successfully decompose monoliths. The challenge is applying these same practices to the orchestration layer.

**Next steps:**
1. Feature freeze on orchestration
2. Coverage system redesign with formal specification
3. Decompose orchestrator into focused services
4. Add integration tests before ANY orchestration changes

**Prognosis:** If these issues are addressed in the next 2-4 weeks, the project can stabilize. If development continues at current velocity without architectural remediation, the orchestration layer will become unmaintainable within 1-2 months.

---

**Report generated:** 2025-12-16
**Analysis period:** 2025-11-25 to 2025-12-16 (21 days, 955 commits)
**Primary data sources:** Git history, file metrics, commit message analysis
