import * as admin from "firebase-admin";
import { GoogleAuth } from "google-auth-library";

// Interfaces (App, Release)는 여기에 유지하거나 별도 types.ts로 분리 가능
export interface App {
  name: string;
  appId: string;
  platform: string;
}

export interface Release {
  name: string;
  releaseNotes: {
    text: string;
  };
  displayVersion: string;
  buildVersion: string;
  createTime: string; // ISO 8601 format
}

export interface PrunerOptions {
  projectId: string;
  serviceAccountKeyPath?: string;
  serviceAccountKeyJson?: string;
  appId?: string;
  minCount: number;
  maxDays: number;
}

async function listApps(projectId: string, auth: GoogleAuth): Promise<App[]> {
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
  auth: GoogleAuth
): Promise<Release[]> {
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
  auth: GoogleAuth
): Promise<void> {
  if (releaseNames.length === 0) {
    console.log("No releases provided to delete.");
    return;
  }

  const client = await auth.getClient();
  const accessToken = (await client.getAccessToken()).token;

  const url = `https://firebaseappdistribution.googleapis.com/v1/projects/${projectId}/apps/${appId}/releases:batchDelete`;

  const chunkSize = 100;
  for (let i = 0; i < releaseNames.length; i += chunkSize) {
    const chunk = releaseNames.slice(i, i + chunkSize);
    const formattedReleaseNames = chunk;

    console.log(
      `Attempting to delete a chunk of ${formattedReleaseNames.length} release(s) for app ${appId}.`
    );

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
      console.error(
        `Failed to batch delete a chunk of releases for app ${appId}: ${
          response.status
        } ${errorText}. Releases in this chunk: ${formattedReleaseNames.join(
          ", "
        )}`
      );
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

function getAuth(
  serviceAccountKeyPath?: string,
  serviceAccountKeyJson?: string
): GoogleAuth {
  if (serviceAccountKeyJson) {
    try {
      const credentials = JSON.parse(serviceAccountKeyJson);
      return new GoogleAuth({
        credentials,
        scopes: ["https://www.googleapis.com/auth/cloud-platform"],
      });
    } catch (e) {
      throw new Error(
        "Failed to parse serviceAccountKeyJson: " + (e as Error).message
      );
    }
  } else if (serviceAccountKeyPath) {
    return new GoogleAuth({
      keyFile: serviceAccountKeyPath,
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  } else {
    return new GoogleAuth({
      scopes: ["https://www.googleapis.com/auth/cloud-platform"],
    });
  }
}

export async function runPruner(options: PrunerOptions): Promise<void> {
  const {
    projectId,
    serviceAccountKeyPath,
    serviceAccountKeyJson,
    appId: appIdOption,
    minCount,
    maxDays,
  } = options;

  try {
    // Initialize Firebase Admin SDK only if not already initialized
    if (!admin.apps.length) {
      // Check if any app is initialized
      if (serviceAccountKeyJson) {
        try {
          const serviceAccount = JSON.parse(serviceAccountKeyJson);
          admin.initializeApp({
            credential: admin.credential.cert(serviceAccount),
          });
        } catch (e) {
          console.error(
            "Failed to parse serviceAccountKeyJson for Firebase Admin SDK:",
            (e as Error).message
          );
          throw new Error(
            "Failed to initialize Firebase Admin SDK with JSON key."
          );
        }
      } else if (serviceAccountKeyPath) {
        // eslint-disable-next-line @typescript-eslint/no-var-requires
        const serviceAccount = require(serviceAccountKeyPath);
        admin.initializeApp({
          credential: admin.credential.cert(serviceAccount),
        });
      } else {
        try {
          admin.initializeApp();
          console.log(
            "Initialized Firebase Admin SDK using Application Default Credentials."
          );
        } catch (e) {
          console.error(
            "Failed to initialize Firebase Admin SDK with Application Default Credentials. " +
              "Ensure credentials are set up correctly (e.g., GOOGLE_APPLICATION_CREDENTIALS environment variable) " +
              "or provide a service account key.",
            e
          );
          throw new Error("Failed to initialize Firebase Admin SDK with ADC.");
        }
      }
    }

    const auth = getAuth(serviceAccountKeyPath, serviceAccountKeyJson);

    if (appIdOption) {
      console.log(
        `Processing specified app: ${appIdOption} for project: ${projectId}`
      );
      const releases = await listReleases(projectId, appIdOption, auth);

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
              auth
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
      console.log(`Fetching apps for project: ${projectId}`);
      const apps = await listApps(projectId, auth);

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
        console.log(`Processing app: ${app.name} (${app.appId})`);
        const releases = await listReleases(projectId, app.appId, auth);

        if (!releases || releases.length === 0) {
          console.log("No releases found for this app.");
          continue;
        }

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
            auth
          );
        } catch (error) {
          console.error(
            `Error batch deleting releases for app ${app.appId}:`,
            error
          );
        }
      }
    }
    console.log("Pruning complete.");
  } catch (error) {
    console.error("Error during pruner execution:", error);
    throw error;
  }
}
