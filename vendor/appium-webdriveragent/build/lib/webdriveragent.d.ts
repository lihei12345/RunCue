import { JWProxy } from '@appium/base-driver';
import type { AppiumLogger, StringRecord } from '@appium/types';
import { NoSessionProxy } from './no-session-proxy';
import { XcodeBuild } from './xcodebuild';
import type { WebDriverAgentArgs, AppleDevice, XcodeBuildSettings, RetrieveBuildSettingsOptions } from './types';
export declare class WebDriverAgent {
    bootstrapPath: string;
    agentPath: string;
    readonly args: WebDriverAgentArgs;
    readonly device: AppleDevice;
    readonly platformVersion?: string;
    readonly platformName?: string;
    readonly iosSdkVersion?: string;
    readonly host?: string;
    readonly isRealDevice: boolean;
    readonly wdaRemotePort: number;
    readonly wdaBaseUrl: string;
    readonly wdaBindingIP?: string;
    webDriverAgentUrl?: string;
    started: boolean;
    updatedWDABundleId?: string;
    noSessionProxy?: NoSessionProxy;
    jwproxy?: JWProxy;
    proxyReqRes?: any;
    private readonly log;
    private readonly wdaLocalPort?;
    private readonly prebuildWDA?;
    private readonly wdaConnectionTimeout?;
    private readonly useXctestrunFile?;
    private readonly usePrebuiltWDA?;
    private readonly mjpegServerPort?;
    private readonly wdaLaunchTimeout;
    private readonly usePreinstalledWDA?;
    private readonly updatedWDABundleIdSuffix;
    private _xcodebuild?;
    private _url?;
    /**
     * Creates a new WebDriverAgent instance.
     * @param args - Configuration arguments for WebDriverAgent
     * @param log - Optional logger instance
     */
    constructor(args: WebDriverAgentArgs, log?: AppiumLogger | null);
    /**
     * Return true if the session does not need xcodebuild.
     * @returns Whether the session needs/has xcodebuild.
     */
    get canSkipXcodebuild(): boolean;
    /**
     * Get the xcodebuild instance. Throws if not initialized.
     * @returns The XcodeBuild instance
     * @throws Error if xcodebuild is not available
     */
    get xcodebuild(): XcodeBuild;
    /**
     * Return bundle id for WebDriverAgent to launch the WDA.
     * The primary usage is with 'this.usePreinstalledWDA'.
     * It adds `.xctrunner` as suffix by default but 'this.updatedWDABundleIdSuffix'
     * lets skip it.
     *
     * @returns Bundle ID for Xctest.
     */
    get bundleIdForXctest(): string;
    /**
     * Gets the base path for the WebDriverAgent URL.
     * @returns The base path (empty string if root path)
     */
    get basePath(): string;
    /**
     * Gets the WebDriverAgent URL.
     * Constructs the URL from webDriverAgentUrl if provided, otherwise
     * builds it from wdaBaseUrl, wdaBindingIP, and wdaLocalPort.
     * @returns The parsed URL object
     */
    get url(): URL;
    /**
     * Gets whether WebDriverAgent has fully started.
     * @returns `true` if WDA has started, `false` otherwise
     */
    get fullyStarted(): boolean;
    /**
     * Sets whether WebDriverAgent has fully started.
     * @param started - `true` if WDA has started, `false` otherwise
     */
    set fullyStarted(started: boolean);
    /**
     * Sets the WebDriverAgent URL.
     * @param _url - The URL string to parse and set
     */
    set url(_url: string);
    /**
     * Cleans up obsolete cached processes from previous WDA sessions
     * that are listening on the same port but belong to different devices.
     */
    cleanupObsoleteProcesses(): Promise<void>;
    /**
    }
  
    /**
     * Return current running WDA's status like below after launching WDA
     * {
     *   "state": "success",
     *   "os": {
     *     "name": "iOS",
     *     "version": "11.4",
     *     "sdkVersion": "11.3"
     *   },
     *   "ios": {
     *     "simulatorVersion": "11.4",
     *     "ip": "172.254.99.34"
     *   },
     *   "build": {
     *     "time": "Jun 24 2018 17:08:21",
     *     "productBundleIdentifier": "com.facebook.WebDriverAgentRunner"
     *   }
     * }
     *
     * @param sessionId Launch WDA and establish the session with this sessionId
     */
    launch(sessionId: string): Promise<StringRecord | null>;
    /**
     * Checks if the WebDriverAgent source is fresh by verifying
     * that required resource files exist.
     * @returns `true` if source is fresh (all required files exist), `false` otherwise
     */
    isSourceFresh(): Promise<boolean>;
    /**
     * Stops the WebDriverAgent session and cleans up resources.
     * Handles both preinstalled WDA and xcodebuild-based sessions.
     */
    quit(): Promise<void>;
    /**
     * Retrieves Xcode build settings.
     * @param options - Optional scheme, SDK, configuration, or destination
     * @returns Build settings, or `undefined` if xcodebuild is skipped or settings cannot be determined
     */
    retrieveBuildSettings(options?: RetrieveBuildSettingsOptions): Promise<XcodeBuildSettings | undefined>;
    /**
     * @deprecated Use {@link retrieveBuildSettings} instead. Will be removed in a future release.
     * @returns The derived data path, or `undefined` if xcodebuild is skipped
     */
    retrieveDerivedDataPath(): Promise<string | undefined>;
    /**
     * Reuse running WDA if it has the same bundle id with updatedWDABundleId.
     * Or reuse it if it has the default id without updatedWDABundleId.
     *
     * @returns The WDA URL used for caching on success, or `undefined` if caching was skipped.
     */
    setupCaching(): Promise<string | undefined>;
    private setupProxies;
    private toUrl;
    private setWDAPaths;
    /**
     * Return current running WDA's status like below
     * {
     *   "state": "success",
     *   "os": {
     *     "name": "iOS",
     *     "version": "11.4",
     *     "sdkVersion": "11.3"
     *   },
     *   "ios": {
     *     "simulatorVersion": "11.4",
     *     "ip": "172.254.99.34"
     *   },
     *   "build": {
     *     "time": "Jun 24 2018 17:08:21",
     *     "productBundleIdentifier": "com.facebook.WebDriverAgentRunner"
     *   }
     * }
     *
     * @param timeoutMs If zero or negative, returns immediately. Otherwise, waits up to timeoutMs.
     */
    private getStatus;
    private _cleanupProjectIfFresh;
    /**
     * Launch WDA with preinstalled package with 'xcrun devicectl device process launch'.
     * The WDA package must be prepared properly like published via
     * https://github.com/appium/WebDriverAgent/releases
     * with proper sign for this case.
     *
     * @param opts launching WDA with devicectl command options.
     */
    private _launchViaDevicectl;
    /**
     * Launch WDA with preinstalled package without xcodebuild.
     * @param sessionId Launch WDA and establish the session with this sessionId
     */
    private launchWithPreinstalledWDA;
}
//# sourceMappingURL=webdriveragent.d.ts.map