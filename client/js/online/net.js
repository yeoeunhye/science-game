// WebSocket 연결 관리. 연결 시도/실패 감지, 끊김 감지(하트비트), 메시지 전달만 담당한다.
(function () {
  let ws = null, handler = null, closeHandler = null, hb = null, lastMsg = 0;

  function url() {
    return (location.protocol === 'https:' ? 'wss://' : 'ws://') + location.host + location.pathname.replace(/[^/]*$/, '') + 'ws';
  }

  // 연결을 시도해서 열리면 resolve, 실패/시간초과면 reject
  function connect(timeoutMs) {
    close(true);
    return new Promise((resolve, reject) => {
      let settled = false, sock;
      const fail = (why) => { if (settled) return; settled = true; try { sock && sock.close(); } catch (e) { /* ignore */ } reject(new Error(why)); };
      if (location.protocol === 'file:') return fail('file');
      try { sock = new WebSocket(url()); } catch (e) { return fail('ctor'); }
      const t = setTimeout(() => fail('timeout'), timeoutMs || 4500);
      sock.onopen = () => {
        if (settled) return;
        settled = true; clearTimeout(t);
        ws = sock; lastMsg = Date.now();
        sock.onmessage = (ev) => {
          lastMsg = Date.now();
          let m; try { m = JSON.parse(ev.data); } catch (e) { return; }
          if (m.t === 'pong' || m.t === 'hello') return;
          handler && handler(m);
        };
        sock.onclose = () => { if (ws === sock) { ws = null; stopBeat(); closeHandler && closeHandler(); } };
        sock.onerror = () => { /* close 에서 처리 */ };
        startBeat();
        resolve();
      };
      sock.onerror = () => { clearTimeout(t); fail('error'); };
      sock.onclose = () => { clearTimeout(t); fail('closed'); };
    });
  }

  function startBeat() {
    stopBeat();
    hb = setInterval(() => {
      if (!ws) return;
      if (Date.now() - lastMsg > 45000) { try { ws.close(); } catch (e) { /* ignore */ } return; }   // 응답이 없으면 끊긴 것으로 본다
      send({ t: 'ping' });
    }, 15000);
  }
  function stopBeat() { clearInterval(hb); hb = null; }

  function send(o) {
    if (!ws || ws.readyState !== 1) return false;
    ws.send(JSON.stringify(o));
    return true;
  }
  function close(silent) {
    stopBeat();
    if (ws) { const s = ws; ws = null; if (silent) { s.onclose = null; } try { s.close(); } catch (e) { /* ignore */ } }
  }

  window.Net = {
    connect, send, close,
    isOpen: () => !!ws && ws.readyState === 1,
    onMessage(fn) { handler = fn; },
    onClose(fn) { closeHandler = fn; },
  };
})();
