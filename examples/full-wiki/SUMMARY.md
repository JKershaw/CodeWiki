# Full Wiki Example

Generated: 2025-11-26

This is the most complete wiki example, showcasing all 9 agents working together.

## Processing Statistics

| Metric | Value |
|--------|-------|
| Total Commits | 16 |
| Wiki Pages | 41 |
| Average Confidence | 56.1% |
| Total Cost | ~$2.50 |

## Agents Used

### Analysis Agents (process commits)
| Agent | Runs | Purpose |
|-------|------|---------|
| code-change | 16 | Base documentation from code changes |
| narrative | 16 | ADRs, planning docs, READMEs |
| security | 16 | Security audit findings |
| pattern | 16 | Design patterns and conventions |
| dependency | 16 | Dependency changes |

### Meta Agents (process wiki)
| Agent | Runs | Purpose |
|-------|------|---------|
| link | 17 | Cross-references between pages |
| structure | 1 | Wiki organization analysis |
| quality | 1 | Content quality review |
| consistency | 1 | Cross-page consistency check |

## Wiki Structure

```
Categories:
  architecture/  - 5 pages (system design docs)
  commits/       - 16 pages (one per commit)
  conventions/   - 1 page (coding standards)
  decisions/     - 6 pages (ADRs)
  guides/        - 1 page (how-to guides)
  history/       - 2 pages (project history)
  patterns/      - 1 page (anti-patterns)
  planning/      - 2 pages (project planning)
  security/      - 7 pages (security audits + overview)
```

## Key Features Demonstrated

1. **Multi-Agent Analysis**: Each commit analyzed by 5 specialized agents
2. **Cross-References**: Link Agent added "Related Pages" sections
3. **Security Overview**: Aggregated security findings across commits
4. **Pattern Detection**: Coding conventions and anti-patterns extracted
5. **Consistency Checks**: 75 issues identified (mostly orphaned pages needing links)

## Sample Pages

- `decisions/cqrs-architecture-decision.md` - ADR extracted by narrative agent
- `security/overview.md` - Aggregated security recommendations
- `commits/296d345b.md` - Shows Link Agent's "Related Pages" section
- `patterns/anti-patterns.md` - Pattern agent output
- `index.md` - Full wiki index with confidence indicators
