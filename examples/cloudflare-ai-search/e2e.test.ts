import type { AutoRagAiSearchResponse } from "@cloudflare/workers-types";
import assert from "node:assert";
import { poll } from "../../alchemy/src/util/poll";

export async function test(props: { url: string }) {
  await poll({
    description: "wait for worker to be ready",
    fn: () => fetch(props.url),
    predicate: (res) => res.ok,
  });
  const url = new URL(props.url);
  url.pathname = "/query";
  url.searchParams.set("q", "What is the capital of France?");
  const response = await poll({
    description: "wait for search to be ready",
    fn: () => fetch(url),
    predicate: (res) => {
      console.log(res);
      return res.ok;
    },
    timeout: 5000,
  });
  const result = (await response.json()) as AutoRagAiSearchResponse;
  assert(
    result.response.includes("Paris"),
    `Paris is not in the response: ${result.response}`,
  );
  assert(result.data.length > 0, "No data returned");
  assert.equal(result.data[0].filename, "france.txt");
}
