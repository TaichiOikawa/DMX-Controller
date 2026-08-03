/**
 * スマホ等のリモート操作ページ（自己完結の単一 HTML）。
 *
 * RemoteServer が `GET /` で返す文字列。ビルドに確実に含めるため .html 別ファイルにせず
 * TS の文字列定数として持つ。外部依存なし（インライン CSS + Vanilla JS）。
 *
 * 動作:
 *   1. localStorage のトークンが無ければ PIN 入力 → POST /api/auth → トークン保存
 *   2. EventSource('/api/events?token=') で RemoteState を購読し描画
 *   3. 各操作は POST /api/command?token= で送信（401 は PIN 画面へ戻す）
 */
export const REMOTE_CLIENT_HTML = /* html */ `<!DOCTYPE html>
<html lang="ja">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1, maximum-scale=1, user-scalable=no" />
<meta name="theme-color" content="#0a0a0a" />
<title>DMX Remote</title>
<style>
  * { box-sizing: border-box; -webkit-tap-highlight-color: transparent; touch-action: manipulation; }
  html, body { margin: 0; height: 100%; }
  body {
    background: #0a0a0a; color: #e5e5e5;
    font-family: system-ui, -apple-system, "Segoe UI", Roboto, sans-serif;
    padding: env(safe-area-inset-top) 12px calc(env(safe-area-inset-bottom) + 12px);
    -webkit-user-select: none; user-select: none;
  }
  .hidden { display: none !important; }
  /* PIN ゲート */
  #gate { position: fixed; inset: 0; display: flex; flex-direction: column;
    align-items: center; justify-content: center; gap: 16px; background: #0a0a0a; padding: 24px; }
  #gate h1 { font-size: 18px; color: #38bdf8; margin: 0; }
  #pin { width: 160px; font-size: 32px; letter-spacing: 8px; text-align: center;
    padding: 10px; border-radius: 10px; border: none; background: #1c1c1c; color: #fff;
    outline: none; }
  #gateBtn { padding: 12px 28px; font-size: 16px; border: none; border-radius: 10px;
    background: #0369a1; color: #fff; font-weight: 700; }
  #gateErr { color: #f87171; font-size: 13px; min-height: 16px; }
  /* ヘッダ */
  header { display: flex; align-items: center; gap: 8px; padding: 6px 2px 10px; }
  header .show { font-weight: 700; font-size: 15px; flex: 1; overflow: hidden;
    text-overflow: ellipsis; white-space: nowrap; }
  .badge { font-size: 11px; font-weight: 700; padding: 2px 8px; border-radius: 999px; }
  .badge.show { background: #7c2d12; color: #fed7aa; }
  .badge.edit { background: #1e3a5f; color: #bae6fd; }
  .dot { width: 8px; height: 8px; border-radius: 999px; background: #ef4444; }
  .dot.ok { background: #22c55e; }
  .view-link { flex-shrink: 0; font-size: 12px; font-weight: 700; text-decoration: none;
    color: #bae6fd; background: #1e293b; padding: 4px 10px; border-radius: 999px; }
  .view-link:active { filter: brightness(1.4); }
  .to-show { flex-shrink: 0; font-size: 12px; font-weight: 800; border: none; border-radius: 999px;
    padding: 5px 12px; background: #7c2d12; color: #fed7aa; }
  .to-show:active { filter: brightness(1.4); }
  /* Action 専用ビュー: Action 以外を隠し、ボタンを大きくする。 */
  .view-actions .card, .view-actions .row, .view-actions .master,
  .view-actions #transport, .view-actions #setlist, .view-actions #showlist { display: none !important; }
  .view-actions header .show { flex: 1; }
  .view-actions #actions { padding: 4px; }
  .view-actions .act-row { gap: 6px; margin-bottom: 10px; }
  .view-actions .act-row .main { padding: 26px 12px; font-size: 20px; }
  .view-actions .act-row .fade { flex: 0 0 104px; padding: 26px 8px; font-size: 16px; }
  /* NOW / NEXT */
  .card { background: #171717; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px;
    ring: 1px; box-shadow: inset 0 0 0 1px #262626; }
  .lbl { font-size: 11px; font-weight: 700; letter-spacing: .5px; }
  .lbl.now { color: #fbbf24; } .lbl.next { color: #38bdf8; }
  .cue-name { font-size: 22px; font-weight: 800; margin-top: 2px; word-break: break-word; }
  .cue-name.dim { color: #525252; }
  .lyric { font-size: 18px; font-weight: 600; margin-top: 4px; word-break: break-word; }
  .lyric.now { color: #fde68a; } .lyric.next { color: #bae6fd; }
  .next-card .cue-name { font-size: 18px; }
  /* ボタン群 */
  .row { display: flex; gap: 10px; margin-bottom: 10px; }
  button.op { flex: 1; padding: 20px 8px; font-size: 18px; font-weight: 800; border: none;
    border-radius: 12px; color: #fff; background: #262626; active: none; }
  button.op:active { filter: brightness(1.4); }
  button.go { background: #15803d; font-size: 26px; flex: 2; }
  button.back { background: #374151; }
  button.hold { background: #b45309; }
  button.blackout { background: #3f3f46; }
  button.blackout.on { background: #dc2626; }
  /* マスター */
  .master { background: #171717; border-radius: 12px; padding: 12px 14px; margin-bottom: 10px; }
  .master .top { display: flex; justify-content: space-between; font-size: 12px; color: #a3a3a3; }
  input[type=range] { width: 100%; height: 36px; }
  /* Timeline */
  .transport-wrap { background: #171717; border-radius: 12px; padding: 8px; margin-bottom: 10px; }
  .tc { display: flex; align-items: baseline; justify-content: center; gap: 8px;
    font-variant-numeric: tabular-nums; padding: 4px 0 8px; }
  #tcPos { font-size: 30px; font-weight: 800; color: #fff; }
  #tcDur { font-size: 18px; font-weight: 700; color: #737373; }
  .transport { display: flex; gap: 10px; }
  .transport button { flex: 1; padding: 16px; font-size: 15px; font-weight: 700; border: none;
    border-radius: 12px; color: #fff; background: #262626; }
  .transport button.play.on { background: #15803d; }
  /* Action */
  .actions { background: #171717; border-radius: 12px; padding: 8px; margin-bottom: 10px; }
  .actions .head { font-size: 11px; font-weight: 700; color: #a3a3a3; padding: 4px 6px 8px;
    display: flex; justify-content: space-between; }
  .act-fade-lbl { color: #38bdf8; font-weight: 600; }
  .act-row { display: flex; gap: 4px; margin-bottom: 6px; }
  .act-row .main { flex: 1; padding: 16px 8px; font-size: 16px; font-weight: 700; border: none;
    border-radius: 10px 0 0 10px; background: #404040; color: #fff; text-align: left;
    overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .act-row .fade { flex: 0 0 84px; padding: 16px 8px; font-size: 14px; font-weight: 700; border: none;
    border-radius: 0 10px 10px 0; background: #0369a1; color: #e0f2fe; }
  .act-row .main:active { filter: brightness(1.4); }
  .act-row .fade:active { filter: brightness(1.4); }
  /* セットリスト */
  .setlist { background: #171717; border-radius: 12px; padding: 8px; margin-bottom: 10px; }
  .setlist .head { font-size: 11px; font-weight: 700; color: #a3a3a3; padding: 4px 6px 8px; }
  .sl-item { display: flex; align-items: center; gap: 8px; padding: 12px 10px; border-radius: 8px;
    font-size: 15px; }
  .sl-item .n { color: #737373; font-variant-numeric: tabular-nums; width: 20px; }
  .sl-item.cur { background: #1e3a5f; color: #fff; font-weight: 700; }
  .sl-item:active { background: #333; }
  .sl-item .rel { margin-left: auto; font-size: 12px; color: #fca5a5; background: #3f3f46;
    padding: 2px 10px; border-radius: 6px; }
</style>
</head>
<body>
  <div id="gate">
    <h1>DMX Remote</h1>
    <input id="pin" inputmode="numeric" pattern="[0-9]*" maxlength="4" placeholder="----" />
    <div id="gateErr"></div>
    <button id="gateBtn">接続</button>
  </div>

  <main id="app" class="hidden">
    <header>
      <span id="conn" class="dot"></span>
      <span id="showName" class="show">—</span>
      <a id="viewLink" class="view-link" href="/actions">⚡ Action専用</a>
      <button id="toShow" class="to-show hidden" data-act="modeShow">▶ SHOW へ</button>
      <span id="mode" class="badge edit">EDIT</span>
    </header>

    <div class="card">
      <div class="lbl now">▶ NOW</div>
      <div id="nowName" class="cue-name dim">— 未開始 —</div>
      <div id="nowLyric" class="lyric now"></div>
    </div>

    <div class="card next-card">
      <div class="lbl next">NEXT ▶</div>
      <div id="nextName" class="cue-name dim">—</div>
      <div id="nextLyric" class="lyric next"></div>
    </div>

    <div class="row">
      <button class="op back" data-act="back">◀ BACK</button>
      <button class="op go" data-act="go">GO</button>
    </div>
    <div class="row">
      <button class="op hold" data-act="hold">HOLD</button>
      <button id="blackout" class="op blackout" data-act="blackout">BLACKOUT</button>
    </div>

    <div class="master">
      <div class="top"><span>マスター</span><span id="masterVal">255</span></div>
      <input id="master" type="range" min="0" max="255" value="255" />
    </div>

    <div id="actions" class="actions hidden">
      <div class="head">ACTION <span id="actFade" class="act-fade-lbl"></span></div>
      <div id="actItems"></div>
    </div>

    <div id="transport" class="transport-wrap hidden">
      <div class="tc"><span id="tcPos">0:00.0</span><span id="tcDur">/ 0:00</span></div>
      <div class="transport">
        <button id="tPlay" class="play" data-act="timelineToggle">▶ 再生</button>
        <button data-act="timelineStop">⏹ 停止</button>
      </div>
    </div>

    <div id="setlist" class="setlist hidden">
      <div class="head" id="slHead">セットリスト</div>
      <div id="slItems"></div>
    </div>

    <div id="showlist" class="setlist hidden">
      <div class="head">SHOW 読み込み</div>
      <div id="showItems"></div>
    </div>
  </main>

<script>
(function () {
  var TKEY = 'dmxRemoteToken';
  var token = localStorage.getItem(TKEY) || '';
  var es = null;
  var masterDragging = false;

  var gate = document.getElementById('gate');
  var app = document.getElementById('app');
  var gateErr = document.getElementById('gateErr');
  var pinInput = document.getElementById('pin');

  function showGate(msg) {
    if (es) { es.close(); es = null; }
    app.classList.add('hidden');
    gate.classList.remove('hidden');
    gateErr.textContent = msg || '';
    pinInput.value = '';
    pinInput.focus();
  }
  function showApp() {
    gate.classList.add('hidden');
    app.classList.remove('hidden');
  }

  function auth() {
    var pin = pinInput.value.trim();
    if (pin.length < 1) return;
    fetch('/api/auth', {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ pin: pin })
    }).then(function (r) {
      if (!r.ok) throw new Error('pin');
      return r.json();
    }).then(function (j) {
      token = j.token; localStorage.setItem(TKEY, token);
      connect(); showApp();
    }).catch(function () { showGate('PIN が違います'); });
  }

  document.getElementById('gateBtn').addEventListener('click', auth);
  pinInput.addEventListener('keydown', function (e) { if (e.key === 'Enter') auth(); });

  function send(action, opts) {
    var body = { action: action };
    if (opts) { for (var k in opts) body[k] = opts[k]; }
    fetch('/api/command?token=' + encodeURIComponent(token), {
      method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body)
    }).then(function (r) { if (r.status === 401) showGate('再接続してください'); });
  }

  // 操作ボタン（data-act）
  Array.prototype.forEach.call(document.querySelectorAll('[data-act]'), function (btn) {
    btn.addEventListener('click', function () { send(btn.getAttribute('data-act')); });
  });

  // マスタースライダー
  var master = document.getElementById('master');
  var masterVal = document.getElementById('masterVal');
  master.addEventListener('input', function () {
    masterDragging = true; masterVal.textContent = master.value;
    send('master', { value: Number(master.value) });
  });
  master.addEventListener('change', function () { masterDragging = false; });

  function setText(id, text) { document.getElementById(id).textContent = text; }

  // ミリ秒を M:SS（tenths=true なら M:SS.d）へ整形する。
  function fmt(ms, tenths) {
    if (!isFinite(ms) || ms < 0) ms = 0;
    var totalSec = Math.floor(ms / 1000);
    var m = Math.floor(totalSec / 60);
    var sec = totalSec % 60;
    var base = m + ':' + (sec < 10 ? '0' + sec : sec);
    return tenths ? base + '.' + Math.floor((ms % 1000) / 100) : base;
  }

  function render(s) {
    document.getElementById('conn').classList.add('ok');
    setText('showName', s.showName || '—');
    var mode = document.getElementById('mode');
    mode.textContent = s.mode === 'show' ? 'SHOW' : 'EDIT';
    mode.className = 'badge ' + (s.mode === 'show' ? 'show' : 'edit');
    // EDIT のときだけ「SHOW へ」を表示（SHOW→EDIT はソフト本体でのみ操作）。
    var toShow = document.getElementById('toShow');
    if (s.mode === 'show') toShow.classList.add('hidden'); else toShow.classList.remove('hidden');

    var now = s.now, next = s.next;
    var nowName = document.getElementById('nowName');
    nowName.textContent = now ? now.name : '— 未開始 —';
    nowName.className = 'cue-name' + (now ? '' : ' dim');
    setText('nowLyric', now && now.lyrics ? '♪ ' + now.lyrics : '');
    var nextName = document.getElementById('nextName');
    nextName.textContent = next ? next.name : '（最後）';
    nextName.className = 'cue-name' + (next ? '' : ' dim');
    setText('nextLyric', next && next.lyrics ? '♪ ' + next.lyrics : '');

    // ブラックアウト
    var bo = document.getElementById('blackout');
    if (s.blackout) bo.classList.add('on'); else bo.classList.remove('on');

    // マスター（ドラッグ中は上書きしない）
    if (!masterDragging) { master.value = s.masterLevel; masterVal.textContent = s.masterLevel; }

    // Timeline トランスポート + タイムコード（Show 読込中は常に表示）
    var tp = document.getElementById('transport');
    if (s.transport) {
      tp.classList.remove('hidden');
      document.getElementById('tcPos').textContent = fmt(s.transport.positionMs, true);
      document.getElementById('tcDur').textContent = '/ ' + fmt(s.transport.durationMs, false);
      var play = document.getElementById('tPlay');
      if (s.transport.playing) { play.classList.add('on'); play.textContent = '⏸ 一時停止'; }
      else { play.classList.remove('on'); play.textContent = '▶ 再生'; }
    } else { tp.classList.add('hidden'); }

    // Action（発火 / 取り込み）
    var acts = document.getElementById('actions');
    if (s.actions && s.actions.length) {
      acts.classList.remove('hidden');
      var fadeSec = (s.actionFadeMs || 0) / 1000;
      document.getElementById('actFade').textContent = 'フェード ' + fadeSec + 's';
      var abox = document.getElementById('actItems');
      abox.innerHTML = '';
      s.actions.forEach(function (a) {
        var row = document.createElement('div'); row.className = 'act-row';
        var main = document.createElement('button'); main.className = 'main'; main.textContent = a.name;
        main.addEventListener('click', function () { send('action', { id: a.id, fade: false }); });
        var fade = document.createElement('button'); fade.className = 'fade'; fade.textContent = '↗ ' + fadeSec + 's';
        fade.addEventListener('click', function () { send('action', { id: a.id, fade: true }); });
        row.appendChild(main); row.appendChild(fade); abox.appendChild(row);
      });
    } else { acts.classList.add('hidden'); }

    // セットリスト
    var sl = document.getElementById('setlist');
    if (s.setlist) {
      sl.classList.remove('hidden');
      document.getElementById('slHead').textContent =
        s.setlist.name + '  ' + (s.setlist.index < 0 ? '–' : s.setlist.index + 1) + ' / ' + s.setlist.total;
      var box = document.getElementById('slItems');
      box.innerHTML = '';
      s.setlist.entries.forEach(function (e, i) {
        var row = document.createElement('div');
        row.className = 'sl-item' + (i === s.setlist.index ? ' cur' : '');
        var n = document.createElement('span'); n.className = 'n'; n.textContent = (i + 1);
        var name = document.createElement('span'); name.textContent = e.name;
        row.appendChild(n); row.appendChild(name);
        row.addEventListener('click', function () { send('setlistGoTo', { value: i }); });
        box.appendChild(row);
      });
    } else { sl.classList.add('hidden'); }

    // Show 読み込み（セットリスト読込中はマスター GO が制御するため隠す）
    var showlist = document.getElementById('showlist');
    if (!s.setlist && s.shows && s.shows.length) {
      showlist.classList.remove('hidden');
      var sbox = document.getElementById('showItems');
      sbox.innerHTML = '';
      s.shows.forEach(function (sh) {
        var active = sh.id === s.activeShowId;
        var row = document.createElement('div');
        row.className = 'sl-item' + (active ? ' cur' : '');
        var name = document.createElement('span'); name.textContent = sh.name;
        row.appendChild(name);
        if (active) {
          var rel = document.createElement('span'); rel.className = 'rel'; rel.textContent = '解放';
          row.appendChild(rel);
          row.addEventListener('click', function () { send('unloadShow'); });
        } else {
          row.addEventListener('click', function () { send('loadShow', { id: sh.id }); });
        }
        sbox.appendChild(row);
      });
    } else { showlist.classList.add('hidden'); }
  }

  function connect() {
    if (es) es.close();
    es = new EventSource('/api/events?token=' + encodeURIComponent(token));
    es.onmessage = function (ev) {
      try { render(JSON.parse(ev.data)); } catch (e) {}
    };
    es.onerror = function () {
      // ストリームが切れた（サーバー再起動でトークン失効など）。接続表示を落とし、
      // トークンの有効性を確認して有効なら再接続、無効なら PIN 画面へ戻す。
      document.getElementById('conn').classList.remove('ok');
      if (es) { es.close(); es = null; }
      setTimeout(function () {
        fetch('/api/ping?token=' + encodeURIComponent(token)).then(function (r) {
          if (r.status === 401) { showGate('再接続してください'); }
          else if (!es) { connect(); }
        }).catch(function () { if (!es) connect(); });
      }, 1000);
    };
  }

  // 表示モード: /actions は Action 専用ビュー（Action 以外を隠す）。切替リンクを相互設定。
  var viewLink = document.getElementById('viewLink');
  if (location.pathname === '/actions') {
    document.body.classList.add('view-actions');
    viewLink.textContent = '← 全操作';
    viewLink.href = '/';
  } else {
    viewLink.textContent = '⚡ Action専用';
    viewLink.href = '/actions';
  }

  // 起動
  if (token) { showApp(); connect(); } else { showGate(); }
})();
</script>
</body>
</html>`;
