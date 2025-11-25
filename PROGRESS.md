# CodeWiki Development Progress

## Current Status (2025-11-25)

### Completed Work

#### 1. Core Architecture (CQRS Pattern)
- Domain models: Repository, Commit, WikiPage, AgentRun
- Repository interfaces with file-based implementations
- FileStore with JSON Date serialization/deserialization

#### 2. Analysis Agents
- **Code Change Agent** - Analyzes commits and generates wiki content
- **Research Agent** - Answers questions using wiki knowledge

#### 3. Infrastructure
- Anthropic LLM integration
- Git service for repository operations
- MCP server for AI agent tools

#### 4. CLI Commands
- `process` - Process repository commits
- `query` - Query the wiki
- `status` - Show processing status
- `list` - List repositories

#### 5. Web Interface (Just Completed)
- Express.js server with REST API routes
- HTML/CSS/JS frontend with:
  - Repository management (list, add, delete, process)
  - Wiki browser with category sidebar
  - Query interface for AI-powered search
- API endpoints: `/api/repos`, `/api/repos/:id/wiki`, `/api/repos/:id/query`, `/api/repos/:id/commits`

#### 6. E2E Tests
- Playwright configuration optimized for containerized environments
- Test suites: smoke, api, wiki, query, repositories
- **Results**: 13 passed, 12 flaky (pass on retry), 4 failed

### Known Issues

#### Browser Test Failures in Containerized Environment
4 tests fail due to browser crashes with error:
```
browserContext.newPage: Target page, context or browser has been closed
```

**Root Cause Analysis** (from web research):
1. `--single-process` flag is problematic - causes browser instability and closing a context closes the entire browser
2. The combination of sandbox-disabling flags needs tuning
3. Memory pressure in containerized environments can cause premature tab closure

**Affected Tests**:
- `tests/e2e/query.spec.ts:60` - can submit a query and see results
- `tests/e2e/query.spec.ts:113` - can submit query with Enter key
- `tests/e2e/wiki.spec.ts:43` - wiki sidebar shows categories
- `tests/e2e/wiki.spec.ts:64` - can click on a wiki page to view content

### Bug Fixes Applied
1. **import.meta.dirname** - Used `fileURLToPath` workaround for ESM
2. **Date handling in commits** - Added type checks to handle both Date objects and ISO strings from JSON

### Pending Work

#### Analysis Agents (Option A)
- [ ] Narrative Agent - Storytelling/changelog generation
- [ ] Security Agent - Security issue detection
- [ ] Pattern Agent - Design pattern recognition
- [ ] Dependency Agent - Dependency tracking

#### Evaluation Needed
- [ ] Writer Agent (Option C) - Evaluate if needed after agents complete

## Technical Notes

### Playwright Configuration
Current flags in `playwright.config.ts`:
```javascript
args: [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-zygote',
  '--single-process',  // PROBLEMATIC - consider removing
  '--disable-extensions',
]
```

### Proposed Fix for Browser Tests
Based on research, try:
1. Remove `--single-process` (known to cause context/page closure issues)
2. Keep `--no-zygote`, `--no-sandbox`
3. Add additional stability flags from chrome-aws-lambda
4. Add explicit waits and browser state checks in tests

## File Structure
```
src/
├── agents/
│   ├── analysis/code-change-agent.ts
│   └── research/research-agent.ts
├── domain/
├── repositories/
│   ├── interfaces/
│   └── file-based/
├── services/
├── web/
│   ├── server.ts
│   └── public/
└── cli/
tests/
└── e2e/
    ├── smoke.spec.ts
    ├── api.spec.ts
    ├── wiki.spec.ts
    ├── query.spec.ts
    └── repositories.spec.ts
```
