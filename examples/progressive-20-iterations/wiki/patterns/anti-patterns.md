---
title: "Anti-Patterns to Avoid"
confidence: 1
path: patterns/anti-patterns
---

# Anti-Patterns to Avoid

These patterns have been identified as problematic in the codebase:

## **POTENTIAL_PERFORMANCE_ISSUE** [MINOR]

**POTENTIAL_PERFORMANCE_ISSUE** [MINOR]: The `getIgnoredPaths()` method performs file system scanning on first call, which could block if the repository is large. Consider adding a progress callback or making this initialization explicit/configurable for large repos. [Location: src/services/cwignore.ts, lines where fast-glob is called]

## **MISSING_VALIDATION** [MINOR]

**MISSING_VALIDATION** [MINOR]: The service doesn't validate glob patterns before using them. Malformed patterns could cause minimatch to throw errors. Consider adding pattern validation or error handling around minimatch operations. [Location: src/services/cwignore.ts]

## **TIGHT_COUPLING_TO_FILE_SYSTEM** [MINOR]

**TIGHT_COUPLING_TO_FILE_SYSTEM** [MINOR]: The service directly uses `fs` module, making it harder to test certain scenarios. Consider injecting a file system abstraction for better testability (though the current test approach with temp directories is acceptable). [Location: src/services/cwignore.ts]


---
*Updated from commit 574dabed*
