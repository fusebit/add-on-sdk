const sdk = require('../lib');
const Url = require('url');
const Express = require('express');
const bodyParser = require('body-parser');

const configurationInitData = {
    baseUrl: 'https://api.fusebit.io',
    accountId: 'abc',
    subscriptionId: 'def',
    boundaryId: 'ghi',
    functionId: 'jkl',
    templateName: 'mno',
};

const configurationInitCtx = {
    method: 'GET',
    url: '/abc/dev/configure',
    query: {
        returnTo: 'https://contoso.com',
        state: 'abc',
        data: Buffer.from(JSON.stringify(configurationInitData)).toString('base64'),
    },
    configuration: {
        fusebit_allowed_return_to: '*',
    },
};

const installCtx = {
    method: 'POST',
    url: '/abc/dev/install',
    query: {},
    body: {
        configuration: configurationInitData,
        metadata: { foo: 'bar' },
    },
    configuration: {
        fusebit_allowed_return_to: '*',
    },
};

const uninstallCtx = {
    ...installCtx,
    url: '/abc/dev/uninstall',
};

const configurationInitCtxDisallowedReturnTo = {
    query: {
        returnTo: 'https://contoso.com',
        state: 'abc',
        data: Buffer.from(JSON.stringify(configurationInitData)).toString('base64'),
    },
    configuration: {
        fusebit_allowed_return_to: 'https://foo.com,https://bar.com',
    },
};

const configurationInitCtxNoAllowedReturnToDefined = {
    query: {
        returnTo: 'https://contoso.com',
        state: 'abc',
        data: Buffer.from(JSON.stringify(configurationInitData)).toString('base64'),
    },
    configuration: {},
};

const configurationInitCtxMalformedData = {
    query: {
        returnTo: 'https://contoso.com',
        state: 'abc',
        data: 'foobar',
    },
};

const configurationResumeState = {
    configurationState: 'initial',
    returnTo: configurationInitCtx.query.returnTo,
    returnToState: configurationInitCtx.query.state,
};

const configurationResumeCtx = {
    query: {
        state: Buffer.from(JSON.stringify(configurationResumeState)).toString('base64'),
        data: Buffer.from(JSON.stringify(configurationInitData)).toString('base64'),
    },
};

const configurationResumeCtxMalformedState = {
    query: {
        state: 'foobar',
        data: Buffer.from(JSON.stringify(configurationInitData)).toString('base64'),
    },
};

const configureSuccess = {
    states: {
        initial: async (ctx, state, data) => {
            data.inner = { ctx, state };
            return sdk.completeWithSuccess(state, data);
        },
    },
    initialState: 'initial',
};

const configureMissingState = {
    states: {},
    initialState: 'initial',
};

const app = Express();
app.get('/test', (req, res) => {
    res.json({ foo: 'bar', query: req.query });
});
app.post('/test', (req, res) => {
    res.json({ req: req.body });
});
app.post('/test-ctx', (req, res) => {
    res.json({ fusebit: req.fusebit });
});

const expressGetCtx = {
    method: 'GET',
    baseUrl: 'https://api.fusebit.io/v1/run/subscription/boundary/function/test',
    url: '/run/subscription/boundary/function/test',
    query: {
        a: '1',
        b: '2',
    },
    configuration: {
        c: 'd',
    },
    fusebit: {
        functionAccessToken: 'abc',
    },
};

const expressPostCtx = {
    method: 'POST',
    baseUrl: 'https://api.fusebit.io/v1/run/subscription/boundary/function/test',
    url: '/run/subscription/boundary/function/test',
    query: {
        a: '1',
        b: '2',
    },
    configuration: {
        c: 'd',
    },
    fusebit: {
        functionAccessToken: 'abc',
    },
    body: {
        foo: 'bar',
    },
    headers: {
        'content-type': 'application/json',
    },
};

const expressPostCtxCtx = {
    method: 'POST',
    baseUrl: 'https://api.fusebit.io/v1/run/subscription/boundary/function/test-ctx',
    url: '/run/subscription/boundary/function/test-ctx',
    query: {
        a: '1',
        b: '2',
    },
    configuration: {
        c: 'd',
    },
    fusebit: {
        functionAccessToken: 'abc',
    },
    body: {
        foo: 'bar',
    },
    headers: {
        'content-type': 'application/json',
    },
};

describe('api', () => {
    test('Sdk has the required exports', async () => {
        expect(typeof sdk.debug).toBe('function');
        expect(typeof sdk.createSettingsManager).toBe('function');
        expect(typeof sdk.createLifecycleManager).toBe('function');
        expect(typeof sdk.serializeState).toBe('function');
        expect(typeof sdk.deserializeState).toBe('function');
        expect(typeof sdk.getInputs).toBe('function');
        expect(typeof sdk.completeWithSuccess).toBe('function');
        expect(typeof sdk.completeWithError).toBe('function');
        expect(typeof sdk.completeWithSuccess).toBe('function');
        expect(typeof sdk.getSelfUrl).toBe('function');
        expect(typeof sdk.redirect).toBe('function');
        expect(typeof sdk.createFunction).toBe('function');
        expect(typeof sdk.deleteFunction).toBe('function');
        expect(typeof sdk.getFunctionDefinition).toBe('function');
        expect(typeof sdk.getFunctionUrl).toBe('function');
        expect(typeof sdk.createStorageClient).toBe('function');
        expect(typeof sdk.createFusebitFunctionFromExpress).toBe('function');
    });

    test('serializeState and deserializeState roundtrip the data', async () => {
        const state = { foo: 12, bar: 'baz' };
        const result = sdk.deserializeState(sdk.serializeState(state));
        expect(result).toMatchObject(state);
    });

    test('getInputs successfuly parses inputs of a flow initialization request', async () => {
        const [state, data] = sdk.getInputs(configurationInitCtx, 'initial');
        expect(state).toMatchObject(configurationResumeState);
        expect(data).toMatchObject(configurationInitData);
    });

    test('getInputs fails when data is malformed', async () => {
        expect(() => sdk.getInputs(configurationInitCtxMalformedData, 'initial')).toThrow(/Malformed 'data' parameter/);
    });

    test('getInputs fails when the data of the initialization request is missing required properties', async () => {
        ['baseUrl', 'accountId', 'subscriptionId', 'boundaryId', 'functionId', 'templateName'].forEach((p) => {
            const ctx = { ...configurationInitCtx, query: { ...configurationInitCtx.query } };
            const data = { ...configurationInitData };
            delete data[p];
            ctx.query.data = Buffer.from(JSON.stringify(data)).toString('base64');
            expect(() => sdk.getInputs(ctx, 'init')).toThrow(`Missing 'data.${p}' input parameter`);
        });
    });

    test('getInputs successfuly parses inputs of a flow continuation request', async () => {
        const [state, data] = sdk.getInputs(configurationResumeCtx, 'initial');
        expect(state).toMatchObject(configurationResumeState);
        expect(data).toMatchObject(configurationInitData);
    });

    test('getInputs fails when flow continuation request has malformed state', async () => {
        expect(() => sdk.getInputs(configurationResumeCtxMalformedState)).toThrow(/Malformed 'state' parameter/);
    });

    test('getInputs fails when neiter returnTo or state are specified', async () => {
        expect(() => sdk.getInputs({ query: {} })).toThrow(/Either the 'returnTo' or 'state' parameter must be present/);
    });

    test('createSettingsManager returns an async function', async () => {
        const manager = sdk.createSettingsManager(configureSuccess);
        expect(typeof manager).toBe('function');
        expect(manager.constructor.name).toBe('AsyncFunction');
    });

    test('settings manager returns completion from initial state', async () => {
        const manager = sdk.createSettingsManager(configureSuccess);
        const result = await manager(configurationInitCtx);
        expect(result).toBeDefined();
        expect(result.status).toBe(302);
        expect(result.headers).toBeDefined();
        expect(typeof result.headers.location).toBe('string');
        const url = Url.parse(result.headers.location, true);
        expect(url.protocol).toBe('https:');
        expect(url.host).toBe('contoso.com');
        expect(url.query.status).toBe('success');
        expect(url.query.state).toBe('abc');
        expect(url.query.data).toBeDefined();
        const data = JSON.parse(Buffer.from(url.query.data, 'base64').toString());
        expect(data).toMatchObject({
            ...configurationInitData,
            inner: {
                ctx: configurationInitCtx,
                state: configurationResumeState,
            },
        });
    });

    test('settings manager returns error when returnTo is not allowed', async () => {
        const manager = sdk.createSettingsManager(configureSuccess);
        const result = await manager(configurationInitCtxDisallowedReturnTo);
        expect(result).toBeDefined();
        expect(result.status).toBe(302);
        expect(result.headers).toBeDefined();
        expect(typeof result.headers.location).toBe('string');
        const url = Url.parse(result.headers.location, true);
        expect(url.protocol).toBe('https:');
        expect(url.host).toBe('contoso.com');
        expect(url.query.status).toBe('error');
        expect(url.query.data).toBeDefined();
        const data = JSON.parse(Buffer.from(url.query.data, 'base64').toString());
        expect(data.status).toBe(403);
        expect(data.message).toMatch(/does not match any of the allowed returnTo URLs/);
    });

    test('settings manager returns error when no allowed returnTo is defined', async () => {
        const manager = sdk.createSettingsManager(configureSuccess);
        const result = await manager(configurationInitCtxNoAllowedReturnToDefined);
        expect(result).toBeDefined();
        expect(result.status).toBe(302);
        expect(result.headers).toBeDefined();
        expect(typeof result.headers.location).toBe('string');
        const url = Url.parse(result.headers.location, true);
        expect(url.protocol).toBe('https:');
        expect(url.host).toBe('contoso.com');
        expect(url.query.status).toBe('error');
        expect(url.query.data).toBeDefined();
        const data = JSON.parse(Buffer.from(url.query.data, 'base64').toString());
        expect(data.status).toBe(403);
        expect(data.message).toMatch(/does not match any of the allowed returnTo URLs/);
    });

    test('settings manager returns error when state is invalid', async () => {
        const manager = sdk.createSettingsManager(configureMissingState);
        const result = await manager(configurationInitCtx);
        expect(result).toBeDefined();
        expect(result.status).toBe(302);
        expect(result.headers).toBeDefined();
        expect(typeof result.headers.location).toBe('string');
        const url = Url.parse(result.headers.location, true);
        expect(url.protocol).toBe('https:');
        expect(url.host).toBe('contoso.com');
        expect(url.query.status).toBe('error');
        expect(url.query.data).toBeDefined();
        const data = JSON.parse(Buffer.from(url.query.data, 'base64').toString());
        expect(data.status).toBe(400);
        expect(data.message).toMatch(/Unsupported configuration state/);
    });

    test('createLifecycleManager returns an async function', async () => {
        const manager = sdk.createLifecycleManager({});
        expect(typeof manager).toBe('function');
        expect(manager.constructor.name).toBe('AsyncFunction');
    });

    test('lifecycle manager returns completion from /configure', async () => {
        const manager = sdk.createLifecycleManager({ configure: configureSuccess });
        const result = await manager(configurationInitCtx);
        expect(result).toBeDefined();
        expect(result.status).toBe(302);
        expect(result.headers).toBeDefined();
        expect(typeof result.headers.location).toBe('string');
        const url = Url.parse(result.headers.location, true);
        expect(url.protocol).toBe('https:');
        expect(url.host).toBe('contoso.com');
        expect(url.query.status).toBe('success');
        expect(url.query.state).toBe('abc');
        expect(url.query.data).toBeDefined();
        const data = JSON.parse(Buffer.from(url.query.data, 'base64').toString());
        expect(data).toMatchObject(configurationInitData);
    });

    test('lifecycle manager returns success from /install', async () => {
        const manager = sdk.createLifecycleManager({
            install: async (ctx) => {
                return { status: 200, body: ctx.body };
            },
        });
        const result = await manager(installCtx);
        expect(result).toBeDefined();
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject(installCtx.body);
    });

    test('lifecycle manager returns success from /uninstall', async () => {
        const manager = sdk.createLifecycleManager({
            uninstall: async (ctx) => {
                return { status: 200, body: ctx.body };
            },
        });
        const result = await manager(uninstallCtx);
        expect(result).toBeDefined();
        expect(result.status).toBe(200);
        expect(result.body).toMatchObject(uninstallCtx.body);
    });

    test('createStorageClient returns the client with correct APIs', async () => {
        const storage = await sdk.createStorageClient({
            baseUrl: 'https://api.fusebit.io/foo/bar',
        });
        expect(storage).toBeDefined();
        expect(typeof storage.get).toBe('function');
        expect(storage.get.constructor.name).toBe('AsyncFunction');
        expect(typeof storage.put).toBe('function');
        expect(storage.put.constructor.name).toBe('AsyncFunction');
        expect(typeof storage.list).toBe('function');
        expect(storage.list.constructor.name).toBe('AsyncFunction');
        expect(typeof storage.delete).toBe('function');
        expect(storage.delete.constructor.name).toBe('AsyncFunction');
    });

    test('redirect returns the correct redirect', async () => {
        const ctx = { baseUrl: 'https://api.fusebit.io/foo/bar' };
        const result = sdk.redirect(ctx, 'abc', { def: 'ghj' }, 'https://redirect.com', 'nextState');
        expect(result).toBeDefined();
        expect(result.status).toBe(302);
        expect(result.headers).toBeDefined();
        expect(typeof result.headers.location).toBe('string');
        const url = Url.parse(result.headers.location, true);
        expect(url.protocol).toBe('https:');
        expect(url.host).toBe('redirect.com');
        expect(url.query.returnTo).toBe(`${ctx.baseUrl}/configure`);
        expect(url.query.state).toBe(sdk.serializeState('abc'));
        expect(url.query.data).toBe(sdk.serializeState({ def: 'ghj' }));
    });

    test('createFusebitFunctionFromExpress returns an async function', async () => {
        const handler = sdk.createFusebitFunctionFromExpress(Express());
        expect(typeof handler).toBe('function');
        expect(handler.constructor.name).toBe('AsyncFunction');
    });

    test('createFusebitFunctionFromExpress handler reponds to GET request', async () => {
        const handler = sdk.createFusebitFunctionFromExpress(app);
        const response = await handler(expressGetCtx);
        expect(response).toMatchObject({
            body: '{"foo":"bar","query":{"a":"1","b":"2"}}',
            bodyEncoding: 'utf8',
            headers: {
                'content-type': 'application/json; charset=utf-8',
            },
            status: 200,
        });
    });

    test('createFusebitFunctionFromExpress handler reponds to POST request', async () => {
        const handler = sdk.createFusebitFunctionFromExpress(app);
        const response = await handler(expressPostCtx);
        expect(response).toMatchObject({
            body: '{"req":{"foo":"bar"}}',
            bodyEncoding: 'utf8',
            headers: {
                'content-type': 'application/json; charset=utf-8',
            },
            status: 200,
        });
    });

    test('createFusebitFunctionFromExpress passes fusebit context to handler', async () => {
        const handler = sdk.createFusebitFunctionFromExpress(app);
        const response = await handler(expressPostCtxCtx);
        expect(response).toMatchObject({
            body: JSON.stringify({ fusebit: expressPostCtxCtx }),
            bodyEncoding: 'utf8',
            headers: {
                'content-type': 'application/json; charset=utf-8',
            },
            status: 200,
        });
    });
});
