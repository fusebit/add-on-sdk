const Superagent = require('superagent');
const Url = require('url');
const Mock = require('mock-http');

function debug() {
    if (+process.env.debug) {
        console.log.apply(console, arguments);
    }
}

function validateReturnTo(ctx) {
    if (ctx.query.returnTo) {
        const validReturnTo = (ctx.configuration.fusebit_allowed_return_to || '').split(',');
        const match = validReturnTo.find((allowed) => {
            if (allowed === ctx.query.returnTo) {
                return true;
            }
            if (allowed[allowed.length - 1] === '*' && ctx.query.returnTo.indexOf(allowed.substring(0, allowed.length - 1)) === 0) {
                return true;
            }
            return false;
        });
        if (!match) {
            throw {
                status: 403,
                message: `The specified 'returnTo' URL '${ctx.query.returnTo}' does not match any of the allowed returnTo URLs of the '${ctx.boundaryId}/${ctx.functionId}' Fusebit Add-On component. If this is a valid request, add the specified 'returnTo' URL to the 'fusebit_allowed_return_to' configuration property of the '${ctx.boundaryId}/${ctx.functionId}' Fusebit Add-On component.`,
            };
        }
    }
}

exports.debug = debug;

exports.createSettingsManager = (configure, disableDebug) => {
    const { states, initialState } = configure;
    return async (ctx) => {
        if (!disableDebug) {
            debug('DEBUGGING ENABLED. To disable debugging information, comment out the `debug` configuration setting.');
            debug('NEW REQUEST', ctx.method, ctx.url, ctx.query, ctx.body);
        }
        try {
            // Configuration request
            validateReturnTo(ctx);
            let [state, data] = exports.getInputs(ctx, initialState || 'none');
            debug('STATE', state);
            debug('DATA', data);
            if (ctx.query.status === 'error') {
                // This is a callback from a subordinate service that resulted in an error; propagate
                throw { status: data.status || 500, message: data.message || 'Unspecified error', state };
            }
            let stateHandler = states[state.configurationState];
            if (stateHandler) {
                return await stateHandler(ctx, state, data);
            } else {
                throw { status: 400, message: `Unsupported configuration state '${state.configurationState}'`, state };
            }
        } catch (e) {
            return exports.completeWithError(ctx, e);
        }
    };
};

exports.createLifecycleManager = (options) => {
    const { configure, install, uninstall } = options;
    return async (ctx) => {
        debug('DEBUGGING ENABLED. To disable debugging information, comment out the `debug` configuration setting.');
        debug('NEW REQUEST', ctx.method, ctx.url, ctx.query, ctx.body);
        const pathSegments = Url.parse(ctx.url).pathname.split('/');
        let lastSegment;
        do {
            lastSegment = pathSegments.pop();
        } while (!lastSegment && pathSegments.length > 0);
        try {
            switch (lastSegment) {
                case 'configure': // configuration
                    if (configure) {
                        // There is a configuration stage, process the next step in the configuration
                        validateReturnTo(ctx);
                        const settingsManager = exports.createSettingsManager(configure, true);
                        return await settingsManager(ctx);
                    } else {
                        // There is no configuration stage, simply redirect back to the caller with success
                        validateReturnTo(ctx);
                        let [state, data] = exports.getInputs(ctx, (configure && configure.initialState) || 'none');
                        return exports.completeWithSuccess(state, data);
                    }
                    break;
                case 'install': // installation
                    if (!install) {
                        throw { status: 404, message: 'Not found' };
                    }
                    return await install(ctx);
                case 'uninstall': // uninstallation
                    if (!uninstall) {
                        throw { status: 404, message: 'Not found' };
                    }
                    return await uninstall(ctx);
                default:
                    throw { status: 404, message: 'Not found' };
            }
        } catch (e) {
            return exports.completeWithError(ctx, e);
        }
    };
};

exports.serializeState = (state) => Buffer.from(JSON.stringify(state)).toString('base64');

exports.deserializeState = (state) => JSON.parse(Buffer.from(state, 'base64').toString());

exports.getInputs = (ctx, initialConfigurationState) => {
    let data;
    try {
        data = ctx.query.data ? exports.deserializeState(ctx.query.data) : {};
    } catch (e) {
        throw { status: 400, message: `Malformed 'data' parameter` };
    }
    if (ctx.query.returnTo) {
        // Initialization of the add-on component interaction
        if (!initialConfigurationState) {
            throw {
                status: 400,
                message: `State consistency error. Initial configuration state is not specified, and 'state' parameter is missing.`,
            };
        }
        ['baseUrl', 'accountId', 'subscriptionId', 'boundaryId', 'functionId', 'templateName'].forEach((p) => {
            if (!data[p]) {
                throw { status: 400, message: `Missing 'data.${p}' input parameter`, state: ctx.query.state };
            }
        });
        return [
            {
                configurationState: initialConfigurationState,
                returnTo: ctx.query.returnTo,
                returnToState: ctx.query.state,
            },
            data,
        ];
    } else if (ctx.query.state) {
        // Continuation of the add-on component interaction (e.g. form post from a settings manager)
        try {
            return [JSON.parse(Buffer.from(ctx.query.state, 'base64').toString()), data];
        } catch (e) {
            throw { status: 400, message: `Malformed 'state' parameter` };
        }
    } else {
        throw { status: 400, message: `Either the 'returnTo' or 'state' parameter must be present.` };
    }
};

exports.completeWithSuccess = (state, data) => {
    const location =
        `${state.returnTo}?status=success&data=${encodeURIComponent(exports.serializeState(data))}` +
        (state.returnToState ? `&state=${encodeURIComponent(state.returnToState)}` : '');
    return { status: 302, headers: { location } };
};

exports.completeWithError = (ctx, error) => {
    debug('COMPLETE WITH ERROR', error);
    let returnTo = (error.state && error.state.returnTo) || ctx.query.returnTo;
    let state = (error.state && error.state.returnToState) || (ctx.query.returnTo && ctx.query.state);
    let body = { status: error.status || 500, message: error.message };
    if (returnTo) {
        const location =
            `${returnTo}?status=error&data=${encodeURIComponent(exports.serializeState(body))}` +
            (state ? `&state=${encodeURIComponent(state)}` : '');
        return { status: 302, headers: { location } };
    } else {
        return { status: body.status, body };
    }
};

exports.getSelfUrl = (ctx) => {
    return ctx.baseUrl;
};

exports.redirect = (ctx, state, data, redirectUrl, nextConfigurationState) => {
    state.configurationState = nextConfigurationState;

    const location = `${redirectUrl}?returnTo=${`${exports.getSelfUrl(ctx)}/configure`}&state=${encodeURIComponent(
        exports.serializeState(state)
    )}&data=${encodeURIComponent(exports.serializeState(data))}`;

    return { status: 302, headers: { location } };
};

exports.createFunction = async (ctx, functionSpecification, accessToken) => {
    let functionCreated = false;
    const accessTokenHeader = `Bearer ${accessToken}`;
    try {
        // Create the function
        let url = `${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/subscription/${ctx.body.subscriptionId}/boundary/${ctx.body.boundaryId}/function/${ctx.body.functionId}`;
        let response = await Superagent.put(url).set('Authorization', accessTokenHeader).send(functionSpecification);
        functionCreated = true;

        // Wait for the function to be built and ready
        let attempts = 15;
        while (response.status === 201 && attempts > 0) {
            response = await Superagent.get(
                `${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/subscription/${ctx.body.subscriptionId}/boundary/${ctx.body.boundaryId}/function/${ctx.body.functionId}/build/${response.body.buildId}`
            ).set('Authorization', accessTokenHeader);
            if (response.status === 200) {
                if (response.body.status === 'success') {
                    break;
                } else {
                    throw new Error(
                        `Failure creating function: ${(response.body.error && response.body.error.message) || 'Unknown error'}`
                    );
                }
            }
            await new Promise((resolve) => setTimeout(resolve, 2000));
            attempts--;
        }
        if (attempts === 0) {
            throw new Error(`Timeout creating function`);
        }

        if (response.status === 204 || (response.body && response.body.status === 'success')) {
            if (response.body && response.body.location) {
                return response.body.location;
            } else {
                response = await Superagent.get(
                    `${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/subscription/${ctx.body.subscriptionId}/boundary/${ctx.body.boundaryId}/function/${ctx.body.functionId}/location`
                ).set('Authorization', accessTokenHeader);
                if (response.body && response.body.location) {
                    return response.body.location;
                }
            }
        }
        throw response.body;
    } catch (e) {
        if (functionCreated) {
            try {
                await exports.deleteFunction(ctx, accessToken);
            } catch (_) {}
        }
        throw e;
    }
};

exports.deleteFunction = async (ctx, accessToken, boundaryId, functionId) => {
    await Superagent.delete(
        `${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/subscription/${ctx.body.subscriptionId}/boundary/${
            boundaryId || ctx.body.boundaryId
        }/function/${functionId || ctx.body.functionId}`
    )
        .set('Authorization', `Bearer ${accessToken}`)
        .ok((res) => res.status === 204 || res.status === 404);
};

exports.getFunctionDefinition = async (ctx, accessToken, boundaryId, functionId) => {
    const response = await Superagent.get(
        `${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/subscription/${ctx.body.subscriptionId}/boundary/${
            boundaryId || ctx.body.boundaryId
        }/function/${functionId || ctx.body.functionId}`
    ).set('Authorization', `Bearer ${accessToken}`);

    return response.body;
};

exports.getFunctionUrl = async (ctx, accessToken, boundaryId, functionId) => {
    const response = await Superagent.get(
        `${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/subscription/${ctx.body.subscriptionId}/boundary/${
            boundaryId || ctx.body.boundaryId
        }/function/${functionId || ctx.body.functionId}/location`
    ).set('Authorization', `Bearer ${accessToken}`);

    return response.body.location;
};

const removeLeadingSlash = (s) => s.replace(/^\/(.+)$/, '$1');
const removeTrailingSlash = (s) => s.replace(/^(.+)\/$/, '$1');

exports.createStorageClient = async (ctx, accessToken, storageIdPrefix) => {
    storageIdPrefix = storageIdPrefix ? removeLeadingSlash(removeTrailingSlash(storageIdPrefix)) : '';
    const functionUrl = Url.parse(ctx.baseUrl);
    let storageBaseUrl = `${functionUrl.protocol}//${functionUrl.host}/v1/account/${ctx.accountId}/subscription/${
        ctx.subscriptionId
    }/storage${storageIdPrefix ? '/' + storageIdPrefix : ''}`;

    const getUrl = (storageSubId) => {
        storageSubId = storageSubId ? removeTrailingSlash(removeLeadingSlash(storageSubId)) : '';
        return `${storageBaseUrl}${storageSubId ? '/' + storageSubId : ''}`;
    };

    const storageClient = {
        get: async function (storageSubId) {
            storageSubId = storageSubId ? removeTrailingSlash(removeLeadingSlash(storageSubId)) : '';
            if (!storageSubId && !storageIdPrefix) {
                return undefined;
            }
            const response = await Superagent.get(getUrl(storageSubId))
                .set('Authorization', `Bearer ${accessToken}`)
                .ok((res) => res.status < 300 || res.status === 404);
            return response.status === 404 ? undefined : response.body;
        },
        put: async function (data, storageSubId) {
            storageSubId = storageSubId ? removeTrailingSlash(removeLeadingSlash(storageSubId)) : '';
            if (!storageSubId && !storageIdPrefix) {
                throw new Error(
                    'Storage objects cannot be stored at the root of the hierarchy. Specify a storageSubId when calling the `put` method, or a storageIdPrefix when creating the storage client.'
                );
            }
            const response = await Superagent.put(getUrl(storageSubId)).set('Authorization', `Bearer ${accessToken}`).send(data);
            return response.body;
        },
        delete: async function (storageSubId, recursive, forceRecursive) {
            storageSubId = storageSubId ? removeLeadingSlash(removeTrailingSlash(storageSubId)) : '';
            if (!storageSubId && !storageIdPrefix && recursive && !forceRecursive) {
                throw new Error(
                    'You are attempting to recursively delete all storage objects in the Fusebit subscription. If this is your intent, please pass "true" as the third parameter in the call to delete(storageSubId, recursive, forceRecursive).'
                );
            }
            await Superagent.delete(`${getUrl(storageSubId)}${recursive ? '/*' : ''}`)
                .set('Authorization', `Bearer ${accessToken}`)
                .ok((res) => res.status === 404 || res.status === 204);
            return;
        },
        list: async function (storageSubId, { count, next } = {}) {
            const response = await Superagent.get(`${getUrl(storageSubId)}/*`)
                .query(isNaN(count) ? undefined : { count })
                .query(typeof next === 'string' ? { next } : undefined)
                .set('Authorization', `Bearer ${accessToken}`);
            return response.body;
        },
    };

    return storageClient;
};

exports.createFusebitFunctionFromExpress = (app, { disableStorageClient } = {}) => {
    // See https://github.com/fusebit/samples/blob/master/express/index.js#L6
    Object.setPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(app.response)), Mock.Response.prototype);
    Object.setPrototypeOf(Object.getPrototypeOf(Object.getPrototypeOf(app.request)), Mock.Request.prototype);

    return async (ctx) => {
        debug('HTTP REQUEST', ctx.method, ctx.url, ctx.headers, ctx.body);

        if (!disableStorageClient) {
            ctx.storage = await exports.createStorageClient(
                ctx,
                ctx.fusebit.functionAccessToken,
                `boundary/${ctx.boundaryId}/function/${ctx.functionId}/root`
            );
        }

        let req = new Mock.Request({
            url: ctx.path,
            method: ctx.method,
            headers: ctx.headers,
        });
        req.query = ctx.query;
        req.fusebit = ctx;
        if (ctx.body) {
            // Simulate the body had already been parsed
            req._body = true;
            req.body = ctx.body;
        }

        return new Promise((resolve, reject) => {
            try {
                let responseFinished;
                let res = new Mock.Response({
                    onEnd: () => {
                        if (responseFinished) {
                            return;
                        }
                        responseFinished = true;
                        const responseBody = (res._internal.buffer || Buffer.from('')).toString('utf8');
                        debug('HTTP RESPONSE', res.statusCode, responseBody);
                        process.nextTick(() => {
                            resolve({
                                body: responseBody,
                                bodyEncoding: 'utf8',
                                headers: res._internal.headers,
                                status: res.statusCode,
                            });
                        });
                    },
                });

                app.handle(req, res);
            } catch (e) {
                reject(e);
            }
        });
    };
};
