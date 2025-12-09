# Agent Output Formatting Audit Report

**Date:** December 9, 2025
**Purpose:** Document all LLM output parsing across CodeWiki agents to identify unreliable formatting that could be simplified.

---

## Executive Summary

This audit examined **28 agents and handlers** across the CodeWiki codebase to identify output formatting patterns that are difficult for smaller LLMs to produce correctly. The findings reveal:

- **High complexity formats** in 12 agents using custom bracket notation, block delimiters, and multi-format sections
- **Inconsistent patterns** across agents (different bracket styles, section markers, delimiter types)
- **Silent failures** where parsing defaults mask format errors
- **Opportunities for simplification** that would improve reliability without losing functionality

### Key Statistics

| Category | Agent Count | High Complexity | Medium | Low/None |
|----------|-------------|-----------------|--------|----------|
| Analysis | 7 | 2 | 5 | 0 |
| Meta | 7 | 2 | 4 | 1 |
| Synthesis | 9 | 1 | 2 | 6 |
| Other | 5+ handlers | 3 | 2 | 2 |

---

## Parsing Infrastructure

The codebase uses a centralized parsing module at `src/agents/parsing/response-parser.ts` providing:

- `parseSection()` - Extract single values using regex
- `parseSectionItems()` - Extract list items from sections
- `parseListItemsWithFallback()` - Try multiple patterns for resilience
- `parseChoice()` - Parse enum/choice fields
- `parseConfidence()` - Extract 0-1 confidence scores
- `parseBlocks()` - Extract delimited content blocks
- `parseStringList()` - Extract simple string lists

---

## Agent-by-Agent Analysis

### Analysis Agents

#### 1. Code-Change Agent
**File:** `src/agents/analysis/code-change-agent.ts`

**Current Format:**
```
PAGE_TITLE:
[Descriptive title]

SUMMARY:
[2-3 paragraph article]

FINDINGS:
- [TYPE] [IMPORTANCE:low/medium/high] [Description] [Related paths comma-separated]

WIKI_UPDATES:
=== [PAGE_PATH] [ACTION:create/update/merge] ===
[Full markdown content]
=== END ===

CONFIDENCE: [0-1 value]
```

**Parsed Fields:**
| Field | Pattern | Required |
|-------|---------|----------|
| pageTitle | `/PAGE_TITLE:\s*(.+?)(?=\n\|SUMMARY:\|$)/i` | No |
| summary | `/SUMMARY:\s*([\s\S]*?)(?=FINDINGS:\|$)/i` | No |
| findings[].type | `\[([^\]]+)\]` (first bracket) | No |
| findings[].importance | `\[IMPORTANCE:(\w+)\]` | No |
| findings[].description | `(.+?)(?:\s*\[([^\]]*)\])?$` | No |
| wikiUpdates[].path | `===\s*\[([^\]]+)\]` | No |
| wikiUpdates[].action | `\[(create\|update\|merge)\]` | No |
| wikiUpdates[].content | `===\s*([\s\S]*?)\s*===\s*END` | No |
| confidence | `parseConfidence()` | Yes (default 0.5) |

**Complexity:** Medium-High

**Issues:**
1. Inconsistent bracket notation: `[TYPE]` vs `[IMPORTANCE:value]` vs `[ACTION:value]`
2. Wiki update `===` delimiters require exact formatting
3. Two-level title fallback (PAGE_TITLE then extractTitleFromMessage)
4. Paths are comma-separated but whitespace handling is inconsistent

**Suggested Simpler Format:**
```
PAGE_TITLE: [Title]

SUMMARY:
[Content]

FINDINGS:
- TYPE: [name] | IMPORTANCE: [level] | [Description]

WIKI_PAGES:
## [Page Title]
PATH: category/name
ACTION: create
[Full markdown content]
---

CONFIDENCE: [0-1]
```

---

#### 2. Codebase-Explorer Agent
**File:** `src/agents/analysis/codebase-explorer-agent.ts`

**Current Format:**
```
SUMMARY:
[2-3 paragraph overview]

FINDINGS:
- [TYPE] [IMPORTANCE:low/medium/high] [Description] [Related paths]

WIKI_PAGES:
---PAGE---
PATH: [category/page-name]
TITLE: [Descriptive title]
CONTENT:
[Markdown content]
---END_PAGE---

CONFIDENCE: [0-1 value]
```

**Complexity:** Medium

**Issues:**
1. Uses different page delimiter (`---PAGE---`) than other agents (`===`)
2. Requires exact `---END_PAGE---` marker
3. PATH and TITLE don't use brackets while other fields do

**Suggested Simpler Format:**
```
SUMMARY:
[Content]

FINDINGS:
- TYPE: [name] | IMPORTANCE: [level] | [Description]

WIKI_PAGES:
## [Page Title]
PATH: category/name
[Markdown content]
---

CONFIDENCE: [0-1]
```

---

#### 3. Dependency Agent
**File:** `src/agents/analysis/dependency-agent.ts`

**Current Format:**
```
SUMMARY:
[Brief summary]

CHANGES:
- [ADDED/REMOVED/UPDATED] [package-name] [old-version->new-version] [Purpose]

BREAKING_CHANGES:
- [Description]

SECURITY_NOTES:
- [Description]

IMPACT:
[minimal/moderate/significant]

DEPENDENCY_DETAILS:
=== [PACKAGE_NAME] ===
PURPOSE: [description]
USAGE: [description]
CONSIDERATIONS: [description]
=== END ===

WIKI_UPDATES:
=== [PAGE_PATH] [ACTION:create/update] ===
[Full markdown content]
=== END ===

CONFIDENCE: [0-1 value]
```

**Complexity:** Medium-High

**Issues:**
1. CHANGES has optional version bracket `[old->new]` making format ambiguous
2. DEPENDENCY_DETAILS and WIKI_UPDATES both use `===` delimiters but parsed differently
3. generateUpdates() creates pages automatically but ignores wikiUpdates from LLM

**Suggested Simpler Format:**
```
SUMMARY: [Text]

CHANGES:
- ADDED | express | ^4.17.0 | Express web framework
- REMOVED | lodash | - | No longer needed

BREAKING_CHANGES: [none or list]
SECURITY_NOTES: [none or list]
IMPACT: moderate

DEPENDENCIES:
## express
PURPOSE: Web framework
USAGE: Server initialization
CONSIDERATIONS: Large ecosystem

CONFIDENCE: 0.8
```

---

#### 4. Narrative Agent
**File:** `src/agents/analysis/narrative-agent.ts`

**Current Format:**
```
SUMMARY:
[Brief description]

NARRATIVE_TYPE:
[planning/adr/design/changelog/philosophy/guide/readme/decision/none]

PAGE_TITLE:
[Short descriptive title]

FINDINGS:
- [TYPE] [IMPORTANCE:low/medium/high] [Description] [Related paths]

KEY_DECISIONS:
- [Decision description]

WIKI_UPDATES:
=== [PAGE_PATH] [ACTION:create/update] ===
[Full markdown content]
=== END ===

CONFIDENCE: [0-1 value]
```

**Complexity:** Medium

**Issues:**
1. 9 possible NARRATIVE_TYPE values create complexity
2. categoryMap for NARRATIVE_TYPE determines wiki path (hidden coupling)
3. If narrativeType is 'none', wiki page not created but findings may still exist

**Suggested Simpler Format:**
```
SUMMARY:
[Content]

NARRATIVE_TYPE: adr
PAGE_TITLE: CQRS Architecture Decision

FINDINGS:
- TYPE: Design Decision | IMPORTANCE: high | [Description]

KEY_DECISIONS:
- Use event sourcing
- Separate read and write models

WIKI_PAGE:
[Full markdown content]

CONFIDENCE: 0.85
```

---

#### 5. Pattern Agent
**File:** `src/agents/analysis/pattern-agent.ts`

**Current Format:**
```
SUMMARY:
[Description]

PATTERNS_FOUND:
- [PATTERN_NAME] [CATEGORY:design/architecture/convention/testing/anti-pattern] [Description] [Paths]

KEY_FILES:
- [FILE_PATH] [ROLE:PRIMARY/SUPPORTING/RELATED/EXAMPLE] [Description]

CODE_SNIPPETS:
- [SNIPPET_NAME] [FILE_PATH:LINE_RANGE]
\`\`\`language
[Code]
\`\`\`

IMPLEMENTATION_EXPLANATION:
[Explanation]

TRADE_OFFS:
- [TRADE_OFF_NAME] [Analysis]

CONVENTIONS:
- [Convention description]

ANTI_PATTERNS:
- [Anti-pattern description]

WIKI_UPDATES:
- [PAGE_PATH] [ACTION:create/update] [Content description]

CONFIDENCE: [0-1 value]
```

**Complexity:** Very High

**Issues:**
1. CODE_SNIPPETS requires exact markdown code block format with language spec
2. KEY_FILES ROLE is optional with 4 uppercase values (inconsistent with other agents)
3. TRADE_OFFS can have optional name - inconsistent structure
4. Wiki updates only capture description, not full content
5. Multiple fallback patterns (5+) per section

**Suggested Simpler Format:**
```
SUMMARY: [Text]

PATTERNS:
- name: Factory Pattern
  category: design
  description: [Text]
  files: src/factory.ts, src/types.ts

KEY_FILES:
- src/factory.ts | PRIMARY | Creates instances
- src/types.ts | SUPPORTING | Type definitions

CODE_EXAMPLE:
```typescript
[Code]
```

HOW_IT_WORKS: [Explanation]

TRADE_OFFS:
- Abstraction overhead: [Analysis]

CONVENTIONS: [List]
ANTI_PATTERNS: [List]

CONFIDENCE: 0.85
```

---

#### 6. Security Agent
**File:** `src/agents/analysis/security-agent.ts`

**Current Format:**
```
SUMMARY:
[Brief assessment]

SECURITY_RELEVANCE:
[critical/high/medium/low/none]

FINDINGS:
- [CATEGORY] [SEVERITY:critical/high/medium/low] [Description] [Affected paths]

VULNERABILITIES:
- [Vulnerability type] [Description] [CWE if known]

RECOMMENDATIONS:
- [Recommendation]

WIKI_UPDATES:
- [PAGE_PATH] [ACTION:create/update] [Content description]

CONFIDENCE: [0-1 value]
```

**Complexity:** Medium

**Issues:**
1. SEVERITY maps to importance but naming differs (critical -> high, high -> high)
2. SECURITY_RELEVANCE has 5 values vs 4 for SEVERITY - misalignment
3. Wiki updates only capture description, not content

**Suggested Simpler Format:**
```
SUMMARY: [Text]

SECURITY_RELEVANCE: high

FINDINGS:
- CATEGORY: Authentication | SEVERITY: high | [Description]

VULNERABILITIES:
- SQL Injection | [Description] | CWE-89

RECOMMENDATIONS:
- Use parameterized queries

CONFIDENCE: 0.9
```

---

#### 7. Technical-Debt Agent
**File:** `src/agents/analysis/technical-debt-agent.ts`

**Current Format:**
```
SUMMARY:
[Assessment]

DEBT_TREND:
[adding_debt/reducing_debt/neutral/mixed]

FINDINGS:
- [CATEGORY] [SEVERITY:critical/high/medium/low] [Description] [Affected paths]

TODO_ITEMS:
- [FILE:line] [TODO/FIXME/HACK] [Description]

SOLID_VIOLATIONS:
- [PRINCIPLE] [Description] [Affected paths]

REMEDIATION:
- [Priority:high/medium/low] [Recommendation]

HOTSPOTS:
- [File path] [Reason]

WIKI_UPDATES:
- [PAGE_PATH] [ACTION:create/update] [Content description]

CONFIDENCE: [0-1 value]
```

**Complexity:** Extremely High

**Issues:**
1. Has 5+ fallback patterns for FINDINGS (most comprehensive but confusing)
2. DEBT_TREND uses underscores vs hyphens elsewhere
3. TODO_ITEMS, SOLID_VIOLATIONS all have different parsing strategies
4. Multiple ways to specify same information encourages inconsistent output

**Suggested Simpler Format:**
```
SUMMARY: [Text]
DEBT_TREND: adding_debt

FINDINGS:
- category: Code Smell
  severity: high
  description: [Text]
  files: path1, path2

TODO_ITEMS:
- location: src/auth.ts:42
  type: FIXME
  description: [Text]

SOLID_VIOLATIONS:
- principle: Single Responsibility
  description: [Text]
  files: path

REMEDIATIONS:
- priority: high | [Recommendation]

HOTSPOTS:
- src/core/auth.ts | Frequently modified

CONFIDENCE: 0.8
```

---

### Meta Agents

#### 8. Category Agent
**File:** `src/agents/meta/category-agent.ts`

**Current Format:**
```
PAGE: [path] | CURRENT: [category] | SUGGESTED: [category] | MISMATCH: [yes/no]

MISMATCH: [path] should be in [category] - [reason]
```

**Complexity:** Medium

**Issues:**
1. Two completely different formats (PAGE line vs MISMATCH line)
2. Hardcoded confidence values (0.85/0.95) ignore LLM's actual confidence
3. No enum validation for MISMATCH (yes/no)

**Suggested Simpler Format:**
```
PAGES:
- path: docs/auth | current: guides | suggested: architecture | mismatch: yes | reason: [text]

CONFIDENCE: 0.85
```

---

#### 9. Consistency Agent
**File:** `src/agents/meta/consistency-agent.ts`

**Current Format:**
```
ISSUES:
- [SEVERITY:high/medium/low] | [TYPE:terminology/contradiction/duplicate/style] | [affected-paths] | Description

TERMINOLOGY_MAP:
- [term1] = [term2] = [term3]: These all refer to the same concept

SUGGESTIONS:
- Specific suggestion

CONFIDENCE: [0-1]
```

**Complexity:** High

**Issues:**
1. Three completely different formats in one response
2. Terminology map requires exact `=` separators with colon description
3. Type/severity values not validated

**Suggested Simpler Format:**
```
ISSUES:
- severity: high | type: terminology | pages: page1, page2 | [Description]

TERMINOLOGY:
- preferred: authentication | variants: auth, authn, login

SUGGESTIONS:
- [suggestion]

CONFIDENCE: 0.8
```

---

#### 10. Link Agent
**File:** `src/agents/meta/link-agent.ts`

**Current Format:**
```
LINK_SUGGESTIONS:
- [source/page-path] -> [target/page-path] | [STRENGTH:strong] | Description

CONFIDENCE: 0.8
```

**Complexity:** Low (but still issues)

**Issues:**
1. Arrow notation `->` between bracketed paths is complex
2. STRENGTH enum not validated
3. No verification source/target paths exist

**Suggested Simpler Format:**
```
LINKS:
source -> target: reason
auth/overview -> auth/jwt: Both discuss JWT tokens

CONFIDENCE: 0.8
```
Or even simpler:
```
LINKS:
- auth/overview -> auth/jwt | strong | Both discuss JWT tokens

CONFIDENCE: 0.8
```

---

#### 11. Quality Agent
**File:** `src/agents/meta/quality-agent.ts`

**Current Format:**
```
ISSUES:
- [SEVERITY:high/medium/low] | [page-path] | Description

IMPROVEMENTS:
- [page-path] | Suggestion

CONFIDENCE: [0-1]
```

**Complexity:** Low

**Issues:**
1. Type hardcoded to 'content_quality' - loses information
2. Asymmetric format: ISSUES has severity, IMPROVEMENTS doesn't

**Suggested Simpler Format:**
```
ISSUES:
- severity: high | page: docs/auth | [Description]

IMPROVEMENTS:
- page: docs/auth | [Suggestion]

CONFIDENCE: 0.8
```

---

#### 12. Source-Verification Agent
**File:** `src/agents/meta/source-verification-agent.ts`

**Current Format (Claim Extraction):**
```
CLAIM: [claim text]
FILE: [file path or "unknown"]
TYPE: [existence|behavior|signature|constant]
```

**Current Format (Verification):**
```
ACCURATE: [true|false]
REASON: [Explanation]
EVIDENCE: [Code snippet]
```

**Complexity:** Medium

**Issues:**
1. Uses `matchAll()` requiring specific newline formatting
2. No validation that TYPE matches enum values
3. Accuracy determination fragile (string === 'true')
4. Severity hardcoded by keyword regex, not LLM-provided

**Suggested Simpler Format:**
```
CLAIMS:
- claim: [text] | file: src/auth.ts | type: behavior

VERIFICATION:
accurate: true
reason: [Explanation]
evidence: [Code snippet]
```

---

#### 13. Structure Agent
**File:** `src/agents/meta/structure-agent.ts`

**Current Format:**
```
SUGGESTIONS:
- [PRIORITY:high/medium/low] | [affected-page-paths] | Suggestion

OVERALL_ASSESSMENT: [text]
```

**Complexity:** Low

**Issues:**
1. OVERALL_ASSESSMENT not parsed (informational only)
2. No confidence field
3. Priority values not validated

**Suggested Simpler Format:**
```
SUGGESTIONS:
- priority: high | pages: page1, page2 | [Suggestion]

ASSESSMENT: [text]
CONFIDENCE: 0.8
```

---

#### 14. Wiki-Editor Agent
**File:** `src/agents/meta/wiki-editor-agent.ts`

**Current Format:**
```
DECISION: [SKIP|HISTORY|MERGE|CONFLICT]
REASONING: [1-2 sentences]
CONTENT: [wiki markdown if HISTORY or MERGE]
```

**Complexity:** Medium

**Issues:**
1. CONTENT parsing is greedy (`[\s\S]*?)(?=$)`) - captures to EOF
2. Multiple format variants accepted but not specified
3. Content fallbacks differ (500 chars for HISTORY, full for MERGE)

**Suggested Simpler Format:**
```
DECISION: MERGE
REASONING: [text]

CONTENT:
[Full markdown content]
```

---

### Synthesis Agents

#### 15. Bootstrap Agent
**File:** `src/agents/synthesis/bootstrap-agent.ts`

**Current Format:**
```
# [Project Name] - Overview

[Free-form markdown content]
```

**Complexity:** Low

**Issues:**
1. No structured sections - relies entirely on LLM following guidelines
2. Title regex assumes h1 exists
3. No validation output includes requested sections

**Suggested Simpler Format:** Keep as-is (already simple), but add validation.

---

#### 16-19. Extension/Getting-Started/Testing/Project-Overview Guides
**Files:** Multiple synthesis agents

**Current Format:** Free-form markdown with suggested section structure

**Complexity:** Low

**Issues:**
1. No enforcement of section structure
2. No validation of commands/paths mentioned
3. Title extraction fails silently if no h1

**Suggested Simpler Format:** Keep as-is but add explicit markers:
```
TITLE: Getting Started

CONTENT:
[Full markdown content]

CONFIDENCE: 0.8
```

---

#### 20. Overview Agent
**File:** `src/agents/synthesis/overview-agent.ts`

**Current Format:**
```
TITLE:
[descriptive title]

INTRODUCTION:
[2-3 paragraphs]

KEY_CONCEPTS:
- [Concept]: [Brief explanation]

PAGES:
- [page-path]: [description]

READING_ORDER:
[suggested order]

CONFIDENCE: [0-1]
```

**Complexity:** High

**Issues:**
1. KEY_CONCEPTS and PAGES require specific `- [item]: description` format
2. List item patterns strict - variations fail silently

**Suggested Simpler Format:**
```
TITLE: [text]

INTRODUCTION:
[paragraphs]

KEY_CONCEPTS:
- name: Authentication | description: [text]

PAGES:
- path: auth/overview | description: [text]

READING_ORDER: [text]

CONFIDENCE: 0.8
```

---

#### 21. Writer Agent
**File:** `src/agents/synthesis/writer-agent.ts`

**Current Format:**
```
TITLE:
[title]

CONTENT:
[Full rewritten article]

CONFIDENCE: [0-1]
```

**Complexity:** Medium

**Issues:**
1. CONTENT regex greedy - if confidence missing, captures to EOF
2. Minimum length (100 chars) may be too low

**Suggested Simpler Format:** Keep as-is (already reasonable).

---

#### 22-23. TOC and Wiki-Index Agents
**Files:** `toc-agent.ts`, `wiki-index-agent.ts`

**No LLM Output** - Pure computation, no parsing issues.

---

### Other Agents

#### 24. Research Agent
**File:** `src/agents/research/research-agent.ts`

**Current Format:**
```
[Free-form answer text]

CONFIDENCE: [0-1]
```

**Complexity:** Low

**Issues:**
1. Cleanup removes optional "ANSWER:" prefix not mentioned in prompt
2. Substring-based cleanup could remove "CONFIDENCE" if in answer

**Suggested Simpler Format:** Keep as-is (already simple).

---

#### 25. Spec Agent
**File:** `src/agents/spec/spec-agent.ts`

**Current Format:**
```
INTERPRETATION: [text]
CONTEXT: [text]
KEY_FILES: [list]
PATTERNS: [text]
CONVENTIONS: [text]
DEPENDENCIES: [text]
TESTING: [text]
PITFALLS: [text]
CONFIDENCE: [0-1]
```

**Complexity:** Medium-High

**Issues:**
1. 8 distinct sections
2. Regex `(?=[A-Z_]+:)` could match unintended content
3. KEY_FILES parsing fragile

**Suggested Simpler Format:**
Use markdown headers:
```
## Interpretation
[text]

## Context
[text]

## Key Files
- [file list]

## Patterns
[text]

...

CONFIDENCE: 0.8
```

---

#### 26. Grader Agent
**File:** `src/benchmark/grader-agent.ts`

**Current Format:**
```
GRADE: [accurate|partial|inaccurate|no_answer]
CONFIDENCE: [0-1]
[Reasoning text]
```

**Complexity:** Medium

**Issues:**
1. Fallback inference for GRADE is complex and error-prone
2. Reasoning extracted via cleanup (indirect)

**Suggested Simpler Format:**
```
GRADE: accurate
CONFIDENCE: 0.9

REASONING: [text]
```

---

### Consolidation Handlers

#### 27. Duplicate Handler
**Current Format:**
```
DECISION: [merge|keep-separate]
REASON: [text]
PRIMARY_PAGE: [path]
MERGED_CONTENT:
[content]
DELETE_PAGES: [comma-separated paths]
CONFIDENCE: [0-1]
```

**Issues:**
1. MERGED_CONTENT parsing breaks if content contains "DELETE_PAGES:" or "CONFIDENCE:"
2. DELETE_PAGES assumes comma-separated format

**Suggested Simpler Format:** Put multi-line content at END.

---

#### 28. Terminology Handler
**Current Format:**
```
CANONICAL_TERMS:
- [preferred-term]: replaces [term1, term2]

REPLACEMENTS:
- [page-path]: [old-term] → [new-term]

SUMMARY: [text]
CONFIDENCE: [0-1]
```

**Issues:**
1. Arrow character `→` assumes specific unicode
2. Complex bracket notation

**Suggested Simpler Format:**
```
CANONICAL_TERMS:
- preferred: auth | replaces: authentication, authn

REPLACEMENTS:
- page: docs/auth | old: authentication | new: auth

SUMMARY: [text]
CONFIDENCE: 0.8
```

---

#### 29. Contradiction Handler
**Current Format:**
```
RESOLUTION: [text]
UPDATES:
- [page-path]: [change description]
UPDATED_CONTENT:
---[page-path]---
[content]

SUMMARY: [text]
CONFIDENCE: [0-1]
```

**Issues:**
1. Custom marker `---[path]---` is very unusual
2. Will break if content contains `---[` or `SUMMARY:` or `CONFIDENCE:`

**Suggested Simpler Format:**
```
RESOLUTION: [text]
SUMMARY: [text]
CONFIDENCE: 0.8

UPDATES:
## page/path
[content]

## page/path2
[content]
```

---

## Cross-Agent Consistency Issues

### 1. Bracket Notation Explosion

Different bracket usages across agents:
- `[TYPE]` - category (no label)
- `[IMPORTANCE:value]` - importance with label
- `[CATEGORY:value]` - category with label
- `[SEVERITY:value]` - severity with label
- `[PRIORITY:value]` - priority with label
- `[ACTION:value]` - action with label
- `[ROLE:value]` - role with label
- `[FILE:line]` - location with label
- `[page-path]` - path without label
- `[STRENGTH:value]` - strength with label

**Recommendation:** Standardize on pipe-separated key-value pairs: `key: value | key: value`

### 2. Wiki Update Format Split

**Full content parsing:**
- Code-Change, Dependency, Narrative (use `=== [path] [action] === content === END ===`)

**Description only:**
- Pattern, Security, Technical-Debt (use `- [path] [action] description`)

**Different delimiter:**
- Codebase-Explorer (uses `---PAGE---`)

**Recommendation:** Standardize on markdown headers for wiki pages.

### 3. Importance/Severity/Priority Naming

| Agent | Findings | Other |
|-------|----------|-------|
| Code-Change | IMPORTANCE | - |
| Security | SEVERITY | - |
| Technical-Debt | SEVERITY | PRIORITY (remediation) |

**Recommendation:** Use consistent `severity: critical|high|medium|low` everywhere.

### 4. Choice Field Capitalization

| Field | Format |
|-------|--------|
| IMPORTANCE | lowercase |
| SEVERITY | lowercase |
| DEBT_TREND | underscore (adding_debt) |
| CATEGORY | lowercase/hyphen |
| ACTION | lowercase |
| ROLE | UPPERCASE |
| TODO_TYPE | UPPERCASE |

**Recommendation:** Use lowercase everywhere.

### 5. Fallback Pattern Distribution

| Agent | Fallback Patterns | Robustness |
|-------|------------------|-----------|
| Technical-Debt | 5+ per section | Very High |
| Pattern | 2-5 per section | High |
| Most others | 1 per section | Low |

**Recommendation:** Standardize on 2 fallback patterns max (one primary, one simplified).

---

## Recommended Unified Format

All agents should migrate toward this simplified structure:

```
## Section Markers
Use markdown headers or uppercase single-word labels:
- SUMMARY: or ## Summary
- FINDINGS: or ## Findings

## List Items
Use pipe-separated key-value pairs:
- severity: high | type: security | description: [text]

## Wiki Pages
Use markdown headers with metadata:
## [Page Title]
PATH: category/page-name
ACTION: create

[Full markdown content]
---

## Multi-line Content
Put at END of response to avoid parsing conflicts.

## Standard Fields
- CONFIDENCE: [0-1] (always at very end)
- severity: critical|high|medium|low (lowercase)
- priority: high|medium|low (lowercase)
- action: create|update|merge (lowercase)
```

---

## Priority Simplification Targets

### High Priority (Complex formats causing failures)

1. **Pattern Agent** - Very high complexity, 8+ section types
2. **Technical-Debt Agent** - Too many fallback patterns
3. **Link Agent** - Arrow notation difficult for LLMs
4. **Consistency Agent** - Three different formats in one response
5. **Contradiction Handler** - Custom `---[path]---` markers

### Medium Priority (Inconsistent with standards)

6. **Codebase-Explorer** - Different delimiter than other agents
7. **Dependency Agent** - Optional version brackets
8. **Category Agent** - Two different line formats
9. **Spec Agent** - 8 sections, complex regex

### Low Priority (Already simple)

10. **Research Agent** - Already minimal
11. **Quality Agent** - Reasonably simple
12. **Bootstrap/Guide Agents** - Free-form markdown

---

## Next Steps

1. **Define standard format specification** for all agents
2. **Create format migration plan** starting with high-priority agents
3. **Update system prompts** with clearer format examples
4. **Add format validation** to parsing layer
5. **Create LLM tests** to verify format compliance
6. **Document expected formats** in agent files

---

## Appendix: Parsing Pattern Reference

### Common Regex Patterns Currently Used

```typescript
// Section extraction
/SECTION_NAME:\s*([\s\S]*?)(?=NEXT_SECTION:|$)/i

// List items with brackets
/^-\s*\[([^\]]+)\]\s*\[([^\]]+)\]\s*(.+)$/

// Key-value in brackets
/\[KEY:(\w+)\]/i

// Block delimiters
/===\s*\[([^\]]+)\]\s*===\s*([\s\S]*?)\s*===\s*END\s*===/

// Confidence
/CONFIDENCE:\s*([\d.]+)/i
```

### Proposed Simplified Patterns

```typescript
// Section with markdown header
/^##\s+(.+)$\n([\s\S]*?)(?=^##|\Z)/m

// Pipe-separated key-value
/^-\s*(.+?):\s*(.+?)(?:\s*\|\s*(.+?):\s*(.+?))*$/

// Simple list
/^-\s*(.+)$/gm

// Wiki page block
/^##\s+(.+)\nPATH:\s*(.+)\nACTION:\s*(.+)\n\n([\s\S]*?)(?=^---$|^##|\Z)/m
```
