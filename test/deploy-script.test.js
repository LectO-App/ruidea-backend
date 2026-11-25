const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const SCRIPT = path.join(__dirname, '..', 'scripts', 'deploy.sh');

// A fake `az` on PATH: it appends each call to a log and answers the revision queries with the
// states listed in FAKE_STATES (one "provisioning running health" line per poll).
const FAKE_AZ = `#!/bin/sh
echo "az $*" >> "$FAKE_LOG"
case "$*" in
  "containerapp show"*latestRevisionName*) echo "ruidea--rev2" ;;
  "containerapp revision show"*)
    n=$(cat "$FAKE_POLLS" 2>/dev/null || echo 0); n=$((n + 1)); echo "$n" > "$FAKE_POLLS"
    line=$(printf '%s\\n' "$FAKE_STATES" | sed -n "\${n}p")
    [ -n "$line" ] || line=$(printf '%s\\n' "$FAKE_STATES" | tail -n 1)
    printf '%s\\n' "$line" | tr ' ' '\\t' ;;
esac
`;

function run(states, extraEnv = {}) {
	const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'deploy-test-'));
	fs.writeFileSync(path.join(dir, 'az'), FAKE_AZ, { mode: 0o755 });
	const log = path.join(dir, 'log');
	const result = spawnSync('bash', [SCRIPT], {
		encoding: 'utf8',
		env: {
			PATH: `${dir}:${process.env.PATH}`,
			FAKE_LOG: log,
			FAKE_POLLS: path.join(dir, 'polls'),
			FAKE_STATES: states.join('\n'),
			IMAGE_TAG: 'abc1234',
			POLL_SECONDS: '0',
			...extraEnv,
		},
	});
	const calls = fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n') : [];
	fs.rmSync(dir, { recursive: true, force: true });
	return { ...result, calls };
}

test('builds the tagged image in the app registry, then points the container app at it', () => {
	const { status, calls } = run(['Provisioned Running Healthy']);
	assert.strictEqual(status, 0);
	assert.match(calls[0], /^az acr build .*--registry acrdisfamstge6bc0b .*--image ruidea-backend:abc1234 /);
	assert.match(calls[1], /^az containerapp update -n ruidea -g rg-disfam-staging --image acrdisfamstge6bc0b\.azurecr\.io\/ruidea-backend:abc1234 /);
});

test('the update output is discarded, so app settings never reach the log', () => {
	const { calls } = run(['Provisioned Running Healthy']);
	assert.match(calls[1], /--output none/);
});

test('waits while the new revision is still starting', () => {
	const { status, calls } = run(['Provisioning Activating None', 'Provisioned Processing None', 'Provisioned Running Healthy']);
	assert.strictEqual(status, 0);
	assert.strictEqual(calls.filter(c => c.startsWith('az containerapp revision show')).length, 3);
	assert.ok(calls.some(c => c.includes('--revision ruidea--rev2')));
});

test('fails when the new revision is unhealthy', () => {
	const { status, stderr } = run(['Provisioned Running Unhealthy']);
	assert.notStrictEqual(status, 0);
	assert.match(stderr, /ruidea--rev2.*Unhealthy/);
});

test('fails when the new revision fails to provision or start', () => {
	assert.notStrictEqual(run(['Failed Failed None']).status, 0);
	assert.notStrictEqual(run(['Provisioned Degraded None']).status, 0);
});

test('fails when the revision is not healthy before the timeout', () => {
	const { status, stderr } = run(['Provisioned Activating None'], { WAIT_SECONDS: '0' });
	assert.notStrictEqual(status, 0);
	assert.match(stderr, /not healthy/);
});

test('names can be changed through the environment', () => {
	const { calls } = run(['Provisioned Running Healthy'], { ACR_NAME: 'otheracr', IMAGE_NAME: 'api', CONTAINER_APP: 'app2', RESOURCE_GROUP: 'rg2' });
	assert.match(calls[0], /--registry otheracr .*--image api:abc1234 /);
	assert.match(calls[1], /-n app2 -g rg2 --image otheracr\.azurecr\.io\/api:abc1234 /);
});
