const assert = require('assert');
const { slugify } = require('../slugify');
assert.strictEqual(slugify('Xin chào Việt Nam'), 'xin-chao-viet-nam');
assert.strictEqual(slugify('Đường phố Hà Nội'), 'duong-pho-ha-noi');
assert.strictEqual(slugify('Hello World'), 'hello-world');
assert.strictEqual(slugify(''), '');
console.log('B1 ok');
