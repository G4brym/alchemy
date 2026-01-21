---
title: AiSearch
description: Learn how to create and configure Cloudflare AI Search instances for RAG-powered semantic search using Alchemy.
---

The AiSearch resource lets you create and manage [Cloudflare AI Search](https://developers.cloudflare.com/ai-search/) instances (formerly AutoRAG). AI Search automatically indexes your data from R2 buckets or web crawlers, creates vector embeddings, and provides natural language search with AI-generated responses.

## Prerequisites

Before creating an AI Search instance, you need to create an AI Search token in the Cloudflare dashboard:

1. Go to **Cloudflare Dashboard → AI Search**
2. Navigate to the **Tokens** section  
3. Create a new token with access to your R2 bucket
4. Copy the token ID (UUID) for use in your configuration

## Minimal Example

Create an AI Search instance backed by an R2 bucket:

```ts
import { AiSearch, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("docs-search", {
  source: {
    type: "r2",
    bucket,
    token: process.env.CLOUDFLARE_AI_SEARCH_TOKEN_ID!,
  },
});
```

## With Custom Models and Chunking

Configure an AI Search instance with custom embedding and generation models:

```ts
import { AiSearch, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("custom-search", {
  source: {
    type: "r2",
    bucket,
    token: process.env.CLOUDFLARE_AI_SEARCH_TOKEN_ID!,
  },
  aiModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
  embeddingModel: "@cf/baai/bge-m3",
  chunkSize: 512,
  chunkOverlap: 20,
  maxNumResults: 15,
});
```

## With Reranking and Query Rewriting

Enable advanced retrieval features for better search results:

```ts
import { AiSearch, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("advanced-search", {
  source: {
    type: "r2",
    bucket,
    token: process.env.CLOUDFLARE_AI_SEARCH_TOKEN_ID!,
  },
  reranking: true,
  rerankingModel: "@cf/baai/bge-reranker-base",
  rewriteQuery: true,
  scoreThreshold: 0.3,
});
```

## Using AI Search from a Worker

AI Search instances are accessed through the `AI` binding using `env.AI.autorag("instance-name")`:

```ts
import { Worker, Ai, AiSearch, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("docs-search", {
  source: {
    type: "r2",
    bucket,
    token: process.env.CLOUDFLARE_AI_SEARCH_TOKEN_ID!,
  },
});

await Worker("api", {
  entrypoint: "./src/worker.ts",
  bindings: {
    AI: Ai(), // AI binding required to access AI Search
  },
});
```

```ts
// src/worker.ts
export default {
  async fetch(request, env) {
    const url = new URL(request.url);
    const query = url.searchParams.get("q") || "";

    // Use search() for vector similarity search only
    const searchResults = await env.AI.autorag("docs-search").search({
      query,
      max_num_results: 10,
    });

    return Response.json({
      results: searchResults.data,
    });
  },
};
```

## RAG Response Generation

Use `aiSearch()` to get AI-generated responses along with source documents:

```ts
// src/worker.ts
export default {
  async fetch(request, env) {
    const { question } = await request.json();

    // Use aiSearch() for RAG - returns AI response + sources
    const result = await env.AI.autorag("docs-search").aiSearch({
      query: question,
      model: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
      max_num_results: 5,
      reranking: {
        enabled: true,
        model: "@cf/baai/bge-reranker-base",
      },
    });

    return Response.json({
      answer: result.response,
      sources: result.data,
    });
  },
};
```

## Web Crawler Source

Create an AI Search instance that crawls websites:

```ts
import { AiSearch } from "alchemy/cloudflare";

const search = await AiSearch("web-search", {
  source: {
    type: "web-crawler",
    urls: ["https://docs.example.com"],
    token: process.env.CLOUDFLARE_AI_SEARCH_TOKEN_ID!,
  },
});
```

## With Caching

Enable similarity caching to improve latency on repeated queries:

```ts
import { AiSearch, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("cached-search", {
  source: {
    type: "r2",
    bucket,
    token: process.env.CLOUDFLARE_AI_SEARCH_TOKEN_ID!,
  },
  cache: true,
  cacheThreshold: 0.9, // Cache queries with 90%+ similarity
});
```

## Using an AiSearchToken Resource

You can also use the `AiSearchToken` resource if you want Alchemy to manage the token lifecycle:

```ts
import { AiSearch, AiSearchToken, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

// Create a token resource
const token = await AiSearchToken("my-token", {
  name: "docs-search-token",
});

const search = await AiSearch("docs-search", {
  source: {
    type: "r2",
    bucket,
    token, // Use the token resource
  },
});
```

> **Note**: The `AiSearchToken` resource attempts to create tokens programmatically, but this may not work with all authentication methods. If it fails, you'll receive a helpful error message with instructions on how to create the token manually in the Cloudflare dashboard.

## Configuration Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | auto-generated | Instance name (1-32 characters) |
| `source` | `AiSearchR2Source \| AiSearchWebCrawlerSource` | required | Data source configuration |
| `aiModel` | `string` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Text generation model |
| `embeddingModel` | `string` | `@cf/baai/bge-m3` | Embedding model |
| `chunk` | `boolean` | `true` | Enable document chunking |
| `chunkSize` | `number` | `256` | Chunk size (minimum 64) |
| `chunkOverlap` | `number` | `10` | Overlap between chunks (0-30) |
| `maxNumResults` | `number` | `10` | Max search results (1-50) |
| `scoreThreshold` | `number` | `0.4` | Minimum match score (0-1) |
| `reranking` | `boolean` | `false` | Enable result reranking |
| `rerankingModel` | `string` | `@cf/baai/bge-reranker-base` | Reranking model |
| `rewriteQuery` | `boolean` | `false` | Enable query rewriting |
| `cache` | `boolean` | `false` | Enable similarity caching |
| `delete` | `boolean` | `true` | Delete instance on removal |
| `adopt` | `boolean` | `false` | Adopt existing instance |
