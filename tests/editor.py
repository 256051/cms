"""Rich editor save/public round trips and media boundaries; isolated sites only."""
import base64
from pathlib import Path
import uuid
from remote_api import machine


def check_editor(admin, passed):
    stamp = uuid.uuid4().hex[:10]
    guest = machine(admin)
    png = base64.b64decode('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+a0foAAAAASUVORK5CYII=')
    image = admin.upload('editor.png', png)
    media = {}
    for ext in ('mp4', 'webm', 'wav'):
        content = (Path(__file__).parent / 'fixtures' / ('editor.' + ext)).read_bytes()
        media[ext] = admin.upload('editor.' + ext, content)
        guest.call(media[ext]['url'], expected=404)
        admin.upload('fake.' + ext, b'<html><script>alert(1)</script></html>', expected=400)
        admin.upload('truncated.' + ext, content[:12], expected=400)
    # A whole Layer III frame and a bounded ID3 prefix exercise both MP3 paths.
    mp3 = bytes.fromhex('fffb9000') + bytes(413)
    media['mp3'] = admin.upload('frame.mp3', mp3)
    admin.upload('tagged.mp3', b'ID3\x04\x00\x00\x00\x00\x00\x00' + mp3)
    for malformed in (b'ID3', bytes.fromhex('fffb9000'), b'ID3\x04\x00\x00\xff\x00\x00\x00' + mp3): admin.upload('bad.mp3', malformed, expected=400)
    passed('verified media containers accepted; forged and truncated files rejected; unpublished media stay private')
    html = f'''<h2 style="text-align: center">丰富正文</h2><p><span style="font-family: serif; font-size: 24px; color: #2563eb; line-height: 1.5">排版中文</span><u>下划线</u><s>删除</s><mark data-color="#fef08a" style="background-color: #fef08a; color: inherit">高亮</mark>x<sup>2</sup>H<sub>2</sub>O</p>
    <div data-type="gallery" data-columns="2"><img src="{image['url']}" alt="图片一"><img src="{image['url']}" alt="图片二"></div>
    <div data-type="columns"><div data-type="column"><p>左栏正文</p></div><div data-type="column"><p>右栏正文</p></div></div>
    <img src="{image['url']}" data-width="50" data-align="right" alt="说明">
    <video src="{media['mp4']['url']}" autoplay loop></video><video src="{media['webm']['url']}"></video><audio src="{media['wav']['url']}"></audio>
    <iframe data-type="embed" src="https://example.com/" title="示例网页" sandbox="allow-scripts allow-same-origin" srcdoc="evil" allow="camera; microphone" onload="evil()"></iframe>
    <pre><code class="language-csharp">Console.WriteLine("正文");</code></pre><table><tbody><tr><th colspan="2">表头</th></tr><tr><td>左格</td><td>右格</td></tr></tbody></table>'''
    payload = dict(kind='post', slug='rich-' + stamp, title='编辑器验收', summary='', html=html, coverId='', categoryId='', tagIds=[], version=0)
    saved = admin.call('admin/contents', 'POST', payload)
    safe = saved['html']
    assert 'color: rgba(37, 99, 235, 1)' in safe and 'background-color: rgba(254, 240, 138, 1)' in safe
    for expected in ('font-family: serif', 'font-size: 24px', 'line-height: 1.5', '<sup>2</sup>', '<sub>2</sub>', 'data-type="columns"', 'data-columns="2"', 'data-type="gallery"', 'data-width="50"', 'data-align="right"', 'language-csharp', 'colspan="2"', 'controls', 'preload="metadata"', 'sandbox="allow-scripts"', 'no-referrer', 'loading="lazy"'):
        assert expected in safe, (expected, safe)
    for bad in ('autoplay', 'loop', 'allow-same-origin', 'srcdoc', 'camera', 'onload'): assert bad not in safe, bad
    again = admin.call('admin/contents/' + saved['id'], 'PUT', dict(payload, html=safe, version=saved['version']))
    assert again['html'] == safe
    guest.call('public/contents/' + saved['slug'], expected=404)
    published = admin.call('admin/contents/' + saved['id'] + '/publish', 'POST', dict(version=again['version']))
    assert guest.call('public/contents/' + saved['slug'])['html'] == safe
    for ext in ('mp4', 'webm', 'wav'):
        guest.headers['Range'] = 'bytes=0-15'
        fragment = guest.call(media[ext]['url'], expected=206)
        assert fragment == (Path(__file__).parent / 'fixtures' / ('editor.' + ext)).read_bytes()[:16]
        assert guest.response_headers['Content-Range'].startswith('bytes 0-15/')
        assert guest.response_headers['Content-Type'].startswith('audio/' if ext == 'wav' else 'video/')
        guest.headers.pop('Range')
        admin.call('admin/assets/' + media[ext]['id'], 'DELETE', expected=409)
    passed('formatting, tables, gallery, columns and sandboxed embeds survive save/re-save/publication; media supports byte ranges and reference protection')
    malicious = '<p style="position:fixed; background-image:url(https://evil.example); color:#123456; font-size:999px" onclick="evil()">保留文字</p><script>evil()</script><iframe src="https://example.com"></iframe><span style="line-height:0; font-family:evil; background-color:expression(evil())">纯文本</span>'
    clean = admin.call('admin/contents/' + saved['id'], 'PUT', dict(payload, html=malicious, version=published['version']))
    for bad in ('script', 'iframe', 'onclick', 'position', 'url(', 'expression', '999', 'line-height', 'font-family'): assert bad not in clean['html']
    assert '保留文字' in clean['html']
    assert guest.call('public/contents/' + saved['slug'])['html'] == safe
    for invalid in ('http://example.com', 'https://localhost', 'https://127.0.0.1', 'https://[::1]', 'https://host.local', 'https://host.local.', 'https://local.', 'https://user:pass@example.com', 'https://example.com:8080', 'javascript:alert(1)'):
        admin.call('admin/contents/' + saved['id'], 'PUT', dict(payload, html=f'<iframe data-type="embed" src="{invalid}"></iframe>', version=clean['version']), expected=400)
    for invalid in (f'<video src="{image["url"]}"></video>', '<audio src="https://example.com/audio.mp3"></audio>', '<div data-type="columns"><div data-type="column"><p>一栏</p></div></div>', '<div data-type="gallery"><p>错误图片集</p></div>'):
        admin.call('admin/contents/' + saved['id'], 'PUT', dict(payload, html=invalid, version=clean['version']), expected=400)
    admin.call('admin/contents/' + saved['id'], 'PUT', dict(payload, version=published['version']), expected=409)
    admin.call('admin/contents/' + saved['id'], 'PUT', dict(payload, version=clean['version']), csrf=False, expected=400)
    guest.call('admin/contents', 'POST', payload, csrf=False, expected=401)
    passed('scripts, unsafe CSS, untrusted iframe capabilities and invalid layouts rejected/removed; stale versions and CSRF enforced; draft edits preserve published rich content')
    # This suite owns the content. Remove it so later pagination tests retain their assumptions.
    admin.call('admin/contents/' + saved['id'], 'DELETE', dict(version=clean['version']))
