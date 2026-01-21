---
title: AiSearchToken
description: Learn how to create and manage Cloudflare AI Search service tokens for authenticating with the AI Search API using Alchemy.
---

The AiSearchToken resource creates a service token for authenticating with [Cloudflare AI Search](https://developers.cloudflare.com/ai-search/). This token is required for AI Search to access your R2 buckets or other data sources.

:::note
In most cases, you don't need to create this resource directly. The [AiSearch](/providers/cloudflare/ai-search) resource automatically creates and manages a service token for you.
:::

## When to Use

Use `AiSearchToken` explicitly when you need to:

- Share a single token across multiple AI Search instances
- Have fine-grained control over token lifecycle
- Inspect token properties (e.g., `tokenId`, `cfApiId`)

## Minimal Example

Create an AI Search token and use it with an AI Search instance:

```ts
import { AiSearch, AiSearchToken, R2Bucket } from "alchemy/cloudflare";

const bucket = await R2Bucket("docs", { name: "my-docs" });

const token = await AiSearchToken("search-token", {
  name: "docs-search-token",
});

const search = await AiSearch("docs-search", {
  source: {
    type: "r2",
    bucket,
    token,
  },
});
```

## Share Token Across Instances

Use a single token for multiple AI Search instances:

```ts
import { AiSearch, AiSearchToken, R2Bucket } from "alchemy/cloudflare";

const docsToken = await AiSearchToken("shared-token", {
  name: "shared-docs-token",
});

const docsBucket = await R2Bucket("docs", { name: "docs-bucket" });
const blogBucket = await R2Bucket("blog", { name: "blog-bucket" });

const docsSearch = await AiSearch("docs-search", {
  source: { type: "r2", bucket: docsBucket, token: docsToken },
});

const blogSearch = await AiSearch("blog-search", {
  source: { type: "r2", bucket: blogBucket, token: docsToken },
});
```

## Adopt Existing Token

Adopt a token that already exists in your account:

```ts
import { AiSearchToken } from "alchemy/cloudflare";

const token = await AiSearchToken("existing-token", {
  name: "my-existing-token",
  adopt: true,
});
```

## How It Works

When you create an `AiSearchToken`, Alchemy:

1. Creates a **user API token** with the required permissions:
   - `AI Search Index Engine` — allows AI Search to index and query data
   - `Workers R2 Storage Write` — allows AI Search to read from R2 buckets
2. Registers the token with the **AI Search service**
3. Returns the token details including the `tokenId` and `cfApiKey`

When the resource is destroyed, both the AI Search token registration and the underlying user API token are cleaned up.

## Permission Requirements

AI Search requires a [service API token](https://developers.cloudflare.com/ai-search/get-started/api/#2-create-a-service-api-token) to access resources in your account on your behalf, such as R2, Vectorize, and Workers AI.

Creating an `AiSearchToken` requires API credentials with **"User API Tokens: Edit"** permission, since it needs to create a user API token under the hood.

If your main credentials don't have this permission, you can provide a pre-created service API token via `serviceApiToken`. Alchemy will use this token directly instead of creating a new one.

```bash
# Create a service API token with the Alchemy CLI
alchemy util create-cloudflare-token --god-token
```

The CLI will output a token value. Add it to your `.env` file:

```bash
CLOUDFLARE_SERVICE_API_TOKEN=your-token-value-here
```

Then use it when creating the token:

```ts
import { alchemy } from "alchemy";
import { AiSearchToken } from "alchemy/cloudflare";

const token = await AiSearchToken("search-token", {
  name: "docs-search-token",
  serviceApiToken: alchemy.secret.env.CLOUDFLARE_SERVICE_API_TOKEN,
});
```

This allows your main credentials to remain restricted while providing AI Search with the access it needs.

## Configuration Options

| Property | Type | Default | Description |
|----------|------|---------|-------------|
| `name` | `string` | resource ID | Name of the token |
| `adopt` | `boolean` | `false` | Adopt an existing token with the same name |
| `delete` | `boolean` | `true` | Delete the token when removed from Alchemy |
| `serviceApiToken` | `Secret` | - | Pre-created token for AI Search; if provided, Alchemy uses it directly instead of creating one |

## Output Properties

| Property | Type | Description |
|----------|------|-------------|
| `tokenId` | `string` | The AI Search token ID (UUID) |
| `userApiTokenId` | `string` | The underlying user API token ID |
| `accountId` | `string` | The Cloudflare account ID |
| `accountTag` | `string` | The Cloudflare account tag |
| `name` | `string` | Name of the token |
| `cfApiId` | `string` | The CF API ID for this token |
| `cfApiKey` | `Secret` | The CF API key (stored securely) |
| `enabled` | `boolean` | Whether the token is enabled |
| `createdAt` | `string` | When the token was created |
| `modifiedAt` | `string` | When the token was last modified |
