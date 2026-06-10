"use strict";
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.XcodeBuild = void 0;
const asyncbox_1 = require("asyncbox");
const teen_process_1 = require("teen_process");
const support_1 = require("@appium/support");
const logger_1 = require("./logger");
const utils_1 = require("./utils");
const node_path_1 = __importDefault(require("node:path"));
const constants_1 = require("./constants");
const DEFAULT_SIGNING_ID = 'iPhone Developer';
const PREBUILD_DELAY = 0;
const RUNNER_SCHEME_IOS = 'WebDriverAgentRunner';
const LIB_SCHEME_IOS = 'WebDriverAgentLib';
const ERROR_WRITING_ATTACHMENT = 'Error writing attachment data to file';
const ERROR_COPYING_ATTACHMENT = 'Error copying testing attachment';
const IGNORED_ERRORS = [
    ERROR_WRITING_ATTACHMENT,
    ERROR_COPYING_ATTACHMENT,
    'Failed to remove screenshot at path',
];
const IGNORED_ERRORS_PATTERN = new RegExp('(' + IGNORED_ERRORS.map((errStr) => (0, utils_1.escapeRegExp)(errStr)).join('|') + ')');
const RUNNER_SCHEME_TV = 'WebDriverAgentRunner_tvOS';
const LIB_SCHEME_TV = 'WebDriverAgentLib_tvOS';
const REAL_DEVICES_CONFIG_DOCS_LINK = 'https://appium.github.io/appium-xcuitest-driver/latest/preparation/real-device-config/';
const xcodeLog = support_1.logger.getLogger('Xcode');
class XcodeBuild {
    device;
    realDevice;
    agentPath;
    bootstrapPath;
    platformVersion;
    platformName;
    iosSdkVersion;
    xcodeSigningId;
    xcodebuild;
    usePrebuiltWDA;
    derivedDataPath;
    log;
    showXcodeLog;
    xcodeConfigFile;
    xcodeOrgId;
    keychainPath;
    keychainPassword;
    useSimpleBuildTest;
    useXctestrunFile;
    launchTimeout;
    wdaRemotePort;
    wdaBindingIP;
    updatedWDABundleId;
    mjpegServerPort;
    prebuildDelay;
    allowProvisioningDeviceRegistration;
    resultBundlePath;
    resultBundleVersion;
    _didBuildFail;
    _didProcessExit;
    _buildSettingsPromises = new Map();
    noSessionProxy;
    xctestrunFilePath;
    /**
     * Creates a new XcodeBuild instance.
     * @param device - The Apple device to build for
     * @param args - Configuration arguments for xcodebuild
     * @param log - Optional logger instance
     */
    constructor(device, args, log = null) {
        this.device = device;
        this.log = log ?? logger_1.log;
        this.realDevice = args.realDevice;
        this.agentPath = args.agentPath;
        this.bootstrapPath = args.bootstrapPath;
        this.platformVersion = args.platformVersion;
        this.platformName = args.platformName;
        this.iosSdkVersion = args.iosSdkVersion;
        this.showXcodeLog = args.showXcodeLog;
        this.xcodeConfigFile = args.xcodeConfigFile;
        this.xcodeOrgId = args.xcodeOrgId;
        this.xcodeSigningId = args.xcodeSigningId || DEFAULT_SIGNING_ID;
        this.keychainPath = args.keychainPath;
        this.keychainPassword = args.keychainPassword;
        this.usePrebuiltWDA = args.usePrebuiltWDA;
        this.useSimpleBuildTest = args.useSimpleBuildTest;
        this.useXctestrunFile = args.useXctestrunFile;
        this.launchTimeout = args.launchTimeout;
        this.wdaRemotePort = args.wdaRemotePort;
        this.wdaBindingIP = args.wdaBindingIP;
        this.updatedWDABundleId = args.updatedWDABundleId;
        this.derivedDataPath = args.derivedDataPath;
        this.mjpegServerPort = args.mjpegServerPort;
        this.prebuildDelay =
            typeof args.prebuildDelay === 'number' ? args.prebuildDelay : PREBUILD_DELAY;
        this.allowProvisioningDeviceRegistration = args.allowProvisioningDeviceRegistration;
        this.resultBundlePath = args.resultBundlePath;
        this.resultBundleVersion = args.resultBundleVersion;
        this._didBuildFail = false;
        this._didProcessExit = false;
    }
    /**
     * Initializes the XcodeBuild instance with a no-session proxy.
     * Sets up xctestrun file if needed.
     * @param noSessionProxy - The proxy instance for WDA communication
     */
    async init(noSessionProxy) {
        this.noSessionProxy = noSessionProxy;
        if (this.useXctestrunFile) {
            const deviceInfo = {
                isRealDevice: !!this.realDevice,
                udid: this.device.udid,
                platformVersion: this.platformVersion || '',
                platformName: this.platformName || '',
            };
            this.xctestrunFilePath = await (0, utils_1.setXctestrunFile)({
                deviceInfo,
                sdkVersion: this.iosSdkVersion || '',
                bootstrapPath: this.bootstrapPath,
                wdaRemotePort: this.wdaRemotePort || 8100,
                wdaBindingIP: this.wdaBindingIP,
            });
            return;
        }
    }
    /**
     * Retrieves Xcode build settings via `xcodebuild -showBuildSettings -json`.
     * @param options - Optional scheme, SDK, configuration, or destination
     * @returns Build settings for the `build` action, or `undefined` if they cannot be determined
     */
    async retrieveBuildSettings(options) {
        const cacheKey = buildSettingsCacheKey(options);
        let promise = this._buildSettingsPromises.get(cacheKey);
        if (!promise) {
            promise = this.fetchBuildSettings(options);
            this._buildSettingsPromises.set(cacheKey, promise);
        }
        return await promise;
    }
    /**
     * @returns The derived data path, or `undefined` if it cannot be determined
     */
    async retrieveDerivedDataPath() {
        if (this.derivedDataPath) {
            return this.derivedDataPath;
        }
        // iOS/tvOS share the same derived data path
        const buildSettings = await this.retrieveBuildSettings({
            scheme: 'WebDriverAgentRunner',
        });
        const buildDir = buildSettings?.BUILD_DIR;
        if (!buildDir) {
            this.log.warn('Cannot parse WDA BUILD_DIR from build settings');
            return;
        }
        this.log.debug(`Parsed BUILD_DIR configuration value: '${buildDir}'`);
        // Derived data root is two levels higher over the build dir
        this.derivedDataPath = node_path_1.default.dirname(node_path_1.default.dirname(node_path_1.default.normalize(buildDir)));
        this.log.debug(`Got derived data root: '${this.derivedDataPath}'`);
        return this.derivedDataPath;
    }
    /**
     * Pre-builds WebDriverAgent before launching tests.
     * Performs a build-only operation and sets usePrebuiltWDA flag.
     */
    async prebuild() {
        // first do a build phase
        this.log.debug('Pre-building WDA before launching test');
        this.usePrebuiltWDA = true;
        await this.start(true);
        if (this.prebuildDelay > 0) {
            // pause a moment
            await new Promise((resolve) => setTimeout(resolve, this.prebuildDelay));
        }
    }
    /**
     * Cleans the Xcode project to remove leftovers from previous installs.
     * Cleans both the library and runner schemes for the appropriate platform.
     */
    async cleanProject() {
        const libScheme = (0, utils_1.isTvOS)(this.platformName || '') ? LIB_SCHEME_TV : LIB_SCHEME_IOS;
        const runnerScheme = (0, utils_1.isTvOS)(this.platformName || '') ? RUNNER_SCHEME_TV : RUNNER_SCHEME_IOS;
        for (const scheme of [libScheme, runnerScheme]) {
            this.log.debug(`Cleaning the project scheme '${scheme}' to make sure there are no leftovers from previous installs`);
            await (0, teen_process_1.exec)('xcodebuild', ['clean', '-project', this.agentPath, '-scheme', scheme]);
        }
    }
    /**
     * Starts the xcodebuild process to build and/or test WebDriverAgent.
     * @param buildOnly - If `true`, only builds without running tests. Defaults to `false`.
     * @returns The WDA status record if tests are run, `void` if build-only
     * @throws Error if xcodebuild fails or cannot start
     */
    async start(buildOnly = false) {
        this.xcodebuild = await this.createSubProcess(buildOnly);
        // wrap the start procedure in a promise so that we can catch, and report,
        // any startup errors that are thrown as events
        if (!this.xcodebuild) {
            throw new Error('xcodebuild subprocess was not created');
        }
        const xcodebuild = this.xcodebuild;
        return await new Promise((resolve, reject) => {
            xcodebuild.once('exit', (code, signal) => {
                xcodeLog.error(`xcodebuild exited with code '${code}' and signal '${signal}'`);
                xcodebuild.removeAllListeners();
                this._didProcessExit = true;
                if (this._didBuildFail || (!signal && code !== 0)) {
                    let errorMessage = `xcodebuild failed with code ${code}.` +
                        ` This usually indicates an issue with the local Xcode setup or WebDriverAgent` +
                        ` project configuration or the driver-to-platform version mismatch.`;
                    if (!this.showXcodeLog) {
                        errorMessage +=
                            ` Consider setting 'showXcodeLog' capability to true in` +
                                ` order to check the Appium server log for build-related error messages.`;
                    }
                    else if (this.realDevice) {
                        errorMessage +=
                            ` Consider checking the WebDriverAgent configuration guide` +
                                ` for real iOS devices at ${REAL_DEVICES_CONFIG_DOCS_LINK}.`;
                    }
                    return reject(new Error(errorMessage));
                }
                // in the case of just building, the process will exit and that is our finish
                if (buildOnly) {
                    return resolve();
                }
            });
            return (async () => {
                try {
                    const timer = new support_1.timing.Timer().start();
                    if (!xcodebuild) {
                        throw new Error('xcodebuild subprocess was not created');
                    }
                    await xcodebuild.start(true);
                    if (!buildOnly) {
                        const result = await this.waitForStart(timer);
                        resolve(result ?? undefined);
                    }
                }
                catch (err) {
                    const msg = `Unable to start WebDriverAgent: ${err}`;
                    this.log.error(msg);
                    reject(new Error(msg));
                }
            })();
        });
    }
    /**
     * Stops the xcodebuild process and cleans up resources.
     */
    async quit() {
        await (0, utils_1.killProcess)('xcodebuild', this.xcodebuild);
    }
    async fetchBuildSettings(options) {
        const schemeLabel = options?.scheme ?? 'default';
        let stdout;
        try {
            ({ stdout } = await (0, teen_process_1.exec)('xcodebuild', [
                '-project',
                this.agentPath,
                '-showBuildSettings',
                '-json',
                ...buildSettingsArgsFromOptions(options),
            ]));
        }
        catch (err) {
            this.log.warn(`Cannot retrieve WDA build settings for scheme '${schemeLabel}'. Original error: ${err.message}`);
            return;
        }
        let entries;
        try {
            entries = JSON.parse(stdout);
        }
        catch (err) {
            this.log.warn(`Cannot parse WDA build settings for scheme '${schemeLabel}' from ${(0, utils_1.truncateString)(stdout, 300)}. ` +
                `Original error: ${err.message}`);
            return;
        }
        const entry = entries.find(({ action }) => action === 'build') ?? entries[0];
        if (!entry?.buildSettings) {
            this.log.warn(`Cannot find build settings for scheme '${schemeLabel}'`);
            return;
        }
        return entry.buildSettings;
    }
    getCommand(buildOnly = false) {
        const cmd = 'xcodebuild';
        const args = [];
        // figure out the targets for xcodebuild
        const [buildCmd, testCmd] = this.useSimpleBuildTest
            ? ['build', 'test']
            : ['build-for-testing', 'test-without-building'];
        if (buildOnly) {
            args.push(buildCmd);
        }
        else if (this.usePrebuiltWDA || this.useXctestrunFile) {
            args.push(testCmd);
        }
        else {
            args.push(buildCmd, testCmd);
        }
        if (this.allowProvisioningDeviceRegistration) {
            // To -allowProvisioningDeviceRegistration flag takes effect, -allowProvisioningUpdates needs to be passed as well.
            args.push('-allowProvisioningUpdates', '-allowProvisioningDeviceRegistration');
        }
        if (this.resultBundlePath) {
            args.push('-resultBundlePath', this.resultBundlePath);
        }
        if (this.resultBundleVersion) {
            args.push('-resultBundleVersion', this.resultBundleVersion);
        }
        if (this.useXctestrunFile && this.xctestrunFilePath) {
            args.push('-xctestrun', this.xctestrunFilePath);
        }
        else {
            const runnerScheme = (0, utils_1.isTvOS)(this.platformName || '') ? RUNNER_SCHEME_TV : RUNNER_SCHEME_IOS;
            args.push('-project', this.agentPath, '-scheme', runnerScheme);
            if (this.derivedDataPath) {
                args.push('-derivedDataPath', this.derivedDataPath);
            }
        }
        args.push('-destination', `id=${this.device.udid}`);
        const versionMatch = this.platformVersion
            ? new RegExp(/^(\d+)\.(\d+)/).exec(this.platformVersion)
            : null;
        if (versionMatch) {
            args.push(`${(0, utils_1.isTvOS)(this.platformName || '') ? 'TV' : 'IPHONE'}OS_DEPLOYMENT_TARGET=${versionMatch[1]}.${versionMatch[2]}`);
        }
        else {
            this.log.warn(`Cannot parse major and minor version numbers from platformVersion "${this.platformVersion}". ` +
                'Will build for the default platform instead');
        }
        if (this.realDevice) {
            if (this.xcodeConfigFile) {
                this.log.debug(`Using Xcode configuration file: '${this.xcodeConfigFile}'`);
                args.push('-xcconfig', this.xcodeConfigFile);
            }
            if (this.xcodeOrgId && this.xcodeSigningId) {
                args.push(`DEVELOPMENT_TEAM=${this.xcodeOrgId}`, `CODE_SIGN_IDENTITY=${this.xcodeSigningId}`);
            }
            if (this.updatedWDABundleId) {
                args.push(`PRODUCT_BUNDLE_IDENTIFIER=${this.updatedWDABundleId}`);
            }
        }
        if (!process.env.APPIUM_XCUITEST_TREAT_WARNINGS_AS_ERRORS) {
            // This sometimes helps to survive Xcode updates
            args.push('GCC_TREAT_WARNINGS_AS_ERRORS=0');
        }
        // Below option slightly reduces build time in debug build
        // with preventing to generate `/Index/DataStore` which is used by development
        args.push('COMPILER_INDEX_STORE_ENABLE=NO');
        return { cmd, args };
    }
    async createSubProcess(buildOnly = false) {
        if (!this.useXctestrunFile && this.realDevice) {
            if (this.keychainPath && this.keychainPassword) {
                await (0, utils_1.setRealDeviceSecurity)(this.keychainPath, this.keychainPassword);
            }
        }
        const { cmd, args } = this.getCommand(buildOnly);
        this.log.debug(`Beginning ${buildOnly ? 'build' : 'test'} with command '${cmd} ${args.join(' ')}' ` +
            `in directory '${this.bootstrapPath}'`);
        const env = Object.assign({}, process.env, {
            USE_PORT: this.wdaRemotePort,
            WDA_PRODUCT_BUNDLE_IDENTIFIER: this.updatedWDABundleId || constants_1.WDA_RUNNER_BUNDLE_ID,
        });
        if (this.mjpegServerPort) {
            // https://github.com/appium/WebDriverAgent/pull/105
            env.MJPEG_SERVER_PORT = this.mjpegServerPort;
        }
        if (this.wdaBindingIP) {
            env.USE_IP = this.wdaBindingIP;
        }
        const upgradeTimestamp = await (0, utils_1.getWDAUpgradeTimestamp)();
        if (upgradeTimestamp) {
            env.UPGRADE_TIMESTAMP = upgradeTimestamp;
        }
        this._didBuildFail = false;
        const xcodebuild = new teen_process_1.SubProcess(cmd, args, {
            cwd: this.bootstrapPath,
            env,
            detached: true,
            stdio: ['ignore', 'pipe', 'pipe'],
        });
        let logXcodeOutput = !!this.showXcodeLog;
        const logMsg = typeof this.showXcodeLog === 'boolean'
            ? `Output from xcodebuild ${this.showXcodeLog ? 'will' : 'will not'} be logged`
            : 'Output from xcodebuild will only be logged if any errors are present there';
        this.log.debug(`${logMsg}. To change this, use 'showXcodeLog' desired capability`);
        const onStreamLine = (line) => {
            if (this.showXcodeLog === false || IGNORED_ERRORS_PATTERN.test(line)) {
                return;
            }
            // if we have an error we want to output the logs
            // otherwise the failure is inscrutible
            // but do not log permission errors from trying to write to attachments folder
            if (line.includes('Error Domain=')) {
                logXcodeOutput = true;
                // handle case where xcode returns 0 but is failing
                this._didBuildFail = true;
            }
            if (logXcodeOutput) {
                xcodeLog.info(line);
            }
        };
        for (const streamName of ['stderr', 'stdout']) {
            xcodebuild.on(`line-${streamName}`, onStreamLine);
        }
        return xcodebuild;
    }
    async waitForStart(timer) {
        // try to connect once every 0.5 seconds, until `launchTimeout` is up
        const timeout = this.launchTimeout || 60000; // Default to 60 seconds if not set
        this.log.debug(`Waiting up to ${timeout}ms for WebDriverAgent to start`);
        let currentStatus = null;
        try {
            const retries = Math.trunc(timeout / 500);
            if (!this.noSessionProxy) {
                throw new Error('noSessionProxy was not initialized');
            }
            const noSessionProxy = this.noSessionProxy;
            await (0, asyncbox_1.retryInterval)(retries, 1000, async () => {
                if (this._didProcessExit) {
                    // there has been an error elsewhere and we need to short-circuit
                    return currentStatus;
                }
                const proxyTimeout = noSessionProxy.timeout;
                noSessionProxy.timeout = 1000;
                try {
                    currentStatus = (await noSessionProxy.command('/status', 'GET'));
                    this.log.debug(`WebDriverAgent information:`);
                    this.log.debug(JSON.stringify(currentStatus, null, 2));
                }
                catch (err) {
                    throw new Error(`Unable to connect to running WebDriverAgent: ${err.message}`, {
                        cause: err,
                    });
                }
                finally {
                    noSessionProxy.timeout = proxyTimeout;
                }
            });
            if (this._didProcessExit) {
                // there has been an error elsewhere and we need to short-circuit
                return currentStatus;
            }
            this.log.debug(`WebDriverAgent successfully started after ${timer.getDuration().asMilliSeconds.toFixed(0)}ms`);
        }
        catch (err) {
            this.log.debug(err.stack);
            throw new Error(`We were not able to retrieve the /status response from the WebDriverAgent server after ${timeout}ms timeout.` +
                `Try to increase the value of 'appium:wdaLaunchTimeout' capability as a possible workaround.`, { cause: err });
        }
        return currentStatus;
    }
}
exports.XcodeBuild = XcodeBuild;
function buildSettingsArgsFromOptions(options) {
    const args = [];
    if (!options) {
        return args;
    }
    if (options.scheme) {
        args.push('-scheme', options.scheme);
    }
    if (options.sdk) {
        args.push('-sdk', options.sdk);
    }
    if (options.configuration) {
        args.push('-configuration', options.configuration);
    }
    if (options.destination) {
        args.push('-destination', options.destination);
    }
    return args;
}
function buildSettingsCacheKey(options) {
    return buildSettingsArgsFromOptions(options).join('\0');
}
//# sourceMappingURL=xcodebuild.js.map