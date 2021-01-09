const { getCredentials, cleanup, testBoundaryId, testFunctionId1, getFunction } = require('./common');
const sdk = require('../lib');
const Superagent = require('superagent');

const profile = getCredentials();

const functionCtx = {
    body: {
        baseUrl: profile.baseUrl,
        accountId: profile.account,
        subscriptionId: profile.subscription,
        boundaryId: testBoundaryId,
        functionId: testFunctionId1,
    },
};

const functionSpecification = {
    nodejs: {
        files: {
            'index.js': 'module.exports = async (ctx) => { return { status: 200, body: "Hello, world!" } };',
        },
    },
};

describe('function', () => {
    beforeAll(async () => cleanup());
    afterEach(async () => cleanup());

    test('createFunction works', async () => {
        const location = await sdk.createFunction(functionCtx, functionSpecification, profile.accessToken);
        expect(location).toBe(`${profile.baseUrl}/v1/run/${profile.subscription}/${testBoundaryId}/${testFunctionId1}`);
        const response = await Superagent.get(location);
        expect(response.status).toBe(200);
        expect(response.body).toBe('Hello, world!');
    });

    test('deleteFunction works', async () => {
        await sdk.createFunction(functionCtx, functionSpecification, profile.accessToken);
        await sdk.deleteFunction(functionCtx, profile.accessToken);
        const response = await getFunction(testBoundaryId, testFunctionId1);
        expect(response.status).toBe(404);
    });

    test('getFunctionUrl works', async () => {
        const location = await sdk.createFunction(functionCtx, functionSpecification, profile.accessToken);
        expect(location).toBe(`${profile.baseUrl}/v1/run/${profile.subscription}/${testBoundaryId}/${testFunctionId1}`);
        const location1 = await sdk.getFunctionUrl(functionCtx, profile.accessToken);
        expect(location).toBe(location1);
    });

    test('getFunctionDefinition works', async () => {
        await sdk.createFunction(functionCtx, functionSpecification, profile.accessToken);
        const definition = await sdk.getFunctionDefinition(functionCtx, profile.accessToken);
        expect(definition).toMatchObject(functionSpecification);
    });
});
