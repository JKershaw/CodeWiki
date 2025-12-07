import type { FindingType } from '../../domain/finding.js';
import type { FindingHandler } from './finding-handler.js';
import {
  BrokenLinkHandler,
  CategoryMismatchHandler,
  ContradictionHandler,
  DuplicateHandler,
  InaccuracyHandler,
  OrphanedPageHandler,
  TerminologyHandler,
} from './handlers/index.js';

/**
 * Registry for finding handlers.
 *
 * This class implements a registry pattern that:
 * - Maintains a mapping of FindingType to FindingHandler
 * - Supports registration of new handlers without modifying existing code (OCP)
 * - Provides lookup functionality for handlers by finding type
 *
 * New finding types can be supported by:
 * 1. Creating a new handler class implementing FindingHandler
 * 2. Registering it with the registry via register()
 */
export class FindingHandlerRegistry {
  private handlers: Map<FindingType, FindingHandler> = new Map();

  /**
   * Register a handler for the finding types it supports.
   * Each handler can support multiple finding types.
   */
  register(handler: FindingHandler): void {
    for (const type of handler.supportedTypes) {
      this.handlers.set(type, handler);
    }
  }

  /**
   * Get the handler for a specific finding type.
   * Returns undefined if no handler is registered for the type.
   */
  getHandler(type: FindingType): FindingHandler | undefined {
    return this.handlers.get(type);
  }

  /**
   * Check if a handler is registered for the given finding type.
   */
  hasHandler(type: FindingType): boolean {
    return this.handlers.has(type);
  }

  /**
   * Get all registered finding types.
   */
  getSupportedTypes(): FindingType[] {
    return Array.from(this.handlers.keys());
  }
}

/**
 * Create a FindingHandlerRegistry with all default handlers registered.
 *
 * This factory function provides the standard configuration with all
 * built-in handlers. Custom registries can be created for testing or
 * to support additional finding types.
 */
export function createDefaultHandlerRegistry(): FindingHandlerRegistry {
  const registry = new FindingHandlerRegistry();

  // Register all built-in handlers
  registry.register(new DuplicateHandler());
  registry.register(new BrokenLinkHandler());
  registry.register(new TerminologyHandler());
  registry.register(new OrphanedPageHandler());
  registry.register(new CategoryMismatchHandler());
  registry.register(new ContradictionHandler());
  registry.register(new InaccuracyHandler());

  return registry;
}
