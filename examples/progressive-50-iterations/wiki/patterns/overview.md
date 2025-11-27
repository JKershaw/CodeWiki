---
title: "Design Patterns and Conventions"
confidence: 0.5
path: patterns/overview
---

# Design Patterns and Conventions

This section documents the design patterns, architectural patterns, and coding conventions used throughout the codebase. Design patterns are reusable solutions to common software design problems that help create more maintainable, flexible, and understandable code. The patterns documented here span multiple levels of abstraction—from low-level object creation patterns to high-level architectural decisions that shape how different parts of the system interact.

Understanding these patterns is essential for contributing effectively to the codebase. They represent agreed-upon approaches that promote consistency across the project and embody lessons learned from past development efforts. The patterns are organized into several categories: design patterns that solve structural and behavioral problems, architectural patterns that define system-level organization, testing patterns that ensure code quality, and conventions that establish coding standards.

This overview also includes anti-patterns—approaches that should be avoided. Recognizing these problematic patterns helps developers understand not just what to do, but also what pitfalls to avoid when designing new features or refactoring existing code.

## Key Concepts

- ****Design Patterns****: Reusable solutions for object creation, structure, and behavior (Factory Method, Builder, Strategy, Facade)
- ****Architectural Patterns****: Higher-level patterns that organize system components and manage dependencies (Repository, Dependency Injection, Interface Segregation)
- ****Testing Patterns****: Patterns that make tests more maintainable and expressive (Test Doubles, Spies, Data Builders, Fixture Organization)
- ****Conventions****: Project-specific coding standards and idioms (Named Constructor Variants)
- ****Anti-Patterns****: Known problematic approaches to avoid

## Pages in this Category

- [Anti-Patterns to Avoid](patterns/anti-patterns.md) - Documents patterns and practices that have been identified as problematic and should be avoided
- [FACTORY_METHOD](patterns/factory-method.md) - Covers object creation through factory methods rather than direct constructors
- [TEST_DOUBLE](patterns/test-double.md) - Covers the use of test doubles (mocks, stubs, fakes) in testing
- [BUILDER_PATTERN](patterns/builder-pattern.md) - Describes the fluent builder pattern for constructing complex objects step-by-step
- [REPOSITORY_PATTERN](patterns/repository-pattern.md) - Documents the data access abstraction layer pattern
- [FACADE_PATTERN](patterns/facade-pattern.md) - Shows how to provide simplified interfaces to complex subsystems
- [DEPENDENCY_INJECTION](patterns/dependency-injection.md) - Covers how dependencies are provided to objects rather than created internally
- [TEST_DATA_BUILDER](patterns/test-data-builder.md) - Explains creating test data using the builder pattern for readable test setup
- [STRATEGY_PATTERN](patterns/strategy-pattern.md) - Explains how to encapsulate interchangeable algorithms or behaviors
- [SPY_PATTERN](patterns/spy-pattern.md) - Documents using spy objects to verify interactions in tests
- [TEST_FIXTURE_ORGANIZATION](patterns/test-fixture-organization.md) - Covers how to organize and structure test fixtures
- [NAMED_CONSTRUCTOR_VARIANTS](patterns/named-constructor-variants.md) - Describes the convention for creating multiple named constructors with different initialization patterns
- [TEST_ORGANIZATION_BY_TYPE](patterns/test-organization-by-type.md) - Documents the approach to organizing test files by test type
- [INTERFACE_SEGREGATION](patterns/interface-segregation.md) - Explains keeping interfaces focused and client-specific

## Suggested Reading Order

**For new contributors**, start with the architectural patterns to understand system-level organization:
1. patterns/dependency-injection - Understand how the system manages dependencies
2. patterns/repository-pattern - Learn the data access strategy
3. patterns/interface-segregation - See how interfaces are designed

**Then explore design patterns** used for object creation and behavior:
4. patterns/factory-method - Object creation patterns
5. patterns/builder-pattern - Complex object construction
6. patterns/named-constructor-variants - Project conventions for constructors
7. patterns/strategy-pattern - Behavioral flexibility
8. patterns/facade-pattern - Simplifying complex interactions

**For testing**, review testing patterns in this order:
9. patterns/test-organization-by-type - How tests are organized
10. patterns/test-fixture-organization - Setting up test data
11. patterns/test-data-builder - Creating test objects
12. patterns/test-double - Using test doubles
13. patterns/spy-pattern - Verifying interactions

**Finally**, review anti-patterns to understand what to avoid:
14. patterns/anti-patterns - Known problematic approaches