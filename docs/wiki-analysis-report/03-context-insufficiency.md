# Issue 3: Insufficient Context for Accurate Analysis

## Severity: HIGH

## Summary

Several agents are asked to make sophisticated judgments about code quality, patterns, and design decisions, but they only receive diffs - not the full context needed to make accurate assessments.

---

## The Context Problem

### What Agents Receive

| Agent | Primary Input | Additional Context |
|-------|---------------|-------------------|
| CodeChangeAgent | Diff + commit message | Pre-fetched full files ✓ |
| NarrativeAgent | Diff + commit message | None |
| SecurityAgent | Diff + commit message | None |
| TechnicalDebtAgent | Diff + commit message | None |
| PatternAgent | Diff + commit message | None |
| DependencyAgent | Diff + commit message | None |

Only CodeChangeAgent pre-fetches full file contents. The rest work from diffs alone.

---

## Why Diffs Are Insufficient

### 1. Technical Debt Agent

**Task:** Identify SOLID violations, code smells, accumulated debt

**What it needs:**
- Full class/module structure (Single Responsibility)
- Inheritance hierarchies (Liskov Substitution)
- Interface definitions (Interface Segregation)
- Dependency graph (Dependency Inversion)

**What it gets:**
```diff
+ private handleAuth(req: Request) {
+   // TODO: refactor this
+   const token = req.headers.authorization;
```

**The problem:**
From a diff, the agent cannot tell:
- Is this class already 2000 lines? (code smell)
- Does this TODO duplicate one that already exists?
- Is this method following existing patterns or diverging?
- What does the rest of the class look like?

---

### 2. Pattern Agent

**Task:** Identify design patterns with code examples and line ranges

**What it needs:**
- Complete class definitions
- Import/export relationships
- How components interact
- Full method implementations

**What it gets:**
```diff
+ export class UserRepository {
+   constructor(private db: Database) {}
+
+   async findById(id: string) {
```

**The problem:**
The agent sees "Repository" in the name and assumes Repository Pattern. But:
- Does it actually abstract the data source?
- Does it follow the interface other repos use?
- Is this a true Repository or just named that way?

Without full context, pattern identification is guesswork.

---

### 3. Narrative Agent

**Task:** Extract project decisions, rationale, and evolution

**What it needs:**
- Full document content (not just changes)
- Related documents for context
- History of previous decisions

**What it gets:**
```diff
  ## Architecture Decision: Auth System

- We will use session-based auth
+ We will use JWT tokens
```

**The problem:**
The agent sees the change but not:
- Why the decision was made
- What alternatives were considered
- How this affects other parts of the system
- Whether this contradicts earlier decisions

---

### 4. Security Agent

**Task:** Audit for security vulnerabilities

**What it needs:**
- Complete authentication flow
- All input validation points
- Data sanitization pipeline
- Permission checking logic

**What it gets:**
```diff
+ const user = await db.query(`SELECT * FROM users WHERE id = ${userId}`);
```

**The problem:**
This looks like SQL injection. But:
- Is `userId` already validated upstream?
- Is this in a trusted internal service?
- Is `db.query` actually a safe abstraction?

Without full context, the agent may:
- Report false positives (validated elsewhere)
- Miss real issues (vulnerability in unchanged code)

---

## Impact on Wiki Quality

### Manifestations

1. **Over-reporting of issues**
   Technical Debt Agent flags "violations" that aren't (context would explain why)

2. **Under-reporting of issues**
   Security Agent misses vulnerabilities in unchanged code that interact with changes

3. **Wrong pattern identification**
   Pattern Agent sees "Factory" in name, reports Factory Pattern, but it's not one

4. **Decontextualized decisions**
   Narrative Agent reports decision change without the reasoning

5. **Incorrect debt tracking**
   TODOs marked as "new" when they've existed for months

---

## Evidence from Implementation

### TechnicalDebtAgent
```typescript
// src/agents/analysis/technical-debt-agent.ts
// Only receives: commitInfo, diff, message
// No tool calls to get full file context
```

### PatternAgent
```typescript
// src/agents/analysis/pattern-agent.ts
// Prompt asks for "exact line ranges" but agent can't verify them
// No tools provided to read actual file contents
```

### NarrativeAgent
```typescript
// src/agents/analysis/narrative-agent.ts
// Categorizes into narrative types from diff only
// Can't see if document changes contradict existing content
```

---

## Contrast: CodeChangeAgent Does It Right

```typescript
// src/agents/analysis/code-change-agent.ts

// Pre-fetch full file contents
const fullContents = await Promise.all(
  changedFiles.map(file => this.getFileContent(file))
);

// Also has tool access for deeper exploration
const tools = [readFileTool, searchFilesTool, listDirectoryTool];
```

This is the model other agents should follow.

---

## Recommended Fixes

### Immediate
1. **Add tool access to analysis agents**
   ```typescript
   // For TechnicalDebtAgent, PatternAgent, NarrativeAgent
   const tools = [
     readFileTool,      // Get full file for context
     searchFilesTool,   // Find related files
     listDirectoryTool  // Understand project structure
   ];
   ```

2. **Pre-fetch changed files like CodeChangeAgent**
   Before analysis, load full content of all changed files.

### Short-term
3. **Add cross-reference context**
   When analyzing a file, also load:
   - Files that import it
   - Files it imports
   - Test files for it

4. **Historical context injection**
   For Narrative Agent, include previous related decisions.

### Medium-term
5. **Staged analysis pipeline**
   - Stage 1: CodeChangeAgent with full context
   - Stage 2: Other agents receive CodeChangeAgent's findings as additional context
   - This prevents each agent from re-analyzing the same code

6. **Context budget allocation**
   Define context budget per agent, prioritize what to include:
   ```typescript
   const contextBudget = 50000; // tokens
   const prioritizedContext = selectMostRelevantContext(
     changedFiles,
     relatedFiles,
     contextBudget
   );
   ```

---

## Metrics to Track

After implementing fixes:
- False positive rate for Technical Debt findings
- Pattern identification accuracy (manual audit sample)
- Security finding accuracy (verified vs spurious)
- Context tokens used vs quality improvement
