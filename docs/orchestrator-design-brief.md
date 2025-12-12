# Orchestrator Design Brief

## The Problem

CodeWiki generates documentation wikis from code repositories. It uses multiple AI "agents" - specialized workers that each do one thing well:
- Some agents explore code and write documentation pages
- Some analyze commits to understand what changed
- Some improve wiki quality (fix links, improve structure)
- Some create overview pages and guides

**The Orchestrator's job is to decide which agents to run next.**

It runs periodically, looks at the current state of everything, and produces a prioritized work list of 1-10 tasks. Think of it as a project manager deciding "what should the team work on today?"

---

## Available Information (Inputs)

When making decisions, the orchestrator can see:

### Coverage Metrics
| Metric | Description |
|--------|-------------|
| Total commits | How many commits exist in the repository |
| Commits processed | How many commits each agent type has analyzed |
| Recent commits | The last 10 commits and whether they've been processed |

### Wiki State
| Metric | Description |
|--------|-------------|
| Total pages | How many wiki pages exist |
| Pages per category | Breakdown by topic (e.g., 5 architecture pages, 3 guide pages) |
| Categories with overviews | Which sections have summary pages |
| Categories without overviews | Which sections are missing summary pages |
| Average confidence | Overall quality score (0-100%) |
| Low confidence pages | Count of pages scoring below 50% |

### Quality Indicators
| Metric | Description |
|--------|-------------|
| Pages without links | Pages that don't link to other pages (orphaned) |
| Shallow pages | Pages with very little content (<500 characters) |
| Pages lacking examples | Documentation without code examples |
| Pages needing rewrite | Pages that read like "commit messages" rather than documentation |

### Key Pages Status
| Page | Exists? |
|------|---------|
| Project Overview | Yes/No |
| Getting Started Guide | Yes/No |
| Testing Guide | Yes/No |
| Extension Guide | Yes/No |

### Undocumented Code
A list of directories where code files lack documentation:
| Directory | Total Files | Undocumented | Coverage |
|-----------|-------------|--------------|----------|
| src/agents | 15 | 12 | 20% |
| src/services | 8 | 3 | 62% |
| ... | ... | ... | ... |

Files are considered "documented" if they have at least 50% coverage (mentioned substantially in wiki pages).

### Recent Activity
- What agents ran recently and whether they succeeded
- How many pages each recent run affected
- Open findings (issues flagged by quality agents)
- Pending edit requests (changes waiting to be applied)

---

## Available Actions (Outputs)

The orchestrator produces a list of work items. Each item triggers one agent:

### Exploration Agents
| Agent | What it does | Target |
|-------|--------------|--------|
| `codebase-explorer` | Reads code files and writes documentation pages | A directory path (e.g., "src/agents") |

### Analysis Agents (process commits)
| Agent | What it does | Target |
|-------|--------------|--------|
| `code-change` | Documents what changed in a commit | A specific commit |
| `narrative` | Finds planning docs, ADRs, design decisions | A specific commit |
| `security` | Audits for security-relevant changes | A specific commit |
| `technical-debt` | Identifies shortcuts and accumulating debt | A specific commit |
| `pattern` | Recognizes recurring patterns | A specific commit |
| `dependency` | Tracks external dependency changes | A specific commit |

### Meta Agents (improve wiki quality)
| Agent | What it does | Target |
|-------|--------------|--------|
| `link` | Adds cross-references between related pages | Whole wiki |
| `structure` | Reorganizes pages, splits long ones | Whole wiki |
| `quality` | Improves clarity, adds sources | Whole wiki |
| `consistency` | Fixes contradictions between pages | Whole wiki |
| `consolidation` | Addresses findings from other meta agents | Whole wiki |

### Synthesis Agents (create new content)
| Agent | What it does | Target |
|-------|--------------|--------|
| `overview` | Creates summary pages for categories | Whole wiki |
| `project-overview` | Creates the main architecture overview | Whole wiki |
| `getting-started` | Creates onboarding guide for new developers | Whole wiki |
| `testing-guide` | Creates guide on how to test the codebase | Whole wiki |
| `extension-guide` | Creates guide on adding new features | Whole wiki |
| `writer` | Rewrites commit-style pages as proper documentation | Whole wiki |
| `wiki-index` | Creates a navigational index page | Whole wiki |
| `toc` | Adds table of contents to long pages | Whole wiki |

### Special
| Agent | What it does | Target |
|-------|--------------|--------|
| `bootstrap` | Initial wiki setup for empty wikis | Whole wiki |

---

## The Decision Problem

Given all the information above, the orchestrator must decide:

1. **Which agents to run** (pick from the list above)
2. **In what order** (priority)
3. **With what targets** (which directory? which commit?)

### Constraints
- Maximum 10 work items per decision cycle
- Don't duplicate work already in progress
- Agents can run in parallel, but results are applied sequentially

### Current Strategy ("Useful Wiki First")

The existing approach prioritizes in this order:

1. **Document current code first** - Explore undocumented directories before analyzing old commits
2. **Build structure early** - Create overview pages once 3+ pages exist in a category
3. **Improve quality** - Run meta agents to fix links, consistency issues
4. **Add historical context last** - Process commit history after the codebase is documented

### Questions for the Expert

We'd like your input on the strategy. Consider:

1. **Exploration vs. History**: Should we document current code before or after analyzing commit history? Current code gives immediate value; commit history gives context about why things exist.

2. **Breadth vs. Depth**: Should we cover all directories shallowly first, or fully document one area before moving to the next?

3. **Quality timing**: When should quality improvements happen? Continuously? Only after reaching a page threshold?

4. **Guide creation**: When is the right time to create getting-started guides, testing guides, etc.? Early (when they'll be thin) or later (when there's more material)?

5. **Commit analysis priority**: Should recent commits be analyzed before old ones? Should we analyze all commits with one agent before moving to the next agent type, or round-robin?

6. **Diminishing returns**: At what point is the wiki "good enough"? When should we slow down or stop?

7. **Recovery from issues**: If quality agents find problems, how aggressively should we fix them vs. continuing to add new content?

---

## Example Scenario

**Current state:**
- 8 wiki pages exist (average confidence: 65%)
- 3 directories have <50% coverage
- 45 commits total, 20 processed by code-change agent
- No project overview exists
- 2 pages have no links
- 1 open finding from quality agent

**What should the orchestrator schedule?**

Current strategy would produce:
1. `codebase-explorer` → highest-gap directory
2. `codebase-explorer` → second-highest-gap directory
3. `project-overview` → create architecture overview
4. `link` → fix the 2 unlinked pages
5. `consolidation` → address the open finding

Is this the right priority? What would you change?
