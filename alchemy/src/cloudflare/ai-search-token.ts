import type { Context } from "../context.ts";
import { Resource, ResourceKind } from "../resource.ts";
import { CloudflareApiError } from "./api-error.ts";
import { extractCloudflareResult } from "./api-response.ts";
import {
  createCloudflareApi,
  type CloudflareApiOptions,
} from "./api.ts";

/**
 * Properties for creating an AI Search Token
 */
export interface AiSearchTokenProps extends CloudflareApiOptions {
  /**
   * Name of the token
   * @default Uses the resource ID
   */
  name?: string;

  /**
   * Whether to adopt an existing token if one with the same name exists
   * @default false
   */
  adopt?: boolean;

  /**
   * Whether this is a legacy token
   * @default false
   */
  legacy?: boolean;
}

/**
 * AI Search Token output
 */
export type AiSearchToken = {
  /**
   * Resource type identifier for binding
   * @internal
   */
  type: "ai_search_token";

  /**
   * The token ID (UUID)
   */
  tokenId: string;

  /**
   * The account ID
   */
  accountId: string;

  /**
   * The account tag
   */
  accountTag: string;

  /**
   * Name of the token
   */
  name: string;

  /**
   * The CF API ID for this token
   */
  cfApiId: string;

  /**
   * The CF API key for this token
   */
  cfApiKey: string;

  /**
   * Whether the token is enabled
   */
  enabled: boolean;

  /**
   * Whether this is a legacy token
   */
  legacy: boolean;

  /**
   * When the token was created
   */
  createdAt: string;

  /**
   * When the token was last modified
   */
  modifiedAt: string;
};

/**
 * API response for AI Search token
 * @internal
 */
interface AiSearchTokenApiResponse {
  id: string;
  account_id: string;
  account_tag: string;
  name: string;
  cf_api_id: string;
  cf_api_key: string;
  enabled: boolean;
  legacy: boolean;
  created_at: string;
  modified_at: string;
}

/**
 * Type guard for AiSearchToken
 */
export function isAiSearchToken(resource: unknown): resource is AiSearchToken {
  return (
    typeof resource === "object" &&
    resource !== null &&
    ((resource as any)[ResourceKind] === "cloudflare::AiSearchToken" ||
      (resource as any).type === "ai_search_token")
  );
}

/**
 * Creates an AI Search token for accessing AI Search instances.
 *
 * AI Search tokens are used to authenticate with the AI Search API and provide
 * access to R2 buckets or other data sources for indexing.
 *
 * @example
 * // Create an AI Search token
 * const token = await AiSearchToken("my-token", {
 *   name: "docs-search-token",
 * });
 *
 * // Use the token with an AI Search instance
 * const search = await AiSearch("docs-search", {
 *   source: {
 *     type: "r2",
 *     bucket: myBucket,
 *     tokenId: token.tokenId,
 *   },
 * });
 *
 * @example
 * // Let AiSearch auto-create a token (recommended)
 * const search = await AiSearch("docs-search", {
 *   source: {
 *     type: "r2",
 *     bucket: myBucket,
 *   },
 * });
 */
export const AiSearchToken = Resource(
  "cloudflare::AiSearchToken",
  async function (
    this: Context<AiSearchToken>,
    id: string,
    props: AiSearchTokenProps,
  ): Promise<AiSearchToken> {
    const api = await createCloudflareApi(props);
    const tokenName = props.name ?? id;

    if (this.phase === "delete") {
      const tokenId = this.output?.tokenId;
      if (tokenId) {
        try {
          const response = await api.delete(
            `/accounts/${api.accountId}/ai-search/tokens/${tokenId}`,
          );
          if (!response.ok && response.status !== 404) {
            const errorText = await response.text();
            console.error(`Failed to delete AI Search token: ${errorText}`);
          }
        } catch (error) {
          // Ignore errors during deletion
          console.error("Error deleting AI Search token:", error);
        }
      }
      return this.destroy();
    }

    // For update, we can't really update tokens - just return existing
    if (this.phase === "update" && this.output?.tokenId) {
      // Token names can't be updated, so just return existing
      return this.output;
    }

    // Get the API credentials for AI Search token creation
    // We need to get the current API token's ID and use it with the token value
    let cfApiId: string;
    let cfApiKey: string;

    if (api.credentials.type === "api-token") {
      // For API token auth, verify the token to get its ID
      const verifyResponse = await api.get("/user/tokens/verify");
      if (!verifyResponse.ok) {
        throw new Error(
          "Failed to verify API token. AI Search token creation requires valid API credentials.",
        );
      }
      const verifyData = (await verifyResponse.json()) as {
        result: { id: string };
      };
      cfApiId = verifyData.result.id;
      cfApiKey = api.credentials.apiToken;
    } else if (api.credentials.type === "api-key") {
      // For Global API Key auth, use email as cf_api_id and the API key as cf_api_key
      cfApiId = api.credentials.email;
      cfApiKey = api.credentials.apiKey;
    } else if (api.credentials.type === "oauth") {
      // For OAuth, we need to get the token ID through verification
      const verifyResponse = await api.get("/user/tokens/verify");
      if (!verifyResponse.ok) {
        throw new Error(
          "Failed to verify OAuth token. AI Search token creation requires valid API credentials.",
        );
      }
      const verifyData = (await verifyResponse.json()) as {
        result: { id: string };
      };
      cfApiId = verifyData.result.id;
      cfApiKey = api.credentials.access;
    } else {
      throw new Error(
        "AI Search token creation requires API Token, Global API Key, or OAuth authentication.",
      );
    }

    // Create new token
    try {
      const response = await extractCloudflareResult<AiSearchTokenApiResponse>(
        `create AI Search token "${tokenName}"`,
        api.post(`/accounts/${api.accountId}/ai-search/tokens`, {
          name: tokenName,
          cf_api_id: cfApiId,
          cf_api_key: cfApiKey,
          legacy: props.legacy ?? false,
        }),
      );

      return {
        type: "ai_search_token" as const,
        tokenId: response.id,
        accountId: response.account_id,
        accountTag: response.account_tag,
        name: response.name,
        cfApiId: response.cf_api_id,
        cfApiKey: response.cf_api_key,
        enabled: response.enabled,
        legacy: response.legacy,
        createdAt: response.created_at,
        modifiedAt: response.modified_at,
      };
    } catch (error) {
      // Check if token already exists and we should adopt it
      if (
        error instanceof CloudflareApiError &&
        props.adopt
      ) {
        // List tokens and find by name
        const listResponse = await api.get(
          `/accounts/${api.accountId}/ai-search/tokens`,
        );
        if (listResponse.ok) {
          const listData = await listResponse.json() as {
            result: AiSearchTokenApiResponse[];
          };
          const existing = listData.result?.find((t) => t.name === tokenName);
          if (existing) {
            return {
              type: "ai_search_token" as const,
              tokenId: existing.id,
              accountId: existing.account_id,
              accountTag: existing.account_tag,
              name: existing.name,
              cfApiId: existing.cf_api_id,
              cfApiKey: existing.cf_api_key,
              enabled: existing.enabled,
              legacy: existing.legacy,
              createdAt: existing.created_at,
              modifiedAt: existing.modified_at,
            };
          }
        }
      }
      throw error;
    }
  },
);
