---
title: "Coding Standards & Conventions"
confidence: 1.00
created: Thu Nov 27 2025 13:52:41 GMT+0000 (Coordinated Universal Time)
updated: Thu Nov 27 2025 14:03:04 GMT+0000 (Coordinated Universal Time)
---

# Coding Standards & Conventions

## Observed Conventions

- **Naming Convention**: Service files follow `service-name.ts` and `service-name.test.ts` pattern
- **Test Organization**: Tests use `describe`/`it` blocks with clear descriptive names and comprehensive edge case coverage
- **Error Handling**: Graceful degradation when .cwignore file doesn't exist (returns empty array)
- **File Structure**: Services organized in `/src/services/` with co-located test files
- **Documentation**: Clear comments in .cwignore file explaining purpose and format

---
*Updated from commit 574dabed*
