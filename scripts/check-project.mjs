import { existsSync, readFileSync, readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const projectRoot = fileURLToPath(new URL('../', import.meta.url));
const ignoredDirectories = new Set(['.git', 'node_modules', '.idea', '.vscode']);

function markdownFiles(directory) {
  return readdirSync(directory, { withFileTypes: true }).flatMap(entry => {
    const filename = path.join(directory, entry.name);
    if (entry.isDirectory()) return ignoredDirectories.has(entry.name) ? [] : markdownFiles(filename);
    return entry.isFile() && entry.name.endsWith('.md') ? [filename] : [];
  });
}

export function checkProject(root = projectRoot) {
  const errors = [];
  const html = readFileSync(path.join(root, 'index.html'), 'utf8').replace(/<!--[\s\S]*?-->/g, '');
  const script = readFileSync(path.join(root, 'assets/js/app.js'), 'utf8');
  const ids = new Set();

  for (const match of html.matchAll(/\sid\s*=\s*(['"])(.*?)\1/gi)) {
    const id = match[2];
    if (ids.has(id)) errors.push(`index.html: 重复的元素 ID「${id}」。`);
    ids.add(id);
  }

  for (const match of script.matchAll(/\$\(\s*(['"])([^'"]+)\1\s*\)/g)) {
    if (!ids.has(match[2])) errors.push(`assets/js/app.js: 找不到页面元素「${match[2]}」。`);
  }

  function checkLocalFile(reference, source) {
    if (/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(reference)) return;
    const pathname = reference.split(/[?#]/, 1)[0];
    if (!pathname) return;
    let decoded;
    try { decoded = decodeURIComponent(pathname); }
    catch { errors.push(`${source}: 路径编码无效「${reference}」。`); return; }
    const base = decoded.startsWith('/') ? root : path.dirname(path.join(root, source));
    const target = path.resolve(base, decoded.replace(/^\/+/, ''));
    if (!existsSync(target)) errors.push(`${source}: 找不到引用文件「${reference}」。`);
  }

  for (const match of html.matchAll(/\s(?:src|href)\s*=\s*(['"])(.*?)\1/gi)) {
    checkLocalFile(match[2], 'index.html');
  }

  for (const filename of markdownFiles(root)) {
    // 检查普通内联链接和图片路径；示例代码不作为文档链接解析。
    const markdown = readFileSync(filename, 'utf8')
      .replace(/^(?:`{3,}|~{3,})[^\n]*\n[\s\S]*?^(?:`{3,}|~{3,})[^\n]*$/gm, '')
      .replace(/`+[^`\n]*`+/g, '');
    for (const match of markdown.matchAll(/\]\(\s*(?:<([^>]+)>|([^\s)]+))(?:\s+["'][^\n]*?["'])?\s*\)/g)) {
      checkLocalFile(match[1] ?? match[2], path.relative(root, filename));
    }
  }
  return errors;
}

if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === import.meta.url) {
  try {
    const errors = checkProject();
    if (errors.length) {
      console.error(errors.join('\n'));
      process.exitCode = 1;
    } else console.log('检查通过：页面资源、元素 ID 和 Markdown 本地文件链接有效。');
  } catch (error) {
    console.error(`检查失败：${error.message}`);
    process.exitCode = 1;
  }
}
