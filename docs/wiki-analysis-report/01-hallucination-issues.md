# Issue 1: Hallucination in Content Generation

## Severity: CRITICAL

## Summary

Multiple agents generate factual claims about code without the ability to verify those claims against source. This leads to plausible-sounding but potentially fabricated content entering the wiki.

---

## Affected Agents

### Writer Agent (CRITICAL)

**Location:** `src/agents/synthesis/writer-agent.ts`

**The Problem:**
The Writer Agent's core purpose is to transform "commit-style" content into "encyclopedia-style" documentation. Its prompt explicitly instructs:

> "Add context and explanation where helpful"
> "Include real examples from the codebase"

But the agent has **no tool access**. It cannot:
- Read source files
- Verify code examples exist
- Check that claims match actual implementation

**What Happens:**
The LLM must invent "context and explanation" from its training data or imagination. It generates plausible code examples that may not exist in the actual codebase.

**Example Failure Mode:**
```
Input: "Added authentication middleware"
Output: "The authentication middleware uses JWT tokens stored in httpOnly
cookies, implementing the standard OAuth 2.0 refresh token flow..."
```
This output sounds authoritative but may be completely wrong about how auth actually works in the project.

---

### Pattern Agent (CRITICAL)

**Location:** `src/agents/analysis/pattern-agent.ts`

**The Problem:**
The Pattern Agent is asked to identify design patterns and provide:
- Code snippets demonstrating the pattern
- **Exact line ranges** where patterns appear
- Trade-off analysis of design decisions

**What Happens:**
The agent receives only a diff, not the full file. When asked for "line 45-67 of src/services/auth.ts", it generates a plausible range based on diff context. These line numbers are often wrong.

**Example Failure Mode:**
```
Pattern: Repository Pattern
Location: src/repositories/user-repository.ts:23-89
Code: [fabricated snippet that looks like it could be there]
```
The line numbers don't correspond to actual code. Anyone following the reference finds different content.

---

### Technical Debt Agent (HIGH)

**Location:** `src/agents/analysis/technical-debt-agent.ts`

**The Problem:**
The agent identifies:
- TODO/FIXME comments and their locations
- SOLID principle violations
- Code smells and hotspots

But it works primarily from diffs, not full files. It cannot see:
- Whether a TODO was already resolved elsewhere
- The broader context that might justify a "violation"
- Whether a "code smell" is actually a conscious design choice

**What Happens:**
The agent reports TODOs that may not exist, or flags patterns as violations when they're intentional.

---

### Overview Agent (HIGH)

**Location:** `src/agents/synthesis/overview-agent.ts`

**The Problem:**
Creates category overview pages by reading first 500 characters of each page in a category, then:
- Inventing "KEY_CONCEPTS" from summaries
- Creating reading order recommendations
- Generating introduction text

**What Happens:**
The "concepts" it identifies may not be real concepts in the codebase. Reading order is based on guessed relationships, not actual dependencies.

---

### Getting Started / Testing Guide / Extension Guide Agents (HIGH)

**Location:** `src/agents/synthesis/`

**The Problem:**
These agents create how-to documentation without any ability to:
- Run the commands they recommend
- Verify file paths exist
- Check that instructions actually work

**What Happens:**
Guides may contain outdated or incorrect instructions. Commands may fail. File paths may not exist.

---

## Root Cause Analysis

### Why This Happens

1. **Design Philosophy Mismatch:**
   The architecture assumes synthesis agents should work from wiki content, creating "higher-order" documentation. But wiki content itself may be incomplete or inaccurate.

2. **Tool Access Not Implemented:**
   Analysis agents (code-change, codebase-explorer) have tools. Synthesis agents don't. This wasn't an oversight - it was a design choice to keep synthesis "pure" from implementation details.

3. **No Verification Step:**
   There's no "fact-check" pass after synthesis agents run. Content goes straight to wiki.

---

## Evidence of Impact

### From Test Analysis:
- Writer Agent: **0 integration tests**
- Testing Guide Agent: **0 integration tests**
- Extension Guide Agent: **0 integration tests**
- Project Overview Agent: **0 integration tests**

The untested agents are exactly the ones most prone to hallucination.

### From Implementation Review:
```typescript
// writer-agent.ts line 299
// Prompt instructs: "Add context and explanation where helpful"
// But no tools are provided to get that context
const tools = undefined; // No tools for Writer Agent
```

---

## Symptoms in Generated Wiki

1. **Code examples that don't compile** - Snippets look right but have subtle errors
2. **Incorrect line number references** - "See line 45" points to wrong code
3. **Over-confident claims** - "The system always uses..." when it sometimes doesn't
4. **Outdated patterns** - Describes v1 approach when codebase uses v2
5. **Missing caveats** - Doesn't mention exceptions or edge cases

---

## Recommended Fixes

### Immediate
1. **Add read-only tools to Writer Agent**
   ```typescript
   tools: [
     readFileTool,      // Verify code examples
     searchFilesTool,   // Find related files
     listDirectoryTool  // Confirm paths exist
   ]
   ```

2. **Remove line number requirements from Pattern Agent**
   Or add tools to verify them.

### Short-term
3. **Implement verification pass**
   After synthesis agents run, have a "fact-checker" agent validate claims against source.

4. **Add uncertainty markers**
   When agents can't verify, they should say "likely" or "appears to" instead of stating as fact.

### Medium-term
5. **Tool access for all synthesis agents**
   Getting Started should be able to run `npm install` and verify it works.

6. **Draft → Review → Publish workflow**
   Synthesis content enters as "draft", gets reviewed, then publishes.

---

## Metrics to Track

After implementing fixes:
- % of code examples that compile
- % of line references that are accurate
- Benchmark accuracy improvement for synthesis pages
- Reduction in user-reported inaccuracies
