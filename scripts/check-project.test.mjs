import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { checkProject } from './check-project.mjs';

function fixture(t, files = {}) {
  const root = mkdtempSync(path.join(tmpdir(), 'image-stitcher-ci-'));
  t.after(() => rmSync(root, { recursive: true, force: true }));
  for (const [name, content] of Object.entries({
    'index.html': '<link href="assets/css/styles.css"><canvas id="preview-canvas"></canvas><script src="assets/js/app.js"></script>',
    'assets/js/app.js': '$("preview-canvas");',
    'assets/css/styles.css': 'body {}',
    'README.md': '[许可证](LICENSE)',
    'LICENSE': 'MIT',
    ...files
  })) {
    const filename = path.join(root, name);
    mkdirSync(path.dirname(filename), { recursive: true });
    writeFileSync(filename, content);
  }
  return root;
}

test('valid project accepts relative links, encoded paths, queries and external URLs', t => {
  const root = fixture(t, {
    'docs/guide.md': '[首页](../index.html?preview=1#canvas) [图片](<../示例 图.png>) [外链](https://example.com) [锚点](#usage) ![外部图片](data:image/png;base64,AAAA)',
    '示例 图.png': '',
    'README.md': '[指南](docs/guide.md) [编码路径](%E7%A4%BA%E4%BE%8B%20%E5%9B%BE.png)\n```md\n[代码示例](missing.md)\n```\n`[内联示例](missing.md)`'
  });
  assert.deepEqual(checkProject(root), []);
});

test('missing page resource fails with the missing filename', t => {
  const root = fixture(t, { 'index.html': '<canvas id="preview-canvas"></canvas><script src="missing.js"></script>' });
  assert.ok(checkProject(root).some(error => error.includes('index.html') && error.includes('missing.js')));
});

test('duplicate IDs and missing script lookup targets fail', t => {
  const root = fixture(t, {
    'index.html': '<div id="repeated"></div><div id="repeated"></div>',
    'assets/js/app.js': '$("missing-element");'
  });
  const errors = checkProject(root);
  assert.ok(errors.some(error => error.includes('重复') && error.includes('repeated')));
  assert.ok(errors.some(error => error.includes('app.js') && error.includes('missing-element')));
});

test('broken links in nested Markdown files fail relative to that document', t => {
  const root = fixture(t, { 'docs/guide.md': '[失效链接](missing.md)' });
  assert.ok(checkProject(root).some(error => error.includes('guide.md') && error.includes('missing.md')));
});

test('malformed path encoding fails with an actionable error', t => {
  const root = fixture(t, { 'README.md': '[损坏路径](%XX.png)' });
  assert.ok(checkProject(root).some(error => error.includes('路径编码无效') && error.includes('%XX.png')));
});
