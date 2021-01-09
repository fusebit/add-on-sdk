const { getCredentials, cleanup, testBoundaryId, testFunctionId1 } = require('./common');
const sdk = require('../lib');

const profile = getCredentials();

const storageCtx = {
    baseUrl: profile.baseUrl,
    accountId: profile.account,
    subscriptionId: profile.subscription,
    boundaryId: testBoundaryId,
    functionId: testFunctionId1,
};

describe('storage', () => {
    beforeAll(async () => cleanup());
    afterEach(async () => cleanup());

    test('get returns undefined if called at the root of the hierarchy', async () => {
        const storage = await sdk.createStorageClient(storageCtx, profile.accessToken);
        const result = await storage.get();
        expect(result).toBe(undefined);
    });

    test('get returns undefined if object does not exist', async () => {
        const storage = await sdk.createStorageClient(
            storageCtx,
            profile.accessToken,
            `boundary/${testBoundaryId}/function/${testFunctionId1}`
        );
        const result = await storage.get();
        expect(result).toBe(undefined);
    });

    test('put returns an error if called at the root of the hierarchy', async () => {
        const storage = await sdk.createStorageClient(storageCtx, profile.accessToken);
        const data = { foo: 'bar' };
        try {
            await storage.put({ data });
            throw new Error('No exception thrown');
        } catch (e) {
            expect(e && e.message).toMatch(/Storage objects cannot be stored at the root of the hierarchy/);
        }
    });

    test('get returns the object that was put', async () => {
        const storage = await sdk.createStorageClient(
            storageCtx,
            profile.accessToken,
            `boundary/${testBoundaryId}/function/${testFunctionId1}`
        );
        const data = { foo: 'bar' };
        const putResult = await storage.put({ data });
        expect(putResult).toBeDefined();
        expect(putResult.etag).toBeDefined();
        expect(putResult.data).toMatchObject(data);
        const getResult = await storage.get();
        expect(getResult).toBeDefined();
        expect(getResult).toMatchObject(putResult);
    });

    test("put returns an error if etags don't match", async () => {
        const storage = await sdk.createStorageClient(
            storageCtx,
            profile.accessToken,
            `boundary/${testBoundaryId}/function/${testFunctionId1}`
        );
        const data = { foo: 'bar' };
        await storage.put({ data });
        try {
            await storage.put({ data, etag: '12' });
            throw new Error('No exception thrown');
        } catch (e) {
            expect(e && e.message).toMatch(/Conflict/);
        }
    });

    test('list returns empty array if nothing was', async () => {
        const storage = await sdk.createStorageClient(storageCtx, profile.accessToken, `boundary/${testBoundaryId}/function`);
        const listResult = await storage.list();
        expect(listResult).toBeDefined();
        expect(Array.isArray(listResult.items)).toBe(true);
        expect(listResult.items.length).toBe(0);
    });

    test('list returns the object that was put', async () => {
        const storage = await sdk.createStorageClient(storageCtx, profile.accessToken, `boundary/${testBoundaryId}/function`);
        const data = { foo: 'bar' };
        await storage.put({ data }, testFunctionId1);
        const listResult = await storage.list();
        expect(listResult).toBeDefined();
        expect(Array.isArray(listResult.items)).toBe(true);
        expect(listResult.items.length).toBe(1);
        expect(listResult.items[0].storageId).toBe(`boundary/${testBoundaryId}/function/${testFunctionId1}`);
    });
});
