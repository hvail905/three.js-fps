import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readdirSync, readFileSync } from 'node:fs';

const dir = new URL('../data/looks/', import.meta.url);

test('look files are valid and respect the bloom trim lock (0.6)', () => {
  for (const f of readdirSync(dir).filter(f => f.endsWith('.json'))) {
    const j = JSON.parse(readFileSync(new URL(f, dir)));
    assert.equal(j.kind, 'lookSettings', f);
    assert.equal(typeof j.name, 'string', f);
    if ('bloomTrim' in j.look) assert.ok(j.look.bloomTrim <= 0.6, `${f} bloomTrim ${j.look.bloomTrim}`);
  }
});
