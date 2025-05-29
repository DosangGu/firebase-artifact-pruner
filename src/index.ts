#!/usr/bin/env node

import * as admin from "firebase-admin";
import { Command } from "commander";
import { GoogleAuth } from "google-auth-library";

interface App {
  name: string;
  appId: string;
  platform: string;
}

interface Release {
  name: string;
  releaseNotes: {
    text: string;
  };
  displayVersion: string;
  buildVersion: string;
  createTime: string; // ISO 8601 format
}

async function listApps(
  projectId: string,
  serviceAccountKeyPath: string
): Promise<App[]> {
  const auth = new GoogleAuth({
    keyFile: serviceAccountKeyPath,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const accessToken = (await client.getAccessToken()).token;

  const url = `https://firebaseappdistribution.googleapis.com/v1/projects/${projectId}/apps`;
  const response = await fetch(url, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
    },
  });

  if (!response.ok) {
    const errorText = await response.text();
    throw new Error(`Failed to list apps: ${response.status} ${errorText}`);
  }

  const result = await response.json();
  return result.apps || [];
}

async function listReleases(
  projectId: string,
  appId: string,
  serviceAccountKeyPath: string
): Promise<Release[]> {
  const auth = new GoogleAuth({
    keyFile: serviceAccountKeyPath,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const accessToken = (await client.getAccessToken()).token;

  let allReleases: Release[] = [];
  let nextPageToken: string | undefined = undefined;

  do {
    let url = `https://firebaseappdistribution.googleapis.com/v1/projects/${projectId}/apps/${appId}/releases`;
    if (nextPageToken) {
      url += `?pageToken=${nextPageToken}`;
    }

    const response = await fetch(url, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    if (!response.ok) {
      const errorText = await response.text();
      throw new Error(
        `Failed to list releases for app ${appId}: ${response.status} ${errorText}`
      );
    }
    const result = await response.json();
    allReleases = allReleases.concat(result.releases || []);
    nextPageToken = result.nextPageToken;
  } while (nextPageToken);

  return allReleases;
}

async function deleteReleases(
  projectId: string,
  appId: string,
  releaseNames: string[],
  serviceAccountKeyPath: string
): Promise<void> {
  if (releaseNames.length === 0) {
    console.log("No releases provided to delete.");
    return;
  }

  const auth = new GoogleAuth({
    keyFile: serviceAccountKeyPath,
    scopes: ["https://www.googleapis.com/auth/cloud-platform"],
  });
  const client = await auth.getClient();
  const accessToken = (await client.getAccessToken()).token;

  const url = `https://firebaseappdistribution.googleapis.com/v1/projects/${projectId}/apps/${appId}/releases:batchDelete`;

  const chunkSize = 100;
  for (let i = 0; i < releaseNames.length; i += chunkSize) {
    const chunk = releaseNames.slice(i, i + chunkSize);
    // Ensure release names are in the full format projects/projectId/apps/appId/releases/releaseId
    // The release.name from listReleases should already be in this format.
    const formattedReleaseNames = chunk;

    console.log(`Attempting to delete a chunk of ${formattedReleaseNames.length} release(s) for app ${appId}.`);

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ names: formattedReleaseNames }),
    });

    if (!response.ok) {
      const errorText = await response.text();
      // Log the specific chunk that failed, but continue trying other chunks.
      console.error(
        `Failed to batch delete a chunk of releases for app ${appId}: ${response.status} ${errorText}. Releases in this chunk: ${formattedReleaseNames.join(", ")}`
      );
      // Optionally, you could decide to throw an error here and stop further processing,
      // or collect failures and report them at the end.
      // For now, it logs the error and continues.
    } else {
      console.log(
        `Successfully deleted a chunk of ${formattedReleaseNames.length} release(s) for app ${appId}.`
      );
    }
  }
  console.log(
    `Finished attempting to delete ${releaseNames.length} release(s) in chunks for app ${appId}.`
  );
}

async function main() {
  const program = new Command();
  program
    .requiredOption("-p, --projectId <projectId>", "Firebase Project ID")
    .requiredOption(
      "-k, --serviceAccountKey <path>",
      "Path to Firebase service account key JSON file"
    )
    .option("-a, --appId <appId>", "Specific Firebase App ID to process") // Added appId option
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
  const projectId = options.projectId;
  const serviceAccountKeyPath = options.serviceAccountKey;
  const appIdOption = options.appId; // Get appId from options
  const minCount = parseInt(options.minCount, 10);
  const maxDays = parseInt(options.maxDays, 10);

  try {
    // Initialize Firebase Admin SDK
    // eslint-disable-next-line @typescript-eslint/no-var-requires
    const serviceAccount = require(serviceAccountKeyPath);
    admin.initializeApp({
      credential: admin.credential.cert(serviceAccount),
    });

    if (appIdOption) {
      // Process a single app if appId is provided
      console.log(
        `Processing specified app: ${appIdOption} for project: ${projectId}`
      );
      const releases = await listReleases(
        projectId,
        appIdOption,
        serviceAccountKeyPath
      );

      if (!releases || releases.length === 0) {
        console.log("No releases found for this app.");
      } else {
        console.log(`Found ${releases.length} release(s).`);
        releases.sort(
          (a, b) =>
            new Date(b.createTime).getTime() - new Date(a.createTime).getTime()
        );
        const releasesToDelete: Release[] = [];
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - maxDays);

        for (let i = 0; i < releases.length; i++) {
          const release = releases[i];
          const releaseDate = new Date(release.createTime);
          if (i >= minCount && releaseDate < cutoffDate) {
            releasesToDelete.push(release);
          }
        }

        if (releasesToDelete.length === 0) {
          console.log("No releases to delete based on current criteria.");
        } else {
          console.log(`Found ${releasesToDelete.length} release(s) to delete:`);
          const releaseNamesToDelete = releasesToDelete.map(
            (release) => release.name
          );
          for (const release of releasesToDelete) {
            console.log(
              `- ${release.displayVersion} (${release.buildVersion}), Created: ${release.createTime}`
            );
          }
          try {
            await deleteReleases(
              projectId,
              appIdOption,
              releaseNamesToDelete,
              serviceAccountKeyPath
            );
          } catch (error) {
            console.error(
              `Error batch deleting releases for app ${appIdOption}:`,
              error
            );
          }
        }
      }
    } else {
      // Process all apps if no specific appId is provided
      console.log(`Fetching apps for project: ${projectId}`);
      const apps = await listApps(projectId, serviceAccountKeyPath);

      if (!apps || apps.length === 0) {
        console.log("No apps found in this project.");
        return;
      }

      console.log(`Found ${apps.length} app(s):`);
      apps.forEach((app) =>
        console.log(
          `- ${app.name} (ID: ${app.appId}, Platform: ${app.platform})`
        )
      );

      for (const app of apps) {
        console.log(`
Processing app: ${app.name} (${app.appId})`);
        const releases = await listReleases(
          projectId,
          app.appId,
          serviceAccountKeyPath
        );

        if (!releases || releases.length === 0) {
          console.log("No releases found for this app.");
          continue;
        }

        console.log(`Found ${releases.length} release(s).`);

        // Sort releases by creation time, newest first
        releases.sort(
          (a, b) =>
            new Date(b.createTime).getTime() - new Date(a.createTime).getTime()
        );

        const releasesToDelete: Release[] = [];
        const cutoffDate = new Date();
        cutoffDate.setDate(cutoffDate.getDate() - maxDays);

        for (let i = 0; i < releases.length; i++) {
          const release = releases[i];
          const releaseDate = new Date(release.createTime);

          if (i >= minCount && releaseDate < cutoffDate) {
            releasesToDelete.push(release);
          }
        }

        if (releasesToDelete.length === 0) {
          console.log("No releases to delete based on current criteria.");
          continue;
        }

        console.log(`Found ${releasesToDelete.length} release(s) to delete:`);
        const releaseNamesToDelete = releasesToDelete.map(
          (release) => release.name
        );
        for (const release of releasesToDelete) {
          console.log(
            `- ${release.displayVersion} (${release.buildVersion}), Created: ${release.createTime}`
          );
        }
        try {
          await deleteReleases(
            projectId,
            app.appId,
            releaseNamesToDelete,
            serviceAccountKeyPath
          );
        } catch (error) {
          console.error(
            `Error batch deleting releases for app ${app.appId}:`,
            error
          );
        }
      }
    }
    console.log("\nPruning complete.");
  } catch (error) {
    console.error("Error during script execution:", error);
    process.exit(1);
  }
}

main();
