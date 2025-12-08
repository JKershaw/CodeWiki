# Wiki Review: 50 Iterations (2025-12-08)

## Summary Statistics

| Metric | Value |
|--------|-------|
| Total iterations | 50 |
| Successful | 24 (48%) |
| Failed | 26 (52%) |
| Wiki pages created | 9 |
| Total cost | ~$0.035 |
| Commits in repo | 298 |
| Commits processed | 2 (0.7%) |

## Wiki Pages Generated

1. `overview` - CodeWiki Overview (confidence: 0.55)
2. `repositories/overview` - Repositories Overview (confidence: 0.55)
3. `executor/overview` - Executor Overview (confidence: 0.55)
4. `mcp/tools` - MCP Tools Overview (confidence: 0.5)
5. `repositories/mongo-based/chat-session-repository` - MongoDB Chat Session Repository (confidence: 0.5)
6. `agents/synthesis/overview-agent` - Overview Agent Documentation (confidence: 0.5)
7. `commits/05732bbd` - CodeWiki Architecture Overview (confidence: 0.5)
8. `commits/3db798ef` - Agent Interface Refactoring (confidence: 0.5)
9. `overview/codewiki-developer-readme` - CodeWiki Developer README (confidence: 0.5)

## Observed Issues

### 1. High Agent Failure Rate (Critical)

**52% of iterations failed** due to tool enforcement violations:

- `codebase-explorer`: 17 failures - "made 0 tool call(s), but 2 required" or "made 1 tool call(s), but 2 required"
- `code-change`: 9 failures - "made 0 tool call(s), but 1 required"

The LLM (meta-llama/llama-4-maverick) frequently outputs tool call syntax in markdown code blocks instead of actually making tool calls, causing the executor to count 0 tool calls.

### 2. Truncated/Corrupted Page Content

The `repositories/mongo-based/chat-session-repository` page starts with:
```
'Hello!',
  timestamp: new Date(),
};
await chatSessionRepo.addMessage('session-id', message);
```

This is clearly mid-code snippet - the beginning of the page content was lost during generation.

### 3. Duplicate Links in Related Pages

The `overview` page has duplicate links array:
```json
"links": ["repositories/overview", "repositories/overview"]
```

And duplicate Related Pages entries:
```markdown
## Related Pages
- [Repositories Overview](repositories/overview) - "overview" mentions the src/repositories directory...
- [Repositories Overview](repositories/overview) - Both are overview pages...
```

### 4. Links Array vs Content Mismatch

The `mcp/tools` page has markdown links in content referencing:
- `services/llm-service`
- `agents/research`
- `agents/spec`

But the `links` array is empty:
```json
"links": []
```

These pages don't exist, creating broken links.

### 5. Low Confidence Scores

All pages have confidence scores between 0.5 and 0.55, which is at or barely above the threshold. This suggests:
- Pages are generated with minimal validation
- No mechanism to improve confidence over time

### 6. Navigation Structure Issues

- No table of contents or index page
- Inconsistent directory structure:
  - Component pages: `repositories/`, `executor/`, `mcp/`, `agents/`
  - Commit pages: `commits/`
  - Overview pages: `overview/` (duplicates main overview)
- No clear hierarchy or reading order

### 7. Missing Backlink Updates

When a page links to another, the backlinks array should be updated on the target page. Some pages have backlinks but it's unclear if this is consistently maintained.

### 8. Agent Output Parsing Failures

Console logs show repeated parsing failures:
```
[codebase-explorer] Failed to parse SUMMARY
[codebase-explorer] Failed to parse FINDINGS
[codebase-explorer] Failed to parse WIKI_PAGES
```

The LLM is not following the expected output format, causing the agent to fall back to defaults.

### 9. Shallow Commit Coverage

Only 2 out of 298 commits (0.7%) were actually processed into wiki pages. Most commit-processing work items failed.

### 10. Redundant Content

Two pages cover similar ground:
- `commits/05732bbd` - "CodeWiki Architecture Overview"
- `overview/codewiki-developer-readme` - "CodeWiki Developer README"

Both describe the README.md file's content but are stored in different locations.

## Link Integrity Check

| Page | Links To | Target Exists? |
|------|----------|----------------|
| overview | repositories/overview | Yes |
| repositories/overview | overview | Yes |
| executor/overview | overview | Yes |
| executor/overview | repositories/overview | Yes |
| executor/overview | mcp/tools | Yes |
| mcp/tools | services/llm-service | **No** |
| mcp/tools | agents/research | **No** |
| mcp/tools | agents/spec | **No** |

**3 broken links detected** in `mcp/tools` page.

## Recommendations

1. **Fix LLM tool calling**: The llama-4-maverick model needs better prompting or a different model should be used that reliably makes tool calls
2. **Add content validation**: Detect truncated content (e.g., content starting mid-sentence or with code)
3. **Deduplicate links**: Before adding a link to the array, check if it already exists
4. **Validate internal links**: Before creating a page with links, verify target pages exist or create stub pages
5. **Improve output parsing**: Make agent output format more forgiving or add retry logic with reformatted prompts
6. **Generate navigation pages**: Add ToC/index page generation earlier in the process
