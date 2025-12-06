/**
 * Reusable mock LLM response fixtures for agent integration tests.
 *
 * Each fixture returns a properly formatted response string that matches
 * the agent's expected output format, allowing tests to run without a real LLM.
 */

/**
 * Security Agent response fixtures.
 */
export const securityAgentResponses = {
  /**
   * Response for a commit with security-relevant auth changes.
   */
  authChangesDetected: (commitSha: string) => `SUMMARY:
This commit introduces authentication logic including password hashing and session token generation. The implementation uses bcrypt for password hashing which is secure.

SECURITY_RELEVANCE:
high

FINDINGS:
- [AUTHENTICATION] [SEVERITY:high] New password hashing implementation using bcrypt [src/auth/password.ts]
- [SESSION_MANAGEMENT] [SEVERITY:medium] Session token generation added [src/auth/session.ts]

VULNERABILITIES:
- No critical vulnerabilities detected

RECOMMENDATIONS:
- Consider adding rate limiting to authentication endpoints
- Ensure session tokens have appropriate expiration

WIKI_UPDATES:
- [security/audit-${commitSha.slice(0, 8)}] [create] Security audit for authentication implementation
- [security/overview] [update] Update security overview with auth changes

CONFIDENCE: 0.85`,

  /**
   * Response for a commit with potential SQL injection vulnerability.
   */
  sqlInjectionDetected: (commitSha: string) => `SUMMARY:
This commit introduces a database query that concatenates user input directly into SQL, creating a potential SQL injection vulnerability.

SECURITY_RELEVANCE:
critical

FINDINGS:
- [SQL_INJECTION] [SEVERITY:critical] User input directly concatenated into SQL query [src/db/queries.ts]
- [INPUT_VALIDATION] [SEVERITY:high] No input sanitization before database operations [src/db/queries.ts]

VULNERABILITIES:
- [SQL Injection] Query uses string concatenation with user input - CWE-89

RECOMMENDATIONS:
- Use parameterized queries or prepared statements
- Add input validation layer before database operations
- Consider using an ORM that handles escaping automatically

WIKI_UPDATES:
- [security/audit-${commitSha.slice(0, 8)}] [create] Critical security audit - SQL injection vulnerability
- [security/overview] [update] Add critical vulnerability notice

CONFIDENCE: 0.95`,

  /**
   * Response for a commit with no security relevance.
   */
  noSecurityRelevance: () => `SUMMARY:
This commit contains documentation updates and code formatting changes with no security implications.

SECURITY_RELEVANCE:
none

FINDINGS:

VULNERABILITIES:

RECOMMENDATIONS:

WIKI_UPDATES:

CONFIDENCE: 0.9`,

  /**
   * Response for XSS vulnerability detection.
   */
  xssVulnerabilityDetected: (commitSha: string) => `SUMMARY:
This commit adds user content rendering without proper HTML escaping, creating potential XSS vulnerabilities.

SECURITY_RELEVANCE:
critical

FINDINGS:
- [XSS] [SEVERITY:critical] User content rendered with innerHTML without sanitization [src/components/UserContent.tsx]
- [INPUT_VALIDATION] [SEVERITY:high] No content sanitization before rendering [src/components/UserContent.tsx]

VULNERABILITIES:
- [Cross-Site Scripting] User input rendered without escaping - CWE-79

RECOMMENDATIONS:
- Use textContent instead of innerHTML for user content
- Implement a sanitization library like DOMPurify
- Enable Content Security Policy headers

WIKI_UPDATES:
- [security/audit-${commitSha.slice(0, 8)}] [create] XSS vulnerability audit
- [security/overview] [update] Document XSS prevention requirements

CONFIDENCE: 0.92`,
};

/**
 * Pattern Agent response fixtures.
 */
export const patternAgentResponses = {
  /**
   * Response for detecting Repository pattern.
   */
  repositoryPatternDetected: (commitSha: string) => `SUMMARY:
This commit introduces the Repository pattern for data access, providing a clean abstraction layer over the database.

PATTERNS_FOUND:
- [Repository Pattern] [CATEGORY:design] Clean data access abstraction separating domain from persistence [src/repositories/user-repository.ts]

KEY_FILES:
- [src/repositories/user-repository.ts] [PRIMARY] Main repository implementation
- [src/repositories/base-repository.ts] [SUPPORTING] Base class with common CRUD operations
- [src/domain/user.ts] [RELATED] Domain entity that the repository manages

CODE_SNIPPETS:
- [Repository Interface] [src/repositories/user-repository.ts:1-10]
\`\`\`typescript
export interface UserRepository {
  findById(id: string): Promise<User | null>;
  save(user: User): Promise<void>;
  delete(id: string): Promise<void>;
}
\`\`\`

IMPLEMENTATION_EXPLANATION:
The Repository pattern encapsulates data access logic behind a clean interface. The UserRepository provides methods for finding, saving, and deleting users without exposing database details to the domain layer.

TRADE_OFFS:
- [Abstraction vs Performance] This design prioritizes clean separation over raw SQL performance, accepting some overhead for maintainability

CONVENTIONS:
- Repository classes follow the naming pattern {Entity}Repository
- All async methods return Promises

ANTI_PATTERNS:

WIKI_UPDATES:
- [patterns/repository-pattern] [update] Document Repository pattern implementation

CONFIDENCE: 0.88`,

  /**
   * Response for detecting Factory pattern.
   */
  factoryPatternDetected: (commitSha: string) => `SUMMARY:
This commit implements a Factory pattern for creating service instances based on configuration.

PATTERNS_FOUND:
- [Factory Pattern] [CATEGORY:design] Creates service instances without exposing creation logic [src/factories/service-factory.ts]

KEY_FILES:
- [src/factories/service-factory.ts] [PRIMARY] Factory implementation
- [src/services/index.ts] [RELATED] Service exports

CODE_SNIPPETS:
- [Factory Method] [src/factories/service-factory.ts:15-25]
\`\`\`typescript
export function createService(type: ServiceType): Service {
  switch (type) {
    case 'memory': return new MemoryService();
    case 'database': return new DatabaseService();
    default: throw new Error('Unknown service type');
  }
}
\`\`\`

IMPLEMENTATION_EXPLANATION:
The factory method pattern allows clients to create objects without specifying their concrete classes. This enables switching implementations easily for testing or configuration changes.

TRADE_OFFS:
- [Flexibility vs Simplicity] Adds indirection but enables easy implementation swapping

CONVENTIONS:
- Factory functions use create{Type} naming pattern

ANTI_PATTERNS:

WIKI_UPDATES:
- [patterns/factory-pattern] [create] Document Factory pattern usage

CONFIDENCE: 0.82`,

  /**
   * Response for detecting anti-patterns.
   */
  antiPatternDetected: (commitSha: string) => `SUMMARY:
This commit introduces a God class that handles too many responsibilities, violating the Single Responsibility Principle.

PATTERNS_FOUND:
- [God Class] [CATEGORY:anti-pattern] AppManager handles database, caching, auth, and business logic [src/app-manager.ts]

KEY_FILES:
- [src/app-manager.ts] [PRIMARY] The problematic God class

CODE_SNIPPETS:

IMPLEMENTATION_EXPLANATION:
The AppManager class has grown to handle database connections, caching, authentication, and business logic all in one place. This makes it difficult to test, maintain, and extend.

TRADE_OFFS:

CONVENTIONS:

ANTI_PATTERNS:
- God Class: AppManager handles 5+ distinct responsibilities that should be separated into dedicated services

WIKI_UPDATES:
- [patterns/anti-patterns] [update] Document God class anti-pattern found in codebase

CONFIDENCE: 0.9`,

  /**
   * Response with no patterns found.
   */
  noPatternsFound: () => `SUMMARY:
This commit contains straightforward utility functions with no notable design patterns.

PATTERNS_FOUND:

KEY_FILES:

CODE_SNIPPETS:

IMPLEMENTATION_EXPLANATION:

TRADE_OFFS:

CONVENTIONS:
- Function names use camelCase

ANTI_PATTERNS:

WIKI_UPDATES:

CONFIDENCE: 0.7`,
};

/**
 * Dependency Agent response fixtures.
 */
export const dependencyAgentResponses = {
  /**
   * Response for added dependencies.
   */
  dependenciesAdded: (commitSha: string) => `SUMMARY:
This commit adds two new dependencies: lodash for utility functions and axios for HTTP requests.

CHANGES:
- [ADDED] lodash [4.17.21] General-purpose utility library
- [ADDED] axios [1.6.0] Promise-based HTTP client

BREAKING_CHANGES:
- None

SECURITY_NOTES:
- lodash has no known active vulnerabilities
- axios is widely used and well-maintained

IMPACT:
moderate

DEPENDENCY_DETAILS:

=== [lodash] ===
PURPOSE:
Lodash provides utility functions for common programming tasks like array manipulation, object operations, and string handling. It was chosen for its comprehensive feature set and proven reliability.

USAGE:
Used throughout the codebase for array operations (map, filter, groupBy) and object manipulation (merge, clone, pick). The library is imported selectively to minimize bundle size.

CONSIDERATIONS:
Consider using lodash-es for better tree-shaking. Bundle size impact is approximately 70KB minified if using full library.
=== END ===

WIKI_UPDATES:
=== [dependencies/lodash] [create] ===
# lodash

## Purpose

Lodash is a modern JavaScript utility library delivering modularity, performance, and extras.

## Usage

\`\`\`typescript
import { groupBy, sortBy } from 'lodash';
\`\`\`

## Version

4.17.21
=== END ===

CONFIDENCE: 0.85`,

  /**
   * Response for dependency updates with breaking changes.
   */
  dependencyUpdatedWithBreakingChanges: (commitSha: string) => `SUMMARY:
This commit updates React from version 17 to version 18, introducing breaking changes related to concurrent rendering.

CHANGES:
- [UPDATED] react [17.0.2 -> 18.2.0] Major version upgrade with concurrent features
- [UPDATED] react-dom [17.0.2 -> 18.2.0] Updated alongside React

BREAKING_CHANGES:
- ReactDOM.render is deprecated, use createRoot instead
- Automatic batching may change component render behavior
- StrictMode now double-invokes effects in development

SECURITY_NOTES:
- Fixes CVE-2022-XXXXX related to SSR vulnerability in React 17

IMPACT:
significant

WIKI_UPDATES:
- [architecture/dependencies] [update] Note React 18 upgrade and migration requirements

CONFIDENCE: 0.9`,

  /**
   * Response for non-dependency commit.
   */
  noDependencyChanges: () => `SUMMARY:
No dependency changes in this commit.

CHANGES:

BREAKING_CHANGES:

SECURITY_NOTES:

IMPACT:
minimal

WIKI_UPDATES:

CONFIDENCE: 1.0`,
};

/**
 * Narrative Agent response fixtures.
 */
export const narrativeAgentResponses = {
  /**
   * Response for ADR (Architecture Decision Record) detection.
   */
  adrDetected: (commitSha: string) => `SUMMARY:
This commit adds an Architecture Decision Record documenting the choice to use CQRS pattern for the application.

NARRATIVE_TYPE:
adr

PAGE_TITLE:
CQRS Architecture Decision

FINDINGS:
- [ARCHITECTURE_DECISION] [IMPORTANCE:high] Decision to adopt CQRS pattern for command/query separation [docs/adr/001-cqrs.md]

KEY_DECISIONS:
- Adopt CQRS pattern to separate read and write operations
- Use event sourcing for audit trail
- Implement eventual consistency for read models

WIKI_UPDATES:
=== [decisions/cqrs-architecture] [create] ===
# CQRS Architecture Decision

## Context

The application needs to handle complex queries and commands with different scaling requirements.

## Decision

We will use the CQRS (Command Query Responsibility Segregation) pattern to separate read and write operations.

## Consequences

- Commands and queries can be scaled independently
- Read models can be optimized for specific query patterns
- Increased complexity in maintaining consistency
=== END ===

CONFIDENCE: 0.9`,

  /**
   * Response for planning document detection.
   */
  planningDocDetected: (commitSha: string) => `SUMMARY:
This commit introduces a project planning document outlining the roadmap for v2.0 features.

NARRATIVE_TYPE:
planning

PAGE_TITLE:
Version 2.0 Roadmap

FINDINGS:
- [ROADMAP] [IMPORTANCE:high] Q1-Q2 feature planning for version 2.0 [PLAN.md]

KEY_DECISIONS:
- Prioritize API redesign in Q1
- Add real-time features in Q2
- Migrate to microservices architecture

WIKI_UPDATES:
=== [planning/v2-roadmap] [create] ===
# Version 2.0 Roadmap

## Overview

This document outlines the planned features and improvements for version 2.0.

## Q1 Goals

- API redesign with GraphQL support
- Improved authentication system

## Q2 Goals

- Real-time collaboration features
- Performance optimizations
=== END ===

CONFIDENCE: 0.85`,

  /**
   * Response with no narrative content.
   */
  noNarrativeContent: () => `SUMMARY:
No significant narrative content in this commit.

NARRATIVE_TYPE:
none

PAGE_TITLE:

FINDINGS:

KEY_DECISIONS:

WIKI_UPDATES:

CONFIDENCE: 0.8`,
};

/**
 * Structure Agent response fixtures.
 */
export const structureAgentResponses = {
  /**
   * Response with structure improvement suggestions.
   */
  structureImprovementsNeeded: () => `SUGGESTIONS:
- [PRIORITY:high] | [patterns/repository-pattern, patterns/factory-pattern] | Create a patterns/overview page to help readers navigate pattern documentation
- [PRIORITY:medium] | [architecture/overview] | Split the 8000-character overview into separate pages for each subsystem
- [PRIORITY:low] | [guides/getting-started] | Add cross-references to related API documentation

OVERALL_ASSESSMENT: The wiki has good content but would benefit from better organization. Creating overview pages for major sections and adding cross-references would significantly improve navigation.`,

  /**
   * Response indicating healthy wiki structure.
   */
  healthyStructure: () => `SUGGESTIONS:

OVERALL_ASSESSMENT: The wiki is well-organized with appropriate page lengths, balanced categories, and good cross-linking between related content.`,
};

/**
 * Consistency Agent response fixtures.
 */
export const consistencyAgentResponses = {
  /**
   * Response with terminology inconsistencies found.
   */
  terminologyInconsistencies: () => `ISSUES:
- [SEVERITY:medium] | [TYPE:terminology] | [architecture/overview, guides/api] | 'Service' and 'Provider' used interchangeably for the same concept
- [SEVERITY:low] | [TYPE:style] | [guides/getting-started, guides/deployment] | Inconsistent heading capitalization

TERMINOLOGY_MAP:
- Service = Provider = ServiceProvider: These all refer to the same dependency injection concept

SUGGESTIONS:
- Standardize on 'Service' terminology throughout the wiki
- Create a glossary page defining key terms

CONFIDENCE: 0.8`,

  /**
   * Response with contradictions detected.
   */
  contradictionsDetected: () => `ISSUES:
- [SEVERITY:high] | [TYPE:contradiction] | [architecture/database, guides/deployment] | Database documentation says PostgreSQL is required but deployment guide mentions SQLite as default

TERMINOLOGY_MAP:

SUGGESTIONS:
- Clarify which database is the default and which are supported alternatives
- Update deployment guide to match architecture documentation

CONFIDENCE: 0.85`,

  /**
   * Response indicating consistent wiki.
   */
  consistentWiki: () => `ISSUES:

TERMINOLOGY_MAP:

SUGGESTIONS:

CONFIDENCE: 0.9`,
};

/**
 * Overview Agent response fixtures.
 */
export const overviewAgentResponses = {
  /**
   * Response for generating project overview.
   */
  projectOverview: () => `# Project Overview

A modern web application built with TypeScript and Node.js.

## Purpose

This project provides a platform for managing and documenting codebases automatically.

## Key Features

- Automatic documentation generation
- Git integration
- Multi-user support

## Architecture

The application follows a layered architecture with clear separation between domain logic, services, and infrastructure.

## Getting Started

1. Clone the repository
2. Install dependencies with \`npm install\`
3. Run \`npm start\` to start the application`,
};

/**
 * Getting Started Agent response fixtures.
 */
export const gettingStartedAgentResponses = {
  /**
   * Response for generating getting started guide.
   */
  gettingStartedGuide: () => `# Getting Started

Welcome to the project! This guide will help you get up and running quickly.

## Prerequisites

- Node.js 18+
- npm or yarn

## Installation

\`\`\`bash
git clone <repo-url>
cd project
npm install
\`\`\`

## Running the Application

\`\`\`bash
npm run dev
\`\`\`

## Next Steps

- Read the API documentation
- Explore the architecture guide`,
};
