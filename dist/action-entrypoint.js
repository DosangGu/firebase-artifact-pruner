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
const core = __importStar(require("@actions/core"));
const pruner_1 = require("./pruner");
async function run() {
    try {
        const projectId = core.getInput("project-id", { required: true });
        const serviceAccountKeyJson = core.getInput("service-account-key-json");
        const serviceAccountKeyPath = core.getInput("service-account-key-path");
        const appId = core.getInput("app-id");
        const minCount = parseInt(core.getInput("min-count") || "5", 10);
        const maxDays = parseInt(core.getInput("max-days") || "30", 10);
        if (!serviceAccountKeyJson &&
            !serviceAccountKeyPath &&
            !process.env.GOOGLE_APPLICATION_CREDENTIALS) {
            core.setFailed('Either "service-account-key-json", "service-account-key-path", or GOOGLE_APPLICATION_CREDENTIALS env must be provided.');
            return;
        }
        const prunerOptions = {
            projectId,
            serviceAccountKeyJson: serviceAccountKeyJson || undefined,
            serviceAccountKeyPath: serviceAccountKeyPath || undefined,
            appId: appId || undefined,
            minCount,
            maxDays,
        };
        await (0, pruner_1.runPruner)(prunerOptions);
        core.info("Firebase Artifact Pruner action completed successfully.");
    }
    catch (error) {
        if (error instanceof Error) {
            core.setFailed(error.message);
        }
        else {
            core.setFailed("An unknown error occurred");
        }
    }
}
run();
