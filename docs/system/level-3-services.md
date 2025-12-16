# Level 3: Services

> **Navigation**: [Overview](./level-1-overview.md) → [Architecture](./level-2-architecture.md) → Services

## Purpose

The Services layer provides infrastructure integrations: LLM (AI capabilities), Git (repository access), GitHub (API integration), and Authentication. These services abstract external dependencies from the core business logic.

## Location

```
src/services/
├── llm/                    # LLM integration
│   ├── llm-service.ts      # Interface definition
│   ├── openrouter-llm-service.ts  # OpenRouter implementation
│   ├── mock-llm-service.ts # Testing mock
│   ├── tools.ts            # Tool definitions
│   ├── base-tools.ts       # Basic tools
│   ├── codebase-tools.ts   # Code exploration tools
│   ├── wiki-tools.ts       # Wiki access tools
│   └── analysis-tools.ts   # Analysis-specific tools
│
├── git/                    # Git operations
│   └── git-service.ts
│
├── github/                 # GitHub integration
│   ├── github-auth-service.ts
│   ├── github-repo-service.ts
│   └── github-api-cache.ts
│
├── repository/             # Unified repo access
│   ├── repository-service.ts
│   └── unified-repo-access.ts
│
└── auth/                   # Authentication
    └── auth-service.ts
```

## LLM Service

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                        LLM Service                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │                    LLMService Interface                   │   │
│  │  chat(messages, options): Promise<LLMResponse>           │   │
│  │  streamChat(messages, options): AsyncIterable<chunk>     │   │
│  └──────────────────────────┬────────────────────────────────┘   │
│                             │                                    │
│              ┌──────────────┴──────────────┐                    │
│              │                             │                     │
│              ▼                             ▼                     │
│  ┌───────────────────────┐    ┌───────────────────────┐        │
│  │ OpenRouterLLMService  │    │   MockLLMService      │        │
│  │                       │    │                       │        │
│  │  - Production use     │    │  - Testing            │        │
│  │  - Multiple models    │    │  - Deterministic      │        │
│  │  - Cost tracking      │    │  - No API calls       │        │
│  │  - Tool support       │    │                       │        │
│  └───────────────────────┘    └───────────────────────┘        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### LLMService Interface

```typescript
interface LLMService {
  /** Send chat completion request */
  chat(
    messages: Message[],
    options?: ChatOptions
  ): Promise<LLMResponse>;

  /** Stream chat completion */
  streamChat(
    messages: Message[],
    options?: ChatOptions
  ): AsyncIterable<StreamChunk>;

  /** Get available models */
  listModels(): Promise<ModelInfo[]>;
}

interface ChatOptions {
  model?: string;           // Model to use
  temperature?: number;     // 0-1 randomness
  maxTokens?: number;       // Response limit
  tools?: ToolDefinition[]; // Available tools
  systemPrompt?: string;    // System message
}

interface LLMResponse {
  content: string;          // Response text
  toolCalls?: ToolCall[];   // Tool invocations
  tokensUsed: number;
  cost: number;             // USD
  model: string;
  finishReason: string;
}
```

### OpenRouter Integration

```
┌─────────────────────────────────────────────────────────────────┐
│                    OpenRouter LLM Service                        │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  Request Flow:                                                  │
│                                                                  │
│  Agent ──▶ chat(messages, {tools}) ──▶ OpenRouter API          │
│                                              │                   │
│                                              ▼                   │
│                                    ┌─────────────────┐          │
│                                    │  Model Router   │          │
│                                    │  (OpenRouter)   │          │
│                                    └────────┬────────┘          │
│                                             │                    │
│           ┌─────────────┬─────────────┬─────┴────────┐          │
│           ▼             ▼             ▼              ▼          │
│     ┌─────────┐   ┌─────────┐   ┌─────────┐   ┌─────────┐      │
│     │ Claude  │   │ Gemini  │   │  Grok   │   │ Qwen    │      │
│     └─────────┘   └─────────┘   └─────────┘   └─────────┘      │
│                                                                  │
│  Supported models:                                              │
│  - anthropic/claude-3.5-sonnet                                  │
│  - anthropic/claude-haiku-4.5                                   │
│  - google/gemini-2.0-flash                                      │
│  - x-ai/grok-beta                                               │
│  - qwen/qwen-turbo                                              │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### Tool System

Tools let agents interact with code and wiki during LLM execution:

```typescript
interface ToolDefinition {
  name: string;
  description: string;
  parameters: JSONSchema;
}

interface ToolCall {
  id: string;
  name: string;
  arguments: Record<string, unknown>;
}

interface ToolResult {
  toolCallId: string;
  result: string | object;
  isError?: boolean;
}
```

### Available Tools

#### Codebase Tools (`codebase-tools.ts`)

| Tool | Purpose | Parameters |
|------|---------|------------|
| `read_file` | Read file contents | `path` |
| `search_code` | Grep for patterns | `pattern`, `path?`, `glob?` |
| `list_files` | List directory | `path`, `recursive?` |
| `get_file_info` | File metadata | `path` |

#### Wiki Tools (`wiki-tools.ts`)

| Tool | Purpose | Parameters |
|------|---------|------------|
| `get_wiki_page` | Read wiki page | `path` |
| `list_wiki_pages` | List all pages | `category?` |
| `search_wiki` | Search wiki content | `query` |

#### Tool Context

```typescript
interface ToolContext {
  repoAccess: UnifiedRepoAccess;  // Repository access
  wikiId: string;                  // Current wiki
  repos: Repositories;             // Data access
}
```

## Git Service

### Operations

```typescript
interface GitService {
  /** Clone repository to local path */
  clone(url: string, path: string): Promise<void>;

  /** Get commit history */
  getCommits(
    repoPath: string,
    options?: { limit?: number; since?: Date }
  ): Promise<Commit[]>;

  /** Get diff for a commit */
  getDiff(repoPath: string, sha: string): Promise<string>;

  /** Read file at specific commit */
  readFileAt(
    repoPath: string,
    sha: string,
    filePath: string
  ): Promise<string>;

  /** List files in repository */
  listFiles(
    repoPath: string,
    options?: { path?: string; ref?: string }
  ): Promise<string[]>;
}
```

### Implementation

Uses `isomorphic-git` for pure JavaScript git operations:

```
┌─────────────────────────────────────────────────────────────────┐
│                        Git Service                               │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌───────────────┐     ┌───────────────┐                       │
│  │ isomorphic-git│ ──▶ │   Local FS    │                       │
│  │   (library)   │     │  .git folder  │                       │
│  └───────────────┘     └───────────────┘                       │
│                                                                  │
│  Operations:                                                    │
│  - clone: Clone remote repos                                    │
│  - log: Get commit history                                      │
│  - readBlob: Read file contents                                │
│  - listFiles: Directory listing                                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## GitHub Service

### Architecture

```
┌─────────────────────────────────────────────────────────────────┐
│                      GitHub Services                             │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────┐    ┌─────────────────────┐            │
│  │ GitHubAuthService   │    │ GitHubRepoService   │            │
│  │                     │    │                     │            │
│  │ - OAuth flow        │    │ - Repository API    │            │
│  │ - Token management  │    │ - File access       │            │
│  │ - User info         │    │ - Commit history    │            │
│  └──────────┬──────────┘    └──────────┬──────────┘            │
│             │                          │                        │
│             └────────────┬─────────────┘                        │
│                          │                                      │
│                          ▼                                      │
│             ┌─────────────────────────┐                        │
│             │    GitHubApiCache       │                        │
│             │                         │                        │
│             │  - Response caching     │                        │
│             │  - Rate limit handling  │                        │
│             │  - ETag support         │                        │
│             └─────────────────────────┘                        │
│                          │                                      │
│                          ▼                                      │
│             ┌─────────────────────────┐                        │
│             │     GitHub REST API     │                        │
│             └─────────────────────────┘                        │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

### GitHubAuthService

```typescript
interface GitHubAuthService {
  /** Start OAuth flow */
  getAuthorizationUrl(state: string): string;

  /** Exchange code for token */
  exchangeCode(code: string): Promise<TokenInfo>;

  /** Get authenticated user */
  getUser(token: string): Promise<GitHubUser>;

  /** Revoke token */
  revokeToken(token: string): Promise<void>;
}
```

### GitHubRepoService

```typescript
interface GitHubRepoService {
  /** List user's repositories */
  listRepos(token: string): Promise<Repository[]>;

  /** Get repository details */
  getRepo(token: string, owner: string, repo: string): Promise<Repository>;

  /** Get file contents */
  getContents(
    token: string,
    owner: string,
    repo: string,
    path: string
  ): Promise<FileContent>;

  /** List commits */
  listCommits(
    token: string,
    owner: string,
    repo: string,
    options?: { since?: Date; until?: Date }
  ): Promise<Commit[]>;
}
```

## Unified Repository Access

Abstracts local vs GitHub repository access:

```
┌─────────────────────────────────────────────────────────────────┐
│                   Unified Repo Access                            │
├─────────────────────────────────────────────────────────────────┤
│                                                                  │
│  ┌─────────────────────────────────────────────────────────┐   │
│  │              UnifiedRepoAccess Interface                  │   │
│  │  readFile(path): Promise<string>                         │   │
│  │  listFiles(path?): Promise<string[]>                     │   │
│  │  searchCode(pattern): Promise<SearchResult[]>            │   │
│  └──────────────────────────┬────────────────────────────────┘   │
│                             │                                    │
│              ┌──────────────┴──────────────┐                    │
│              │                             │                     │
│              ▼                             ▼                     │
│  ┌───────────────────────┐    ┌───────────────────────┐        │
│  │  LocalRepoAccess      │    │  GitHubRepoAccess     │        │
│  │                       │    │                       │        │
│  │  - Filesystem reads   │    │  - API calls          │        │
│  │  - Git operations     │    │  - Cached responses   │        │
│  │  - Fast, local        │    │  - Rate limited       │        │
│  └───────────────────────┘    └───────────────────────┘        │
│                                                                  │
│  Factory: createUnifiedRepoAccessFactory(repos)                 │
│                                                                  │
└─────────────────────────────────────────────────────────────────┘
```

## Auth Service

JWT-based authentication for web API:

```typescript
interface AuthService {
  /** Generate JWT token */
  generateToken(userId: string, payload?: object): string;

  /** Verify and decode token */
  verifyToken(token: string): TokenPayload | null;

  /** Refresh token */
  refreshToken(token: string): string;
}
```

## Environment Variables

| Variable | Service | Purpose |
|----------|---------|---------|
| `OPENROUTER_API_KEY` | LLM | OpenRouter authentication |
| `GITHUB_CLIENT_ID` | GitHub | OAuth app ID |
| `GITHUB_CLIENT_SECRET` | GitHub | OAuth app secret |
| `JWT_SECRET` | Auth | Token signing key |
| `MONGODB_URI` | Repository | Database connection |

## Error Handling

### LLM Errors

```typescript
class LLMError extends Error {
  constructor(
    message: string,
    public code: 'RATE_LIMIT' | 'INVALID_REQUEST' | 'MODEL_ERROR' | 'NETWORK',
    public retryable: boolean
  ) {
    super(message);
  }
}
```

### Rate Limiting

```
Request ──▶ Check rate limit ──▶ Under limit? ──Yes──▶ Execute
                                      │
                                      No
                                      │
                                      ▼
                              Wait with backoff
                                      │
                                      ▼
                                   Retry
```

## Related Modules

| Module | Relationship |
|--------|--------------|
| [Agents](./level-3-agents.md) | Use LLM service for AI calls |
| [Executor](./level-3-executor.md) | Coordinates service usage |
| [Web](./level-2-architecture.md) | Uses auth and GitHub services |

## Key Files

| File | Purpose |
|------|---------|
| `src/services/llm/openrouter-llm-service.ts` | Main LLM implementation |
| `src/services/llm/codebase-tools.ts` | Code exploration tools |
| `src/services/git/git-service.ts` | Git operations |
| `src/services/github/github-repo-service.ts` | GitHub API client |
| `src/services/repository/unified-repo-access.ts` | Unified file access |

---

← [Data Layer](./level-3-data.md) | [Back to Architecture](./level-2-architecture.md)
