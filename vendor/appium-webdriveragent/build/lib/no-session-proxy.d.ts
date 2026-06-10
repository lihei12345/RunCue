import { JWProxy } from '@appium/base-driver';
import type { ProxyOptions } from '@appium/types';
export declare class NoSessionProxy extends JWProxy {
    constructor(opts?: ProxyOptions);
    getUrlForProxy(url: string): string;
}
//# sourceMappingURL=no-session-proxy.d.ts.map