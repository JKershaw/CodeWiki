# Wiki Iteration Comparison

This directory contains wiki outputs generated with different iteration counts to compare how wiki quality evolves.

## Test Environment

- **Repository**: CodeWiki (this project)
- **Total Commits**: 10
- **LLM**: Mock LLM (no ANTHROPIC_API_KEY set)
- **Date**: 2025-11-25

## Results Summary

| Iterations | Commits Processed | Wiki Pages | Coverage |
|------------|-------------------|------------|----------|
| 1          | 1                 | 1          | 10%      |
| 2          | 2                 | 2          | 20%      |
| 5          | 5                 | 5          | 50%      |
| 10         | 10                | 10         | 100%     |

## Key Observations

### Current Behavior (Mock LLM)

With the mock LLM, each iteration:
1. Picks the next unprocessed commit
2. Creates a new wiki page for that commit
3. Pages are independent with no cross-linking

The wiki pages contain:
- Commit message as title
- List of affected files
- Empty Summary and Findings sections (mock LLM doesn't analyze)

### Real LLM Would Provide

With Anthropic API enabled, each iteration would:
1. Analyze commit diffs in detail
2. Generate meaningful summaries
3. Identify patterns and connections
4. Create cross-references between related pages

### Writer Agent Value Assessment

Based on this test, a Writer Agent would add value when:

1. **Multiple agents analyze the same code** - Need to merge findings
2. **Cross-references needed** - Currently no links/backlinks populated
3. **Synthesis required** - Combining multiple commit analyses into coherent docs
4. **Conflict resolution** - When different agents suggest different categorizations

Currently with single-threaded code-change agent only, a Writer Agent provides marginal benefit. Value increases with:
- Multiple specialized agents (Security, Pattern, Dependency, Narrative)
- Higher commit volumes
- Complex cross-cutting concerns

## Recommendation

**Phase 1 (Current)**: Defer Writer Agent - single agent, sequential processing
**Phase 2 (Future)**: Implement Writer Agent when:
- Multiple agents are enabled in executor
- Cross-reference management becomes important
- Wiki conflicts start appearing

## Files in This Directory

- `1-iteration/wiki-pages.json` - Single commit processed
- `2-iterations/wiki-pages.json` - Two commits processed
- `5-iterations/wiki-pages.json` - Five commits processed
- `10-iterations/wiki-pages.json` - All commits processed (100% coverage)
