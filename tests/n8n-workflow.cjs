// Run the workflow's actual Code nodes with n8n-shaped input; no network or credentials.
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const workflow = JSON.parse(fs.readFileSync(require('node:path').join(__dirname, '../workflows/n8n/cms-draft.json'), 'utf8'));
const nodes = Object.fromEntries(workflow.nodes.map(node => [node.name, node]));
const sample = JSON.parse(nodes['主题与资料'].parameters.jsonOutput);
const run = (name, json, prior = {}) => JSON.parse(JSON.stringify(vm.runInNewContext(
  `(function(){${nodes[name].parameters.jsCode}\n})()`, {
    $input: { first: () => ({ json }) }, $execution: { id: '123' },
    $: key => ({ first: () => ({ json: prior[key] }) }),
  })));
const organized = run('整理资料', { ...sample, sources: [...sample.sources, sample.sources[0]] })[0].json;
assert.equal(organized.sourceCount, 2);
assert.equal(organized.requestKey, 'n8n-123-draft');
assert.equal(organized.aiRequest.action, 'write');
assert.match(organized.aiRequest.html, /资料 1/);
const hostile = run('整理资料', { ...sample, sources: [{ ...sample.sources[0], text: '<script>alert(1)</script>' }] })[0].json;
assert.ok(!hostile.aiRequest.html.includes('<script>'));
assert.throws(() => run('整理资料', { ...sample, sources: [] }));
assert.throws(() => run('整理资料', { ...sample, title: '' }));
assert.throws(() => run('整理资料', { ...sample, sources: [{ ...sample.sources[0], url: 'javascript:alert(1)' }] }));
assert.throws(() => run('整理资料', { ...sample, cmsUrl: 'https://user:password@example.com' }));
assert.throws(() => run('整理资料', { ...sample, sources: [{ ...sample.sources[0], text: 'x'.repeat(12001) }] }));
const proposal = { code: 'OK', data: { html: '<p>文章正文</p>', text: '摘要', tagIds: [] } };
const draft = run('准备草稿', proposal, { 整理资料: organized })[0].json;
assert.equal(draft.article.kind, 'post'); assert.equal(draft.article.slug, 'n8n-123');
assert.match(draft.article.html, /参考资料/); assert.equal(draft.article.version, 0);
assert.throws(() => run('准备草稿', { code: 'OK', data: { html: '' } }, { 整理资料: organized }));
assert.throws(() => run('查看草稿结果', { code: 'OK', data: { id: '1', published: true } }, { 准备草稿: draft }));
assert.equal(run('查看草稿结果', { code: 'OK', data: { id: '1', published: false } }, { 准备草稿: draft })[0].json.previewUrl, 'https://cms.example.com/admin/preview/1');
assert.equal(workflow.active, false);
assert.ok(!workflow.nodes.some(node => JSON.stringify(node.parameters).includes('/publish')));
assert.equal(nodes['保存 CMS 草稿'].parameters.headerParameters.parameters[0].name, 'Idempotency-Key');
assert.equal(nodes['AI 生成文章'].retryOnFail, undefined);
for (const node of workflow.nodes.filter(node => node.type.endsWith('.httpRequest')))
  assert.equal(node.parameters.options.redirect.redirect.followRedirects, false);
console.log('PASS: n8n source validation, deduplication, escaping, proposal validation, draft mapping, receipts and retry boundaries.');
