import { DataSource } from "@azure-tools/datastore";
import * as oai3 from "@azure-tools/openapi";
import { isHttpMethod } from "@azure-tools/openapi";
import { AutorestContext } from "../../context";
import { PipelinePlugin } from "../../pipeline/common";
import { OperationStats } from "../../stats";

export async function collectOpenAPIStats(context: AutorestContext, dataSource: DataSource) {
  const inputs = await dataSource.enum();
  context.stats.track({
    openapi: {
      inputCount: inputs.length,
    },
  });

  for (const input of inputs) {
    const data = await dataSource.read(input);
    if (data) {
      const rawContent = await data.readData();
      const spec = await data.readObject<oai3.Model>();

      const specStat = {
        lineCount: rawContent.split("\n").length,
        operations: countOperations(spec),
        security: {
          schemes: countSecuritySchemes(spec),
        },
      };

      context.stats.track({
        openapi: {
          specs: {
            [data.description]: specStat,
          },
        },
      });
    }
  }
}

/**
 * @param spec OpenAPI spec
 * @returns number of operations(path + methods) defined in the spec.
 */
function countSecuritySchemes(spec: oai3.Model): number {
  const schemes = spec.components?.securitySchemes;
  return schemes === undefined ? 0 : Object.keys(schemes).length;
}

/**
 * @param spec OpenAPI spec
 * @returns number of operations(path + methods) defined in the spec.
 */
function countOperations(spec: oai3.Model): OperationStats {
  const stats: OperationStats = {
    total: 0,
    paths: 0,
    longRunning: 0,
    pageable: 0,
    methods: {
      get: 0,
      post: 0,
      put: 0,
      patch: 0,
      delete: 0,
      head: 0,
      trace: 0,
      options: 0,
    },
  };

  for (const path of Object.values(spec.paths)) {
    stats.paths++;

    for (const [key, operation] of Object.entries(path)) {
      if (!isHttpMethod(key)) {
        continue;
      }
      stats.methods[key]++;

      if (isLongRunningOperation(operation)) {
        stats.longRunning++;
      }
      if (isPageableOperation(operation)) {
        stats.pageable++;
      }
    }
  }
  return stats;
}

/**
 * @param operation Operation
 * @returns if the operation is a long running operation(defined with x-ms-long-running-operation: true) defined in the spec.
 */
function isLongRunningOperation(operation: oai3.HttpOperation): boolean {
  return operation["x-ms-long-running-operation"];
}

/**
 * @param operation Operation
 * @returns if the operation is pageable(defined with x-ms-pageable: true) defined in the spec.
 */
function isPageableOperation(operation: oai3.HttpOperation): boolean {
  return operation["x-ms-pageable"];
}

export function createOpenAPIStatsCollectorPlugin(): PipelinePlugin {
  return async (context, dataSource, sink) => {
    await collectOpenAPIStats(context, dataSource);
    return dataSource;
  };
}
