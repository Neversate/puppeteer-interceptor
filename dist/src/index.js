"use strict";
function __export(m) {
    for (var p in m) if (!exports.hasOwnProperty(p)) exports[p] = m[p];
}
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
const atob_1 = __importDefault(require("atob"));
const btoa_1 = __importDefault(require("btoa"));
const debug_1 = __importDefault(require("debug"));
const lodash_pick_1 = __importDefault(require("lodash.pick"));
const debug = debug_1.default('puppeteer-interceptor');
__export(require("./types"));
__export(require("./request-patterns"));
class InterceptionHandler {
    constructor(page, patterns = [], eventHandlers = {}) {
        this.patterns = [];
        this.eventHandlers = {};
        this.disabled = false;
        this.page = page;
        this.patterns = patterns;
        this.eventHandlers = eventHandlers;
    }
    disable() {
        this.disabled = true;
    }
    enable() {
        this.disabled = false;
    }
    async initialize() {
        const client = await this.page.target().createCDPSession();
        await client.send('Fetch.enable', { patterns: this.patterns });
        client.on('Fetch.requestPaused', async (event) => {
            const { requestId, request } = event;
            if (this.disabled) {
                debug(`Interception handler disabled, continuing request.`);
                await client.send('Fetch.continueRequest', { requestId });
                return;
            }
            debug(`Request ${event.request.url} (${requestId}) paused.`);
            if (this.eventHandlers.onInterception) {
                let errorReason = 'Aborted';
                let shouldContinue = true;
                let fulfill = undefined;
                const control = {
                    abort: (msg) => {
                        shouldContinue = false;
                        errorReason = msg;
                    },
                    fulfill: (responseCode, responseOptions) => {
                        const fulfillOptions = {
                            requestId,
                            responseCode,
                        };
                        if (responseOptions) {
                            const keys = ['body', 'binaryResponseHeaders', 'responseHeaders', 'responsePhrase'];
                            Object.assign(fulfillOptions, lodash_pick_1.default(responseOptions, keys));
                            if (fulfillOptions.body)
                                fulfillOptions.body = btoa_1.default(fulfillOptions.body);
                            if (responseOptions.encodedBody)
                                fulfillOptions.body = responseOptions.encodedBody;
                        }
                        fulfill = async () => {
                            debug(`Fulfilling request ${requestId} with responseCode "${responseCode}"`);
                            await client.send('Fetch.fulfillRequest', fulfillOptions);
                        };
                    },
                };
                await this.eventHandlers.onInterception(event, control);
                if (!shouldContinue) {
                    debug(`Aborting request ${requestId} with reason "${errorReason}"`);
                    await client.send('Fetch.failRequest', { requestId, errorReason });
                    return;
                }
                else if (fulfill) {
                    await fulfill();
                    return;
                }
            }
            let newResponse = null;
            if (this.eventHandlers.onResponseReceived) {
                if (!event.responseStatusCode) {
                    debug(`Warning: onResponseReceived handler passed but ${requestId} intercepted at Request stage. Handler can not be called.`);
                }
                else if (event.responseStatusCode != 200) {
                    debug(`Warning: onResponseReceived handler passed but status code of response was ${event.responseStatusCode}. Not handling response.`);
                }
                else {
                    const responseCdp = (await client.send('Fetch.getResponseBody', {
                        requestId,
                    }));
                    const response = {
                        body: responseCdp.base64Encoded ? atob_1.default(responseCdp.body) : responseCdp.body,
                        headers: event.responseHeaders,
                        errorReason: event.responseErrorReason,
                        statusCode: event.responseStatusCode,
                    };
                    newResponse = await this.eventHandlers.onResponseReceived({ response, request });
                }
            }
            if (newResponse) {
                debug(`Fulfilling request ${requestId} with response returned from onResponseReceived`);
                await client.send('Fetch.fulfillRequest', {
                    requestId,
                    responseCode: newResponse.statusCode,
                    responseHeaders: newResponse.headers,
                    body: newResponse.base64Body ? newResponse.base64Body : btoa_1.default(newResponse.body),
                    responsePhrase: newResponse.statusMessage,
                }).catch(e => null);
            }
            else {
                await client.send('Fetch.continueRequest', { requestId });
            }
        });
    }
}
exports.InterceptionHandler = InterceptionHandler;
async function intercept(page, patterns = [], eventHandlers = {}) {
    debug(`Registering interceptors for ${patterns.length} patterns`);
    const interceptionHandler = new InterceptionHandler(page, patterns, eventHandlers);
    await interceptionHandler.initialize();
    return interceptionHandler;
}
exports.intercept = intercept;
//# sourceMappingURL=index.js.map