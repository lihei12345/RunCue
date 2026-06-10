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
var __exportStar = (this && this.__exportStar) || function(m, exports) {
    for (var p in m) if (p !== "default" && !Object.prototype.hasOwnProperty.call(exports, p)) __createBinding(exports, m, p);
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.BOOTSTRAP_PATH = exports.resetTestProcesses = exports.PROJECT_FILE = exports.WDA_RUNNER_BUNDLE_ID = exports.WDA_RUNNER_APP = exports.WDA_BASE_URL = exports.WebDriverAgent = exports.NoSessionProxy = exports.bundleWDASim = void 0;
var check_dependencies_1 = require("./check-dependencies");
Object.defineProperty(exports, "bundleWDASim", { enumerable: true, get: function () { return check_dependencies_1.bundleWDASim; } });
var no_session_proxy_1 = require("./no-session-proxy");
Object.defineProperty(exports, "NoSessionProxy", { enumerable: true, get: function () { return no_session_proxy_1.NoSessionProxy; } });
var webdriveragent_1 = require("./webdriveragent");
Object.defineProperty(exports, "WebDriverAgent", { enumerable: true, get: function () { return webdriveragent_1.WebDriverAgent; } });
var constants_1 = require("./constants");
Object.defineProperty(exports, "WDA_BASE_URL", { enumerable: true, get: function () { return constants_1.WDA_BASE_URL; } });
Object.defineProperty(exports, "WDA_RUNNER_APP", { enumerable: true, get: function () { return constants_1.WDA_RUNNER_APP; } });
Object.defineProperty(exports, "WDA_RUNNER_BUNDLE_ID", { enumerable: true, get: function () { return constants_1.WDA_RUNNER_BUNDLE_ID; } });
Object.defineProperty(exports, "PROJECT_FILE", { enumerable: true, get: function () { return constants_1.PROJECT_FILE; } });
var utils_1 = require("./utils");
Object.defineProperty(exports, "resetTestProcesses", { enumerable: true, get: function () { return utils_1.resetTestProcesses; } });
Object.defineProperty(exports, "BOOTSTRAP_PATH", { enumerable: true, get: function () { return utils_1.BOOTSTRAP_PATH; } });
__exportStar(require("./types"), exports);
//# sourceMappingURL=index.js.map