---
title: "BUILDER_PATTERN"
confidence: 0.5
path: patterns/builder-pattern
---

# BUILDER_PATTERN

**Category:** design

## Description

MockLLMService uses a fluent builder-like API with `setDefaultResponse()`, `addResponseHandler()`, `onPromptContaining()` to configure behavior. This makes test setup readable and flexible.

## Usage in This Codebase

Found in: `tests/fixtures/mock-llm.ts`

## Examples

*See commit e2a858ba for implementation example.*

---
*Last updated from commit e2a858ba*
