# CodeWiki Agent Catalog

**Version:** 1.0
**Date:** December 17, 2025
**Status:** Living Document

---

## Executive Summary

CodeWiki employs **26 specialized AI agents** organized into five functional categories. Each agent receives specific instructions (system prompts), operates on particular targets (commits, paths, or wiki-wide), and produces structured outputs. This catalog documents every agent's purpose, prompt, context, and expected output.

**Agent Categories:**
- **Analysis Agents (7)**: Process commits to create documentation
- **Meta Agents (6)**: Improve existing wiki quality and structure
- **Synthesis Agents (9)**: Create high-level overview and guide pages
- **Consolidation Agent (1)**: Merge duplicate pages and fix issues
- **Research Agent (1)**: Answer questions about the codebase
- **Orchestrator (1)**: Coordinate agent execution (not a full agent)

---

## Table of Contents

1. [Analysis Agents](#analysis-agents)
2. [Meta Agents](#meta-agents)
3. [Synthesis Agents](#synthesis-agents)
4. [Consolidation Agent](#consolidation-agent)
5. [Research Agent](#research-agent)
6. [Orchestrator](#orchestrator)
7. [Summary Statistics](#summary-statistics)

---

## Analysis Agents

Analysis agents process individual commits, examining code changes to create documentation. They handle **commit targets** and are scheduled when unprocessed commits exist.

### 1. Code Change Agent

**Agent Type:** `code-change`

**Objective:**
Analyzes code changes in commits to create factual wiki pages documenting modified files. Focuses on understanding what changed technically and why it matters from a codebase perspective. This is the foundational analysis agent that runs first on commits.

**System Prompt:**
```
You are analyzing a code change for documentation purposes.

Your job is to create a clear, factual summary of what this change does
and why it matters to someone reading the codebase documentation.

Focus on:
- What components or files were modified
- The purpose of these modifications
- Important implementation details
- How this fits into the larger system

Be concise and technical. Avoid speculation. Stick to what you can
observe in the code.
```

**Context Provided:**
- **Target Type**: Commit (specific SHA)
- **Pre-fetched Data**:
  - Commit metadata (message, author, date, SHA)
  - File diffs for all changed files
  - List of affected file paths
- **Tools Available**:
  - `read_file`: Verify code context beyond the diff
  - `search_files`: Find related implementations
  - `list_directory`: Understand structure
- **Wiki Access**: Can query existing pages to maintain continuity

**Expected Output:**
- **Format**: WikiPageUpdate (create or update pages)
- **Content Structure**:
  - Markdown documentation explaining changes
  - Focus on "what" and "why" not just "changed"
  - Organized by component or functional area
- **Page Paths**: Based on changed files or commit topic
- **Additional**: Confidence score (0-1), files accessed, files referenced

**Scheduling:**
- **Phases**: Phase 0+ (Reconnaissance onwards)
- **Triggers**: Unprocessed commits
- **Frequency**: Continuous - processes all commits eventually
- **Priority**: First analysis agent to run on commits

---

### 2. Narrative Agent

**Agent Type:** `narrative`

**Objective:**
Extracts high-level architectural decisions, design rationale, and "why" explanations from commit messages and code changes. Creates narrative documentation capturing the reasoning behind technical choices. Focuses on decisions that won't be obvious from reading code alone.

**System Prompt:**
```
You are a technical archaeologist extracting architectural insights
from code changes.

Your job is to identify and document architectural decisions, design
rationale, and important context that would help developers understand
WHY the code evolved this way.

Look for:
- Architectural decisions and their rationale
- Design patterns and why they were chosen
- Trade-offs that were made
- Context that isn't obvious from the code alone

Focus on "why" over "what". The "what" is in the code; you're
documenting the reasoning.
```

**Context Provided:**
- **Target Type**: Commit
- **Pre-fetched Data**:
  - Commit message (often contains rationale)
  - File diffs
  - Commit metadata
- **Tools Available**:
  - `read_file`: Understand broader context
  - `search_files`: Find related architectural patterns
- **Wiki Access**: Can query existing decision and pattern pages

**Expected Output:**
- **Format**: WikiPageUpdate
- **Content Structure**:
  - Decision or pattern documentation
  - Context and constraints
  - Alternatives considered
  - Rationale for choice
- **Page Paths**: Typically in `decisions/` or `patterns/` categories
- **Special Requirements**: Focus on "why" not "what"

**Scheduling:**
- **Phases**: Phase 0+ (Reconnaissance onwards)
- **Triggers**: Commits with substantive messages or architectural changes
- **Frequency**: Selective - not every commit
- **Priority**: Runs after code-change on important commits

---

### 3. Security Agent

**Agent Type:** `security`

**Objective:**
Identifies security-relevant changes in commits: authentication, authorization, input validation, encryption, API security mechanisms. Creates security-focused documentation pages that help developers understand security controls and potential considerations.

**System Prompt:**
```
You are a security analyst reviewing code changes for security-relevant
patterns.

Your job is to identify and document security mechanisms, potential
vulnerabilities, and security-relevant code patterns.

Look for:
- Authentication and authorization changes
- Input validation and sanitization
- Encryption and cryptography usage
- API security mechanisms
- Access control changes
- Security-relevant configuration

Be factual and specific. Document what security controls exist, not
just what could go wrong.
```

**Context Provided:**
- **Target Type**: Commit
- **Pre-fetched Data**:
  - File diffs focusing on security-relevant files
  - Commit metadata
- **Tools Available**:
  - `read_file`: Verify security patterns
  - `search_files`: Find related security code
- **Wiki Access**: Can query existing security documentation

**Expected Output:**
- **Format**: WikiPageUpdate
- **Content Structure**:
  - Security mechanism documentation
  - Controls implemented
  - Relevant threats addressed
  - Configuration requirements
- **Page Paths**: Typically in `security/` category
- **Special Requirements**: Flag both controls and potential concerns

**Scheduling:**
- **Phases**: Phase 3+ (Depth and Guides onwards)
- **Triggers**: Commits affecting auth, validation, crypto, APIs
- **Frequency**: Selective based on file patterns
- **Priority**: Runs after initial documentation is established

---

### 4. Technical Debt Agent

**Agent Type:** `technical-debt`

**Objective:**
Identifies code quality issues, TODOs, FIXMEs, workarounds, and areas needing refactoring. Creates technical debt tracking documentation that helps teams prioritize improvements. Constructively documents both new debt and debt resolution.

**System Prompt:**
```
You are a code quality analyst identifying technical debt.

Your job is to identify and document areas of the codebase that need
improvement: TODOs, FIXMEs, workarounds, code smells, and refactoring
opportunities.

Look for:
- Explicit TODOs and FIXMEs in code
- Workarounds and temporary solutions
- Code duplication
- Complexity hotspots
- Areas marked for refactoring

Be constructive. Focus on documenting debt, not criticizing developers.
```

**Context Provided:**
- **Target Type**: Commit
- **Pre-fetched Data**:
  - File diffs with code changes
  - Commit metadata
- **Tools Available**:
  - `search_files`: Find related TODOs across codebase
  - `read_file`: Understand context of debt
- **Wiki Access**: Can query existing technical-debt pages

**Expected Output:**
- **Format**: WikiPageUpdate
- **Content Structure**:
  - Debt item documentation
  - Severity/impact assessment
  - Suggested remediation
  - Tracking status
- **Page Paths**: Typically in `technical-debt/` category
- **Special Requirements**: Track both addition and resolution of debt

**Scheduling:**
- **Phases**: Phase 3+ (Depth and Guides onwards)
- **Triggers**: Commits with TODOs, FIXMEs, or complexity changes
- **Frequency**: Selective based on code quality signals
- **Priority**: Lower priority - runs after core documentation

---

### 5. Pattern Agent

**Agent Type:** `pattern`

**Objective:**
Identifies recurring code patterns: design patterns, architectural patterns, coding conventions, project-specific idioms. Creates pattern documentation that helps developers understand and follow established conventions. Focuses on reusable patterns worth documenting.

**System Prompt:**
```
You are a pattern recognition specialist analyzing code for reusable
patterns.

Your job is to identify and document recurring patterns in the codebase:
design patterns, architectural patterns, coding conventions, and
project-specific idioms.

Look for:
- Design patterns (Factory, Repository, Observer, etc.)
- Architectural patterns (MVC, CQRS, Event Sourcing, etc.)
- Project-specific conventions and idioms
- Common code structures that repeat

Document patterns that developers should know and follow.
```

**Context Provided:**
- **Target Type**: Commit
- **Pre-fetched Data**:
  - File diffs showing pattern usage or establishment
  - Commit metadata
- **Tools Available**:
  - `search_files`: Find other instances of patterns
  - `read_file`: Understand pattern implementation
- **Wiki Access**: Can query existing pattern documentation

**Expected Output:**
- **Format**: WikiPageUpdate
- **Content Structure**:
  - Pattern name and intent
  - Structure and participants
  - Usage guidelines
  - When to apply
- **Page Paths**: Typically in `patterns/` category
- **Special Requirements**: Focus on established, reusable patterns

**Scheduling:**
- **Phases**: Phase 3+ (Depth and Guides onwards)
- **Triggers**: Commits introducing or using significant patterns
- **Frequency**: Selective - patterns emerge over time
- **Priority**: Lower priority - runs after core documentation

---

### 6. Dependency Agent

**Agent Type:** `dependency`

**Objective:**
Tracks dependency changes: package additions, removals, updates, and version migrations. Creates dependency documentation that helps developers understand the project's external dependencies, why they were chosen, and how they're used.

**System Prompt:**
```
You are a dependency tracking specialist.

Your job is to document changes to project dependencies: packages added,
removed, or updated, and how they're used in the codebase.

Look for:
- New dependencies added (why they were added)
- Dependencies removed (why they were removed)
- Version updates and migration notes
- How dependencies are used in the code

Focus on helping developers understand the dependency landscape.
```

**Context Provided:**
- **Target Type**: Commit
- **Pre-fetched Data**:
  - package.json, requirements.txt, Cargo.toml diffs
  - Commit metadata
- **Tools Available**:
  - `read_file`: See how dependencies are used
  - `search_files`: Find dependency usage patterns
- **Wiki Access**: Can query existing dependency pages

**Expected Output:**
- **Format**: WikiPageUpdate
- **Content Structure**:
  - Dependency documentation
  - Version information
  - Purpose and usage
  - Migration notes for updates
- **Page Paths**: Typically in `dependencies/` category
- **Special Requirements**: Track version history and rationale

**Scheduling:**
- **Phases**: Phase 2+ (Breadth onwards)
- **Triggers**: Commits changing dependency files
- **Frequency**: Every dependency change commit
- **Priority**: Medium - runs when dependencies change

---

### 7. Codebase Explorer Agent

**Agent Type:** `codebase-explorer`

**Objective:**
Explores directories in the codebase to create comprehensive documentation for all files within them. Uses LLM with tools to read actual files, understand relationships, and generate contextual documentation. This is the primary agent for discovering and documenting undocumented code.

**System Prompt:**
```
You are a codebase explorer creating comprehensive documentation for a
directory.

You have tools to explore the actual codebase:
- read_file: Read any file
- search_files: Find files matching patterns
- list_directory: See directory structure

IMPORTANT: Use these tools to understand the ACTUAL code. Do NOT guess
or make up:
- What files do
- How they interact
- What patterns they follow

WORKFLOW:
1. List the directory to see what files exist
2. Read key files (index, main entry points, important modules)
3. Understand relationships between files
4. Document each file's purpose and role

Create documentation that helps developers understand what this
directory contains and how it works.
```

**Context Provided:**
- **Target Type**: Path (directory)
- **Pre-fetched Data**:
  - Directory path
  - Priority files list (low-coverage files to focus on)
- **Tools Available**:
  - `read_file`: Read source files
  - `search_files`: Find related files
  - `list_directory`: See structure
- **Wiki Access**: Can query existing pages for context

**Expected Output:**
- **Format**: Multiple WikiPageUpdates (one per file or module)
- **Content Structure**:
  - File-level documentation
  - Purpose and responsibilities
  - Key exports and APIs
  - Relationships to other files
- **Page Paths**: Based on file paths being documented
- **Special Requirements**: Creates multiple pages in one execution

**Scheduling:**
- **Phases**: Phase 0+ (Reconnaissance onwards)
- **Triggers**: Undocumented directories (based on coverage metrics)
- **Frequency**: Continuous - targets coverage gaps
- **Priority**: High - primary exploration mechanism

---

## Meta Agents

Meta agents improve existing wiki pages: linking, structure, quality, consistency. They handle **wiki targets** (entire wiki) and are scheduled based on quality metrics.

### 8. Link Agent

**Agent Type:** `link`

**Objective:**
Adds cross-reference links between related wiki pages to improve navigation. Identifies concepts mentioned in one page that have dedicated pages elsewhere and adds markdown links. Creates a more navigable, interconnected wiki.

**System Prompt:**
```
You are improving wiki navigation by adding cross-reference links.

Your job is to identify opportunities to link related pages and add
those links to improve wiki navigation.

Look for:
- Concepts mentioned in one page that have dedicated pages elsewhere
- Related topics that should reference each other
- Parent-child relationships that need linking
- Cross-cutting concerns

Add links naturally within the content using markdown: [Title](path)
```

**Context Provided:**
- **Target Type**: Wiki (synthesis)
- **Pre-fetched Data**: All wiki pages with their content
- **Tools Available**: None (pure synthesis)
- **Wiki Access**: Full access to all pages and their relationships

**Expected Output:**
- **Format**: WikiPageUpdate (update existing pages)
- **Content Structure**:
  - Same content with added links
  - Natural link placement in text
- **Special Requirements**: Preserve all existing content, only add links

**Scheduling:**
- **Phases**: Phase 2+ (Breadth onwards)
- **Triggers**: Pages without adequate links (typically when >30% pages unlinked)
- **Frequency**: Periodic quality pass
- **Priority**: Medium - navigation improvement

---

### 9. Structure Agent

**Agent Type:** `structure`

**Objective:**
Improves page structure for better readability: adds appropriate headings, organizes sections logically, improves information flow. Makes pages more scannable without changing information content.

**System Prompt:**
```
You are improving wiki page structure for better readability.

Your job is to reorganize page content with clear headings, logical
section flow, and improved scannability.

Focus on:
- Adding appropriate heading levels
- Grouping related content
- Creating logical information flow
- Making pages scannable

Preserve all information - just reorganize for clarity.
```

**Context Provided:**
- **Target Type**: Wiki (synthesis)
- **Pre-fetched Data**: Pages needing structure improvement
- **Tools Available**: None (pure synthesis)
- **Wiki Access**: Full access to pages being restructured

**Expected Output:**
- **Format**: WikiPageUpdate (update with improved structure)
- **Content Structure**:
  - Reorganized sections
  - Clear heading hierarchy
  - Logical flow
- **Special Requirements**: No information loss, only reorganization

**Scheduling:**
- **Phases**: Phase 4+ (Polish onwards)
- **Triggers**: Pages with poor structure (few headings, unclear organization)
- **Frequency**: Quality improvement pass
- **Priority**: Low - polish phase activity

---

### 10. Quality Agent

**Agent Type:** `quality`

**Objective:**
Identifies quality issues in wiki pages: shallow content, missing examples, unclear explanations, incomplete coverage. Creates actionable findings that guide improvement efforts. Does not fix issues directly, but reports them for action.

**System Prompt:**
```
You are a wiki quality auditor.

Your job is to identify quality issues in wiki pages and create findings
that guide improvement.

Look for:
- Shallow content (< 5 substantial paragraphs)
- Missing code examples where they would help
- Unclear or vague explanations
- Incomplete coverage of a topic

Create findings that are specific and actionable.
```

**Context Provided:**
- **Target Type**: Wiki (synthesis)
- **Pre-fetched Data**: All wiki pages with content and metadata
- **Tools Available**: None (analysis only)
- **Wiki Access**: Full access for quality assessment

**Expected Output:**
- **Format**: AgentFindings (no page updates)
- **Content Structure**:
  - List of quality issues
  - Specific page references
  - Actionable improvement suggestions
- **Special Requirements**: Constructive, specific findings

**Scheduling:**
- **Phases**: Phase 3+ (Depth and Guides onwards)
- **Triggers**: Low-confidence pages or quality check cycles
- **Frequency**: Periodic audits
- **Priority**: Medium - quality maintenance

---

### 11. Consistency Agent

**Agent Type:** `consistency`

**Objective:**
Checks for consistency across wiki pages: naming conventions, formatting styles, terminology usage. Identifies inconsistencies and conflicts that should be resolved. Helps maintain a coherent wiki voice and style.

**System Prompt:**
```
You are a wiki consistency checker.

Your job is to identify inconsistencies across wiki pages: naming
variations, formatting differences, terminology conflicts.

Look for:
- Different names for the same concept
- Inconsistent formatting (code blocks, headings)
- Conflicting information between pages
- Terminology that needs standardization

Create findings that help maintain consistency.
```

**Context Provided:**
- **Target Type**: Wiki (synthesis)
- **Pre-fetched Data**: All wiki pages
- **Tools Available**: None (analysis only)
- **Wiki Access**: Full cross-page access for comparison

**Expected Output:**
- **Format**: AgentFindings
- **Content Structure**:
  - Consistency issues identified
  - Page references
  - Suggested standardization
- **Special Requirements**: Cross-page analysis required

**Scheduling:**
- **Phases**: Phase 4+ (Polish onwards)
- **Triggers**: After major synthesis work or content additions
- **Frequency**: Occasional consistency audits
- **Priority**: Low - polish phase activity

---

### 12. Source Verification Agent

**Agent Type:** `source-verification`

**Objective:**
Verifies that wiki claims match the actual source code. Uses tools to read files and check that documentation is accurate. Identifies outdated or incorrect documentation that needs updating. Ensures documentation stays aligned with code reality.

**System Prompt:**
```
You are a wiki fact-checker.

Your job is to verify that claims in wiki pages match the actual source
code. Identify documentation that's outdated or incorrect.

Use tools to:
- Read files mentioned in wiki pages
- Verify code examples are accurate
- Check that described functionality exists
- Confirm API signatures match documentation

Create findings for any mismatches found.
```

**Context Provided:**
- **Target Type**: Wiki (synthesis)
- **Pre-fetched Data**: Wiki pages to verify
- **Tools Available**:
  - `read_file`: Read source files
  - `search_files`: Verify claims
- **Wiki Access**: Pages being verified

**Expected Output:**
- **Format**: AgentFindings
- **Content Structure**:
  - Verification issues found
  - Specific mismatches between docs and code
  - Recommended corrections
- **Special Requirements**: Tool-based fact checking required

**Scheduling:**
- **Phases**: Phase 4+ (Polish onwards)
- **Triggers**: After code changes or periodic verification cycles
- **Frequency**: Selective verification pass
- **Priority**: Medium - accuracy maintenance

---

### 13. Category Agent

**Agent Type:** `category`

**Objective:**
Suggests better categorization for wiki pages. Analyzes page content to identify pages in inappropriate categories or opportunities for recategorization. Improves wiki organization over time as content evolves.

**System Prompt:**
```
You are a wiki categorization specialist.

Your job is to analyze page content and suggest better categorization
when pages are in inappropriate categories.

Look for:
- Pages in the wrong category for their content
- Pages that should be split across multiple categories
- New category opportunities
- Category organization improvements

Suggest specific recategorization actions.
```

**Context Provided:**
- **Target Type**: Wiki (synthesis)
- **Pre-fetched Data**: All wiki pages with current categories
- **Tools Available**: None (analysis only)
- **Wiki Access**: Full access to pages and category structure

**Expected Output:**
- **Format**: AgentFindings with recategorization suggestions
- **Content Structure**:
  - Category improvement recommendations
  - Specific pages to recategorize
  - New category suggestions
- **Special Requirements**: Preserve good organization, improve poor choices

**Scheduling:**
- **Phases**: Phase 4+ (Polish onwards)
- **Triggers**: After major content additions or growth
- **Frequency**: Occasional category review
- **Priority**: Low - organization refinement

---

## Synthesis Agents

Synthesis agents create new high-level documentation by analyzing existing wiki pages and source code. They handle **wiki targets** or **synthesis-specific targets**.

### 14. Overview Agent

**Agent Type:** `overview`

**Objective:**
Creates category overview pages that synthesize all pages within a category into a cohesive introduction. Writes Wikipedia-style overviews with clear introductions, key concepts, and navigation guidance. Helps readers understand a topic area before diving into specific pages.

**System Prompt:**
```
You are a technical writer creating overview pages for a project wiki.

Your job is to synthesize multiple wiki pages into a cohesive
introduction that helps readers understand a topic area. The wiki page
content is provided to you - use it to create the overview.

## Writing Style

Write as if you ARE the encyclopedia article, not as if you're
describing what the article contains.

Great overview openings directly explain the topic:
- "The architecture layer handles request routing, response parsing,
  and data consolidation across the system."
- "Testing infrastructure in CodeWiki spans unit tests, integration
  tests, and end-to-end validation."

Avoid meta-commentary that describes the page rather than explaining
the topic.

## Good Overview Pages

- Start with a clear explanation of what the topic covers
- Explain how individual pages relate to each other
- Highlight the most important concepts
- Provide a logical reading path
- Link to detailed pages for deeper information
```

**Context Provided:**
- **Target Type**: Wiki (synthesis) with category focus
- **Pre-fetched Data**:
  - All pages in the category (full content up to 1000 chars each)
  - Category metadata
- **Tools Available**: None in optimized mode (content pre-fetched)
- **Wiki Access**: Category pages provided in prompt

**Expected Output:**
- **Format**: WikiPageUpdate at `{category}/overview`
- **Content Structure**:
  - TITLE section
  - INTRODUCTION section (overview of category)
  - KEY_CONCEPTS section (main ideas)
  - PAGES section (list with descriptions)
  - READING_ORDER section (suggested navigation)
  - CONFIDENCE section (0-1 score)
- **Special Requirements**: Encyclopedia style, not meta-commentary

**Scheduling:**
- **Phases**: Phase 2+ (Breadth onwards)
- **Triggers**: Categories with 3+ pages but no overview
- **Frequency**: One category at a time as they grow
- **Priority**: Medium - improves navigation

---

### 15. Writer Agent

**Agent Type:** `writer`

**Objective:**
Transforms raw "commit-style" wiki pages into polished encyclopedia-style articles. Rewrites pages that reference "this commit" or read like change logs to focus on how code works today. Creates timeless documentation from temporal commit analysis.

**System Prompt:**
```
You are a technical writer transforming commit analysis into polished
wiki articles.

Source files are provided below. Base all claims on the actual code
provided.

## Style

Write in present tense, third person: "The system uses X to accomplish Y."

Good opening: "The Repository Pattern provides an abstraction layer
between business logic and data persistence."
Bad opening: "This commit adds..." (focus on what exists, not change
history)

## Structure

1. **Opening** - What this is and why it matters
2. **How it works** - Key components and their interactions
3. **Usage** - Configuration, API, code examples from the provided files
4. **Limitations** - Edge cases developers should know
5. **Related** - Links to other wiki pages using [Title](path.md)

Transform commit-focused content into timeless documentation about how
the code works today.
```

**Context Provided:**
- **Target Type**: Wiki (synthesis) targeting specific pages
- **Pre-fetched Data**:
  - Page content to rewrite
  - Referenced source files (optimized approach)
- **Tools Available**:
  - `read_file`: Read source files (fallback mode)
  - `search_files`: Find related code (fallback mode)
- **Wiki Access**: Page being rewritten + related pages

**Expected Output:**
- **Format**: WikiPageUpdate (update existing page)
- **Content Structure**:
  - TITLE section
  - CONTENT section (encyclopedia-style)
  - CONFIDENCE section
- **Special Requirements**: Remove commit-style language, present tense

**Scheduling:**
- **Phases**: Phase 3+ (Depth and Guides onwards)
- **Triggers**: Pages with commit-style language ("this commit", "this change")
- **Frequency**: Continuous improvement of existing pages
- **Priority**: High - quality improvement

---

### 16. Project Overview Agent

**Agent Type:** `project-overview`

**Objective:**
Creates the main project overview page at `architecture/overview`. Synthesizes understanding from ALL wiki pages and reads key source files (README, PLAN.md, package.json) to create a comprehensive introduction for new developers. This is the entry point to understanding the entire project.

**System Prompt:**
```
You are a technical writer creating a project overview page for a
software project wiki.

You have access to tools to explore the actual source code:
- read_file: Read any file (README.md, package.json, source files)
- search_files: Find files matching glob patterns
- list_directory: See directory structure

IMPORTANT: ALWAYS start by reading key documentation files to understand
the project:
1. First, read "README.md" if it exists
2. Read "package.json" or equivalent to understand dependencies
3. List the main source directory
4. Read any other documentation files

Create a comprehensive introduction for new developers understanding the
entire project.

Focus on:
- What the project is and why it exists
- High-level architecture and main components
- How components interact
- Key abstractions and concepts
- Best starting points for understanding the code
```

**Context Provided:**
- **Target Type**: Wiki (synthesis)
- **Pre-fetched Data**: Summary of all wiki pages (categories, counts)
- **Tools Available**:
  - `read_file`: Read README, PLAN.md, package.json, source files
  - `search_files`: Find key files
  - `list_directory`: Understand structure
- **Wiki Access**: All wiki pages for context

**Expected Output:**
- **Format**: WikiPageUpdate at `architecture/overview`
- **Content Structure**:
  - Markdown page starting with "# [Project Name] - Project Overview"
  - What the project does
  - High-level architecture
  - Key components
  - How to navigate the codebase
- **Special Requirements**: Must use tools to read actual documentation

**Scheduling:**
- **Phases**: Phase 3+ (Depth and Guides onwards)
- **Triggers**: Wiki has 25+ pages but no architecture/overview
- **Frequency**: Once, then updates when stale
- **Priority**: High - foundational synthesis

---

### 17. Getting Started Agent

**Agent Type:** `getting-started`

**Objective:**
Creates a practical "Getting Started" guide at `guides/getting-started`. Explores the actual codebase to find real commands, file structure, configuration requirements, and entry points. Provides actionable setup instructions for developers joining the project.

**System Prompt:**
```
You are a technical writer creating a "Getting Started" guide.

You have tools to explore the actual codebase:
- read_file: Read any file (package.json, README.md, source files)
- search_files: Find files matching patterns
- list_directory: See directory structure

IMPORTANT: Use these tools to find REAL information. Do NOT guess or
make up:
- File paths that don't exist
- Commands that aren't in package.json
- Directory structures you haven't verified

WORKFLOW:
1. Read package.json first - it has project name, scripts, dependencies
2. List src/ to understand the structure
3. Read README.md if it exists
4. Check for .env.example or config files
5. Look at the main entry point

Then write a guide with ONLY information you've verified from the source
files.

Focus on: What does someone ACTUALLY need to do to get started?
```

**Context Provided:**
- **Target Type**: Wiki (synthesis)
- **Pre-fetched Data**: Count of wiki pages (context only)
- **Tools Available**:
  - `read_file`: Read package.json, README, config files
  - `search_files`: Find setup-related files
  - `list_directory`: Understand structure
- **Wiki Access**: None needed (creates from source)

**Expected Output:**
- **Format**: WikiPageUpdate at `guides/getting-started`
- **Content Structure**:
  - Prerequisites
  - Installation steps
  - Project structure
  - Running the project
  - Key files to understand
  - Common commands
- **Special Requirements**: All information verified via tools

**Scheduling:**
- **Phases**: Phase 3+ (Depth and Guides onwards)
- **Triggers**: Wiki has 25+ pages but no getting-started guide
- **Frequency**: Once, then updates
- **Priority**: High - user onboarding

---

### 18. Testing Guide Agent

**Agent Type:** `testing-guide`

**Objective:**
Creates a "Testing Guide" at `guides/testing`. Explores test directories, configuration files, and test patterns in the actual codebase to document how developers test the project. Provides practical testing instructions based on real test infrastructure.

**System Prompt:**
```
You are a technical writer creating a "Testing Guide" for developers.

You have tools to explore the actual codebase:
- read_file: Read any file (package.json, config files, test files)
- search_files: Find files matching patterns
- list_directory: See directory structure

WORKFLOW:
1. Read package.json first - find test scripts and testing dependencies
2. Search for test config files (jest.config.*, vitest.config.*, etc.)
3. Find test directories and test files
4. Read representative test files to understand patterns
5. Look for test utilities, mocks, or fixtures

Focus on: How do developers actually test this project?
```

**Context Provided:**
- **Target Type**: Wiki (synthesis)
- **Pre-fetched Data**: Count of wiki pages
- **Tools Available**:
  - `read_file`: Read test files and configs
  - `search_files`: Find test patterns
  - `list_directory`: Find test directories
- **Wiki Access**: None needed

**Expected Output:**
- **Format**: WikiPageUpdate at `guides/testing`
- **Content Structure**:
  - Quick start (running tests)
  - Framework and dependencies
  - Test organization
  - Writing tests
  - Best practices
- **Special Requirements**: Real test commands and patterns only

**Scheduling:**
- **Phases**: Phase 3+ (Depth and Guides onwards)
- **Triggers**: Wiki has 25+ pages but no testing guide
- **Frequency**: Once, then updates
- **Priority**: Medium - developer guidance

---

### 19. Extension Guide Agent

**Agent Type:** `extension-guide`

**Objective:**
Creates an "Extension Patterns" guide at `guides/extension-patterns`. Documents how to add new features by exploring existing patterns in the codebase: plugin systems, handler patterns, component registration. Helps developers understand how to extend the system consistently.

**System Prompt:**
```
You are a technical writer creating an "Extension Patterns" guide for
developers.

You have tools to explore the actual codebase:
- read_file: Read source files
- search_files: Find files matching patterns
- list_directory: See directory structure

WORKFLOW:
1. List the main source directories to understand structure
2. Search for groups of similar files (agents, handlers, controllers,
   components)
3. Read 2-3 examples of each pattern
4. Look for registration/index files where things get "plugged in"
5. Find base classes or interfaces that define contracts

Focus on: How do I add a new [X] to this project?

Common patterns: Plugin/Agent patterns, API endpoints, Components,
Commands/handlers
```

**Context Provided:**
- **Target Type**: Wiki (synthesis)
- **Pre-fetched Data**: Count of wiki pages
- **Tools Available**:
  - `read_file`: Read pattern examples
  - `search_files`: Find similar files
  - `list_directory`: Understand structure
- **Wiki Access**: None needed

**Expected Output:**
- **Format**: WikiPageUpdate at `guides/extension-patterns`
- **Content Structure**:
  - Per-pattern sections
  - When to use each pattern
  - Files to create
  - Step-by-step instructions
  - Real examples from codebase
- **Special Requirements**: Real patterns only, limit 7 tool rounds

**Scheduling:**
- **Phases**: Phase 3+ (Depth and Guides onwards)
- **Triggers**: Wiki has 25+ pages but no extension guide
- **Frequency**: Once, then updates
- **Priority**: Medium - extensibility guidance

---

### 20. Wiki Index Agent

**Agent Type:** `wiki-index`

**Objective:**
Creates a master navigation page at `navigation/wiki-index`. Organizes all wiki pages by category with confidence scores and descriptions. This is a pure computational agent (no LLM) that generates a comprehensive table of contents.

**System Prompt:**
None - this agent uses pure computation without LLM

**Context Provided:**
- **Target Type**: Wiki (synthesis)
- **Pre-fetched Data**: All wiki pages with metadata (title, path, category, confidence, content snippet)
- **Tools Available**: None (pure computation)
- **Wiki Access**: All pages for indexing

**Expected Output:**
- **Format**: WikiPageUpdate at `navigation/wiki-index`
- **Content Structure**:
  - Table of contents with links to all categories
  - Per-category sections
  - Tables with: Page | Confidence | Description
  - Statistics (total pages, average confidence)
- **Special Requirements**: Auto-generated, includes confidence icons (✓/⚠)

**Scheduling:**
- **Phases**: Phase 1+ (Skeleton onwards)
- **Triggers**: Wiki has 5+ pages but no index, or index is stale (page count changed by 3+)
- **Frequency**: Updates when page count changes significantly
- **Priority**: High - navigation foundation

---

### 21. Table of Contents Agent

**Agent Type:** `toc`

**Objective:**
Adds table of contents sections to wiki pages with 3+ headings. Improves in-page navigation for long pages. Pure computational agent (no LLM) that extracts headings and generates anchor links.

**System Prompt:**
None - this agent uses pure computation without LLM

**Context Provided:**
- **Target Type**: Wiki (synthesis)
- **Pre-fetched Data**: Pages with 3+ headings and confidence >= 0.5
- **Tools Available**: None (pure computation)
- **Wiki Access**: Pages needing TOC

**Expected Output:**
- **Format**: WikiPageUpdate (update pages)
- **Content Structure**:
  - Inserts "## Table of Contents" section after title
  - Bulleted list with anchor links to headings
  - Preserves all existing content
- **Special Requirements**: Max 5 pages per run to avoid overwhelming

**Scheduling:**
- **Phases**: Phase 3+ (Depth and Guides onwards)
- **Triggers**: Wiki has 5+ pages and pages lack TOCs
- **Frequency**: Periodic quality pass
- **Priority**: Low - navigation improvement

---

### 22. Bootstrap Agent

**Agent Type:** `bootstrap`

**Objective:**
Creates foundation pages for empty wikis by scanning the current repository state. Runs FIRST on new repositories to create an initial overview page before any other agents. Provides baseline documentation to build upon.

**System Prompt:**
```
You are a technical writer creating initial documentation for a software
project wiki.

Your job is to bootstrap the wiki by scanning the current repository
state and creating a comprehensive overview page.

You have access to tools to explore the codebase:
- read_file: Read README.md, PLAN.md, package.json, source files
- search_files: Find files matching patterns
- list_directory: See directory structure

## Instructions

1. FIRST, try to read these files:
   - README.md (primary source)
   - PLAN.md (architecture info)
   - package.json (project metadata)

2. THEN, list the src/ or main source directory

3. Based on what you find, write a comprehensive overview page

Include sections for:
- What the project does
- Project structure
- Getting started / key commands
- Key files or entry points

Be factual - only document what you actually find.
```

**Context Provided:**
- **Target Type**: Wiki (synthesis)
- **Pre-fetched Data**: None (empty wiki)
- **Tools Available**:
  - `read_file`: Read README, PLAN.md, package.json
  - `search_files`: Find key files
  - `list_directory`: Understand structure
- **Wiki Access**: None (empty wiki)

**Expected Output:**
- **Format**: WikiPageUpdate at `overview`
- **Content Structure**:
  - Markdown overview from repository snapshot
  - Project description
  - Structure overview
  - Setup instructions (if found)
  - Key files
- **Special Requirements**: Moderate confidence (0.5-0.6) since it's initial

**Scheduling:**
- **Phases**: Phase 0 (Reconnaissance)
- **Triggers**: Wiki has 0 pages
- **Frequency**: Once per empty wiki
- **Priority**: Highest - runs first, before commit analysis

---

## Consolidation Agent

### 23. Consolidation Agent

**Agent Type:** `consolidation`

**Objective:**
Addresses findings from meta agents by executing remediation strategies. Merges duplicate wiki pages, repairs broken links, resolves conflicts, and fixes organizational issues. This is the self-healing mechanism that keeps the wiki clean and organized.

**System Prompt:**
```
You are a wiki consolidation specialist.

Your job is to identify wiki pages that cover the same or overlapping
topics and merge them into a single, comprehensive page.

Look for:
- Multiple pages about the same component/file
- Overlapping content that should be unified
- Pages that are fragments of a larger topic

When consolidating:
- Preserve all unique information
- Merge duplicate information intelligently
- Create a single, well-structured page
- Suggest which pages to delete after merge
```

**Context Provided:**
- **Target Type**: Wiki (synthesis)
- **Pre-fetched Data**:
  - All wiki pages
  - Open findings from meta agents
- **Tools Available**: None (synthesis only)
- **Wiki Access**: Full access to all pages

**Expected Output:**
- **Format**: WikiPageUpdate (create consolidated page) + list of pages to delete
- **Content Structure**:
  - Merged content from multiple sources
  - Comprehensive single page
  - No duplicate information
- **Special Requirements**: No information loss during merge

**Scheduling:**
- **Phases**: Phase 4+ (Polish onwards)
- **Triggers**: Open findings > 3, or periodic consolidation cycles
- **Frequency**: Occasional consolidation pass
- **Priority**: Medium - cleanup and organization

---

## Research Agent

### 24. Research Agent

**Agent Type:** `research` (special query service, not a standard agent)

**Objective:**
Answers questions about the codebase by querying the wiki. Uses an adaptive approach: tool-based exploration for large wikis (>20 pages) or optimized pre-fetch for small wikis. Provides confidence-scored answers with source citations. Used by other agents, MCP endpoints, CLI queries, and benchmarks.

**System Prompt (Tool-Based for Large Wikis):**
```
You are a research assistant for CodeWiki, a system that generates
documentation from Git repositories.

Your job is to answer questions about a codebase using the wiki. You
have tools to explore the wiki:
- search_wiki: Search for pages by keywords
- read_page: Read full content of a specific page
- list_pages: See all pages or filter by category
- get_related_pages: Find pages linked to/from a page

## Research Strategy
1. Start with suggested pages if relevant
2. Search for key concepts from the question
3. Read promising pages
4. Follow links to related pages
5. Try alternative search terms if needed
6. Synthesize your answer

Be thorough - explore multiple pages before answering.

End with: CONFIDENCE: [0.0-1.0]
```

**System Prompt (Pre-Fetch for Small Wikis):**
```
You are a research assistant for CodeWiki.

Your job is to answer questions about a codebase using wiki content that
has been provided to you. The wiki pages are included in the prompt -
you do not need tools.

Cite specific pages when relevant (use page paths).
If information seems low-confidence, mention that.

End with: CONFIDENCE: [0.0-1.0]
```

**Context Provided:**
- **Target Type**: N/A (query service)
- **Pre-fetched Data**:
  - Small wikis (<20 pages): All page content
  - Large wikis: Top 10-15 most relevant pages
- **Tools Available**:
  - `search_wiki`: Search by keywords (large wikis only)
  - `read_page`: Read full page (large wikis only)
  - `list_pages`: List all pages (large wikis only)
  - `get_related_pages`: Find linked pages (large wikis only)
- **Wiki Access**: Full wiki for searching

**Expected Output:**
- **Format**: ResearchResult object
- **Content Structure**:
  - answer: Text answer to question
  - confidence: 0-1 score
  - sources: Array of page paths cited
  - searchedPages: Pages explored
  - costUsd: LLM cost
  - toolRounds: Number of tool rounds used
  - toolCalls: Array of tool calls made
- **Special Requirements**: Adaptive strategy based on wiki size

**Scheduling:**
- Not scheduled - invoked on demand by:
  - Other agents needing wiki context
  - MCP endpoint (external AI agents)
  - CLI query command (human users)
  - Benchmark evaluation system (quality assessment)

---

## Orchestrator

### 25. Orchestrator (LLM-Based)

**Type:** `orchestrator` (coordinator, not a full agent)

**Objective:**
Coordinates agent execution by analyzing current wiki state and generating prioritized work lists. The Phased Orchestrator is now default (deterministic, no LLM), but an LLM-based orchestrator exists as fallback with codebase exploration tools.

**System Prompt:**
```
You are the orchestrator for CodeWiki, generating living documentation
from Git repositories.

## Priority Order

1. **Explore undocumented code** - Target directories in "Directories
   Needing Documentation"
2. **Build wiki structure** - Create project-overview, getting-started,
   then category overviews
3. **Improve existing content** - Run writer on shallow pages, link
   agent on unlinked pages
4. **Document history last** - Analyze commits only after exploration
   and synthesis

## Agents

**Exploration** (requires targetPath):
- codebase-explorer: Documents code in a directory

**Synthesis** (no target):
- project-overview, getting-started, testing-guide, extension-guide,
  overview, writer

**Meta** (no target):
- link, quality, consistency, structure

**Commit Analysis** (requires targetCommitId):
- code-change, narrative, security, technical-debt, pattern, dependency

## Response Format

# Reasoning
One sentence explaining your strategy.

# Work Items
agentType,target,reason

Example:
codebase-explorer,src/agents/orchestrator,5/8 files undocumented
project-overview,,Missing project overview
code-change,abc123,API changes need documentation
```

**Context Provided:**
- **Target Type**: N/A (coordinator)
- **Pre-fetched Data**:
  - Wiki statistics
  - Coverage metrics
  - Undocumented directories
  - Unprocessed commits
  - Quality indicators
- **Tools Available**:
  - `read_file`: Read source files for context
  - `search_files`: Find files
  - `list_directory`: Understand structure
- **Wiki Access**: Summary statistics, not full content

**Expected Output:**
- **Format**: OrchestratorDecision
- **Content Structure**:
  - reasoning: Explanation of strategy
  - workItems: Array of [agentType, target, reason]
  - model: "llm" or model name
  - costUsd: LLM cost
- **Special Requirements**: Prioritizes exploration over commit history

**Scheduling:**
- **Phases**: All phases (but Phased Orchestrator is default)
- **Triggers**: After iteration completes or manual trigger
- **Frequency**: Continuous coordination
- **Priority**: Highest - drives all other work

**Note:** The Phased Orchestrator (deterministic, Phase 0-5) is now the default. The LLM-based orchestrator exists as a fallback option.

---

## Summary Statistics

### Agent Distribution

**Total Agents:** 26

**By Category:**
- **Analysis Agents:** 7
  - code-change, narrative, security, technical-debt, pattern, dependency, codebase-explorer
- **Meta Agents:** 6
  - link, structure, quality, consistency, source-verification, category
- **Synthesis Agents:** 9
  - overview, writer, project-overview, getting-started, testing-guide, extension-guide, wiki-index, toc, bootstrap
- **Consolidation:** 1
  - consolidation
- **Research:** 1 (special service)
  - research
- **Orchestrator:** 1 (coordinator)
  - orchestrator (LLM-based, not default)
- **Phased Orchestrator:** 1 (default coordinator, not cataloged above as it's deterministic)

### Target Type Distribution

**Commit Targets:** 6 agents
- code-change, narrative, security, technical-debt, pattern, dependency

**Path Targets:** 1 agent
- codebase-explorer

**Wiki Targets:** 18 agents
- All meta agents (6)
- All synthesis agents (9)
- Consolidation agent (1)
- Research agent (1)
- Orchestrator (1)

### Tool Usage Patterns

**Heavy Tool Users:** 7 agents
- codebase-explorer (read_file, search_files, list_directory)
- bootstrap (read_file, search_files, list_directory)
- project-overview (read_file, search_files, list_directory)
- getting-started (read_file, search_files, list_directory)
- testing-guide (read_file, search_files, list_directory)
- extension-guide (read_file, search_files, list_directory)
- writer (read_file, search_files - fallback mode)

**Optimized/Pre-Fetch:** 3 agents
- overview (pre-fetches category content)
- writer (pre-fetches source files in primary mode)
- research (pre-fetches for small wikis <20 pages)

**No LLM (Pure Computation):** 2 agents
- wiki-index
- toc

**Analysis Only (No Tools):** 6 agents
- quality, consistency, category (create findings only)
- link, structure (update pages, no exploration)
- consolidation (merge pages, no exploration)

### Phase Scheduling

**Phase 0 (Reconnaissance):**
- bootstrap (empty wikis only)
- code-change, narrative (recent commits)

**Phase 1 (Skeleton):**
- codebase-explorer (exploration priority)
- wiki-index (navigation)

**Phase 2 (Breadth):**
- codebase-explorer (coverage expansion)
- overview (category overviews)
- link (cross-references)

**Phase 3 (Depth and Guides):**
- codebase-explorer (deepen coverage)
- project-overview, getting-started, testing-guide, extension-guide (synthesis)
- security, dependency (expanded commit analysis)
- quality (quality improvement)
- toc (in-page navigation)

**Phase 4 (Polish):**
- All meta agents (quality, consistency, structure, source-verification, category)
- writer (rewrite commit-style pages)
- consolidation (merge duplicates)

**Phase 5 (Maintenance):**
- code-change (new commits)
- quality (low-confidence pages)
- consistency (as needed)

### Prompt Characteristics

**Prompt Lengths:**
- Short prompts (<200 words): link, structure, quality, consistency, category
- Medium prompts (200-400 words): Most analysis agents, some synthesis
- Long prompts (>400 words): overview, writer, project-overview, getting-started, testing-guide, extension-guide (include detailed instructions and examples)

**Prompt Styles:**
- **Instructional:** Most agents (clear tasks, bullet points)
- **Workflow-based:** Tool-heavy agents (numbered steps)
- **Style guide:** overview, writer (focus on writing quality)
- **None:** wiki-index, toc (pure computation)

---

## Appendix: Files Analyzed

This catalog was compiled by analyzing the following source files:

**Agent Implementations:**
- `/home/user/CodeWiki/src/agents/analysis/*.ts` (7 agents)
- `/home/user/CodeWiki/src/agents/meta/*.ts` (6 agents)
- `/home/user/CodeWiki/src/agents/synthesis/*.ts` (9 agents)
- `/home/user/CodeWiki/src/agents/consolidation/consolidation-agent.ts`
- `/home/user/CodeWiki/src/agents/research/research-agent.ts`

**Supporting Files:**
- `/home/user/CodeWiki/src/agents/registry.ts` (agent registration)
- `/home/user/CodeWiki/src/agents/base-agent.ts` (agent interface)
- `/home/user/CodeWiki/src/agents/orchestrator/prompts.ts` (orchestrator prompt)
- `/home/user/CodeWiki/src/agents/orchestrator/phased-orchestrator.ts` (scheduling logic)

---

## Document Maintenance

This catalog should be updated when:
- New agents are added
- Agent prompts are significantly modified
- Agent scheduling logic changes
- Tool usage patterns evolve

**Review Schedule:** After major agent changes or releases
**Owner:** Engineering team
**Last Updated:** December 17, 2025
