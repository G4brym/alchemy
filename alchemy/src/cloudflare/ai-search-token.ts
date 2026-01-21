import { alchemy } from "../alchemy.ts";
import type { Context } from "../context.ts";
import { Resource, ResourceKind } from "../resource.ts";
import type { Secret } from "../secret.ts";
import { CloudflareApiError } from "./api-error.ts";
import { extractCloudflareResult } from "./api-response.ts";
import { createCloudflareApi, type CloudflareApiOptions } from "./api.ts";

/**
 * Permission group IDs required for AI Search
 * @see https://developers.cloudflare.com/ai-search/get-started/api/
 */
const AI_SEARCH_INDEX_ENGINE_PERMISSION = "9e9b428a0bcd46fd80e580b46a69963c";
const WORKERS_R2_STORAGE_WRITE_PERMISSION = "bf7481a1826f439697cb59a20b22293e";

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
   * The underlying user API token ID (for lifecycle management)
   */
  userApiTokenId: string;

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
 * API response for user token creation
 * @internal
 */
interface UserApiTokenResponse {
  id: string;
  name: string;
  status: string;
  issued_on: string;
  modified_on: string;
  value?: string;
}

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
 * 1. Creates a dedicated user API token with AI Search Index Engine and R2 Storage Write permissions
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

    // Track whether we created the user token (vs using a provided one)
    // If we didn't create it, we shouldn't delete it
    const usingProvidedToken = !!props.serviceApiToken;

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

      // Only delete the underlying user API token if we created it
      // (i.e., serviceApiToken was NOT provided)
      const userApiTokenId = this.output?.userApiTokenId;
      if (userApiTokenId && !usingProvidedToken) {
        try {
          const response = await api.delete(`/user/tokens/${userApiTokenId}`);
          if (!response.ok && response.status !== 404) {
            const errorText = await response.text();
            console.error(`Failed to delete user API token: ${errorText}`);
          }
        } catch (error) {
          console.error("Error deleting user API token:", error);
        }
      }

      return this.destroy();
    }

    // For update, we can't really update tokens - just return existing
    if (this.phase === "update" && this.output?.tokenId) {
      return this.output;
    }

    let cfApiId: string;
    let cfApiKey: string;
    let userApiTokenId: string;

    if (props.serviceApiToken) {
      // Use the provided service API token directly
      // Verify it to get the token ID
      cfApiKey = props.serviceApiToken.unencrypted;

      const serviceTokenApi = await createCloudflareApi({
        ...props,
        apiToken: props.serviceApiToken,
      });

      const verifyResponse = await serviceTokenApi.get("/user/tokens/verify");
      if (!verifyResponse.ok) {
        const errorData: any = await verifyResponse.json().catch(() => ({
          errors: [{ message: verifyResponse.statusText }],
        }));
        throw new Error(
          `Failed to verify service API token: ${
            errorData.errors?.[0]?.message || verifyResponse.statusText
          }. Ensure the token has AI Search Index Engine and Workers R2 Storage Write permissions.`,
        );
      }

      const verifyResult: { result: { id: string; status: string } } =
        await verifyResponse.json();
      cfApiId = verifyResult.result.id;
      userApiTokenId = cfApiId;
    } else {
      // Create a new user API token with AI Search + R2 permissions
      // This must be a USER token (not account token) per Cloudflare docs
      const userTokenPayload = {
        name: `${tokenName} (AI Search Service Token)`,
        policies: [
          {
            effect: "allow",
            resources: {
              [`com.cloudflare.api.account.${api.accountId}`]: "*",
            },
            permission_groups: [
              { id: AI_SEARCH_INDEX_ENGINE_PERMISSION },
              { id: WORKERS_R2_STORAGE_WRITE_PERMISSION },
            ],
          },
        ],
      };

      const userTokenResponse = await api.post(
        "/user/tokens",
        userTokenPayload,
      );

      if (!userTokenResponse.ok) {
        const errorData: any = await userTokenResponse.json().catch(() => ({
          errors: [{ message: userTokenResponse.statusText }],
        }));
        throw new Error(
          `Failed to create user API token for AI Search: ${
            errorData.errors?.[0]?.message || userTokenResponse.statusText
          }`,
        );
      }

      const userTokenResult: { result: UserApiTokenResponse } =
        await userTokenResponse.json();
      const userToken = userTokenResult.result;

      if (!userToken.value) {
        throw new Error(
          "Failed to create user API token for AI Search - no token value returned",
        );
      }

      cfApiId = userToken.id;
      cfApiKey = userToken.value;
      userApiTokenId = userToken.id;
    }

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
        userApiTokenId,
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
      // If AI Search token registration failed, clean up the user token we created
      // (only if we created it, not if it was provided)
      if (!usingProvidedToken) {
        try {
          await api.delete(`/user/tokens/${userApiTokenId}`);
        } catch (cleanupError) {
          console.error("Failed to clean up user API token:", cleanupError);
        }
      }

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
              userApiTokenId,
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
