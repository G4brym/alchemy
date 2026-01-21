import type { Context } from "../context.ts";
import { Resource, ResourceKind } from "../resource.ts";
import type { Secret } from "../secret.ts";
import { logger } from "../util/logger.ts";
import {
  AiSearchToken,
  isAiSearchToken,
  type AiSearchToken as AiSearchTokenType,
} from "./ai-search-token.ts";
import { CloudflareApiError } from "./api-error.ts";
import { extractCloudflareResult } from "./api-response.ts";
import {
  createCloudflareApi,
  type CloudflareApi,
  type CloudflareApiOptions,
} from "./api.ts";
import { isBucket, type R2Bucket } from "./bucket.ts";

/**
 * Convert a 32-character hex string to UUID format
 * e.g., "57cb2c2851ac12c814b87da46a15d8f6" -> "57cb2c28-51ac-12c8-14b8-7da46a15d8f6"
 */
function formatAsUuid(hexString: string): string {
  // If it's already formatted as a UUID, return as-is
  if (hexString.includes("-")) {
    return hexString;
  }
  // Format as UUID: 8-4-4-4-12
  return `${hexString.slice(0, 8)}-${hexString.slice(8, 12)}-${hexString.slice(12, 16)}-${hexString.slice(16, 20)}-${hexString.slice(20)}`;
}

/**
 * Source configuration for R2 bucket-backed AI Search
 */
export interface AiSearchR2Source {
  /**
   * Source type
   */
  type: "r2";

  /**
   * R2 bucket - can be bucket name string or R2Bucket resource
   */
  bucket: string | R2Bucket;

  /**
   * API token for R2 access.
   * Can be a token ID string or an AiSearchToken resource.
   * If not provided, an AI Search token will be automatically created.
   */
  token?: string | AiSearchTokenType;
}

/**
 * Source configuration for web crawler-backed AI Search
 */
export interface AiSearchWebCrawlerSource {
  /**
   * Source type
   */
  type: "web-crawler";

  /**
   * URLs to crawl
   */
  urls: string[];

  /**
   * API token for web crawler access.
   * Can be a token ID string or an AiSearchToken resource.
   * If not provided, an AI Search token will be automatically created.
   */
  token?: string | AiSearchTokenType;
}

/**
 * Properties for creating or updating an AI Search instance
 */
export interface AiSearchProps extends CloudflareApiOptions {
  /**
   * Instance name (1-32 characters)
   *
   * @default ${app}-${stage}-${id}
   */
  name?: string;

  /**
   * Data source for indexing.
   * Can be an R2Bucket directly, an R2 source config, or a web crawler config.
   */
  source: R2Bucket | AiSearchR2Source | AiSearchWebCrawlerSource;

  /**
   * Text generation model for AI responses
   *
   * @default "@cf/meta/llama-3.3-70b-instruct-fp8-fast"
   */
  aiSearchModel?: string;

  /**
   * Embedding model for vectorization
   *
   * @default "@cf/baai/bge-m3"
   */
  embeddingModel?: string;

  /**
   * Enable chunking of source documents
   *
   * @default true
   */
  chunk?: boolean;

  /**
   * Size of each chunk (minimum 64)
   *
   * @default 256
   */
  chunkSize?: number;

  /**
   * Overlap between chunks (0-30)
   *
   * @default 10
   */
  chunkOverlap?: number;

  /**
   * Maximum search results (1-50)
   *
   * @default 10
   */
  maxNumResults?: number;

  /**
   * Minimum match score (0-1)
   *
   * @default 0.4
   */
  scoreThreshold?: number;

  /**
   * Enable result reranking
   *
   * @default false
   */
  reranking?: boolean;

  /**
   * Reranking model
   *
   * @default "@cf/baai/bge-reranker-base"
   */
  rerankingModel?: string;

  /**
   * Enable query rewriting for better retrieval
   *
   * @default false
   */
  rewriteQuery?: boolean;

  /**
   * Query rewriting model
   */
  rewriteModel?: string;

  /**
   * Enable similarity caching
   *
   * @default false
   */
  cache?: boolean;

  /**
   * Cache similarity threshold
   */
  cacheThreshold?: number;

  /**
   * Custom metadata
   */
  metadata?: Record<string, unknown>;

  /**
   * Whether to delete the instance when removed from Alchemy
   *
   * @default true
   */
  delete?: boolean;

  /**
   * Adopt existing instance if name conflicts
   *
   * @default false
   */
  adopt?: boolean;

  /**
   * A pre-created service API token that allows AI Search to access resources
   * in your account on your behalf, such as R2, Vectorize, and Workers AI.
   *
   * If provided, Alchemy will use this token directly instead of creating a new one.
   * The token must have the following permissions:
   * - AI Search Index Engine
   * - Workers R2 Storage Write
   *
   * You can create one using: `alchemy util create-cloudflare-token`
   *
   * See: https://alchemy.run/concepts/cli/#util-create-cloudflare-token
   */
  serviceApiToken?: Secret;
}

/**
 * Type guard for AiSearch resource
 */
export function isAiSearch(resource: any): resource is AiSearch {
  return resource?.[ResourceKind] === "cloudflare::AiSearch";
}

/**
 * AI Search instance output
 */
export type AiSearch = Omit<AiSearchProps, "delete" | "adopt" | "source"> & {
  /**
   * Resource type identifier
   */
  type: "ai_search";

  /**
   * Instance ID (same as name)
   */
  id: string;

  /**
   * Instance name
   */
  name: string;

  /**
   * Internal UUID assigned by Cloudflare
   */
  internalId: string;

  /**
   * Associated Vectorize index name
   */
  vectorizeName: string;

  /**
   * Source type
   */
  sourceType: "r2" | "web-crawler";

  /**
   * Source bucket name (for R2 sources)
   */
  sourceBucket?: string;

  /**
   * AI Search token ID used for data source access
   */
  tokenId: string;

  /**
   * Current indexing status
   */
  status: "waiting" | "ready" | "indexing" | "error";

  /**
   * Creation timestamp (ISO 8601)
   */
  createdAt: string;

  /**
   * Last modification timestamp (ISO 8601)
   */
  modifiedAt: string;
};

/**
 * API response structure for AI Search instance
 * @internal
 */
interface AiSearchApiResponse {
  id: string;
  account_id: string;
  account_tag: string;
  created_at: string;
  internal_id: string;
  modified_at: string;
  source: string;
  token_id: string;
  type: "r2" | "web-crawler";
  vectorize_name: string;
  ai_search_model?: string;
  embedding_model?: string;
  cache?: boolean;
  cache_threshold?: number;
  chunk?: boolean;
  chunk_overlap?: number;
  chunk_size?: number;
  max_num_results?: number;
  reranking?: boolean;
  reranking_model?: string;
  rewrite_model?: string;
  rewrite_query?: boolean;
  score_threshold?: number;
  status?: string;
  metadata?: Record<string, unknown>;
}

/**
 * Creates and manages Cloudflare AI Search instances for RAG-powered search.
 *
 * AI Search (formerly AutoRAG) automatically indexes your data from R2 buckets or
 * web crawlers, creates vector embeddings, and provides natural language search
 * with AI-generated responses.
 *
 * @example
 * // Create an AI Search instance backed by an R2 bucket
 * const bucket = await R2Bucket("docs", { name: "my-docs" });
 * const search = await AiSearch("docs-search", {
 *   source: bucket,
 * });
 *
 * @example
 * // Create with custom models and chunking
 * const bucket = await R2Bucket("docs", { name: "my-docs" });
 * const search = await AiSearch("custom-search", {
 *   source: bucket,
 *   aiSearchModel: "@cf/meta/llama-3.3-70b-instruct-fp8-fast",
 *   embeddingModel: "@cf/baai/bge-m3",
 *   chunkSize: 512,
 *   chunkOverlap: 20,
 *   reranking: true,
 * });
 *
 * @example
 * // Create from a web crawler
 * const search = await AiSearch("web-search", {
 *   source: {
 *     type: "web-crawler",
 *     urls: ["https://docs.example.com"],
 *   },
 * });
 *
 * @example
 * // Use an existing AI Search token (advanced)
 * const token = await AiSearchToken("my-token");
 * const bucket = await R2Bucket("docs", { name: "my-docs" });
 * const search = await AiSearch("docs-search", {
 *   source: {
 *     type: "r2",
 *     bucket,
 *     token,
 *   },
 * });
 *
 * @example
 * // Access AI Search from a Worker using the AI binding
 * // Pass search.name as a binding since the instance name may be auto-generated
 * const bucket = await R2Bucket("docs", { name: "my-docs" });
 * const search = await AiSearch("docs-search", {
 *   source: bucket,
 * });
 * await Worker("api", {
 *   bindings: {
 *     AI: Ai(),
 *     RAG_NAME: search.name, // Pass the actual instance name
 *   },
 *   script: `
 *     export default {
 *       async fetch(request, env) {
 *         const result = await env.AI.autorag(env.RAG_NAME).aiSearch({
 *           query: "How do I get started?",
 *         });
 *         return Response.json(result);
 *       }
 *     };
 *   `,
 * });
 *
 * @see https://developers.cloudflare.com/ai-search/
 */
export const AiSearch = Resource(
  "cloudflare::AiSearch",
  async function (
    this: Context<AiSearch>,
    id: string,
    props: AiSearchProps,
  ): Promise<AiSearch> {
    const api = await createCloudflareApi(props);
    const instanceName =
      props.name ?? this.output?.name ?? this.scope.createPhysicalName(id);

    // Validate name length
    if (instanceName.length < 1 || instanceName.length > 32) {
      throw new Error(
        `AI Search instance name must be 1-32 characters, got ${instanceName.length}`,
      );
    }

    const adopt = props.adopt ?? this.scope.adopt;

    // Normalize source: if R2Bucket is passed directly, wrap it as AiSearchR2Source
    const normalizedSource: AiSearchR2Source | AiSearchWebCrawlerSource =
      isBucket(props.source)
        ? { type: "r2", bucket: props.source }
        : props.source;

    if (this.phase === "delete") {
      if (props.delete !== false && this.output?.id) {
        await deleteAiSearchInstance(api, this.output.id);
      }
      return this.destroy();
    }

    // Check if name changed - requires replacement
    if (this.phase === "update" && this.output?.name !== instanceName) {
      return this.replace();
    }

    // Check if source type changed - requires replacement
    if (
      this.phase === "update" &&
      this.output?.sourceType !== normalizedSource.type
    ) {
      return this.replace();
    }

    // Extract bucket name from source
    const sourceBucket =
      normalizedSource.type === "r2"
        ? isBucket(normalizedSource.bucket)
          ? normalizedSource.bucket.name
          : normalizedSource.bucket
        : undefined;

    // Check if source bucket changed - requires replacement
    if (
      this.phase === "update" &&
      normalizedSource.type === "r2" &&
      this.output?.sourceBucket !== sourceBucket
    ) {
      return this.replace();
    }

    // Get the AI Search token for accessing the data source
    let tokenId: string;
    if (normalizedSource.token) {
      // Token provided - extract the ID
      tokenId = isAiSearchToken(normalizedSource.token)
        ? normalizedSource.token.tokenId
        : normalizedSource.token;
    } else {
      // No token provided - try to create one automatically
      const tokenName = `${instanceName}-token`;
      try {
        const token = await AiSearchToken(`${id}-token`, {
          name: tokenName,
          adopt: true,
          delete: props.delete,
          apiToken: props.apiToken,
          accountId: props.accountId,
          baseUrl: props.baseUrl,
          profile: props.profile,
          serviceApiToken: props.serviceApiToken,
        });
        tokenId = token.tokenId;
      } catch (error) {
        // If automatic token creation fails, provide helpful instructions
        throw new Error(
          [
            `Failed to automatically create AI Search token for "${id}".`,
            "",
            "AI Search requires a service API token to access resources in your account on your behalf,",
            "such as R2, Vectorize, and Workers AI. Creating this token automatically requires credentials",
            "with 'User API Tokens: Edit' permission.",
            "",
            "To fix this, either:",
            "",
            "1. Provide a pre-created service API token via the serviceApiToken option (recommended):",
            "   - Create one: alchemy util create-cloudflare-token",
            "   - Add the output to your .env: CLOUDFLARE_SERVICE_API_TOKEN=your-token-here",
            "   - Pass it to your AiSearch resource:",
            "",
            '     await AiSearch("my-search", {',
            "       source: bucket,",
            "       serviceApiToken: alchemy.secret.env.CLOUDFLARE_SERVICE_API_TOKEN,",
            "     });",
            "",
            "   Alchemy will use this token directly instead of creating a new one.",
            "   See: https://alchemy.run/concepts/cli/#util-create-cloudflare-token",
            "",
            "2. Or set CLOUDFLARE_API_TOKEN to a token with 'User API Tokens: Edit' permission:",
            "   - Go to Cloudflare Dashboard → My Profile → API Tokens",
            "   - Create or edit a token to include 'User API Tokens: Edit' permission",
            "   - Set CLOUDFLARE_API_TOKEN environment variable with this token",
            "   - Alchemy will then be able to create the service token automatically.",
          ].join("\n"),
          { cause: error },
        );
      }
    }

    let result: AiSearchApiResponse;

    if (this.phase === "update" && this.output?.id) {
      // Update existing instance
      result = await updateAiSearchInstance(
        api,
        instanceName,
        props,
        sourceBucket,
        tokenId,
      );
    } else {
      // Create new instance
      try {
        result = await createAiSearchInstance(
          api,
          instanceName,
          props,
          normalizedSource,
          sourceBucket,
          tokenId,
        );
      } catch (error) {
        // Handle adoption if instance already exists
        // Error code 7022: ai_search_with_this_name_already_exist
        const isAlreadyExistsError =
          error instanceof CloudflareApiError &&
          (error.message.includes("already exists") ||
            error.message.includes("already_exist") ||
            error.message.includes("duplicate") ||
            error.errorData?.some?.((e: { code?: number }) => e.code === 7022));
        if (adopt && isAlreadyExistsError) {
          logger.log(
            `AI Search instance ${instanceName} already exists, adopting`,
          );
          result = await getAiSearchInstance(api, instanceName);
          // Update with new configuration
          result = await updateAiSearchInstance(
            api,
            instanceName,
            props,
            sourceBucket,
            tokenId,
          );
        } else {
          throw error;
        }
      }
    }

    return {
      type: "ai_search",
      id: result.id,
      name: result.id,
      internalId: result.internal_id,
      vectorizeName: result.vectorize_name,
      sourceType: result.type,
      sourceBucket,
      tokenId,
      status: (result.status as AiSearch["status"]) ?? "waiting",
      createdAt: result.created_at,
      modifiedAt: result.modified_at,
      accountId: result.account_id,
      aiSearchModel: result.ai_search_model,
      embeddingModel: result.embedding_model,
      chunk: result.chunk,
      chunkSize: result.chunk_size,
      chunkOverlap: result.chunk_overlap,
      maxNumResults: result.max_num_results,
      scoreThreshold: result.score_threshold,
      reranking: result.reranking,
      rerankingModel: result.reranking_model,
      rewriteQuery: result.rewrite_query,
      rewriteModel: result.rewrite_model,
      cache: result.cache,
      cacheThreshold: result.cache_threshold,
      metadata: result.metadata,
    };
  },
);

/**
 * Create a new AI Search instance
 */
async function createAiSearchInstance(
  api: CloudflareApi,
  instanceName: string,
  props: AiSearchProps,
  normalizedSource: AiSearchR2Source | AiSearchWebCrawlerSource,
  sourceBucket: string | undefined,
  tokenId: string,
): Promise<AiSearchApiResponse> {
  const formattedTokenId = formatAsUuid(tokenId);
  const body: Record<string, unknown> = {
    id: instanceName,
    type: normalizedSource.type,
    token_id: formattedTokenId,
    source: sourceBucket ?? (normalizedSource as AiSearchWebCrawlerSource).urls,
  };

  // Add optional configuration
  if (props.aiSearchModel !== undefined) {
    body.ai_search_model = props.aiSearchModel;
  }
  if (props.embeddingModel !== undefined) {
    body.embedding_model = props.embeddingModel;
  }
  if (props.chunk !== undefined) {
    body.chunk = props.chunk;
  }
  if (props.chunkSize !== undefined) {
    body.chunk_size = props.chunkSize;
  }
  if (props.chunkOverlap !== undefined) {
    body.chunk_overlap = props.chunkOverlap;
  }
  if (props.maxNumResults !== undefined) {
    body.max_num_results = props.maxNumResults;
  }
  if (props.scoreThreshold !== undefined) {
    body.score_threshold = props.scoreThreshold;
  }
  if (props.reranking !== undefined) {
    body.reranking = props.reranking;
  }
  if (props.rerankingModel !== undefined) {
    body.reranking_model = props.rerankingModel;
  }
  if (props.rewriteQuery !== undefined) {
    body.rewrite_query = props.rewriteQuery;
  }
  if (props.rewriteModel !== undefined) {
    body.rewrite_model = props.rewriteModel;
  }
  if (props.cache !== undefined) {
    body.cache = props.cache;
  }
  if (props.cacheThreshold !== undefined) {
    body.cache_threshold = props.cacheThreshold;
  }
  if (props.metadata !== undefined) {
    body.metadata = props.metadata;
  }

  return extractCloudflareResult<AiSearchApiResponse>(
    `create AI Search instance "${instanceName}"`,
    api.post(`/accounts/${api.accountId}/ai-search/instances`, body),
  );
}

/**
 * Get an AI Search instance
 */
export async function getAiSearchInstance(
  api: CloudflareApi,
  instanceName: string,
): Promise<AiSearchApiResponse> {
  return extractCloudflareResult<AiSearchApiResponse>(
    `get AI Search instance "${instanceName}"`,
    api.get(`/accounts/${api.accountId}/ai-search/instances/${instanceName}`),
  );
}

/**
 * Update an AI Search instance
 */
async function updateAiSearchInstance(
  api: CloudflareApi,
  instanceName: string,
  props: AiSearchProps,
  _sourceBucket: string | undefined,
  _tokenId: string,
): Promise<AiSearchApiResponse> {
  const body: Record<string, unknown> = {};

  // Only include fields that can be updated
  if (props.aiSearchModel !== undefined) {
    body.ai_search_model = props.aiSearchModel;
  }
  if (props.embeddingModel !== undefined) {
    body.embedding_model = props.embeddingModel;
  }
  if (props.chunk !== undefined) {
    body.chunk = props.chunk;
  }
  if (props.chunkSize !== undefined) {
    body.chunk_size = props.chunkSize;
  }
  if (props.chunkOverlap !== undefined) {
    body.chunk_overlap = props.chunkOverlap;
  }
  if (props.maxNumResults !== undefined) {
    body.max_num_results = props.maxNumResults;
  }
  if (props.scoreThreshold !== undefined) {
    body.score_threshold = props.scoreThreshold;
  }
  if (props.reranking !== undefined) {
    body.reranking = props.reranking;
  }
  if (props.rerankingModel !== undefined) {
    body.reranking_model = props.rerankingModel;
  }
  if (props.rewriteQuery !== undefined) {
    body.rewrite_query = props.rewriteQuery;
  }
  if (props.rewriteModel !== undefined) {
    body.rewrite_model = props.rewriteModel;
  }
  if (props.cache !== undefined) {
    body.cache = props.cache;
  }
  if (props.cacheThreshold !== undefined) {
    body.cache_threshold = props.cacheThreshold;
  }
  if (props.metadata !== undefined) {
    body.metadata = props.metadata;
  }

  return extractCloudflareResult<AiSearchApiResponse>(
    `update AI Search instance "${instanceName}"`,
    api.put(
      `/accounts/${api.accountId}/ai-search/instances/${instanceName}`,
      body,
    ),
  );
}

/**
 * Delete an AI Search instance
 */
async function deleteAiSearchInstance(
  api: CloudflareApi,
  instanceName: string,
): Promise<void> {
  try {
    await extractCloudflareResult(
      `delete AI Search instance "${instanceName}"`,
      api.delete(
        `/accounts/${api.accountId}/ai-search/instances/${instanceName}`,
      ),
    );
  } catch (error) {
    // Ignore 404 errors (instance already deleted)
    if (error instanceof CloudflareApiError && error.status === 404) {
      return;
    }
    throw error;
  }
}

/**
 * List all AI Search instances in an account
 */
export async function listAiSearchInstances(
  api: CloudflareApi,
): Promise<AiSearchApiResponse[]> {
  return extractCloudflareResult<AiSearchApiResponse[]>(
    "list AI Search instances",
    api.get(`/accounts/${api.accountId}/ai-search/instances`),
  );
}
