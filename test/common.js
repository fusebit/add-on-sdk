const execFileSync = require('child_process').execFileSync;
const Url = require('url');
const Uuid = require('uuid');
const Superagent = require('superagent');

exports.testBoundaryId = `test-${Uuid.v4()}`;
exports.testFunctionId1 = `function1`;

let credentials;
exports.getCredentials = () => {
    if (!credentials) {
        const profile = JSON.parse(execFileSync('fuse', ['profile', 'get', process.env.FUSE_PROFILE, '-o', 'json']));
        profile.accessToken = execFileSync('fuse', ['token', '-p', process.env.FUSE_PROFILE, '-o', 'raw']).toString('utf8').trim();
        credentials = profile;
    }
    return credentials;
};

exports.sleep = async (ms) => {
    return new Promise((resolve) => setTimeout(() => resolve(), ms));
};

exports.cleanup = async () => {
    const profile = exports.getCredentials();
    const urlPrefix = `${profile.baseUrl}/v1/account/${profile.account}/subscription/${profile.subscription}`;
    await Superagent.delete(`${urlPrefix}/boundary/${exports.testBoundaryId}/function/${exports.testFunctionId1}`)
        .set('Authorization', `Bearer ${profile.accessToken}`)
        .ok((res) => res.status === 204 || res.status === 404);
    await Superagent.delete(`${urlPrefix}/storage/boundary/${exports.testBoundaryId}/function/${exports.testFunctionId1}/*`)
        .set('Authorization', `Bearer ${profile.accessToken}`)
        .ok((res) => res.status === 204 || res.status === 404);
    await Superagent.delete(`${urlPrefix}/storage/boundary/${exports.testBoundaryId}/function/${exports.testFunctionId1}`)
        .set('Authorization', `Bearer ${profile.accessToken}`)
        .ok((res) => res.status === 204 || res.status === 404);
};

exports.getFunction = async (boundaryId, functionId) => {
    const profile = exports.getCredentials();
    const urlPrefix = `${profile.baseUrl}/v1/account/${profile.account}/subscription/${profile.subscription}`;
    return Superagent.get(`${urlPrefix}/boundary/${boundaryId}/function/${functionId}`)
        .set('Authorization', `Bearer ${profile.accessToken}`)
        .ok((res) => true);
};

exports.getStorage = async (boundaryId, functionId, suffix) => {
    const profile = exports.getCredentials();
    const urlPrefix = `${profile.baseUrl}/v1/account/${profile.account}/subscription/${profile.subscription}`;
    return Superagent.get(`${urlPrefix}/storage/boundary/${boundaryId}/function/${functionId}/root/${suffix}`)
        .set('Authorization', `Bearer ${profile.accessToken}`)
        .ok((res) => true);
};
