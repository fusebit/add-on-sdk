const Superagent = require('superagent');
const Url = require('url');
const Jwt = require('jsonwebtoken');
const uuid = require('uuid');

function debug() {
    if (process.env.debug) {
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
    const baseUrl = ctx.headers['x-forwarded-proto']
        ? `${ctx.headers['x-forwarded-proto'].split(',')[0]}://${ctx.headers.host}`
        : `${ctx.protocol}://${ctx.headers.host}`;
    return `${baseUrl}/v1/run/${ctx.subscriptionId}/${ctx.boundaryId}/${ctx.functionId}`;
};

exports.redirect = (ctx, state, data, redirectUrl, nextConfigurationState) => {
    state.configurationState = nextConfigurationState;

    const location = `${redirectUrl}?returnTo=${`${exports.getSelfUrl(ctx)}/configure`}&state=${encodeURIComponent(
        exports.serializeState(state)
    )}&data=${encodeURIComponent(exports.serializeState(data))}`;

    return { status: 302, headers: { location } };
};

function generateIssuerSubject(ctx) {
    return {
        issuerId: `uri:fusebit-template:${ctx.functionId}:${ctx.body.subscriptionId}:${ctx.body.boundaryId}:${ctx.body.functionId}`,
        subject: 'client-1',
    };
}

exports.createStorage = async (ctx, options) => {

    if (options) {
        if (!options.accessToken) {
            throw new Error('Creating storage context using a function access token requires that the caller is also in possession of the function access token.')
        }
        const storageCtx = {
            fusebit_storage_id: `boundary/${ctx.body.boundaryId}/function/${ctx.body.functionId}/root`,
            fusebit_storage_audience: ctx.body.baseUrl,
            fusebit_storage_account_id: ctx.body.accountId,
            fusebit_storage_subscription_id: ctx.body.subscriptionId,
        };
        try {
            await Superagent.get(`${generateStorageUrl(storageCtx)}/*?count=1`)
                .set('Authorization', `Bearer ${options.accessToken}`);
        }
        catch (e) {
            throw new Error(`Creating storage context that uses a function access token requires that the caller itself is in possession of a function access token with permissions to ${generateStoragePath(storageCtx)} storage id.`);
        }
        return storageCtx;
    }

    // Legacy mode - create PKI, issuer, and client with permissions to storage

    let issuerCreated = false;
    let { issuerId, subject } = generateIssuerSubject(ctx);
    let clientId;

    try {
        // Create a PKI issuer to represent the the Add-on Handler
        debug(`Creating the storage keys: ${issuerId}`);
        const keyId = 'key-1';
        const { publicKey, privateKey } = await new Promise((resolve, reject) =>
            require('crypto').generateKeyPair(
                'rsa',
                {
                    modulusLength: 512,
                    publicKeyEncoding: { format: 'pem', type: 'spki' },
                    privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
                },
                (error, publicKey, privateKey) => (error ? reject(error) : resolve({ publicKey, privateKey }))
            )
        );
        debug('Creating the issuer');
        await Superagent.post(`${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/issuer/${encodeURIComponent(issuerId)}`)
            .set('Authorization', ctx.headers['authorization']) // pass-through authorization
            .send({
                displayName: `Issuer for ${ctx.functionId} add-on handler ${ctx.body.subscriptionId}/${ctx.body.boundaryId}/${ctx.body.functionId}`,
                publicKeys: [{ keyId, publicKey }],
            });
        issuerCreated = true;
        debug('ISSUER CREATED');

        // Create a Client for the add-on handler with permissions to storage
        const storageId = uuid.v4();
        debug(`Creating the storage client: ${storageId}`);
        clientId = (
            await Superagent.post(`${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/client`)
                .set('Authorization', ctx.headers['authorization']) // pass-through authorization
                .send({
                    displayName: `Client for ${ctx.functionId} add-on handler ${ctx.body.subscriptionId}/${ctx.body.boundaryId}/${ctx.body.functionId}`,
                    identities: [{ issuerId, subject }],
                    access: {
                        allow: [
                            {
                                action: 'storage:*',
                                resource: `/account/${ctx.body.accountId}/subscription/${ctx.body.subscriptionId}/storage/${storageId}/`,
                            },
                        ],
                    },
                })
        ).body.id;
        debug('Storage successfully created');

        // Return the appropriate configuration elements for a consumer.
        return {
            fusebit_storage_key: Buffer.from(privateKey).toString('base64'),
            fusebit_storage_key_id: keyId,
            fusebit_storage_issuer_id: issuerId,
            fusebit_storage_subject: subject,
            fusebit_storage_id: storageId,
            fusebit_storage_audience: ctx.body.baseUrl,
            fusebit_storage_account_id: ctx.body.accountId,
            fusebit_storage_subscription_id: ctx.body.subscriptionId,
        };
    } catch (e) {
        if (clientId) {
            try {
                await Superagent.delete(`${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/client/${clientId}`).set(
                    'Authorization',
                    ctx.headers['authorization']
                ); // pass-through authorization
            } catch (_) {}
        }
        if (issuerCreated) {
            try {
                await Superagent.delete(`${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/issuer/${encodeURIComponent(issuerId)}`).set(
                    'Authorization',
                    ctx.headers['authorization']
                ); // pass-through authorization
            } catch (_) {}
        }
        throw e;
    }
};

function generateStoragePath(storageCtx) {
    return `/account/${storageCtx.fusebit_storage_account_id}/subscription/${storageCtx.fusebit_storage_subscription_id}/storage/${storageCtx.fusebit_storage_id}`;
}

function generateStorageUrl(storageCtx) {
    return `${storageCtx.fusebit_storage_audience}/v1/${generateStoragePath(storageCtx)}`;
}

exports.createStoragePermission = (storageCtx) => {
    return {
        action: 'storage:*',
        resource: generateStoragePath(storageCtx)
    }
};

exports.deleteStorage = async (ctx, storageCtx) => {
    debug('DELETE STORAGE');

    if (!storageCtx.fusebit_storage_id) {
        debug('Storage not configured for this function');
        return;
    }

    const issuerId = storageCtx.fusebit_storage_issuer_id;
    const subject = storageCtx.fusebit_storage_subject;
    const accountId = storageCtx.fusebit_storage_account_id;

    if (!issuerId || !subject || !accountId) {
        if (!ctx.fusebit || !ctx.fusebit.functionAccessToken) {
            throw new Error('Unable to delete storage. Function does not have a function access token and storage context does not contain credentials.');
        }
        await Superagent.delete(`${generateStorageUrl(storageCtx)}/*`)
            .set('Authorization', `Bearer ${ctx.fusebit.functionAccessToken}`);
        return;
    }

    // Legacy mode - delete storage, issuer, and client

    // Delete the storage
    debug('Deleting storage');
    await Superagent.delete(generateStorageUrl(storageCtx))
        .set('Authorization', ctx.headers['authorization']) // pass-through authorization
        .ok((r) => r.status < 300 || r.status === 404);
    debug('Deleted storage');

    // Find the client
    debug('Looking up Client ID', issuerId);
    const response = await Superagent.get(
        `${ctx.body.baseUrl}/v1/account/${accountId}/client?issuerId=${encodeURIComponent(issuerId)}&subject=${subject}&include=all`
    ).set('Authorization', ctx.headers['authorization']); // pass-through authorization
    const client = response.body.items && response.body.items[0];
    debug('Found client', client);

    if (client) {
        // Delete the client
        debug('Deleting client');
        await Superagent.delete(`${ctx.body.baseUrl}/v1/account/${accountId}/client/${client.id}`)
            .set('Authorization', ctx.headers['authorization']) // pass-through authorization
            .ok((r) => r.status < 300 || r.status === 404);
        debug('Deleted client');
    }

    // Delete the issuer
    debug('Deleting issuer', issuerId);
    await Superagent.delete(`${ctx.body.baseUrl}/v1/account/${accountId}/issuer/${encodeURIComponent(issuerId)}`)
        .set('Authorization', ctx.headers['authorization']) // pass-through authorization
        .ok((r) => r.status < 300 || r.status === 404);
    debug('Deleted issuer');
};

exports.createFunction = async (ctx, functionSpecification, accessToken) => {
    let functionCreated = false;
    const accessTokenHeader = accessToken ?  `Bearer ${accessToken}` : ctx.headers['authorization'];
    try {
        // Create the function
        let url = `${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/subscription/${ctx.body.subscriptionId}/boundary/${ctx.body.boundaryId}/function/${ctx.body.functionId}`;
        let response = await Superagent.put(url)
            .set('Authorization', accessTokenHeader) 
            .send(functionSpecification);
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
            }
            else {
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
                await exports.deleteFunction(ctx, undefined, undefined, accessToken);
            } catch (_) {}
        }
        throw e;
    }
};

exports.deleteFunction = async (ctx, boundaryId, functionId, accessToken) => {
    await Superagent.delete(
        `${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/subscription/${ctx.body.subscriptionId}/boundary/${
            boundaryId || ctx.body.boundaryId
        }/function/${functionId || ctx.body.functionId}`
    ).set('Authorization', accessToken ? `Bearer ${accessToken}` : ctx.headers['authorization'])
    .ok(res => res.status === 204 || res.status === 404);
};

exports.getFunctionDefinition = async (ctx, boundaryId, functionId) => {
    let response = await Superagent.get(
        `${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/subscription/${ctx.body.subscriptionId}/boundary/${
            boundaryId || ctx.body.boundaryId
        }/function/${functionId || ctx.body.functionId}`
    ).set('Authorization', ctx.headers['authorization']); // pass-through authorization

    return response.body;
};

exports.getFunctionUrl = async (ctx, boundaryId, functionId) => {
    let response = await Superagent.get(
        `${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/subscription/${ctx.body.subscriptionId}/boundary/${
            boundaryId || ctx.body.boundaryId
        }/function/${functionId || ctx.body.functionId}/location`
    ).set('Authorization', ctx.headers['authorization']); // pass-through authorization

    return response.body.location;
};

exports.getStorageClient = (ctx) => {
    const expiry = 60 * 16; // 15+1 min to align with Lambda lifecycle plus some buffer
    let accessToken = ctx.fusebit && ctx.fusebit.functionAccessToken;
    if (ctx.configuration.fusebit_storage_key) {
        // Legacy mode - use pre-creaeted issuer to mint the access token
        accessToken = Jwt.sign({}, Buffer.from(ctx.configuration.fusebit_storage_key, 'base64').toString('utf8'), {
            algorithm: 'RS256',
            expiresIn: expiry,
            audience: ctx.configuration.fusebit_storage_audience,
            issuer: ctx.configuration.fusebit_storage_issuer_id,
            subject: ctx.configuration.fusebit_storage_subject,
            keyid: ctx.configuration.fusebit_storage_key_id,
            header: { jwtId: Date.now().toString() },
        });
    }

    const url = generateStorageUrl(ctx.configuration);

    const isHierarchicalStorageSupported = accessToken === ctx.fusebit.functionAccessToken;

    const ensureHierarchicalStorageSupported = () => {
        if (!isHierarchicalStorageSupported) {
            throw new Error('Hierarchical storage is not supported in this function.');
        }
    }

    const getUrl = (storageSubId) => `${url}${storageSubId ? ('/' + storageSubId) : ''}`;

    const storageClient = {
        etag: null,
        expiration: Date.now() + expiry * 1000,
        get: async function (storageSubId) {
            storageSubId && ensureHierarchicalStorageSupported();
            const response = await Superagent.get(getUrl(storageSubId))
                .set('Authorization', `Bearer ${accessToken}`)
                .ok((res) => res.status < 300 || res.status === 404);
            this.etag = response.body.etag;
            return response.status === 404 ? undefined : response.body.data;
        },
        put: async function (data, force, storageSubId) {
            storageSubId && ensureHierarchicalStorageSupported();
            let request = Superagent.put(getUrl(storageSubId)).set('Authorization', `Bearer ${accessToken}`);
            let payload = { data: data };
            if (!force) {
                payload.etag = this.etag;
            }
            const response = await request.send(payload);
            this.etag = response.body.etag;
        },
        delete: async function (recursive, storageSubId) {
            (recursive || storageSubId) && ensureHierarchicalStorageSupported();
            await Superagent.delete(`${getUrl(storageSubId)}${recursive ? '/*' : ''}`)
                .set('Authorization', `Bearer ${accessToken}`);
            return;
        },
        list: async function (storageSubId) {
            ensureHierarchicalStorageSupported();
            const response = await Superagent.get(`${getUrl(storageSubId)}/*`)
                .set('Authorization', `Bearer ${accessToken}`);
            return response.body;
        }
    };

    return storageClient;
};
