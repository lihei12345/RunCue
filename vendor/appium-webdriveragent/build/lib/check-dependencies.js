"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.bundleWDASim = bundleWDASim;
const support_1 = require("@appium/support");
const teen_process_1 = require("teen_process");
const node_path_1 = __importDefault(require("node:path"));
const constants_1 = require("./constants");
const utils_1 = require("./utils");
/**
 * Ensure simulator WDA is built and return the resulting app bundle path.
 */
async function bundleWDASim(xcodebuild) {
    const derivedDataPath = await xcodebuild.retrieveDerivedDataPath();
    if (!derivedDataPath) {
        throw new Error('Cannot retrieve the path to the Xcode derived data folder');
    }
    const wdaBundlePath = node_path_1.default.join(derivedDataPath, 'Build', 'Products', 'Debug-iphonesimulator', constants_1.WDA_RUNNER_APP);
    if (await support_1.fs.exists(wdaBundlePath)) {
        return wdaBundlePath;
    }
    await buildWDASim();
    return wdaBundlePath;
}
async function buildWDASim() {
    const args = [
        '-project',
        node_path_1.default.join(utils_1.BOOTSTRAP_PATH, 'WebDriverAgent.xcodeproj'),
        '-scheme',
        constants_1.WDA_SCHEME,
        '-sdk',
        constants_1.SDK_SIMULATOR,
        'CODE_SIGN_IDENTITY=""',
        'CODE_SIGNING_REQUIRED="NO"',
        'GCC_TREAT_WARNINGS_AS_ERRORS=0',
    ];
    await (0, teen_process_1.exec)('xcodebuild', args);
}
//# sourceMappingURL=check-dependencies.js.map