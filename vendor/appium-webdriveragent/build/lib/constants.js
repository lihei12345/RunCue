"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.WDA_UPGRADE_TIMESTAMP_PATH = exports.SDK_DEVICE = exports.SDK_SIMULATOR = exports.PLATFORM_NAME_IOS = exports.PLATFORM_NAME_TVOS = exports.WDA_BASE_URL = exports.PROJECT_FILE = exports.WDA_SCHEME = exports.WDA_RUNNER_APP = exports.WDA_RUNNER_BUNDLE_ID_FOR_XCTEST = exports.WDA_RUNNER_BUNDLE_ID = exports.DEFAULT_TEST_BUNDLE_SUFFIX = void 0;
const node_path_1 = __importDefault(require("node:path"));
exports.DEFAULT_TEST_BUNDLE_SUFFIX = '.xctrunner';
exports.WDA_RUNNER_BUNDLE_ID = 'com.facebook.WebDriverAgentRunner';
exports.WDA_RUNNER_BUNDLE_ID_FOR_XCTEST = `${exports.WDA_RUNNER_BUNDLE_ID}${exports.DEFAULT_TEST_BUNDLE_SUFFIX}`;
exports.WDA_RUNNER_APP = 'WebDriverAgentRunner-Runner.app';
exports.WDA_SCHEME = 'WebDriverAgentRunner';
exports.PROJECT_FILE = 'project.pbxproj';
exports.WDA_BASE_URL = 'http://127.0.0.1';
exports.PLATFORM_NAME_TVOS = 'tvOS';
exports.PLATFORM_NAME_IOS = 'iOS';
exports.SDK_SIMULATOR = 'iphonesimulator';
exports.SDK_DEVICE = 'iphoneos';
exports.WDA_UPGRADE_TIMESTAMP_PATH = node_path_1.default.join('.appium', 'webdriveragent', 'upgrade.time');
//# sourceMappingURL=constants.js.map