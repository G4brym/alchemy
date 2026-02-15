import type { worker } from "../alchemy.run.ts";

export default {
  async fetch(request: Request, env: typeof worker.Env) {
    const url = new URL(request.url);
    if (url.pathname === "/list") {
      const result = await env.AI.autorag(env.AI_SEARCH_ID).list();
      return Response.json(result);
    }
    if (url.pathname === "/query" && url.searchParams.has("q")) {
      const query = url.searchParams.get("q")!;
      const result = await env.AI.autorag(env.AI_SEARCH_ID).aiSearch({
        query,
      });
      return Response.json(result, {
        status: result.data.length > 0 ? 200 : 400,
      });
    } else {
      return new Response("Usage: /query?q=...");
    }
  },
};
