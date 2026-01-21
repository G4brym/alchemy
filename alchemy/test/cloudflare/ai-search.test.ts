import { describe, expect } from "vitest";
import { alchemy } from "../../src/alchemy.ts";
import {
  AiSearch,
  getAiSearchInstance,
} from "../../src/cloudflare/ai-search.ts";
import { Ai } from "../../src/cloudflare/ai.ts";
import { createCloudflareApi } from "../../src/cloudflare/api.ts";
import { R2Bucket } from "../../src/cloudflare/bucket.ts";
import { Worker } from "../../src/cloudflare/worker.ts";
import { destroy } from "../../src/destroy.ts";
import { fetchAndExpectOK } from "../../src/util/safe-fetch.ts";
import { BRANCH_PREFIX, waitFor } from "../util.ts";
// must import this or else alchemy.test won't exist
import "../../src/test/vitest.ts";

// Create API client for verification
const api = await createCloudflareApi();

const test = alchemy.test(import.meta, {
  prefix: BRANCH_PREFIX,
});

// AI Search automatic token creation is currently not working reliably
// Set CLOUDFLARE_AI_SEARCH_TOKEN_ID to run these tests with a manually created token
const AI_SEARCH_TOKEN_ID = process.env.CLOUDFLARE_AI_SEARCH_TOKEN_ID;
const SKIP_AI_SEARCH_TESTS = !AI_SEARCH_TOKEN_ID;

describe("AiSearch Resource", () => {
  const testId = `${BRANCH_PREFIX}-ai-search`;

  test.skipIf(SKIP_AI_SEARCH_TESTS)(
    "create, update, and delete AI Search instance with R2 source",
    async (scope) => {
      const instanceName = `${testId}-r2`;
      const bucketName = `${testId}-bucket`;

      let aiSearch: AiSearch | undefined;
      let bucket: R2Bucket | undefined;

      try {
        // Create an R2 bucket for the AI Search source
        bucket = await R2Bucket("test-bucket", {
          name: bucketName,
          adopt: true,
        });

        expect(bucket.name).toEqual(bucketName);

        // Create AI Search instance backed by R2
        aiSearch = await AiSearch("test-search", {
          name: instanceName,
          source: {
            type: "r2",
            bucket,
            token: AI_SEARCH_TOKEN_ID!,
          },
          adopt: true,
        });

        expect(aiSearch.id).toEqual(instanceName);
        expect(aiSearch.name).toEqual(instanceName);
        expect(aiSearch.sourceType).toEqual("r2");
        expect(aiSearch.sourceBucket).toEqual(bucketName);
        expect(aiSearch.type).toEqual("ai_search");
        expect(aiSearch.internalId).toBeTruthy();
        expect(aiSearch.vectorizeName).toBeTruthy();

        // Verify instance was created by querying the API directly
        const instance = await getAiSearchInstance(api, instanceName);
        expect(instance.id).toEqual(instanceName);
        expect(instance.type).toEqual("r2");

        // Update the AI Search configuration
        aiSearch = await AiSearch("test-search", {
          name: instanceName,
          source: {
            type: "r2",
            bucket,
            token: AI_SEARCH_TOKEN_ID!,
          },
          maxNumResults: 20,
          scoreThreshold: 0.5,
          reranking: true,
          adopt: true,
        });

        expect(aiSearch.id).toEqual(instanceName);
        expect(aiSearch.maxNumResults).toEqual(20);
        expect(aiSearch.scoreThreshold).toEqual(0.5);
        expect(aiSearch.reranking).toEqual(true);

        // Verify instance was updated
        const updatedInstance = await getAiSearchInstance(api, instanceName);
        expect(updatedInstance.max_num_results).toEqual(20);
        expect(updatedInstance.score_threshold).toEqual(0.5);
        expect(updatedInstance.reranking).toEqual(true);
      } finally {
        await destroy(scope);

        // Verify instance was deleted
        const getResponse = await api.get(
          `/accounts/${api.accountId}/ai-search/instances/${instanceName}`,
        );
        expect(getResponse.status).toEqual(404);
      }
    },
  );

  test.skipIf(SKIP_AI_SEARCH_TESTS)(
    "create AI Search with bucket name string",
    async (scope) => {
      const instanceName = `${testId}-str`;
      const bucketName = `${testId}-str-bucket`;

      let aiSearch: AiSearch | undefined;

      try {
        // First create the bucket so it exists
        await R2Bucket("str-bucket", {
          name: bucketName,
          adopt: true,
        });

        // Create AI Search using bucket name string instead of resource
        aiSearch = await AiSearch("str-search", {
          name: instanceName,
          source: {
            type: "r2",
            bucket: bucketName, // String instead of R2Bucket resource
            token: AI_SEARCH_TOKEN_ID!,
          },
          adopt: true,
        });

        expect(aiSearch.id).toEqual(instanceName);
        expect(aiSearch.sourceType).toEqual("r2");
        expect(aiSearch.sourceBucket).toEqual(bucketName);
      } finally {
        await destroy(scope);
      }
    },
  );

  test.skipIf(SKIP_AI_SEARCH_TESTS)(
    "create AI Search with custom models and chunking",
    async (scope) => {
      const instanceName = `${testId}-custom`;
      const bucketName = `${testId}-custom-bucket`;

      let aiSearch: AiSearch | undefined;

      try {
        const bucket = await R2Bucket("custom-bucket", {
          name: bucketName,
          adopt: true,
        });

        // Create AI Search with custom configuration
        aiSearch = await AiSearch("custom-search", {
          name: instanceName,
          source: {
            type: "r2",
            bucket,
            token: AI_SEARCH_TOKEN_ID!,
          },
          chunkSize: 512,
          chunkOverlap: 20,
          maxNumResults: 15,
          scoreThreshold: 0.3,
          rewriteQuery: true,
          adopt: true,
        });

        expect(aiSearch.id).toEqual(instanceName);
        expect(aiSearch.chunkSize).toEqual(512);
        expect(aiSearch.chunkOverlap).toEqual(20);
        expect(aiSearch.maxNumResults).toEqual(15);
        expect(aiSearch.scoreThreshold).toEqual(0.3);
        expect(aiSearch.rewriteQuery).toEqual(true);
      } finally {
        await destroy(scope);
      }
    },
  );

  test.skipIf(SKIP_AI_SEARCH_TESTS)(
    "adopt existing AI Search instance",
    async (scope) => {
      const instanceName = `${testId}-adopt`;
      const bucketName = `${testId}-adopt-bucket`;

      try {
        const bucket = await R2Bucket("adopt-bucket", {
          name: bucketName,
          adopt: true,
        });

        // Create initial instance
        const aiSearch1 = await AiSearch("adopt-search-1", {
          name: instanceName,
          source: {
            type: "r2",
            bucket,
            token: AI_SEARCH_TOKEN_ID!,
          },
          maxNumResults: 10,
        });

        expect(aiSearch1.id).toEqual(instanceName);

        // Create second instance with same name - should adopt
        const aiSearch2 = await AiSearch("adopt-search-2", {
          name: instanceName,
          source: {
            type: "r2",
            bucket,
            token: AI_SEARCH_TOKEN_ID!,
          },
          maxNumResults: 25,
          adopt: true,
        });

        // Should have adopted and updated
        expect(aiSearch2.id).toEqual(instanceName);
        expect(aiSearch2.maxNumResults).toEqual(25);
      } finally {
        await destroy(scope);
      }
    },
  );

  test.skipIf(SKIP_AI_SEARCH_TESTS)(
    "AI Search with delete: false preserves instance",
    async (scope) => {
      const instanceName = `${testId}-nodelete`;
      const bucketName = `${testId}-nodelete-bucket`;

      try {
        const bucket = await R2Bucket("nodelete-bucket", {
          name: bucketName,
          adopt: true,
        });

        await AiSearch("nodelete-search", {
          name: instanceName,
          source: {
            type: "r2",
            bucket,
            token: AI_SEARCH_TOKEN_ID!,
          },
          delete: false, // Don't delete on destroy
          adopt: true,
        });

        // Destroy the scope
        await destroy(scope);

        // Instance should still exist
        const instance = await getAiSearchInstance(api, instanceName);
        expect(instance.id).toEqual(instanceName);

        // Clean up manually for test hygiene
        await api.delete(
          `/accounts/${api.accountId}/ai-search/instances/${instanceName}`,
        );
      } catch (error) {
        // Clean up on error
        await api
          .delete(
            `/accounts/${api.accountId}/ai-search/instances/${instanceName}`,
          )
          .catch(() => {});
        throw error;
      }
    },
  );

  // End-to-end test with Worker binding
  test.skipIf(SKIP_AI_SEARCH_TESTS)(
    "create AI Search and query via Worker binding",
    async (scope) => {
      const instanceName = `${testId}-e2e`;
      const bucketName = `${testId}-e2e-bucket`;
      const workerName = `${testId}-e2e-worker`;

      try {
        // 1. Create an R2 bucket with test documents
        const bucket = await R2Bucket("e2e-bucket", {
          name: bucketName,
          adopt: true,
        });

        // Upload test documents to the bucket
        await bucket.put(
          "test-doc.md",
          `# Getting Started Guide

Welcome to our documentation! This guide will help you get started.

## Installation

To install the package, run:

\`\`\`bash
npm install our-package
\`\`\`

## Configuration

Configure the package by creating a config file.

## Usage

Import and use the package in your code.
`,
        );

        await bucket.put(
          "faq.md",
          `# Frequently Asked Questions

## What is this package?

This package helps you build amazing applications.

## How do I get support?

Contact us at support@example.com or visit our forums.
`,
        );

        // 2. Create AI Search instance backed by the R2 bucket
        const aiSearch = await AiSearch("e2e-search", {
          name: instanceName,
          source: {
            type: "r2",
            bucket,
            token: AI_SEARCH_TOKEN_ID!,
          },
          adopt: true,
        });

        expect(aiSearch.id).toEqual(instanceName);
        expect(aiSearch.sourceType).toEqual("r2");

        // 3. Wait for indexing to complete (status: "ready")
        // Note: This can take a while for initial indexing
        await waitFor(
          async () => {
            const instance = await getAiSearchInstance(api, instanceName);
            return instance.status;
          },
          (status) => status === "ready",
          { timeoutMs: 180_000, intervalMs: 10_000 },
        );

        // 4. Create a worker that uses the AI binding to query AI Search
        const worker = await Worker(workerName, {
          name: workerName,
          adopt: true,
          script: `
            export default {
              async fetch(request, env, ctx) {
                const url = new URL(request.url);
                const query = url.searchParams.get('q') || 'installation';
                
                try {
                  // Access AI Search through the AI binding
                  const result = await env.AI.autorag("${instanceName}").search({
                    query,
                    max_num_results: 5,
                  });
                  
                  return Response.json({
                    success: true,
                    searchQuery: result.search_query,
                    resultCount: result.data?.length || 0,
                    hasResults: (result.data?.length || 0) > 0,
                  });
                } catch (error) {
                  return Response.json({
                    success: false,
                    error: error.message,
                  }, { status: 500 });
                }
              }
            };
          `,
          format: "esm",
          url: true,
          bindings: {
            AI: Ai(), // AI binding required to access AI Search
          },
        });

        expect(worker.url).toBeTruthy();

        // Wait for worker to be ready
        await new Promise((resolve) => setTimeout(resolve, 2000));

        // 5. Query the worker and verify AI Search returns results
        const response = await fetchAndExpectOK(
          `${worker.url}?q=installation`,
        );
        const data: any = await response.json();

        expect(data.success).toBe(true);
        // Note: Results may vary based on indexing, but we verify the call succeeded
        expect(data.searchQuery).toBeTruthy();
      } finally {
        await destroy(scope);
      }
    },
    300_000, // 5 minute timeout for indexing
  );

  // Test aiSearch() with RAG response generation
  test.skipIf(SKIP_AI_SEARCH_TESTS)(
    "AI Search with RAG response generation via Worker",
    async (scope) => {
      const instanceName = `${testId}-rag`;
      const bucketName = `${testId}-rag-bucket`;
      const workerName = `${testId}-rag-worker`;

      try {
        // 1. Create bucket with test content
        const bucket = await R2Bucket("rag-bucket", {
          name: bucketName,
          adopt: true,
        });

        await bucket.put(
          "llama-care.md",
          `# How to Care for Llamas

## Feeding

Llamas eat grass, hay, and grain. Feed them twice daily.

## Housing

Provide a shelter with at least 40 square feet per llama.

## Health

Schedule regular vet checkups and keep vaccinations current.
`,
        );

        // 2. Create AI Search instance
        const aiSearch = await AiSearch("rag-search", {
          name: instanceName,
          source: {
            type: "r2",
            bucket,
            token: AI_SEARCH_TOKEN_ID!,
          },
          adopt: true,
        });

        expect(aiSearch.id).toEqual(instanceName);

        // 3. Wait for indexing
        await waitFor(
          async () => {
            const instance = await getAiSearchInstance(api, instanceName);
            return instance.status;
          },
          (status) => status === "ready",
          { timeoutMs: 180_000, intervalMs: 10_000 },
        );

        // 4. Create worker that uses aiSearch (RAG)
        const worker = await Worker(workerName, {
          name: workerName,
          adopt: true,
          script: `
            export default {
              async fetch(request, env, ctx) {
                try {
                  const result = await env.AI.autorag("${instanceName}").aiSearch({
                    query: "How do I feed a llama?",
                    max_num_results: 3,
                  });
                  
                  return Response.json({
                    success: true,
                    hasResponse: !!result.response,
                    responseLength: result.response?.length || 0,
                    sourceCount: result.data?.length || 0,
                  });
                } catch (error) {
                  return Response.json({
                    success: false,
                    error: error.message,
                  }, { status: 500 });
                }
              }
            };
          `,
          format: "esm",
          url: true,
          bindings: {
            AI: Ai(),
          },
        });

        expect(worker.url).toBeTruthy();

        await new Promise((resolve) => setTimeout(resolve, 2000));

        // 5. Verify RAG response
        const response = await fetchAndExpectOK(worker.url!);
        const data: any = await response.json();

        expect(data.success).toBe(true);
        // AI Search with RAG should generate a response
        expect(data.hasResponse).toBe(true);
      } finally {
        await destroy(scope);
      }
    },
    300_000, // 5 minute timeout
  );
});
