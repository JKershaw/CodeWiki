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
- **Narrative Agent** - Detects meta-documents (ADRs, planning docs, READMEs)
- **Security Agent** - Audits commits for security-relevant changes
- **Pattern Agent** - Identifies design patterns, conventions, anti-patterns
- **Dependency Agent** - Tracks dependency changes and implications

#### 3. Infrastructure
- Anthropic LLM integration
- Git service for repository operations
- MCP server for AI agent tools

#### 4. CLI Commands
- `process` - Process repository commits
- `query` - Query the wiki
- `status` - Show processing status
- `list` - List repositories

#### 5. Web Interface
- Express.js server with REST API routes
- HTML/CSS/JS frontend with:
  - Repository management (list, add, delete, process)
  - Wiki browser with category sidebar
  - Query interface for AI-powered search
- API endpoints: `/api/repos`, `/api/repos/:id/wiki`, `/api/repos/:id/query`, `/api/repos/:id/commits`

#### 6. E2E Tests
- Playwright configuration optimized for containerized environments
- Test suites: smoke, api, wiki, query, repositories
- **All 29 tests passing**

### Bug Fixes Applied
1. **import.meta.dirname** - Used `fileURLToPath` workaround for ESM
2. **Date handling in commits** - Added type checks for Date objects and ISO strings
3. **Playwright browser stability** - Removed `--single-process` flag, added stability flags
4. **Test assertions** - Fixed loading state checks and strict mode violations
5. **TypeScript strict mode** - Fixed all exactOptionalPropertyTypes issues
6. **simple-git import** - Use named export instead of default

### Writer Agent Evaluation

**Decision: Deferred**

The Writer Agent (centralized wiki modification handler) was evaluated and deemed **not strictly necessary** for the current MVP. The executor handles updates adequately.

Benefits of a Writer Agent (for future):
- Conflict resolution between agents
- Link/cross-reference management
- Consistent formatting
- Queue-based writes at scale

Current handling is sufficient for:
- Single-threaded processing
- Basic wiki operations
- Small to medium wikis

## Technical Notes

### Playwright Configuration
Optimized for containerized environments:
```javascript
args: [
  '--no-sandbox',
  '--disable-setuid-sandbox',
  '--disable-dev-shm-usage',
  '--disable-gpu',
  '--no-first-run',
  '--no-zygote',
  // Note: --single-process removed - causes context closure issues
  '--disable-extensions',
  '--disable-background-networking',
  '--disable-default-apps',
  '--disable-sync',
  '--disable-translate',
  '--mute-audio',
  '--hide-scrollbars',
  '--metrics-recording-only',
]
```

## File Structure
```
src/
├── agents/
│   ├── analysis/
│   │   ├── code-change-agent.ts
│   │   ├── narrative-agent.ts
│   │   ├── security-agent.ts
│   │   ├── pattern-agent.ts
│   │   └── dependency-agent.ts
│   ├── research/research-agent.ts
│   └── orchestrator/
├── domain/
├── repositories/
│   ├── interfaces/
│   └── file-based/
├── services/
│   ├── git/
│   └── llm/
├── web/
│   ├── server.ts
│   └── public/
└── cli.ts
tests/
└── e2e/
    ├── smoke.spec.ts
    ├── api.spec.ts
    ├── wiki.spec.ts
    ├── query.spec.ts
    └── repositories.spec.ts
```

## Next Steps (Future Work)
1. Register new agents in executor for actual use
2. Add Meta Agents (Structure, Link, Quality, Consistency)
3. Add Synthesis Agents (Guide, Overview, History, Convention)
4. Implement Writer Agent when scaling requires it
5. Add GitHub OAuth for web authentication
6. Deploy to production (Heroku)
