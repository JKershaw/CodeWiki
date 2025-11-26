---
title: "Build Artifacts and Generated Content Management"
confidence: 0.55
created: 2025-11-26T12:25:31.079Z
updated: 2025-11-26T13:05:14.106Z
commits: [ca53f7eaf87dc836914eb445bb5869c4978f2599]
---
# Build Artifacts and Generated Content Management

The project's build process generates wiki documentation output that should not be tracked in version control. The `wiki-output/` directory serves as the default destination for generated wiki content, similar to other build artifacts like compiled binaries, test results, or bundled assets. This directory is excluded from git tracking to prevent repository bloat and avoid merge conflicts from generated files.

This pattern follows standard practices for managing generated content in software projects. Just as compiled code, dependency caches, and log files are excluded from version control, generated documentation should remain local to each developer's environment or be deployed separately through CI/CD pipelines. The wiki output can be regenerated from source at any time, making it unnecessary to track in the repository.

The placement of this exclusion in `.gitignore` alongside other local data directories (like `.codewiki-data/`) indicates that the project maintains a clear separation between source content (tracked) and generated artifacts (ignored). This allows developers to build and preview wiki documentation locally without affecting the shared repository state.



## Source

- **Commit:** ca53f7ea
- **Files:** `.gitignore`


---



## Related Pages

- [Wiki Export System](commits/fd824f7d.md) - Wiki export generates content into wiki-output directory
- [Improve wiki export and agent prompts for better content quality](commits/b49c7432.md) - Export improvements affect build artifacts management
- [Wiki Paths](conventions/wiki-paths.md) - Build artifacts relate to wiki organization conventions
- [Cli Usage](guides/cli-usage.md) - CLI generates wiki output as build artifacts