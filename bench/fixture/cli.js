#!/usr/bin/env node
// Usage: node cli.js <title>...   prints one slug per title
const { slugify } = require('./slugify');
const titles = process.argv.slice(2);
for (const t of titles) console.log(slugify(t));
