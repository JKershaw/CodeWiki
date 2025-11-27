---
title: "Coding Standards & Conventions"
confidence: 0.5
path: conventions/coding-standards
---

# Coding Standards & Conventions

## Observed Conventions

- **TypeScript Strict Typing**: All parameters, return types, and properties are explicitly typed. Uses `type` imports for interfaces. Example: `async runOnCommit(commitId: string, context: AgentContext): Promise<AgentRunResult>`
- **Readonly Class Properties**: Agent type is declared readonly (`readonly type: AgentType = 'technical-debt'`), preventing accidental mutation and signaling immutability intent
- **Private Method Convention**: Helper methods use `private` keyword and are named with camelCase (buildPrompt, parseResponse, generateUpdates), clearly distinguishing public API from implementation details
- **JSDoc Documentation**: Comprehensive block comments with purpose, behavior, and examples. Multi-line comment format with bullet lists for complex documentation
- **Error Message Format**: Consistent error messages with context (`Commit not found: ${commitId}`), using template literals for interpolation
- **Early Return Pattern**: Guards at method start (commit null check) fail fast with descriptive errors, avoiding nested conditionals
- **Destructuring Parameters**: Complex objects destructured in method signatures for clarity: `commit: { sha: string; message: string; ... }`
- **String Literal Types**: Uses discriminated unions for debt levels and severities ('critical' | 'high' | 'medium' | 'low' | 'none'), providing type safety
- **Array Method Chaining**: Functional style with map/filter chains: `commit.diffSummary.affectedFiles.map(f => `- ${f}`).join('\n')`
- **File Extension Convention**: Explicit .js extensions in imports despite TypeScript source, indicating ES module compilation target
- **Test File Mirroring**: Both unit and integration tests follow src/ directory structure, separating test concerns

---
*Updated from commit a286af4b*
