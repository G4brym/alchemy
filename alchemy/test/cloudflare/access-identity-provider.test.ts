import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import { AccessIdentityProvider } from "../../src/cloudflare/access-identity-provider.ts";
import { createCloudflareApi } from "../../src/cloudflare/api.ts";
import { destroy } from "../../src/destroy.ts";
import { BRANCH_PREFIX } from "../util.ts";

import "../../src/test/vitest.ts";

const api = await createCloudflareApi();

const test = alchemy.test(import.meta, {
  prefix: BRANCH_PREFIX,
});

describe.skipIf(!process.env.ALL_TESTS)(
  "AccessIdentityProvider Resource",
  () => {
    const testId = `${BRANCH_PREFIX}-access-otp-idp`;

    test("create, update, and delete OneTimePin identity provider", async (scope) => {
      let idp: AccessIdentityProvider | undefined;
      try {
        // Create — OneTimePin requires no external config.
        idp = await AccessIdentityProvider(testId, {
          type: "onetimepin",
          name: `Test OTP ${testId}`,
        });
        expect(idp.id).toBeTruthy();
        expect(idp.type).toEqual("onetimepin");
        const initialId = idp.id;

        // Update name.
        idp = await AccessIdentityProvider(testId, {
          type: "onetimepin",
          name: `Updated OTP ${testId}`,
        });
        expect(idp.id).toEqual(initialId);
        expect(idp.name).toEqual(`Updated OTP ${testId}`);
      } finally {
        await destroy(scope);
        if (idp?.id) {
          const response = await api.get(
            `/accounts/${api.accountId}/access/identity_providers/${idp.id}`,
          );
          expect(response.status).toEqual(404);
        }
      }
    });
  },
);
