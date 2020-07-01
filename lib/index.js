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

function getStorageConfig(ctx, segment = 'fusebit-template') {
    return {
        issuerId: `uri:${segment}:${ctx.body.functionId}:${ctx.body.subscriptionId}:${ctx.body.boundaryId}:${ctx.body.functionId}`,
        subject: 'client-1',
        keyId: 'key-1',
    };
}

exports.deleteStorage = async (ctx) => {
    // Find the Client
    const cfg = getStorageConfig(ctx);

    console.log(`Acquiring client for ${cfg.body.accountId}/${cfg.issuerId}`);
    const response = await Superagent.get(
        `${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/client?issuerId=${encodeURIComponent(cfg.issuerId)}&subject=${
            cfg.subject
        }&include=all`
    ).set('Authorization', ctx.headers['authorization']); // pass-through authorization
    const client = response.body.items && response.body.items[0];

    if (client) {
        console.log(`Removing storage for ${client}`);
        // Delete the storage
        const allow = (client.access && client.access.allow) || [];
        for (var i = 0; i < allow.length; i++) {
            if (allow[i].action.indexOf('storage:') === 0) {
                console.log(`Removing ${allow[i]}`);
                try {
                    await Superagent.delete(`${ctx.body.baseUrl}/v1${allow[i].resource}`)
                        .set('Authorization', ctx.headers['authorization']) // pass-through authorization
                        .ok((r) => r.status < 300 || r.status === 404);
                } catch (_) {}
            }
        }
        // Delete the client
        console.log(`Deleting client ${client}`);
        try {
            await Superagent.delete(`${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/client/${client.id}`).set(
                'Authorization',
                ctx.headers['authorization']
            ); // pass-through authorization
        } catch (_) {}
    } else {
        console.log(`No storage client found for ${cfg.issuerId}`);
    }

    // Delete the issuer
    console.log(`Deleting issuer ${cfg.body.accountId}/${cfg.issuerId}`);
    try {
        await Superagent.delete(`${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/issuer/${encodeURIComponent(cfg.issuerId)}`).set(
            'Authorization',
            ctx.headers['authorization']
        ); // pass-through authorization
    } catch (_) {}

    return { status: 204 };
};

exports.createStorage = async (ctx) => {
    let issuerCreated = false;
    let clientId;

    const cfg = getStorageConfig();

    try {
        // Create a PKI issuer to represent the the Add-on Handler
        console.log(`Creating the storage keys: ${cfg.issuerId}`);
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

        console.log(`Creating the issuer: ${ctx.body.accountId}/${cfg.issuerId}`);
        await Superagent.post(`${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/issuer/${encodeURIComponent(cfg.issuerId)}`)
            .set('Authorization', ctx.headers['authorization']) // pass-through authorization
            .send({
                displayName: `Issuer for add-on handler ${ctx.body.subscriptionId}/${ctx.body.boundaryId}/${ctx.body.functionId}`,
                publicKeys: [{ keyId: cfg.keyId, publicKey }],
            });
        issuerCreated = true;
        console.log('Issuer created');

        // Create a Client for the add-on handler with permissions to storage
        const storageId = uuid.v4();
        console.log(`Creating the storage client: ${storageId}`);
        clientId = (
            await Superagent.post(`${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/client`)
                .set('Authorization', ctx.headers['authorization']) // pass-through authorization
                .send({
                    displayName: `Client for add-on handler ${ctx.body.subscriptionId}/${ctx.body.boundaryId}/${ctx.body.functionId}`,
                    identities: [{ issuerId: cfg.issuerId, subject: cfg.subject }],
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
        console.log('Storage successfully created');

        // Return the appropriate configuration elements for a consumer.
        return {
            fusebit_storage_key: Buffer.from(privateKey).toString('base64'),
            fusebit_storage_key_id: cfg.keyId,
            fusebit_storage_issuer_id: cfg.issuerId,
            fusebit_storage_subject: cfg.subject,
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
                await Superagent.delete(
                    `${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/issuer/${encodeURIComponent(cfg.issuerId)}`
                ).set('Authorization', ctx.headers['authorization']); // pass-through authorization
            } catch (_) {}
        }
        throw e;
    }
};

exports.createFunction = async (ctx, functionSpecification) => {
    let functionCreated = false;
    try {
        // Acquire any additional configuration elements from optional components
        let additionalCfg = {};

        // Is storage requested?
        if (functionSpecification.enableStorage) {
            delete functionSpecification.enableStorage;
            additionalCfg = await exports.createStorage(ctx);
            if (typeof functionSpecification.nodejs.files['package.json'] === 'object') {
                functionSpecification.nodejs.files['package.json'].dependencies['@fusebit/add-on-sdk'] = '*';
            } else if (typeof functionSpecification.nodejs.files['package.json'] === 'string') {
                let pkg = JSON.parse(functionSpecification.nodejs.files['package.json']);
                pkg.dependencies['@fusebit/add-on-sdk'] = '*';
                functionSpecification.nodejs.files['package.json'] = pkg;
            }
        }

        // Add the additional configuration elements to the specification
        if (functionSpecification.configurationSerialized && Object.keys(additionalCfg).length != 0) {
            functionSpecification.configurationSerialized += `# Storage configuration settings\n${Object.keys(additionalCfg)
                .sort()
                .map((k) => `${k}=${additionalCfg[k]}`)
                .join('\n')}\n`;
        } else {
            functionSpecification.configuration = { ...functionSpecification.configuration, ...additionalCfg };
        }

        // Create the function
        let url = `${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/subscription/${ctx.body.subscriptionId}/boundary/${ctx.body.boundaryId}/function/${ctx.body.functionId}`;
        let response = await Superagent.put(url)
            .set('Authorization', ctx.headers['authorization']) // pass-through authorization
            .send(functionSpecification);
        functionCreated = true;

        // Wait for the function to be built and ready
        let attempts = 15;
        while (response.status === 201 && attempts > 0) {
            response = await Superagent.get(
                `${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/subscription/${ctx.body.subscriptionId}/boundary/${ctx.body.boundaryId}/function/${ctx.body.functionId}/build/${response.body.buildId}`
            ).set('Authorization', ctx.headers['authorization']);
            if (response.status === 200) {
                if (response.body.status === 'success') {
                    return;
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
            return;
        } else {
            throw response.body;
        }
    } catch (e) {
        if (functionCreated) {
            try {
                await exports.deleteFunction(ctx);
            } catch (_) {}
        }
        throw e;
    }
};

exports.deleteFunction = async (ctx, boundaryId, functionId) => {
    await Superagent.delete(
        `${ctx.body.baseUrl}/v1/account/${ctx.body.accountId}/subscription/${ctx.body.subscriptionId}/boundary/${
            boundaryId || ctx.body.boundaryId
        }/function/${functionId || ctx.body.functionId}`
    ).set('Authorization', ctx.headers['authorization']); // pass-through authorization

    exports.deleteStorage(ctx);
};

exports.getStorageClient = (ctx) => {
    const accessToken = Jwt.sign({}, Buffer.from(ctx.configuration.fusebit_storage_key, 'base64').toString('utf8'), {
        algorithm: 'RS256',
        expiresIn: 60 * 60 * 24,
        audience: ctx.configuration.fusebit_storage_audience,
        issuer: ctx.configuration.fusebit_storage_issuer_id,
        subject: ctx.configuration.fusebit_storage_subject,
        keyid: ctx.configuration.fusebit_storage_key_id,
        header: { jwtId: Date.now().toString() },
    });

    const url = `${ctx.configuration.fusebit_storage_audience}/v1/account/${ctx.configuration.fusebit_storage_account_id}/subscription/${ctx.configuration.fusebit_storage_subscription_id}/storage/${ctx.configuration.fusebit_storage_id}`;

    return {
        get: async () => {
            const response = await Superagent.get(url)
                .set('Authorization', `Bearer ${accessToken}`)
                .ok((res) => res.status < 300 || res.status === 404);
            return response.status === 404 ? undefined : response.body.data;
        },
        put: async (data) => {
            await Superagent.put(url).set('Authorization', `Bearer ${accessToken}`).send({ data });
        },
    };
};
