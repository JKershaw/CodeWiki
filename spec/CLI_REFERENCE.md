# CLI Command Reference

## Executive Summary

The CodeWiki command-line interface provides direct access to all system capabilities through seven primary commands. The CLI is designed for both interactive use and automation, with consistent patterns, comprehensive help, and machine-readable output formats.

**Seven Core Commands:**

1. **process** - Generate or update wiki documentation
2. **ask** - Interactive question answering about codebase
3. **spec** - Generate architectural specifications
4. **query** - Search existing wiki knowledge
5. **status** - Monitor system status and progress
6. **list** - Browse wiki pages and topics
7. **diagnose-coverage** - Debug documentation coverage

**CLI Design Principles:**

- **Consistent Syntax**: All commands follow predictable patterns
- **Progressive Disclosure**: Simple usage simple, complex usage possible
- **Composable**: Commands work well in pipes and scripts
- **Self-Documenting**: Built-in help and examples
- **Error-Friendly**: Clear error messages with suggestions

---

## Table of Contents

1. [Getting Started](#getting-started)
2. [Global Options](#global-options)
3. [process Command](#process-command)
4. [ask Command](#ask-command)
5. [spec Command](#spec-command)
6. [query Command](#query-command)
7. [status Command](#status-command)
8. [list Command](#list-command)
9. [diagnose-coverage Command](#diagnose-coverage-command)
10. [Advanced Usage](#advanced-usage)

---

## Getting Started

### Installation

```bash
# Install globally
npm install -g codewiki

# Or use npx (no installation)
npx codewiki <command>

# Or use as project dependency
npm install codewiki
npx codewiki <command>
```

### First Command

```bash
# Generate wiki for current directory
codewiki process

# Get help on any command
codewiki --help
codewiki process --help
```

### Shell Completion

```bash
# Enable bash completion
codewiki completion bash >> ~/.bashrc

# Enable zsh completion
codewiki completion zsh >> ~/.zshrc

# Enable fish completion
codewiki completion fish >> ~/.config/fish/completions/codewiki.fish
```

---

## Global Options

These options work with all commands:

| Option | Alias | Description | Default |
|--------|-------|-------------|---------|
| `--config <path>` | `-c` | Path to config file | `.codewikirc` |
| `--data-dir <path>` | `-d` | Data directory | `.codewiki-data` |
| `--verbose` | `-v` | Verbose output | false |
| `--quiet` | `-q` | Minimal output | false |
| `--json` | | JSON output format | false |
| `--no-color` | | Disable colored output | false |
| `--help` | `-h` | Show help | |
| `--version` | `-V` | Show version | |

**Examples:**

```bash
# Verbose mode
codewiki process --verbose

# JSON output for scripting
codewiki status --json

# Custom config and data directory
codewiki process --config ./my-config.json --data-dir ./wiki-data
```

---

## process Command

Generate or update wiki documentation for a repository.

### Syntax

```bash
codewiki process [repository] [options]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `repository` | No | Path to repository (default: current directory) |

### Options

| Option | Alias | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--mode <mode>` | `-m` | string | Generation mode: full, incremental, continue | full |
| `--phases <phases>` | `-p` | string | Specific phases to run (comma-separated) | all |
| `--output <path>` | `-o` | string | Output directory for wiki | .codewiki-data |
| `--quality-target <score>` | | number | Target quality score (0-10) | 7.0 |
| `--max-iterations <n>` | | number | Max auto-benchmark iterations | 3 |
| `--budget <amount>` | | number | Max API cost budget (USD) | unlimited |
| `--skip-benchmark` | | boolean | Skip quality benchmarking | false |

### Phases

- `reconnaissance` - Analyze repository structure
- `skeleton` - Generate foundational pages
- `breadth` - Ensure broad coverage
- `depth` - Add detailed documentation
- `polish` - Refine and consolidate
- `maintenance` - Handle updates

### Examples

**Basic Usage:**

```bash
# Generate wiki for current directory
codewiki process

# Generate wiki for specific repository
codewiki process /path/to/repo

# Generate wiki with specific output directory
codewiki process --output ./wiki-output
```

**Advanced Usage:**

```bash
# Incremental update (faster for small changes)
codewiki process --mode incremental

# Continue interrupted generation
codewiki process --mode continue

# Run only specific phases
codewiki process --phases depth,polish

# Set quality target and budget
codewiki process --quality-target 8.5 --budget 10.00

# Full generation with benchmarking
codewiki process --max-iterations 3
```

**Scripting:**

```bash
# Process with JSON output
codewiki process --json > result.json

# Check exit code
codewiki process
if [ $? -eq 0 ]; then
  echo "Success"
else
  echo "Failed"
fi
```

### Exit Codes

| Code | Meaning |
|------|---------|
| 0 | Success |
| 1 | General error |
| 2 | Configuration error |
| 3 | Quality threshold not met |
| 4 | Budget exceeded |
| 130 | User interrupted (Ctrl+C) |

---

## ask Command

Interactive question answering about the codebase.

### Syntax

```bash
codewiki ask [question] [options]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `question` | No | Question to ask (or enter interactive mode) |

### Options

| Option | Alias | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--context <files>` | `-c` | string | Additional context files (comma-separated) | |
| `--agent <name>` | `-a` | string | Specific agent to use | auto |
| `--format <format>` | `-f` | string | Output format: text, markdown, json | text |
| `--max-length <n>` | | number | Max answer length (words) | 500 |

### Examples

**Basic Usage:**

```bash
# Interactive mode
codewiki ask

# Single question
codewiki ask "How does authentication work?"

# With quotes for complex questions
codewiki ask "What design patterns are used in the authentication module?"
```

**Advanced Usage:**

```bash
# Provide context files
codewiki ask "How does this work?" --context src/auth/AuthService.ts

# Use specific agent
codewiki ask "What APIs are available?" --agent api-agent

# Markdown output
codewiki ask "Explain the architecture" --format markdown > architecture.md

# JSON output for parsing
codewiki ask "List all agents" --format json | jq '.answer'
```

**Interactive Session:**

```bash
$ codewiki ask
CodeWiki Interactive Q&A
Type your questions or 'exit' to quit.

> How does authentication work?
[Answer appears...]

> What database is used?
[Answer appears...]

> exit
Goodbye!
```

### Output Format

**Text (default):**
```
Question: How does authentication work?

Answer:
The system uses OAuth 2.0 authentication with GitHub as the provider...

References:
- src/auth/AuthService.ts:45
- docs/authentication.md
```

**JSON:**
```json
{
  "question": "How does authentication work?",
  "answer": "The system uses OAuth 2.0...",
  "confidence": 0.92,
  "references": [
    {"file": "src/auth/AuthService.ts", "line": 45},
    {"page": "authentication-overview"}
  ],
  "agent": "overview-agent"
}
```

---

## spec Command

Generate architectural specification documents.

### Syntax

```bash
codewiki spec <topic> [options]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `topic` | Yes | Topic to document (e.g., architecture, api, security) |

### Options

| Option | Alias | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--output <path>` | `-o` | string | Output file path | ./spec-{topic}.md |
| `--format <format>` | `-f` | string | Output format: markdown, pdf, html | markdown |
| `--template <name>` | `-t` | string | Template to use | default |
| `--diagrams` | | boolean | Include mermaid diagrams | true |
| `--depth <level>` | | string | Detail level: overview, detailed, comprehensive | detailed |

### Examples

**Basic Usage:**

```bash
# Generate architecture spec
codewiki spec architecture

# Generate API specification
codewiki spec api

# Generate security documentation
codewiki spec security
```

**Advanced Usage:**

```bash
# Custom output path
codewiki spec architecture --output ./docs/ARCHITECTURE.md

# PDF format (requires pandoc)
codewiki spec architecture --format pdf

# Comprehensive detail level
codewiki spec api --depth comprehensive

# No diagrams (faster)
codewiki spec overview --diagrams=false
```

**Common Topics:**

- `architecture` - System architecture overview
- `api` - API reference documentation
- `security` - Security design and practices
- `database` - Database schema and design
- `deployment` - Deployment guide
- `testing` - Testing strategy and practices

---

## query Command

Search existing wiki knowledge base.

### Syntax

```bash
codewiki query <search-terms> [options]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `search-terms` | Yes | Search keywords or phrase |

### Options

| Option | Alias | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--topics <topics>` | `-t` | string | Filter by topics (comma-separated) | |
| `--min-quality <score>` | | number | Minimum quality score | 0 |
| `--limit <n>` | `-l` | number | Max results to return | 20 |
| `--format <format>` | `-f` | string | Output format: text, json | text |
| `--show-excerpts` | `-e` | boolean | Show content excerpts | true |

### Examples

**Basic Usage:**

```bash
# Simple search
codewiki query "authentication"

# Phrase search
codewiki query "how to deploy"

# Search with topic filter
codewiki query "API" --topics security,api
```

**Advanced Usage:**

```bash
# High quality pages only
codewiki query "architecture" --min-quality 8.0

# More results
codewiki query "testing" --limit 50

# JSON output for scripting
codewiki query "database" --format json | jq '.results[].title'

# Compact output (no excerpts)
codewiki query "setup" --show-excerpts=false
```

### Output Format

**Text:**
```
Found 3 results for "authentication":

1. Authentication Overview (Quality: 9.2)
   Topics: security, authentication
   Excerpt: The system uses OAuth 2.0 authentication with GitHub...

2. API Authentication (Quality: 8.5)
   Topics: api, security, authentication
   Excerpt: All API endpoints require Bearer token authentication...

3. Testing Authentication (Quality: 7.8)
   Topics: testing, authentication
   Excerpt: Authentication tests use mock OAuth provider...
```

**JSON:**
```json
{
  "query": "authentication",
  "results": [
    {
      "pageId": "auth-overview",
      "title": "Authentication Overview",
      "topics": ["security", "authentication"],
      "qualityScore": 9.2,
      "relevance": 0.95,
      "excerpt": "The system uses OAuth 2.0..."
    }
  ],
  "total": 3
}
```

---

## status Command

Monitor system status and generation progress.

### Syntax

```bash
codewiki status [options]
```

### Options

| Option | Alias | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--watch` | `-w` | boolean | Watch mode (auto-refresh) | false |
| `--interval <seconds>` | `-i` | number | Refresh interval in watch mode | 5 |
| `--format <format>` | `-f` | string | Output format: text, json | text |

### Examples

**Basic Usage:**

```bash
# Show current status
codewiki status

# JSON format
codewiki status --format json
```

**Watch Mode:**

```bash
# Auto-refresh every 5 seconds
codewiki status --watch

# Custom refresh interval
codewiki status --watch --interval 10
```

### Output Format

**Text:**
```
CodeWiki Status
================

System Status: Active
Current Phase: depth (iteration 2/3)
Progress: 65% complete

Coverage Statistics:
  Total Files: 450
  Files Documented: 292
  Coverage: 64.9%
  Average Depth: 2.3/3.0

Wiki Statistics:
  Total Pages: 87
  Average Quality: 8.2
  Last Generated: 2025-12-18 10:30:00

Active Work Items: 12
Completed Work Items: 245
Failed Work Items: 2

Estimated Time Remaining: 25 minutes
```

**JSON:**
```json
{
  "status": "active",
  "currentPhase": {
    "name": "depth",
    "iteration": 2,
    "maxIterations": 3,
    "progress": 0.65
  },
  "coverage": {
    "totalFiles": 450,
    "filesDocumented": 292,
    "percentage": 64.9,
    "averageDepth": 2.3
  },
  "wiki": {
    "totalPages": 87,
    "averageQuality": 8.2,
    "lastGenerated": "2025-12-18T10:30:00Z"
  },
  "workItems": {
    "active": 12,
    "completed": 245,
    "failed": 2
  },
  "estimatedTimeRemaining": 1500
}
```

---

## list Command

Browse wiki pages and topics.

### Syntax

```bash
codewiki list <type> [options]
```

### Arguments

| Argument | Required | Description |
|----------|----------|-------------|
| `type` | Yes | What to list: pages, topics, repositories |

### Options

| Option | Alias | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--sort <field>` | `-s` | string | Sort by: title, quality, date | quality |
| `--order <order>` | | string | Sort order: asc, desc | desc |
| `--filter <filter>` | `-f` | string | Filter expression | |
| `--limit <n>` | `-l` | number | Max items to show | 50 |
| `--format <format>` | | string | Output format: text, json, csv | text |

### Examples

**List Pages:**

```bash
# All pages sorted by quality
codewiki list pages

# Sort by title
codewiki list pages --sort title

# Filter by quality
codewiki list pages --filter "quality > 8.0"

# Show more results
codewiki list pages --limit 100
```

**List Topics:**

```bash
# All topics
codewiki list topics

# Sort by page count
codewiki list topics --sort count

# JSON format
codewiki list topics --format json
```

**List Repositories:**

```bash
# All repositories
codewiki list repositories

# Most recently updated first
codewiki list repositories --sort date --order desc
```

### Output Format

**Pages (Text):**
```
Wiki Pages (sorted by quality)
================================

1. Architecture Overview                     Quality: 9.2  Pages: 1
   Topics: architecture, overview

2. API Reference                             Quality: 8.5  Pages: 1
   Topics: api, reference

3. Security Design                           Quality: 8.3  Pages: 1
   Topics: security, architecture

Total: 87 pages
```

**Topics (JSON):**
```json
{
  "topics": [
    {
      "name": "architecture",
      "pageCount": 15,
      "category": "architecture",
      "relatedTopics": ["design", "patterns"]
    }
  ],
  "total": 24
}
```

---

## diagnose-coverage Command

Debug documentation coverage issues.

### Syntax

```bash
codewiki diagnose-coverage [options]
```

### Options

| Option | Alias | Type | Description | Default |
|--------|-------|------|-------------|---------|
| `--path <path>` | `-p` | string | Specific path to diagnose | (all) |
| `--min-depth <level>` | | number | Minimum depth to consider covered | 1 |
| `--show-uncovered` | `-u` | boolean | Show uncovered files | true |
| `--format <format>` | `-f` | string | Output format: text, json | text |

### Examples

**Basic Usage:**

```bash
# Diagnose overall coverage
codewiki diagnose-coverage

# Specific directory
codewiki diagnose-coverage --path src/agents

# Show only uncovered files
codewiki diagnose-coverage --show-uncovered
```

**Advanced Usage:**

```bash
# Higher depth requirement
codewiki diagnose-coverage --min-depth 2

# JSON output
codewiki diagnose-coverage --format json > coverage-report.json
```

### Output Format

**Text:**
```
Coverage Diagnosis Report
==========================

Overall Coverage: 64.9% (292/450 files)

Coverage by Directory:
  src/agents/           85.2% (23/27 files)   ✓ Good
  src/orchestrator/     78.9% (15/19 files)   ✓ Good
  src/storage/          45.8% (11/24 files)   ⚠ Poor
  tests/                22.1% (34/154 files)  ✗ Very Poor

Uncovered Files (Sample):
  src/storage/FileStorage.ts           Depth: 0  Priority: High
  src/storage/MongoDBStorage.ts        Depth: 0  Priority: High
  tests/unit/agents/BaseAgent.test.ts  Depth: 0  Priority: Low

Recommendations:
  - Focus on src/storage/ directory (low coverage)
  - Consider running depth phase for better coverage
  - Test files have intentionally low coverage priority
```

---

## Advanced Usage

### Piping and Composition

**Combine Commands:**

```bash
# Generate wiki and check quality
codewiki process && codewiki status

# Query and save results
codewiki query "authentication" --format json > auth-docs.json

# List low-quality pages for regeneration
codewiki list pages --filter "quality < 7.0" --format json | \
  jq -r '.pages[].id' | \
  xargs -I {} codewiki process --pages {}
```

---

### Scripting

**Bash Script Example:**

```bash
#!/bin/bash
set -e

echo "Starting wiki generation..."
codewiki process --quality-target 8.0 --json > result.json

QUALITY=$(jq -r '.averageQuality' result.json)
echo "Average quality: $QUALITY"

if (( $(echo "$QUALITY < 7.5" | bc -l) )); then
  echo "Quality below threshold, regenerating..."
  codewiki process --mode incremental --phases depth,polish
fi

echo "Wiki generation complete!"
```

---

### CI/CD Integration

**GitHub Actions:**

```yaml
- name: Generate Wiki
  run: |
    codewiki process --json > result.json
    echo "QUALITY=$(jq -r '.averageQuality' result.json)" >> $GITHUB_ENV

- name: Check Quality
  run: |
    if (( $(echo "$QUALITY < 7.5" | bc -l) )); then
      echo "Quality $QUALITY below threshold 7.5"
      exit 1
    fi
```

---

### Output Formats

**JSON Output Structure:**

All commands support `--format json` with consistent structure:

```json
{
  "command": "process",
  "timestamp": "2025-12-18T10:00:00Z",
  "success": true,
  "data": {
    /* command-specific data */
  },
  "error": null,
  "metadata": {
    "duration": 1234,
    "version": "1.0.0"
  }
}
```

---

## Appendix: Quick Reference Card

| Command | Purpose | Quick Example |
|---------|---------|---------------|
| `process` | Generate wiki | `codewiki process` |
| `ask` | Ask questions | `codewiki ask "How does X work?"` |
| `spec` | Generate specs | `codewiki spec architecture` |
| `query` | Search wiki | `codewiki query "authentication"` |
| `status` | Check progress | `codewiki status --watch` |
| `list` | Browse pages | `codewiki list pages` |
| `diagnose-coverage` | Debug coverage | `codewiki diagnose-coverage` |

**Global Options:**
- `--help` - Show help
- `--json` - JSON output
- `--verbose` - Verbose logging
- `--data-dir <path>` - Custom data directory

---

**Document Version**: 1.0
**Last Updated**: 2025-12-18
**Related Documents**:
- USER_WORKFLOWS.md - Usage patterns and workflows
- CONFIGURATION.md - Configuration options
- ARCHITECTURE.md - System architecture
