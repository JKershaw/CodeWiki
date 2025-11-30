# Benchmark Questions

This folder contains benchmark questions in markdown format. Questions are used to evaluate wiki quality by testing the wiki's knowledge about a codebase.

## File Naming

Question files should be named after the repository they target:

- `{repo-name}.md` - Questions specific to a repository (e.g., `CodeWiki.md`)
- `default.md` - Fallback questions used when no repo-specific file exists

The loader will first look for a file matching the repository name, then fall back to `default.md`.

## Markdown Format

Each question is defined as a level-2 heading (`##`) with the question ID, followed by metadata and the question text.

### Structure

```markdown
## question-id

- **Category:** architecture
- **Difficulty:** easy
- **Hints:** path/to/file1, path/to/dir2/

The actual question text goes here. It can span multiple lines
and include any formatting needed.
```

### Fields

| Field | Required | Description |
|-------|----------|-------------|
| `question-id` | Yes | Unique identifier for the question (the heading text) |
| `Category` | Yes | One of: `architecture`, `patterns`, `decisions`, `conventions`, `security`, `howto` |
| `Difficulty` | Yes | One of: `easy`, `medium`, `hard` - affects scoring weight |
| `Hints` | No | Comma-separated file/directory paths to help the grader verify answers |

### Scoring Weights

Difficulty levels affect the final score calculation:

- `easy` - Weight: 1.0
- `medium` - Weight: 1.5
- `hard` - Weight: 2.0

### Categories

- `architecture` - Overall system structure and design
- `patterns` - Design patterns and implementation approaches
- `decisions` - Technical decisions and their rationale
- `conventions` - Naming conventions and coding standards
- `security` - Security measures and practices
- `howto` - How to accomplish specific tasks

## Example

```markdown
## auth-flow

- **Category:** architecture
- **Difficulty:** medium
- **Hints:** src/auth/, src/middleware/auth.ts

How does the authentication flow work from login to session management?

## naming-conventions

- **Category:** conventions
- **Difficulty:** easy

What naming conventions are used for React components in this codebase?
```

## Adding New Questions

1. Open the appropriate markdown file (or create a new repo-specific file)
2. Add a new `##` section with a unique question ID
3. Include the required metadata fields
4. Write a clear, specific question
5. Optionally add verification hints to help the grader

## Best Practices

- Use descriptive, kebab-case IDs (e.g., `auth-flow`, `db-migrations`)
- Write questions that have verifiable answers in the codebase
- Include hints for complex questions to improve grading accuracy
- Balance question difficulty across categories
- Focus on important aspects of the codebase that developers should know
