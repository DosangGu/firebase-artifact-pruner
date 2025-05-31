#!/usr/bin/env node

import { Command } from "commander";
import { runPruner, PrunerOptions } from "./pruner";

async function main() {
  const program = new Command();
  program
    .requiredOption("-p, --projectId <projectId>", "Firebase Project ID")
    .option(
      "-k, --serviceAccountKey <path>",
      "Path to Firebase service account key JSON file. Used if --serviceAccountKeyJson is not provided."
    )
    .option(
      "--serviceAccountKeyJson <jsonString>",
      "Firebase service account key as a JSON string. Takes precedence over --serviceAccountKey."
    )
    .option("-a, --appId <appId>", "Specific Firebase App ID to process")
    .option(
      "-c, --minCount <number>",
      "Minimum number of artifacts to keep",
      "5"
    )
    .option(
      "-d, --maxDays <number>",
      "Maximum age in days for artifacts to keep",
      "30"
    )
    .parse(process.argv);

  const options = program.opts();
  const prunerOptions: PrunerOptions = {
    projectId: options.projectId,
    serviceAccountKeyPath: options.serviceAccountKey,
    serviceAccountKeyJson: options.serviceAccountKeyJson,
    appId: options.appId,
    minCount: parseInt(options.minCount, 10),
    maxDays: parseInt(options.maxDays, 10),
  };

  try {
    await runPruner(prunerOptions);
  } catch (error) {
    process.exit(1);
  }
}

main();
