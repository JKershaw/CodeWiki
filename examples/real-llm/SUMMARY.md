# Real LLM Wiki Generation Results

Generated on 2025-11-25 using Anthropic Claude API

## Processing Statistics

| Metric | Value |
|--------|-------|
| Total Commits | 12 |
| Total Iterations | 60 (5 + 10 + 45) |
| Wiki Pages Created | 32 |
| Average Confidence | 56.2% |
| Total Cost | ~$1.63 |
| Processing Time | ~25 minutes |

## Agent Performance

| Agent | Commits Processed | Avg Time | Avg Cost | Pages Created |
|-------|-------------------|----------|----------|---------------|
| code-change | 12 | 21s | $0.025 | 12 |
| narrative | 12 | 22s | $0.025 | varies |
| security | 12 | 29s | $0.030 | 6 |
| pattern | 12 | 43s | $0.039 | 1 |
| dependency | 12 | 18s* | $0.019* | varies |

*Dependency agent skips commits without dependency changes (0ms)

## Wiki Structure

```
Pages by category:
  commits: 12       (one per commit)
  security: 6       (security findings)
  decisions: 5      (ADRs extracted)
  architecture: 4   (architecture docs)
  planning: 2       (planning docs)
  history: 1        (project history)
  conventions: 1    (coding conventions)
  patterns: 1       (design patterns)
```

## Sample Content Quality

### Code Change Agent
- Generates detailed summaries with findings categorized by type (ARCHITECTURE, FEATURE, BUG_FIX, etc.)
- Importance levels (high/medium/low) assigned to each finding
- Affected files listed

### Narrative Agent
- Creates ADRs and planning documents from commits
- Captures project decisions with rationale
- Links to source files

### Security Agent
- Identifies security-relevant changes
- Documents API integrations and authentication patterns
- Flags potential security considerations

### Pattern Agent
- Identifies architectural patterns (CQRS, Repository, Agent-based)
- Documents design decisions
- Creates pattern documentation pages

### Dependency Agent
- Tracks package.json changes
- Skips non-dependency commits (efficient)
- Documents new dependencies and their implications

## Key Observations

1. **Content Quality**: Real LLM produces rich, contextual documentation compared to mock LLM
2. **Agent Specialization**: Each agent provides unique perspective on the same commits
3. **Cost Efficiency**: ~$1.63 for complete analysis of 12 commits (5 agents each)
4. **Time**: ~25 minutes for full processing (could be parallelized)

## Files in This Directory

- `5-iterations.json` - Initial 5 code-change runs
- `full-processing.json` - Complete wiki after all agents
