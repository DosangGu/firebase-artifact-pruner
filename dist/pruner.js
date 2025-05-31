"use strict";
var __createBinding = (this && this.__createBinding) || (Object.create ? (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    var desc = Object.getOwnPropertyDescriptor(m, k);
    if (!desc || ("get" in desc ? !m.__esModule : desc.writable || desc.configurable)) {
      desc = { enumerable: true, get: function() { return m[k]; } };
    }
    Object.defineProperty(o, k2, desc);
}) : (function(o, m, k, k2) {
    if (k2 === undefined) k2 = k;
    o[k2] = m[k];
}));
var __setModuleDefault = (this && this.__setModuleDefault) || (Object.create ? (function(o, v) {
    Object.defineProperty(o, "default", { enumerable: true, value: v });
}) : function(o, v) {
    o["default"] = v;
});
var __importStar = (this && this.__importStar) || (function () {
    var ownKeys = function(o) {
        ownKeys = Object.getOwnPropertyNames || function (o) {
            var ar = [];
            for (var k in o) if (Object.prototype.hasOwnProperty.call(o, k)) ar[ar.length] = k;
            return ar;
        };
        return ownKeys(o);
    };
    return function (mod) {
        if (mod && mod.__esModule) return mod;
        var result = {};
        if (mod != null) for (var k = ownKeys(mod), i = 0; i < k.length; i++) if (k[i] !== "default") __createBinding(result, mod, k[i]);
        __setModuleDefault(result, mod);
        return result;
    };
})();
Object.defineProperty(exports, "__esModule", { value: true });
exports.runPruner = runPruner;
const admin = __importStar(require("firebase-admin"));
const google_auth_library_1 = require("google-auth-library");
async function listApps(projectId, auth) {
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
async function listReleases(projectId, appId, auth) {
    const client = await auth.getClient();
    const accessToken = (await client.getAccessToken()).token;
    let allReleases = [];
    let nextPageToken = undefined;
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
            throw new Error(`Failed to list releases for app ${appId}: ${response.status} ${errorText}`);
        }
        const result = await response.json();
        allReleases = allReleases.concat(result.releases || []);
        nextPageToken = result.nextPageToken;
    } while (nextPageToken);
    return allReleases;
}
async function deleteReleases(projectId, appId, releaseNames, auth) {
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
            console.error(`Failed to batch delete a chunk of releases for app ${appId}: ${response.status} ${errorText}. Releases in this chunk: ${formattedReleaseNames.join(", ")}`);
        }
        else {
            console.log(`Successfully deleted a chunk of ${formattedReleaseNames.length} release(s) for app ${appId}.`);
        }
    }
    console.log(`Finished attempting to delete ${releaseNames.length} release(s) in chunks for app ${appId}.`);
}
function getAuth(serviceAccountKeyPath, serviceAccountKeyJson) {
    if (serviceAccountKeyJson) {
        try {
            const credentials = JSON.parse(serviceAccountKeyJson);
            return new google_auth_library_1.GoogleAuth({
                credentials,
                scopes: ["https://www.googleapis.com/auth/cloud-platform"],
            });
        }
        catch (e) {
            throw new Error("Failed to parse serviceAccountKeyJson: " + e.message);
        }
    }
    else if (serviceAccountKeyPath) {
        return new google_auth_library_1.GoogleAuth({
            keyFile: serviceAccountKeyPath,
            scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        });
    }
    else {
        return new google_auth_library_1.GoogleAuth({
            scopes: ["https://www.googleapis.com/auth/cloud-platform"],
        });
    }
}
async function runPruner(options) {
    const { projectId, serviceAccountKeyPath, serviceAccountKeyJson, appId: appIdOption, minCount, maxDays, } = options;
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
                }
                catch (e) {
                    console.error("Failed to parse serviceAccountKeyJson for Firebase Admin SDK:", e.message);
                    throw new Error("Failed to initialize Firebase Admin SDK with JSON key.");
                }
            }
            else if (serviceAccountKeyPath) {
                // eslint-disable-next-line @typescript-eslint/no-var-requires
                const serviceAccount = require(serviceAccountKeyPath);
                admin.initializeApp({
                    credential: admin.credential.cert(serviceAccount),
                });
            }
            else {
                try {
                    admin.initializeApp();
                    console.log("Initialized Firebase Admin SDK using Application Default Credentials.");
                }
                catch (e) {
                    console.error("Failed to initialize Firebase Admin SDK with Application Default Credentials. " +
                        "Ensure credentials are set up correctly (e.g., GOOGLE_APPLICATION_CREDENTIALS environment variable) " +
                        "or provide a service account key.", e);
                    throw new Error("Failed to initialize Firebase Admin SDK with ADC.");
                }
            }
        }
        const auth = getAuth(serviceAccountKeyPath, serviceAccountKeyJson);
        if (appIdOption) {
            console.log(`Processing specified app: ${appIdOption} for project: ${projectId}`);
            const releases = await listReleases(projectId, appIdOption, auth);
            if (!releases || releases.length === 0) {
                console.log("No releases found for this app.");
            }
            else {
                console.log(`Found ${releases.length} release(s).`);
                releases.sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime());
                const releasesToDelete = [];
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
                }
                else {
                    console.log(`Found ${releasesToDelete.length} release(s) to delete:`);
                    const releaseNamesToDelete = releasesToDelete.map((release) => release.name);
                    for (const release of releasesToDelete) {
                        console.log(`- ${release.displayVersion} (${release.buildVersion}), Created: ${release.createTime}`);
                    }
                    try {
                        await deleteReleases(projectId, appIdOption, releaseNamesToDelete, auth);
                    }
                    catch (error) {
                        console.error(`Error batch deleting releases for app ${appIdOption}:`, error);
                    }
                }
            }
        }
        else {
            console.log(`Fetching apps for project: ${projectId}`);
            const apps = await listApps(projectId, auth);
            if (!apps || apps.length === 0) {
                console.log("No apps found in this project.");
                return;
            }
            console.log(`Found ${apps.length} app(s):`);
            apps.forEach((app) => console.log(`- ${app.name} (ID: ${app.appId}, Platform: ${app.platform})`));
            for (const app of apps) {
                console.log(`Processing app: ${app.name} (${app.appId})`);
                const releases = await listReleases(projectId, app.appId, auth);
                if (!releases || releases.length === 0) {
                    console.log("No releases found for this app.");
                    continue;
                }
                console.log(`Found ${releases.length} release(s).`);
                releases.sort((a, b) => new Date(b.createTime).getTime() - new Date(a.createTime).getTime());
                const releasesToDelete = [];
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
                const releaseNamesToDelete = releasesToDelete.map((release) => release.name);
                for (const release of releasesToDelete) {
                    console.log(`- ${release.displayVersion} (${release.buildVersion}), Created: ${release.createTime}`);
                }
                try {
                    await deleteReleases(projectId, app.appId, releaseNamesToDelete, auth);
                }
                catch (error) {
                    console.error(`Error batch deleting releases for app ${app.appId}:`, error);
                }
            }
        }
        console.log("Pruning complete.");
    }
    catch (error) {
        console.error("Error during pruner execution:", error);
        throw error;
    }
}
