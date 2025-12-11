# Issue: LLM Reasoning/Tool Calls Leaking into Wiki Content

**Priority:** P0 - Critical
**Severity:** CRITICAL
**Status:** Open
**Detected:** 2025-12-11 (llama-4-maverick testing)

---

## Summary

LLM "thinking out loud" text and raw tool invocation JSON appear in published wiki page content, making pages unreadable and unprofessional.

---

## Symptoms

- Internal reasoning text: "I will read...", "Let's examine...", "However, considering the context..."
- Raw JSON tool calls: `{"name": "search_files", "parameters": {...}}`
- Planning statements mixed with actual content

---

## Affected Pages (Confirmed)

- `guides/testing`
- `guides/extension-patterns`
- `patterns/add`
- `patterns/avoid`
- `patterns/sum`
- `patterns/single-type-other-version-1`

---

## Examples

**guides/testing:**
```
The test directory structure is now clear. I will read sample test files from the unit, integration, and e2e directories to understand the testing patterns and conventions used.{"name": "search_files", "parameters": {"pattern": "tests/**/*.test.ts"}}
Here is the testing guide:

# Testing Guide
...
```

**patterns/add:**
```
To understand the implementation, we need to search for the definition of `global._register()`. Let's search for files containing this function.

{"name": "search_files", "parameters": {"pattern": "**/*.ts"}}

After searching for the files, we can read the relevant file to verify the implementation.
```

---

## Root Cause

Response parsing in synthesis agents does not strip LLM internal reasoning before saving content. The content extraction captures everything the LLM outputs rather than just the intended wiki content.

**Affected Components:**
- Synthesis agents (testing-guide-agent, extension-guide-agent, etc.)
- Pattern agent
- Response parser (`src/agents/parsing/response-parser.ts`)

---

## Proposed Fix

1. **Add post-processing to strip common LLM reasoning patterns:**
   ```typescript
   const reasoningPatterns = [
     /^(I will|Let me|I'll|Let's|However,|First,|Now,).*?\n/gmi,
     /\{"name":\s*"[^"]+",\s*"parameters":\s*\{[^}]+\}\}/g,
     /```python\n\{"name".*?\}\n```/gs,
   ];

   function stripLLMReasoning(content: string): string {
     let cleaned = content;
     for (const pattern of reasoningPatterns) {
       cleaned = cleaned.replace(pattern, '');
     }
     return cleaned.trim();
   }
   ```

2. **Use structured output format with clear delimiters:**
   - Require content between `<wiki_content>` and `</wiki_content>` tags
   - Only save content within delimiters

3. **Add regex filters for tool invocation JSON:**
   - Strip any `{"name": "...", "parameters": {...}}` patterns
   - Remove markdown code blocks containing tool calls

4. **Validate content before saving:**
   - Reject pages that contain obvious LLM artifacts
   - Log warnings when stripping significant content

---

## Acceptance Criteria

- [ ] No wiki pages contain LLM reasoning phrases
- [ ] No wiki pages contain raw JSON tool calls
- [ ] Existing affected pages are cleaned up
- [ ] New pages pass validation before saving

---

## Related Issues

- Response parsing failures (#003)
- Hallucinated pattern pages (#002)
