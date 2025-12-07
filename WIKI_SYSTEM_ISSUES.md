# CodeWiki System Issues and Suggested Fixes

## Executive Summary

After running 200 iterations of the CodeWiki system against its own repository, significant issues were identified that prevent the wiki from being useful. The system generates pages but fails to create organized, interconnected documentation.

**Key Statistics:**
- 131 pages created, but only 18% have proper titles
- 100% of pages are uncategorized
- 0% of pages have inter-page links
- 17.5% overall agent failure rate
- Analysis agents (security, pattern, technical-debt) never run due to configuration issues

---

## Critical Issues

### Issue 1: Pages Created Without Titles (82% Untitled)

**Severity:** Critical
**Impact:** Navigation impossible, pages are orphaned and undiscoverable

**Observed Behavior:**
- 107 out of 131 pages have title "Untitled"
- Percentage of untitled pages *increased* from 73% to 82% over time

**Root Cause Analysis:**
The page creation flow doesn't enforce title generation. When the LLM doesn't explicitly generate a title, the system defaults to "Untitled" instead of:
1. Inferring a title from content
2. Rejecting the page
3. Using the source (e.g., commit message, path) as fallback

**Suggested Fix:**
```typescript
// In wiki page creation logic:
function validatePage(page: WikiPage): WikiPage {
  if (!page.title || page.title === 'Untitled') {
    // Option 1: Extract title from content (first heading)
    const firstHeading = page.content.match(/^#\s+(.+)$/m);
    if (firstHeading) {
      page.title = firstHeading[1];
    }
    // Option 2: Use source info
    else if (page.sourceCommitId) {
      page.title = `Changes: ${page.sourceCommitId.slice(0, 8)}`;
    }
    // Option 3: Reject page
    else {
      throw new Error('Page must have a title');
    }
  }
  return page;
}
```

---

### Issue 2: No Page Categorization (100% Uncategorized)

**Severity:** Critical
**Impact:** No hierarchical organization, impossible to browse by topic

**Observed Behavior:**
- Every single page has `category: null` or `category: 'uncategorized'`
- The `slug` field is also `null` for all pages

**Root Cause Analysis:**
The LLM is not being prompted to generate category information, or the extraction is failing silently.

**Suggested Fix:**
1. Add category inference based on content/path:
```typescript
function inferCategory(page: WikiPage): string {
  const content = page.content.toLowerCase();

  // Path-based inference
  if (page.sourcePath?.includes('/agents/')) return 'agents';
  if (page.sourcePath?.includes('/services/')) return 'services';
  if (page.sourcePath?.includes('/repositories/')) return 'data';

  // Content-based inference
  if (content.includes('security') || content.includes('vulnerability')) return 'security';
  if (content.includes('test') || content.includes('spec')) return 'testing';
  if (content.includes('api') || content.includes('endpoint')) return 'api';

  return 'general';
}
```

2. Add slug generation:
```typescript
function generateSlug(title: string): string {
  return title
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '');
}
```

---

### Issue 3: Zero Inter-Page Links

**Severity:** Critical
**Impact:** Wiki pages are isolated islands, no discoverability through navigation

**Observed Behavior:**
- The `link` agent runs successfully (94% success rate)
- But produces zero actual links between pages
- All pages have `links: []`

**Root Cause Analysis:**
The link agent is completing but not producing output. Likely causes:
1. The agent doesn't have access to the page index
2. The LLM isn't being prompted correctly to identify relationships
3. Link extraction/insertion is failing silently

**Suggested Fix:**
1. Implement automatic link detection based on page titles:
```typescript
function autoLinkContent(content: string, pageIndex: Map<string, WikiPage>): string {
  let linkedContent = content;
  for (const [title, page] of pageIndex) {
    const regex = new RegExp(`\\b(${escapeRegex(title)})\\b`, 'gi');
    linkedContent = linkedContent.replace(regex, `[$1](${page.slug})`);
  }
  return linkedContent;
}
```

2. Add a post-processing step that runs after page creation to inject links

---

### Issue 4: code-change Agent Failures (62% Failure Rate)

**Severity:** High
**Impact:** Commit-based documentation not being generated

**Observed Behavior:**
- 33 out of 53 code-change runs failed
- Error: "Agent 'code-change' made 0 tool call(s), but 1 required"
- The qwen/qwen-turbo model doesn't invoke tools properly

**Root Cause Analysis:**
The qwen/qwen-turbo model has poor tool-calling capabilities. It generates responses but doesn't use the required tools (read_file, search_files, etc.)

**Suggested Fixes:**
1. **Model Recommendation:** Use a model with better tool support:
   - `anthropic/claude-3-haiku` (good tool support, low cost)
   - `openai/gpt-4o-mini` (excellent tool support)
   - `meta-llama/llama-3.1-70b-instruct` (decent tool support)

2. **Improve Prompting for Tool Use:**
```typescript
// In agent prompt:
const toolPrompt = `
IMPORTANT: You MUST use at least one tool before generating your response.
Available tools:
- read_file: Read the contents of a file
- search_files: Search for patterns in files
- list_directory: List files in a directory

Start by using read_file to examine the changed files.
`;
```

3. **Add Retry Logic with Different Prompting:**
```typescript
async function executeWithRetry(agent, workItem): Promise<Result> {
  let attempt = 0;
  while (attempt < 3) {
    const result = await agent.run(workItem);
    if (result.toolCalls.length > 0) return result;

    // Retry with more explicit instruction
    workItem.prompt += '\n\nREMINDER: You must use tools. Call read_file now.';
    attempt++;
  }
  throw new ToolEnforcementError(...);
}
```

---

### Issue 5: Orchestrator Suggests Invalid Paths

**Severity:** Medium
**Impact:** Wasted iterations, exploration of irrelevant code

**Observed Behavior:**
Hundreds of warnings like:
- `Path not found in coverage tree for codebase-explorer: src/agents`
- `Invalid path for codebase-explorer: node_modules/playwright-core/lib`
- `Invalid path: tests/unit (must start with src/ or lib/)`

**Root Cause Analysis:**
1. The orchestrator LLM doesn't have accurate knowledge of the directory structure
2. node_modules paths are being suggested even though they should be excluded
3. The validation is happening after selection, not during

**Suggested Fixes:**
1. **Pre-filter valid paths before LLM selection:**
```typescript
function getValidExplorationPaths(): string[] {
  return glob.sync('src/**/*', { onlyDirectories: true })
    .filter(p => !p.includes('node_modules'))
    .filter(p => !p.includes('.git'));
}

// Pass only valid paths to orchestrator
const validPaths = getValidExplorationPaths();
const prompt = `Choose from these directories to explore:\n${validPaths.join('\n')}`;
```

2. **Update .cwignore to explicitly exclude node_modules:**
```
node_modules/
dist/
.git/
*.log
```

3. **Add path existence check before adding to queue:**
```typescript
function validateWorkItem(item: WorkItem): boolean {
  if (item.targetPath && !fs.existsSync(item.targetPath)) {
    console.warn(`Skipping invalid path: ${item.targetPath}`);
    return false;
  }
  return true;
}
```

---

### Issue 6: Analysis Agents Never Run

**Severity:** High
**Impact:** No security analysis, pattern detection, or technical debt tracking

**Observed Behavior:**
Repeated warnings:
- "Analysis agent narrative missing targetCommitId"
- "Analysis agent security missing targetCommitId"
- "Analysis agent technical-debt missing targetCommitId"
- "Analysis agent pattern missing targetCommitId"
- "Analysis agent dependency missing targetCommitId"

**Root Cause Analysis:**
The orchestrator is selecting these agents but not providing the required `targetCommitId` parameter.

**Suggested Fix:**
```typescript
// In orchestrator work item creation:
function createAnalysisWorkItem(agentType: string, context: Context): WorkItem {
  // Ensure targetCommitId is always set for analysis agents
  const analysisAgents = ['narrative', 'security', 'technical-debt', 'pattern', 'dependency'];

  if (analysisAgents.includes(agentType)) {
    if (!context.targetCommitId) {
      // Select a recent commit that hasn't been analyzed
      const unanalyzedCommit = await getUnanalyzedCommit(agentType);
      if (!unanalyzedCommit) {
        console.log(`No commits to analyze for ${agentType}`);
        return null; // Skip this work item
      }
      context.targetCommitId = unanalyzedCommit.id;
    }
  }

  return { agentType, ...context };
}
```

---

### Issue 7: Exploring node_modules

**Severity:** Medium
**Impact:** Irrelevant pages about third-party packages

**Observed Behavior:**
- Pages created about `@acemir`, `acorn-jsx`, `ansi-regex`, etc.
- These are npm dependencies, not project code

**Root Cause Analysis:**
The `.cwignore` file should exclude node_modules but the orchestrator is still suggesting these paths.

**Suggested Fix:**
1. Verify `.cwignore` is being respected
2. Add explicit node_modules filtering in path enumeration
3. Check if codebase-explorer is correctly loading ignore patterns

---

### Issue 8: Low Average Confidence (0.52)

**Severity:** Medium
**Impact:** Quality uncertainty, potentially misleading content

**Observed Behavior:**
- Average confidence score is only 52%
- Pages are being created even with low confidence

**Suggested Fix:**
Add confidence threshold:
```typescript
const MIN_CONFIDENCE_THRESHOLD = 0.7;

function shouldPublishPage(page: WikiPage): boolean {
  if (page.confidence < MIN_CONFIDENCE_THRESHOLD) {
    console.log(`Rejecting page ${page.title} - low confidence: ${page.confidence}`);
    return false;
  }
  return true;
}
```

---

## Summary of Recommended Actions

### Immediate (Critical):
1. **Fix title generation** - Enforce titles or infer from content
2. **Fix category assignment** - Add inference logic
3. **Fix link generation** - Implement automatic linking
4. **Use better LLM model** - Switch from qwen/qwen-turbo to a model with tool support

### Short-term (High):
5. **Fix analysis agent configuration** - Ensure targetCommitId is always set
6. **Fix orchestrator path validation** - Pre-filter valid paths
7. **Improve node_modules exclusion** - Verify .cwignore is working

### Medium-term:
8. **Add confidence threshold** - Reject low-quality pages
9. **Add retry logic for tool failures** - Better prompting on retry
10. **Implement quality metrics** - Track and improve over time

---

## Testing Recommendations

1. Run with a different model (anthropic/claude-3-haiku) to verify tool-calling issues
2. Create unit tests for page validation (title, category, slug)
3. Add integration tests for link agent
4. Monitor agent failure rates over time
