const execFileSync = require('child_process').execFileSync;
const { getCredentials } = require('./common');

describe('preconditions', () => {
    test('FUSE_PROFILE is set', async () => {
        expect(process.env.FUSE_PROFILE).toBeDefined();
        expect(process.env.FUSE_PROFILE.length).toBeGreaterThan(0);
    });

    test('Fuse CLI is installed', async () => {
        const output = execFileSync('fuse', ['version', '-o', 'json']);
        const version = JSON.parse(output).version;
        expect(version).toBeDefined();
        expect(version.length).toBeGreaterThan(0);
    });

    test('Credentials can be obtained', async () => {
        const creds = getCredentials();
        expect(creds).toBeDefined();
        expect(creds.baseUrl).toBeDefined();
        expect(creds.account).toBeDefined();
        expect(creds.subscription).toBeDefined();
        expect(creds.accessToken).toBeDefined();
    });
});
