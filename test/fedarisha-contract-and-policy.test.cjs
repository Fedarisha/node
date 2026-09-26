const assert = require('node:assert/strict');
const fs = require('node:fs');
const test = require('node:test');
const ts = require('typescript');

require.extensions['.ts'] = (module, filename) => {
    const source = fs.readFileSync(filename, 'utf8');
    const compiled = ts.transpileModule(source, {
        compilerOptions: {
            esModuleInterop: true,
            experimentalDecorators: true,
            module: ts.ModuleKind.CommonJS,
            target: ts.ScriptTarget.ES2022,
        },
        fileName: filename,
    });
    module._compile(compiled.outputText, filename);
};

const {
    ProvisionFedarishaUserCommand,
} = require('../libs/contract/commands/fedarisha/provision-user.command.ts');
const {
    RevokeFedarishaUserCommand,
} = require('../libs/contract/commands/fedarisha/revoke-user.command.ts');
const {
    ProbeFedarishaUserCommand,
} = require('../libs/contract/commands/fedarisha/probe-user.command.ts');
const { SelectelPakService } = require('../src/modules/fedarisha-pak/selectel-pak.service.ts');

test('all node PAK endpoints accept panel numeric IDs and reject unsafe handles', () => {
    const schemas = [
        ProvisionFedarishaUserCommand.RequestSchema,
        RevokeFedarishaUserCommand.RequestSchema,
        ProbeFedarishaUserCommand.RequestSchema,
    ];
    for (const schema of schemas) {
        const base = {
            inboundTag: 'fedarisha',
            prefix: 'fedarisha/42/',
            accessKey: 'access',
            secretKey: 'secret',
        };
        assert.equal(schema.safeParse({ ...base, userUuid: '42' }).success, true);
        assert.equal(
            schema.safeParse({ ...base, userUuid: '550e8400-e29b-41d4-a716-446655440000' }).success,
            true,
        );
        for (const unsafe of ['', '0', '42/other', '../42']) {
            assert.equal(schema.safeParse({ ...base, userUuid: unsafe }).success, false);
        }
    }
});

test('Selectel policy retains master access and scopes each client to its own prefix', () => {
    const service = new SelectelPakService();
    const masterId = 'a'.repeat(32);
    const userId = 'b'.repeat(32);
    const storage = {
        bucket: 'test-bucket',
        basePrefix: 'fedarisha/',
        masterServiceUserId: masterId,
    };
    const policy = service.buildPolicy(storage, [
        { serviceUserId: userId, userName: '42-inbound', keyPrefix: 'fedarisha/42' },
    ]);

    assert.equal(policy.Statement.length, 4);
    assert.equal(
        policy.Statement.some((statement) => statement.Principal?.AWS?.includes('*')),
        false,
    );

    const master = policy.Statement.filter((statement) =>
        statement.Principal?.AWS?.includes(masterId),
    );
    assert.deepEqual(
        master.map((statement) => statement.Action),
        [['s3:ListBucket'], ['s3:GetObject', 's3:PutObject', 's3:DeleteObject']],
    );
    assert.deepEqual(master[1].Resource, [
        'arn:aws:s3:::test-bucket/fedarisha/*',
        'arn:aws:s3:::test-bucket/.fedarisha-pak-state/*',
    ]);

    const client = policy.Statement.filter((statement) =>
        statement.Principal?.AWS?.includes(userId),
    );
    assert.deepEqual(client[0].Resource, ['arn:aws:s3:::test-bucket/fedarisha/42/*']);
    assert.deepEqual(client[1].Condition.StringLike['s3:prefix'], [
        'fedarisha/42/',
        'fedarisha/42/*',
    ]);
    assert.throws(() => service.buildPolicy({ ...storage, masterServiceUserId: '' }, []));
});

test('Selectel refuses a master principal that does not own the configured S3 key', async () => {
    const service = new SelectelPakService();
    service.listCredentials = async () => [{ access_key: 'different-key' }];
    await assert.rejects(
        service.verifyMasterCredentials(
            { masterServiceUserId: 'a'.repeat(32), accessKey: 'master-key', iam: {} },
            'token',
        ),
        /does not belong/,
    );
});
