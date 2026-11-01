const assert = require('assert');
const { execFileSync } = require('child_process');
const path = require('path');
const cli = path.join(__dirname, '..', 'cli.js');
const out = JSON.parse(execFileSync(process.execPath, [cli, '--json', 'Hello World', 'A b'], { encoding: 'utf8' }));
assert.deepStrictEqual(out, [{ title: 'Hello World', slug: 'hello-world' }, { title: 'A b', slug: 'a-b' }]);
assert.strictEqual(execFileSync(process.execPath, [cli, 'Hello World'], { encoding: 'utf8' }).trim(), 'hello-world');
console.log('B2 ok');
