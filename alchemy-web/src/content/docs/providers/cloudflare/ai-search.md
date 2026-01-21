---
title: AiSearch
description: Learn how to create and configure Cloudflare AI Search instances for RAG-powered semantic search using Alchemy.
---

The AiSearch resource lets you create and manage [Cloudflare AI Search](https://developers.cloudflare.com/ai-search/) instances (formerly AutoRAG). AI Search automatically indexes your data from R2 buckets or web crawlers, creates vector embeddings, and provides natural language search with AI-generated responses.

:::caution[Token Creation Permissions]
AI Search requires a [service API token](https://developers.cloudflare.com/ai-search/get-started/api/#2-create-a-service-api-token) to access resources in your account. Alchemy can create this automatically, but only if your credentials have **"User API Tokens: Edit"** permission.

If your credentials don't have this permission, provide a pre-created token via `serviceApiToken`:

```ts
import { alchemy } from "alchemy";
import { AiSearch, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("docs-search", {
  source: bucket,
  serviceApiToken: alchemy.secret.env.CLOUDFLARE_SERVICE_API_TOKEN,
});
```

Create a service API token using the CLI: `alchemy util create-cloudflare-token`

See [Token Creation Permissions](#token-creation-permissions) for more details.
:::

## Minimal Example

Create an AI Search instance backed by an R2 bucket. Just pass the bucket directly as the source - Alchemy automatically creates and manages the required service token:

```ts
import { AiSearch, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("docs-search", {
  source: bucket,
});
```

## With Custom Models and Chunking

Configure an AI Search instance with custom embedding and generation models:

```ts
import { AiSearch, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("custom-search", {
  source: bucket,
  aiSearchModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
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
  source: bucket,
  reranking: true,
  rerankingModel: "@cf/baai/bge-reranker-base",
  rewriteQuery: true,
  scoreThreshold: 0.3,
});
```

## Using AI Search from a Worker

AI Search instances are accessed through the `AI` binding using `env.AI.autorag(name)`. Pass `search.name` as a binding so your worker knows the actual instance name (which may be auto-generated based on your app and stage):

```ts
import { Worker, Ai, AiSearch, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("docs-search", {
  source: bucket,
});

await Worker("api", {
  entrypoint: "./src/worker.ts",
  bindings: {
    AI: Ai(), // AI binding required to access AI Search
    RAG_NAME: search.name, // Pass the actual instance name
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
    const searchResults = await env.AI.autorag(env.RAG_NAME).search({
      query,
      max_num_results: 10,
    });

    return Response.json({
      results: searchResults.data,
    });
  },
};
```

:::tip[Instance Naming]
If you don't provide an explicit `name`, Alchemy generates one using `${app}-${stage}-${id}` (e.g., `myapp-dev-docs-search`). Always use `search.name` as a binding for portability across environments, or pass an explicit `name` if you need a predictable value.
:::

## RAG Response Generation

Use `aiSearch()` to get AI-generated responses along with source documents:

```ts
// src/worker.ts
export default {
  async fetch(request, env) {
    const { question } = await request.json();

    // Use aiSearch() for RAG - returns AI response + sources
    const result = await env.AI.autorag(env.RAG_NAME).aiSearch({
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
  },
});
```

## With Caching

Enable similarity caching to improve latency on repeated queries:

```ts
import { AiSearch, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("cached-search", {
  source: bucket,
  cache: true,
  cacheThreshold: 0.9, // Cache queries with 90%+ similarity
});
```

## Service Token

`AiSearch` automatically creates and manages a service token with the required permissions. You don't need to pass any credentials or tokens — Alchemy handles this for you.

The automatically created token has:
- **AI Search Index Engine** permission
- **Workers R2 Storage Write** permission

When the AI Search instance is destroyed, the token is automatically cleaned up.

### Token Creation Permissions

AI Search requires a [service API token](https://developers.cloudflare.com/ai-search/get-started/api/#2-create-a-service-api-token) to access resources in your account on your behalf, such as R2, Vectorize, and Workers AI.

Creating this service token requires your API credentials to have **"User API Tokens: Edit"** permission. If your credentials don't have this permission (common in production environments with restricted access), you have two options:

#### Option 1: Provide a Service API Token (Recommended)

Create a token with the required permissions and pass it via `serviceApiToken`. Alchemy will use this token directly instead of creating a new one.

```bash
# Create a service API token using the Alchemy CLI
alchemy util create-cloudflare-token --god-token
```

The CLI will output a token value. Add it to your `.env` file:

```bash
CLOUDFLARE_SERVICE_API_TOKEN=your-token-value-here
```

Then use it in your configuration:

```ts
import { alchemy } from "alchemy";
import { AiSearch, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const search = await AiSearch("docs-search", {
  source: bucket,
  serviceApiToken: alchemy.secret.env.CLOUDFLARE_SERVICE_API_TOKEN,
});
```

This keeps your main credentials restricted while providing AI Search with the access it needs.

#### Option 2: Use an Explicit Token

Create an [AiSearchToken](/providers/cloudflare/ai-search-token) explicitly and pass it to `AiSearch`:

```ts
import { alchemy } from "alchemy";
import { AiSearch, AiSearchToken, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

// Create a token resource explicitly
const token = await AiSearchToken("my-token", {
  name: "docs-search-token",
  serviceApiToken: alchemy.secret.env.CLOUDFLARE_SERVICE_API_TOKEN,
});

const search = await AiSearch("docs-search", {
  source: {
    type: "r2",
    bucket,
    token, // Use the explicit token
  },
});
```

See [AiSearchToken](/providers/cloudflare/ai-search-token) for more details.

## Configuration Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | auto-generated | Instance name (1-32 characters) |
| `source` | `R2Bucket \| AiSearchR2Source \| AiSearchWebCrawlerSource` | required | Data source (bucket or config) |
| `aiSearchModel` | `string` | `@cf/meta/llama-3.3-70b-instruct-fp8-fast` | Text generation model |
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
| `serviceApiToken` | `Secret` | - | Pre-created token for AI Search to access resources; if provided, Alchemy uses it directly |
