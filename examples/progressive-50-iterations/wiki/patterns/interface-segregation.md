---
title: "INTERFACE_SEGREGATION"
confidence: 0.5
path: patterns/interface-segregation
---

# INTERFACE_SEGREGATION

**Category:** architectural

## Description

MockLLMService implements full LLMService interface including `complete()`, `completeWithTools()`, `getUsageStats()`, suggesting well-defined service boundaries.

## Usage in This Codebase

Found in: `tests/fixtures/mock-llm.ts:11-19`

## Examples

*See commit e2a858ba for implementation example.*

---
*Last updated from commit e2a858ba*
