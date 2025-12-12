# Orchestrator V2 Specification

## Overview

A phased orchestrator that adapts its strategy based on wiki maturity. Unlike the current strategy-based approach, this orchestrator recognizes distinct phases and allocates work accordingly.

## Phase Detection Logic

```
Phase 0: pages == 0
Phase 1: pages < 10 OR directories_with_any_coverage < 3
Phase 2: any_directory < 30% coverage OR pages < 25
Phase 3: key_pages_missing OR average_confidence < 65%
Phase 4: low_confidence_pages > 10% OR open_findings > 5
Phase 5: otherwise (maintenance)
```

## Phase Definitions

### Phase 0: Reconnaissance (1 cycle)

**Goal:** Understand the codebase before generating documentation.

| Slot | Agent | Target | Notes |
|------|-------|--------|-------|
| 1 | `bootstrap` | wiki | Initialize structure |
| 2-6 | `code-change` | 5 most recent commits | What's actively changing |
| 7-10 | `narrative` | 5 most recent commits | Recent design decisions |

**Exit criteria:**
- Bootstrap complete
- Recent commits analyzed

**Why this matters:** On empty wiki, recent commits reveal what's actively being worked on. Prevents documenting code that's about to be deleted/refactored.

---

### Phase 1: Skeleton (2-3 cycles)

**Goal:** Build navigable structure with minimal content.

| Priority | Agent | Target Selection |
|----------|-------|------------------|
| 1 | `codebase-explorer` | Core/shared module (most imports) |
| 2 | `codebase-explorer` | Entry point (main, index, app) |
| 3 | `codebase-explorer` | Highest-activity directory |
| 4 | `wiki-index` | wiki |
| 5 | `overview` | First category with 3+ pages |

**Allocation per cycle:**
- 70% exploration (prioritize core → entry → active)
- 20% recent commits (continue rolling analysis)
- 10% structure (index, first overview)

**Exit criteria:**
- 10+ pages exist
- At least 3 directories have some coverage
- Wiki index exists

**Not yet:** Quality passes, historical commits, guides.

---

### Phase 2: Breadth (4-6 cycles)

**Goal:** Cover all directories shallowly. Every directory should have *something*.

**Allocation per cycle (10 items):**
| Slots | Allocation | Agent(s) |
|-------|------------|----------|
| 6 | 60% | `codebase-explorer` → lowest-coverage directories |
| 2 | 20% | `code-change` → recent commits (rolling) |
| 1 | 10% | `overview` → categories hitting 3-page threshold |
| 1 | 10% | `link` → whole wiki |

**Directory prioritization:**
1. Undocumented ratio (higher = priority)
2. File count (more files = priority)
3. Depth (deeper = more specific, slight priority)

**Exit criteria:**
- All directories ≥30% coverage
- 25+ pages exist
- Average confidence ≥50%

---

### Phase 3: Depth + Guides (4-6 cycles)

**Goal:** Deepen important areas and create synthesis content.

**Allocation per cycle (10 items):**
| Slots | Allocation | Agent(s) |
|-------|------------|----------|
| 4 | 40% | `codebase-explorer` → deepen below-target directories |
| 2-3 | 25% | Synthesis (guides, project-overview) |
| 2 | 20% | Commit analysis (broader agent types) |
| 1-2 | 15% | Quality agents |

**Synthesis priority order:**
1. `project-overview` — can now synthesize architecture
2. `getting-started` — happy path is documented
3. `testing-guide` — test directories explored
4. `toc` — pages long enough to need navigation
5. `extension-guide` — last, needs full pattern visibility

**Commit analysis expands:**
- Add `security`, `dependency` agents
- Work backward through older commits
- Enable `pattern` agent (enough data now)

**Exit criteria:**
- All directories ≥60% coverage
- All 4 key pages exist (project-overview, getting-started, testing-guide, extension-guide)
- Average confidence ≥65%

---

### Phase 4: Polish (2-4 cycles)

**Goal:** Quality-focused. Content production slows dramatically.

**Allocation per cycle (10 items):**
| Slots | Allocation | Agent(s) |
|-------|------------|----------|
| 5 | 50% | Meta agents (`quality`, `consistency`, `writer`) |
| 3 | 30% | Fill remaining coverage gaps |
| 2 | 20% | Process remaining commit backlog |

**Key activities:**
- `writer` → rewrite commit-style pages as proper docs
- `consistency` → fix contradictions between pages
- `quality` → add examples, improve clarity
- `consolidation` → clear accumulated findings

**Exit criteria:**
- All directories ≥80% coverage
- Average confidence ≥75%
- Low-confidence pages <10% of total
- Open findings <5

---

### Phase 5: Maintenance (ongoing)

**Goal:** Reactive mode. Wiki is "done."

**Triggers and responses:**
| Trigger | Action |
|---------|--------|
| New commit | `code-change`, maybe `narrative` |
| New directory | `codebase-explorer` |
| Page confidence drops | Re-explore that area |
| Weekly | Light quality pass |
| Monthly | Full `consistency` check |

**Work items per cycle:** 1-3 (down from 10)

**Pause if:** No commits in 2 weeks AND no open findings.

---

## Visual Timeline

```
Cycle:  1    2    3    4    5    6    7    8    9   10   11   12   13+
        |----|----|----|----|----|----|----|----|----|----|----|----|
Phase:  [0 ] [ 1      ] [  2                    ] [ 3         ] [4  ]→ 5

Focus:  Recon Skeleton  Breadth                   Depth+Guides  Polish
Pages:  0→5   5→10      10→25                     25→40         40+
Conf:   —     ~40%      ~50%                      ~65%          ~75%+
```

---

## Key Principles

1. **Recent commits before exploration** — Always know what's actively changing
2. **Core modules first** — Everything else references them
3. **Breadth before depth** — Cross-referencing needs coverage spread
4. **Guides after foundation** — They need material to synthesize from
5. **Quality after quantity** — Polish what's stable, not what's still forming
6. **Graceful degradation** — Maintenance mode, not infinite growth

---

## Implementation Notes

### Required Context Additions

The current `OrchestratorContext` needs:
- `directoriesWithAnyCoverage: number` — count of dirs with >0% coverage
- `coreModulePath?: string` — detected via import analysis or heuristics
- `recentCommitCount: number` — commits in last 2 weeks
- `pagesUpdatedRecently: number` — pages touched in last N cycles

### Phase State

The orchestrator should track:
- `currentPhase: 0 | 1 | 2 | 3 | 4 | 5`
- `cyclesInPhase: number`
- `phaseEnteredAt: Date`

This allows logging/debugging and prevents thrashing between phases.

### Staleness Detection (Future)

Flag pages for re-exploration when:
- Page not updated in N cycles
- Underlying code directory has new commits
- This prevents documentation drift

---

## Comparison with Current Strategy

| Aspect | Current (Default) | V2 (Phased) |
|--------|-------------------|-------------|
| Phase awareness | None | Explicit 6 phases |
| Recent commits | After exploration | Before/during exploration |
| Guide timing | Fixed thresholds | Phase-dependent |
| Quality timing | Continuous | Staged (Phase 3+) |
| Maintenance mode | None | Explicit Phase 5 |
| Work allocation | Strategy priority order | Percentage-based per phase |

---

## Testing Strategy

1. **Unit tests** for phase detection logic
2. **Integration tests** for phase transitions
3. **Simulation tests** — run orchestrator on mock context through full lifecycle
4. **Comparison tests** — same inputs, compare V2 output vs Default output
