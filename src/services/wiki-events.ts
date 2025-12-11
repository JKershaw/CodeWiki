/**
 * Wiki event emitter for real-time updates.
 *
 * This service provides a central event bus for wiki changes,
 * enabling real-time graph visualization updates via SSE.
 */

import { EventEmitter } from 'events';

/**
 * Types of wiki events.
 */
export type WikiEventType =
  | 'page-created'
  | 'page-updated'
  | 'page-deleted'
  | 'link-added'
  | 'link-removed';

/**
 * Base wiki event structure.
 */
export interface WikiEventBase {
  type: WikiEventType;
  wikiId: string;
  timestamp: Date;
}

/**
 * Event emitted when a page is created.
 */
export interface PageCreatedEvent extends WikiEventBase {
  type: 'page-created';
  page: {
    id: string;
    path: string;
    title: string;
    category?: string;
    confidence: number;
  };
}

/**
 * Event emitted when a page is updated.
 */
export interface PageUpdatedEvent extends WikiEventBase {
  type: 'page-updated';
  page: {
    id: string;
    path: string;
    title: string;
    category?: string;
    confidence: number;
  };
}

/**
 * Event emitted when a page is deleted.
 */
export interface PageDeletedEvent extends WikiEventBase {
  type: 'page-deleted';
  pageId: string;
  path: string;
}

/**
 * Event emitted when a link is added between pages.
 */
export interface LinkAddedEvent extends WikiEventBase {
  type: 'link-added';
  sourcePageId: string;
  targetPageId: string;
  sourcePath: string;
  targetPath: string;
}

/**
 * Event emitted when a link is removed between pages.
 */
export interface LinkRemovedEvent extends WikiEventBase {
  type: 'link-removed';
  sourcePageId: string;
  targetPageId: string;
  sourcePath: string;
  targetPath: string;
}

/**
 * Union type of all wiki events.
 */
export type WikiEvent =
  | PageCreatedEvent
  | PageUpdatedEvent
  | PageDeletedEvent
  | LinkAddedEvent
  | LinkRemovedEvent;

/**
 * Typed event emitter for wiki events.
 */
class WikiEventEmitter extends EventEmitter {
  /**
   * Emit a wiki event.
   */
  emitWikiEvent(event: WikiEvent): void {
    this.emit('wiki-event', event);
  }

  /**
   * Emit a page created event.
   */
  emitPageCreated(wikiId: string, page: PageCreatedEvent['page']): void {
    this.emitWikiEvent({
      type: 'page-created',
      wikiId,
      timestamp: new Date(),
      page,
    });
  }

  /**
   * Emit a page updated event.
   */
  emitPageUpdated(wikiId: string, page: PageUpdatedEvent['page']): void {
    this.emitWikiEvent({
      type: 'page-updated',
      wikiId,
      timestamp: new Date(),
      page,
    });
  }

  /**
   * Emit a page deleted event.
   */
  emitPageDeleted(wikiId: string, pageId: string, path: string): void {
    this.emitWikiEvent({
      type: 'page-deleted',
      wikiId,
      timestamp: new Date(),
      pageId,
      path,
    });
  }

  /**
   * Emit a link added event.
   */
  emitLinkAdded(
    wikiId: string,
    sourcePageId: string,
    targetPageId: string,
    sourcePath: string,
    targetPath: string
  ): void {
    this.emitWikiEvent({
      type: 'link-added',
      wikiId,
      timestamp: new Date(),
      sourcePageId,
      targetPageId,
      sourcePath,
      targetPath,
    });
  }

  /**
   * Emit a link removed event.
   */
  emitLinkRemoved(
    wikiId: string,
    sourcePageId: string,
    targetPageId: string,
    sourcePath: string,
    targetPath: string
  ): void {
    this.emitWikiEvent({
      type: 'link-removed',
      wikiId,
      timestamp: new Date(),
      sourcePageId,
      targetPageId,
      sourcePath,
      targetPath,
    });
  }
}

/**
 * Singleton event emitter for wiki events.
 */
export const wikiEventEmitter = new WikiEventEmitter();
