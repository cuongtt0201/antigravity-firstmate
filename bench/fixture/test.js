const assert = require('assert');
const { slugify } = require('./slugify');
assert.strictEqual(slugify('Hello World'), 'hello-world');
assert.strictEqual(slugify('  Many   spaces  '), 'many-spaces');
console.log('ok');
