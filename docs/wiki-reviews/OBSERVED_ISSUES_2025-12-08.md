# Consolidated Observed Issues (2025-12-08)

Based on manual review of wiki generation after 100 iterations using `meta-llama/llama-4-maverick` model.

## Critical Issues

### 1. High Agent Failure Rate (~50%)

**Severity:** Critical
**Impact:** Half of all iterations produce no output

**Description:**
The LLM frequently outputs tool call syntax in markdown code blocks instead of actually executing tool calls. The executor counts these as 0 tool calls and fails the agent.

**Evidence:**
```
[codebase-explorer] Failed to parse SUMMARY
  responsePreview: '```\nlist_directory(path: "src/domain")\n```...'
  🔧 ⚠ codebase-explorer: 0 tool call(s) [none]

Agent 'codebase-explorer' made 0 tool call(s), but 2 required
```

**Root Cause:**
The llama-4-maverick model doesn't reliably follow the tool calling format expected by the system.

**Recommendation:**
- Switch to a model with better tool calling support
- Add retry logic with reformatted prompts
- Implement tool call extraction from markdown code blocks as fallback

---

### 2. Content Truncation

**Severity:** High
**Impact:** Incomplete, unusable wiki pages

**Description:**
Some pages have truncated content, either cut off mid-word or starting in the middle of a code snippet.

**Evidence:**
```markdown
# repositories/mongo-based/chat-session-repository starts with:
'Hello!',
  timestamp: new Date(),
};
await chatSessionRepo.addMessage('session-id', message);

# security/overview contains:
...introduces security vulnerabil
```

**Root Cause:**
LLM response truncation or parsing errors during content extraction.

**Recommendation:**
- Validate content completeness before saving
- Detect mid-sentence starts/endings
- Require minimum content length

---

### 3. Content Duplication

**Severity:** High
**Impact:** Redundant pages, wasted iterations, confusing wiki

**Description:**
Multiple pages cover identical or near-identical topics, particularly around README/architecture content.

**Evidence:**
4 pages cover the same README.md commit:
- `commits/05732bbd`
- `overview/codewiki-developer-readme`
- `overview/codewiki-architecture-overview`
- `commits/0872fa5e`

**Root Cause:**
No deduplication check before creating pages. Multiple agents (code-change, narrative, wiki-editor) all generate content for the same commits.

**Recommendation:**
- Implement semantic similarity check before page creation
- Merge similar content into existing pages
- Track which commits have been fully documented

---

## High Priority Issues

### 4. Empty Content Sections

**Severity:** High
**Impact:** Uninformative pages that waste wiki space

**Description:**
Several commit pages have only a title and source section with no actual content.

**Evidence:**
```markdown
# commits/6fd38c3e:
# Implement UnifiedRepoAccess abstraction to consolidate repository access




## Source
- **Commit:** 6fd38c3e
```

**Recommendation:**
- Require minimum content before page creation
- Retry content generation if body is empty

---

### 5. Broken Internal Links

**Severity:** High
**Impact:** Poor navigation, user frustration

**Description:**
Pages contain markdown links to pages that don't exist.

**Evidence:**
`mcp/tools` links to:
- `services/llm-service` - Does not exist
- `agents/research` - Does not exist
- `agents/spec` - Does not exist

**Recommendation:**
- Validate all internal links before saving
- Create stub pages for referenced content
- Track broken links as findings for consolidation

---

### 6. Duplicate Links Array

**Severity:** Medium
**Impact:** Data integrity, potential rendering issues

**Description:**
The links array contains duplicate entries.

**Evidence:**
```json
"links": ["repositories/overview", "repositories/overview"]
```

**Recommendation:**
- Deduplicate links array before saving
- Use Set instead of Array for links

---

## Medium Priority Issues

### 7. Missing Cross-Links

**Severity:** Medium
**Impact:** Poor discoverability, isolated pages

**Description:**
Most new pages have empty `links` arrays. The link agent isn't creating relationships between related content.

**Evidence:**
16 of 16 new pages in iterations 51-100 have:
```json
"links": []
```

**Recommendation:**
- Run link agent more frequently
- Make link agent run immediately after page creation
- Add bidirectional linking

---

### 8. Inconsistent Page Organization

**Severity:** Medium
**Impact:** Confusing navigation, hard to find content

**Description:**
Pages are scattered across 11+ directories with no clear organizing principle.

**Current Structure:**
- `commits/` - Commit-specific pages
- `overview/` - General overviews (but also some at root)
- `repositories/` - Repository layer docs
- `security/` - Security audits
- `agents/` - Agent documentation
- `guides/` - Getting started
- `frontend/` - Frontend docs
- `executor/` - Executor docs
- `mcp/` - MCP docs
- `queries/` - Query docs

**Recommendation:**
- Define clear taxonomy upfront
- Generate category index pages
- Create table of contents

---

### 9. Low Confidence Scores

**Severity:** Medium
**Impact:** All pages at minimum quality threshold

**Description:**
24 of 25 pages have confidence score of 0.5 (minimum threshold). Only 1 page achieved 0.7.

**Recommendation:**
- Implement confidence improvement agents
- Run quality agents on low-confidence pages
- Require higher confidence for publication

---

### 10. Missing Navigation Structure

**Severity:** Medium
**Impact:** Users can't navigate wiki effectively

**Description:**
No table of contents, index page, or category overview pages exist.

**Recommendation:**
- Generate ToC agent early in wiki lifecycle
- Create category overviews automatically
- Add "See Also" sections

---

## Low Priority Issues

### 11. Links Array vs Content Mismatch

**Severity:** Low
**Impact:** Tracking inconsistency

**Description:**
Some pages have markdown links in content that aren't tracked in the `links` array.

**Evidence:**
`mcp/tools` has links in content to `services/llm-service` etc, but `links: []`

**Recommendation:**
- Parse content for links and sync with links array

---

### 12. Backlinks Not Updated

**Severity:** Low
**Impact:** Bidirectional navigation incomplete

**Description:**
When new pages link to existing pages, the backlinks array isn't consistently updated.

**Recommendation:**
- Update backlinks when pages are created
- Run backlink sync as maintenance task

---

## Summary Statistics

| Issue Category | Count | Impact |
|----------------|-------|--------|
| Critical | 3 | Blocks wiki growth |
| High | 3 | Degrades wiki quality |
| Medium | 4 | Reduces usability |
| Low | 2 | Minor inconsistencies |

## Prioritized Fix Order

1. **Fix LLM tool calling** - Unblocks all other improvements
2. **Add content validation** - Prevents bad pages from being saved
3. **Implement deduplication** - Stops redundant page creation
4. **Validate internal links** - Eliminates broken references
5. **Run link agent more often** - Improves navigation
6. **Generate navigation pages** - Makes wiki usable
7. **Improve confidence scoring** - Better quality tracking
