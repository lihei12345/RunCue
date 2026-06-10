"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.NoSessionProxy = void 0;
const base_driver_1 = require("@appium/base-driver");
class NoSessionProxy extends base_driver_1.JWProxy {
    constructor(opts = {}) {
        super(opts);
    }
    getUrlForProxy(url) {
        if (url === '') {
            url = '/';
        }
        const proxyBase = `${this.scheme}://${this.server}:${this.port}${this.base}`;
        if (new RegExp('^/').test(url)) {
            return proxyBase + url.replace(/\/$/, ''); // can't have trailing slashes
        }
        throw new Error(`Did not know what to do with url '${url}'`);
    }
}
exports.NoSessionProxy = NoSessionProxy;
//# sourceMappingURL=no-session-proxy.js.map