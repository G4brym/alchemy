import { alchemy } from "../alchemy.ts";
import type { Context } from "../context.ts";
import { Resource, ResourceKind } from "../resource.ts";
import type { Secret } from "../secret.ts";
import { AccountApiToken } from "./account-api-token.ts";
import { CloudflareApiError } from "./api-error.ts";
import { extractCloudflareResult } from "./api-response.ts";
import { createCloudflareApi, type CloudflareApiOptions } from "./api.ts";

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
   * Whether to delete the token when removed from Alchemy
   * @default true
   */
  delete?: boolean;
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
   * The AI Search token ID (UUID)
   */
  tokenId: string;

  /**
   * The underlying account API token ID (for lifecycle management)
   */
  accountTokenId: string;

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
   * The CF API key for this token (stored as Secret)
   */
  cfApiKey: Secret;

  /**
   * Whether the token is enabled
   */
  enabled: boolean;

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
 * This resource automatically:
 * 1. Creates an account API token with AI Search Index Engine and R2 Storage Write permissions
 * 2. Registers that token with the AI Search service
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
 *     token: token,
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
      // First delete the AI Search token registration
      const aiSearchTokenId = this.output?.tokenId;
      if (aiSearchTokenId) {
        try {
          const response = await api.delete(
            `/accounts/${api.accountId}/ai-search/tokens/${aiSearchTokenId}`,
          );
          if (!response.ok && response.status !== 404) {
            const errorText = await response.text();
            console.error(`Failed to delete AI Search token: ${errorText}`);
          }
        } catch (error) {
          console.error("Error deleting AI Search token:", error);
        }
      }

      // The AccountApiToken will be cleaned up automatically by Alchemy's
      // resource lifecycle management since it's a child resource

      return this.destroy();
    }

    // For update, we can't really update tokens - just return existing
    if (this.phase === "update" && this.output?.tokenId) {
      return this.output;
    }

    // Create an account API token with AI Search + R2 permissions
    const accountToken = await AccountApiToken(`${id}-account-token`, {
      name: `${tokenName} (AI Search Service Token)`,
      policies: [
        {
          effect: "allow",
          permissionGroups: [
            "AI Search Index Engine",
            "Workers R2 Storage Write",
          ],
          resources: {
            "com.cloudflare.api.account": "*",
          },
        },
      ],
      apiToken: props.apiToken,
      accountId: props.accountId,
      baseUrl: props.baseUrl,
      profile: props.profile,
    });

    if (!accountToken.value) {
      throw new Error(
        "Failed to create account API token for AI Search - no token value returned",
      );
    }

    const cfApiId = accountToken.id;
    const cfApiKey = accountToken.value.unencrypted;

    // Register the token with AI Search
    try {
      const response = await extractCloudflareResult<AiSearchTokenApiResponse>(
        `create AI Search token "${tokenName}"`,
        api.post(`/accounts/${api.accountId}/ai-search/tokens`, {
          name: tokenName,
          cf_api_id: cfApiId,
          cf_api_key: cfApiKey,
        }),
      );

      return {
        type: "ai_search_token" as const,
        tokenId: response.id,
        accountTokenId: accountToken.id,
        accountId: response.account_id,
        accountTag: response.account_tag,
        name: response.name,
        cfApiId: response.cf_api_id,
        cfApiKey: alchemy.secret(cfApiKey),
        enabled: response.enabled,
        createdAt: response.created_at,
        modifiedAt: response.modified_at,
      };
    } catch (error) {
      // Check if token already exists and we should adopt it
      if (error instanceof CloudflareApiError && props.adopt) {
        // List tokens and find by name
        const listResponse = await api.get(
          `/accounts/${api.accountId}/ai-search/tokens`,
        );
        if (listResponse.ok) {
          const listData = (await listResponse.json()) as {
            result: AiSearchTokenApiResponse[];
          };
          const existing = listData.result?.find((t) => t.name === tokenName);
          if (existing) {
            return {
              type: "ai_search_token" as const,
              tokenId: existing.id,
              accountTokenId: accountToken.id,
              accountId: existing.account_id,
              accountTag: existing.account_tag,
              name: existing.name,
              cfApiId: existing.cf_api_id,
              cfApiKey: alchemy.secret(cfApiKey),
              enabled: existing.enabled,
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
