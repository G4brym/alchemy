import type { Context } from "../context.ts";
import { Resource, ResourceKind } from "../resource.ts";
import { Secret } from "../secret.ts";
import { logger } from "../util/logger.ts";
import { isCloudflareApiError } from "./api-error.ts";
import {
  extractCloudflareResult,
  type CloudflareApiListResponse,
} from "./api-response.ts";
import {
  createCloudflareApi,
  type CloudflareApi,
  type CloudflareApiOptions,
} from "./api.ts";

/**
 * Supported Access identity provider types. The five most common providers
 * have strict {@link AccessIdentityProviderProps} variants below; everything
 * else falls back to {@link OtherIdentityProviderProps} with a permissive
 * `config` shape.
 */
export type AccessIdentityProviderType =
  | "onetimepin"
  | "google"
  | "google-apps"
  | "github"
  | "okta"
  | "azureAD"
  | "oidc"
  | "saml"
  | "centrify"
  | "facebook"
  | "linkedin"
  | "onelogin"
  | "pingone"
  | "yandex"
  | (string & {});

interface BaseAccessIdpProps extends CloudflareApiOptions {
  /**
   * Display name shown on the Access login page.
   *
   * @default ${app}-${stage}-${id}
   */
  name?: string;

  /**
   * Adopt an existing IdP with the same name instead of failing.
   *
   * @default false
   */
  adopt?: boolean;

  /**
   * Whether to delete the IdP when removed from Alchemy.
   *
   * @default true
   */
  delete?: boolean;
}

/**
 * One-Time PIN — Cloudflare emails a code to the user. No external IdP
 * configuration required.
 */
export interface OneTimePinIdentityProviderProps extends BaseAccessIdpProps {
  type: "onetimepin";
}

/**
 * Google OAuth identity provider.
 */
export interface GoogleIdentityProviderProps extends BaseAccessIdpProps {
  type: "google";
  config: {
    clientId: string;
    clientSecret: string | Secret;
    claims?: string[];
    emailClaimName?: string;
  };
}

/**
 * Okta identity provider (OIDC under the hood).
 */
export interface OktaIdentityProviderProps extends BaseAccessIdpProps {
  type: "okta";
  config: {
    /** Your Okta tenant subdomain, e.g. `acme` for `acme.okta.com`. */
    oktaAccount: string;
    authorizationServerId?: string;
    clientId: string;
    clientSecret: string | Secret;
    claims?: string[];
    emailClaimName?: string;
  };
}

/**
 * Generic OpenID Connect identity provider.
 */
export interface OidcIdentityProviderProps extends BaseAccessIdpProps {
  type: "oidc";
  config: {
    authUrl: string;
    tokenUrl: string;
    certsUrl: string;
    clientId: string;
    clientSecret: string | Secret;
    scopes?: string[];
    claims?: string[];
    emailClaimName?: string;
    pkceEnabled?: boolean;
  };
}

/**
 * Generic SAML 2.0 identity provider.
 */
export interface SamlIdentityProviderProps extends BaseAccessIdpProps {
  type: "saml";
  config: {
    issuerUrl: string;
    ssoTargetUrl: string;
    /** PEM-encoded x509 certificates the IdP will use to sign assertions. */
    idpPublicCerts: string[];
    attributes?: string[];
    emailAttributeName?: string;
    headerAttributes?: { headerName: string; attributeName: string }[];
    signRequest?: boolean;
  };
}

/**
 * Catch-all for IdP types not covered by a strict variant
 * (`azureAD`, `github`, `google-apps`, `centrify`, `facebook`, `linkedin`,
 * `onelogin`, `pingone`, `yandex`, or future providers).
 *
 * Pass a free-form camelCase `config` object — keys are converted to
 * snake_case at the API boundary.
 */
export interface OtherIdentityProviderProps extends BaseAccessIdpProps {
  type: Exclude<
    AccessIdentityProviderType,
    "onetimepin" | "google" | "okta" | "oidc" | "saml"
  >;
  config: { clientId?: string; clientSecret?: string | Secret } & Record<
    string,
    unknown
  >;
}

/**
 * Properties for creating or updating an {@link AccessIdentityProvider}.
 */
export type AccessIdentityProviderProps =
  | OneTimePinIdentityProviderProps
  | GoogleIdentityProviderProps
  | OktaIdentityProviderProps
  | OidcIdentityProviderProps
  | SamlIdentityProviderProps
  | OtherIdentityProviderProps;

/**
 * Output for an {@link AccessIdentityProvider}.
 */
export type AccessIdentityProvider = Omit<
  AccessIdentityProviderProps,
  "adopt" | "delete"
> & {
  /** Cloudflare-assigned IdP UUID. */
  id: string;
  /** Display name. */
  name: string;
};

/**
 * Type guard for {@link AccessIdentityProvider}.
 */
export function isAccessIdentityProvider(
  resource: any,
): resource is AccessIdentityProvider {
  return resource?.[ResourceKind] === "cloudflare::AccessIdentityProvider";
}

/**
 * Cloudflare wire shape.
 * @internal
 */
interface CloudflareAccessIdentityProvider {
  id: string;
  name: string;
  type: string;
  config?: Record<string, unknown>;
}

/**
 * Creates a Cloudflare Zero Trust [Access identity provider](https://developers.cloudflare.com/cloudflare-one/identity/idp-integration/)
 * which lets users sign in to Access-protected applications.
 *
 * @example
 * // Built-in One-Time PIN (no IdP setup required).
 * const otp = await AccessIdentityProvider("otp", {
 *   type: "onetimepin",
 *   name: "Email OTP",
 * });
 *
 * @example
 * // Google OAuth. clientId is a public OAuth identifier (not a secret).
 * const google = await AccessIdentityProvider("google", {
 *   type: "google",
 *   name: "Google",
 *   config: {
 *     clientId: process.env.GOOGLE_CLIENT_ID!,
 *     clientSecret: alchemy.secret.env.GOOGLE_CLIENT_SECRET,
 *   },
 * });
 *
 * @example
 * // Generic OIDC provider.
 * const oidc = await AccessIdentityProvider("idp", {
 *   type: "oidc",
 *   name: "Corporate IdP",
 *   config: {
 *     authUrl: "https://idp.example.com/oauth2/authorize",
 *     tokenUrl: "https://idp.example.com/oauth2/token",
 *     certsUrl: "https://idp.example.com/oauth2/certs",
 *     clientId: "my-app",
 *     clientSecret: alchemy.secret.env.IDP_CLIENT_SECRET,
 *     scopes: ["openid", "email", "profile"],
 *     pkceEnabled: true,
 *   },
 * });
 */
export const AccessIdentityProvider = Resource(
  "cloudflare::AccessIdentityProvider",
  async function (
    this: Context<AccessIdentityProvider>,
    id: string,
    props: AccessIdentityProviderProps,
  ): Promise<AccessIdentityProvider> {
    const api = await createCloudflareApi(props);
    const name = props.name ?? this.scope.createPhysicalName(id);
    const basePath = `/accounts/${api.accountId}/access/identity_providers`;

    if (this.phase === "delete") {
      if (this.output?.id && props.delete !== false) {
        await deleteAccessIdentityProvider(api, this.output.id);
      }
      return this.destroy();
    }

    // type is immutable — recreate if it changed.
    if (
      this.phase === "update" &&
      this.output &&
      this.output.type !== props.type
    ) {
      this.replace(true);
    }

    // Cloudflare requires `config` to always be present, even for variants
    // that don't take any (e.g. `onetimepin`). Omitting it returns
    // [12130] "unexpected end of JSON input".
    const body: Record<string, unknown> = {
      name,
      type: props.type,
      config:
        "config" in props && props.config
          ? camelToSnakeWithSecrets(props.config as Record<string, unknown>)
          : {},
    };

    let result: CloudflareAccessIdentityProvider;
    if (this.phase === "update" && this.output?.id) {
      result = await extractCloudflareResult<CloudflareAccessIdentityProvider>(
        `update access identity provider "${name}"`,
        api.put(`${basePath}/${this.output.id}`, body),
      );
    } else {
      const adopt = props.adopt ?? this.scope.adopt;
      try {
        result =
          await extractCloudflareResult<CloudflareAccessIdentityProvider>(
            `create access identity provider "${name}"`,
            api.post(basePath, body),
          );
      } catch (err) {
        if (adopt && isAccessDuplicateNameError(err)) {
          const existing = await findAccessIdentityProviderByName(api, name);
          if (!existing) {
            throw new Error(
              `Identity provider "${name}" already exists but could not be found for adoption.`,
              { cause: err },
            );
          }
          logger.log(
            `Adopting existing access identity provider "${name}" (${existing.id})`,
          );
          result =
            await extractCloudflareResult<CloudflareAccessIdentityProvider>(
              `adopt access identity provider "${name}"`,
              api.put(`${basePath}/${existing.id}`, body),
            );
        } else {
          throw err;
        }
      }
    }

    const rest: Record<string, unknown> = { ...props };
    delete rest.adopt;
    delete rest.delete;

    // Output convention (CLAUDE.md): secrets are always wrapped. If the user
    // passed a raw string for clientSecret, normalize it before returning.
    const config = rest.config as Record<string, unknown> | undefined;
    if (config && typeof config.clientSecret === "string") {
      rest.config = {
        ...config,
        clientSecret: Secret.wrap(config.clientSecret),
      };
    }

    return {
      ...rest,
      id: result.id,
      name: result.name,
    } as AccessIdentityProvider;
  },
);

/**
 * Convert a camelCase config object to snake_case for the wire, unwrapping
 * any {@link Secret} values along the way. Recurses into arrays of objects
 * (e.g. SAML `headerAttributes`).
 *
 * @internal
 */
function camelToSnakeWithSecrets(
  input: Record<string, unknown>,
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(input)) {
    if (value === undefined) continue;
    const snakeKey = key.replace(/[A-Z]/g, (c) => `_${c.toLowerCase()}`);
    out[snakeKey] = transformValue(value);
  }
  return out;
}

function transformValue(value: unknown): unknown {
  if (value instanceof Secret) return value.unencrypted;
  if (Array.isArray(value)) {
    return value.map((item) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? camelToSnakeWithSecrets(item as Record<string, unknown>)
        : transformValue(item),
    );
  }
  return value;
}

/**
 * Cloudflare returns 409/400 with an "already exists" message for duplicate
 * IdP names.
 * @internal
 */
function isAccessDuplicateNameError(err: unknown): boolean {
  if (
    isCloudflareApiError(err, { status: 409 }) ||
    isCloudflareApiError(err, { status: 400 })
  ) {
    const data = err.errorData;
    return (
      Array.isArray(data) &&
      data.some(
        (e) => "message" in e && /already exists/i.test(String(e.message)),
      )
    );
  }
  return false;
}

/**
 * Look up an existing IdP by name across paginated results.
 * @internal
 */
async function findAccessIdentityProviderByName(
  api: CloudflareApi,
  name: string,
): Promise<CloudflareAccessIdentityProvider | null> {
  let page = 1;
  const perPage = 50;
  while (true) {
    const response = await api.get(
      `/accounts/${api.accountId}/access/identity_providers?page=${page}&per_page=${perPage}`,
    );
    if (!response.ok) return null;
    const data =
      (await response.json()) as CloudflareApiListResponse<CloudflareAccessIdentityProvider>;
    const match = data.result.find((p) => p.name === name);
    if (match) return match;
    const info = data.result_info;
    if (!info || info.page * info.per_page >= info.total_count) return null;
    page++;
  }
}

/**
 * Delete an IdP. Cloudflare returns 400 if any Application references it.
 * @internal
 */
async function deleteAccessIdentityProvider(
  api: CloudflareApi,
  idpId: string,
): Promise<void> {
  const response = await api.delete(
    `/accounts/${api.accountId}/access/identity_providers/${idpId}`,
  );
  if (!response.ok && response.status !== 404) {
    let body = "";
    try {
      body = await response.text();
    } catch {}
    if (/in use|reference|associated/i.test(body)) {
      throw new Error(
        `Cannot delete identity provider ${idpId}: it is referenced by one or more Access applications. Remove those references first.\n${body}`,
      );
    }
    logger.error(
      `Error deleting access identity provider ${idpId}: ${response.status} ${response.statusText}\n${body}`,
    );
  }
}
