# tRPC Benchmark Questions

Questions specific to evaluating wiki quality for the trpc/trpc repository.
Generated from analysis of 107 GitHub issues on 2025-11-30.

## arch-websocket-refactor

- **Category:** architecture
- **Difficulty:** hard
- **Hints:** packages/client/src/links/ws, WsClient, ReconnectManager

How is the WebSocket implementation structured and what are the key modules that handle connection management, reconnection, and ping/pong?

## arch-streaming

- **Category:** architecture
- **Difficulty:** hard
- **Hints:** httpBatchStreamLink, packages/client/src/links/, Transfer-Encoding

How does tRPC implement HTTP batch streaming and what is the response format that enables out-of-order responses?

## arch-core-package

- **Category:** architecture
- **Difficulty:** medium
- **Hints:** packages/core/, packages/server/, packages/client/

What is the purpose of the @trpc/core package and how does it relate to @trpc/server and @trpc/client?

## arch-adapters

- **Category:** architecture
- **Difficulty:** medium
- **Hints:** packages/server/src/adapters/, requestHandler

How are server adapters organized and what is the pattern for creating adapters for different platforms (Express, Fastify, AWS Lambda)?

## arch-lambda-streaming

- **Category:** architecture
- **Difficulty:** hard
- **Hints:** awsLambdaStreamingRequestHandler, packages/server/src/adapters/aws-lambda

How does the AWS Lambda streaming adapter differ from the standard Lambda adapter, and why was a separate adapter created?

## pattern-procedure-creation

- **Category:** patterns
- **Difficulty:** easy
- **Hints:** publicProcedure, .query(, .mutation(

What are the two syntaxes for creating procedures in tRPC (fluent/chaining vs object-based)?

## pattern-links

- **Category:** patterns
- **Difficulty:** medium
- **Hints:** packages/client/src/links/, httpBatchLink, splitLink

How does the link chain pattern work in tRPC client, and what links are commonly used together?

## pattern-standard-schema

- **Category:** patterns
- **Difficulty:** medium
- **Hints:** Standard Schema, packages/server/src/unstable-core-do-not-import/parser

How does tRPC support multiple validation libraries (Zod, Valibot, ArkType) through the Standard Schema spec?

## pattern-query-options

- **Category:** patterns
- **Difficulty:** medium
- **Hints:** queryOptions, packages/tanstack-react-query/, mutationOptions

How does the queryOptions pattern work in @trpc/tanstack-react-query and what problems does it solve?

## decision-v11-proxy-naming

- **Category:** decisions
- **Difficulty:** easy
- **Hints:** createTRPCClient, migration, v11

Why was 'Proxy' removed from function names like createTRPCProxyClient in v11?

## decision-tuple-paths

- **Category:** decisions
- **Difficulty:** medium
- **Hints:** getQueryKey, tuple, packages/react-query/

Why did tRPC v11 move from string paths to tuples in react-query integration?

## decision-streaming-vs-subscriptions

- **Category:** decisions
- **Difficulty:** hard
- **Hints:** streamingMutation, async generator, subscriptions

Why did tRPC add streaming mutations/queries instead of relying solely on WebSocket subscriptions?

## convention-smurfing

- **Category:** conventions
- **Difficulty:** medium
- **Hints:** packages/client/src/, packages/server/src/, exports

What is 'smurfing' in the context of tRPC exports and how are packages structured to follow this convention?

## convention-testing

- **Category:** conventions
- **Difficulty:** easy
- **Hints:** vitest, packages/*/test/, *.test.ts

What testing framework does tRPC use and how are tests organized across packages?

## convention-deprecation

- **Category:** conventions
- **Difficulty:** medium
- **Hints:** @deprecated, v9, migration

What is tRPC's convention for deprecating features before removing them in major versions?

## security-websocket-auth

- **Category:** security
- **Difficulty:** hard
- **Hints:** wsLink, authorization, headers

How should authentication be handled with WebSocket connections in tRPC, and what are the limitations of the current approach?

## security-content-types

- **Category:** security
- **Difficulty:** medium
- **Hints:** FormData, Blob, octet-stream, packages/server/

How does tRPC handle different content types (FormData, File, Blob) and what security considerations apply?

## howto-query-key-prefix

- **Category:** howto
- **Difficulty:** medium
- **Hints:** queryKeyPrefix, TRPCProvider, enableKeyPrefix

How do you configure query key prefixes in tRPC for user/session switching scenarios?

## howto-get-query-key

- **Category:** howto
- **Difficulty:** easy
- **Hints:** getQueryKey, QueryType, query, infinite

How do you get the query key for a tRPC procedure for cache invalidation or prefetching?

## howto-response-objects

- **Category:** howto
- **Difficulty:** hard
- **Hints:** Response, file download, binary, custom headers

How do you return custom HTTP responses (like file downloads or binary data) from tRPC procedures?
