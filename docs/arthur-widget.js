/*!
 * Arthur Chat Widget — v1.0.0
 * Optional floating chat UI for the Arthur engine (arthur.js). Renders
 * a bottom-right chat bubble, a message thread, and an input box, and
 * wires them to an existing Arthur instance you already created.
 *
 * Entirely separate from the core engine on purpose — a page that wants
 * its own chat UI design can use arthur.js directly and skip this file.
 *
 * Optionally integrates with the Read Aloud Engine (a different,
 * unrelated standalone project) if it's present on the page: when
 * `window.ReadAloudEngine` exists, each of Arthur's answers gets a
 * "read aloud" button alongside its copy button. If that engine isn't
 * loaded, the read-aloud button is simply omitted — this widget has no
 * hard dependency on it.
 *
 * ---------------------------------------------------------------
 * Quick start
 * ---------------------------------------------------------------
 *   <script src="arthur.js"></script>
 *   <script src="arthur-widget.js"></script>
 *   <script>
 *     const arthur = Arthur.create({ name: 'Arthur' });
 *     arthur.index(document.querySelectorAll('h2, h3, p, li'));
 *     ArthurWidget.mount(arthur, {
 *       greeting: "Hi, I'm Arthur. Ask me anything about this page."
 *     });
 *   </script>
 * ---------------------------------------------------------------
 */

(function (root, factory) {
  var built = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = built;
  }
  if (root) {
    root.ArthurWidget = built;
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  function escapeHtml(s) {
    return String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  /**
   * Mounts a floating chat widget bound to an existing Arthur instance.
   *
   * @param {Object} arthur An instance from Arthur.create(...).
   * @param {Object} [options]
   * @param {string} [options.greeting] First message shown when opened.
   * @param {string} [options.avatarLabel] Single character/short label
   *   shown in the launcher bubble and each of Arthur's messages.
   * @param {boolean} [options.readAloud=true] Show a "read aloud" button
   *   on Arthur's answers when window.ReadAloudEngine is available.
   * @param {string} [options.className='arthur-widget'] Root class,
   *   letting a page scope its own styles/overrides.
   * @returns {{open: function, close: function, toggle: function, destroy: function}}
   */
  function mount(arthur, options) {
    options = options || {};
    var greeting = options.greeting || ("Hi, I'm " + (arthur.name || 'Arthur') + ". Ask me anything about this page.");
    var avatarLabel = options.avatarLabel || (arthur.name || 'A').charAt(0).toUpperCase();
    var useReadAloud = options.readAloud !== false;
    var rootClass = options.className || 'arthur-widget';

    var readAloudEngine = null;
    if (useReadAloud && typeof window !== 'undefined' && window.ReadAloudEngine) {
      readAloudEngine = window.ReadAloudEngine.create({ storageKey: 'arthur-widget-voice' });
    }

    var root = document.createElement('div');
    root.className = rootClass;
    root.innerHTML =
      '<button type="button" class="arthur-launcher" aria-label="Open ' + escapeHtml(arthur.name || 'Arthur') + ' chat">' +
        '<span class="arthur-launcher-avatar">' + escapeHtml(avatarLabel) + '</span>' +
      '</button>' +
      '<div class="arthur-panel" hidden>' +
        '<div class="arthur-panel-header">' +
          '<span class="arthur-panel-avatar">' + escapeHtml(avatarLabel) + '</span>' +
          '<div class="arthur-panel-title-group">' +
            '<div class="arthur-panel-title">' + escapeHtml(arthur.name || 'Arthur') + '</div>' +
            '<div class="arthur-panel-subtitle">Ask about this page</div>' +
          '</div>' +
          '<button type="button" class="arthur-close" aria-label="Close chat">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>' +
          '</button>' +
        '</div>' +
        '<div class="arthur-messages" role="log" aria-live="polite"></div>' +
        '<form class="arthur-input-row">' +
          '<input type="text" class="arthur-input" placeholder="Ask a question…" autocomplete="off">' +
          '<button type="submit" class="arthur-send" aria-label="Send">' +
            '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="22" y1="2" x2="11" y2="13"/><polygon points="22 2 15 22 11 13 2 9 22 2"/></svg>' +
          '</button>' +
        '</form>' +
      '</div>';
    document.body.appendChild(root);

    var launcher = root.querySelector('.arthur-launcher');
    var panel = root.querySelector('.arthur-panel');
    var closeBtn = root.querySelector('.arthur-close');
    var messagesEl = root.querySelector('.arthur-messages');
    var form = root.querySelector('.arthur-input-row');
    var input = root.querySelector('.arthur-input');

    var greeted = false;
    var speakingBtn = null;

    function stopSpeaking() {
      if (readAloudEngine) readAloudEngine.stop();
      if (speakingBtn) {
        speakingBtn.classList.remove('speaking');
        var label = speakingBtn.querySelector('.arthur-speak-label');
        if (label) label.textContent = 'Read aloud';
      }
      speakingBtn = null;
    }

    function addMessage(role, text, opts) {
      opts = opts || {};
      var row = document.createElement('div');
      row.className = 'arthur-message arthur-message-' + role;

      var bubble = document.createElement('div');
      bubble.className = 'arthur-bubble';
      bubble.textContent = text;
      row.appendChild(bubble);

      if (role === 'bot') {
        var actions = document.createElement('div');
        actions.className = 'arthur-message-actions';

        var copyBtn = document.createElement('button');
        copyBtn.type = 'button';
        copyBtn.className = 'arthur-action-btn arthur-copy-btn';
        copyBtn.innerHTML =
          '<svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>' +
          '<span>Copy</span>';
        copyBtn.addEventListener('click', function () {
          var done = function () {
            copyBtn.classList.add('copied');
            copyBtn.querySelector('span').textContent = 'Copied';
            setTimeout(function () {
              copyBtn.classList.remove('copied');
              copyBtn.querySelector('span').textContent = 'Copy';
            }, 1400);
          };
          try {
            navigator.clipboard.writeText(text).then(done).catch(function () { legacyCopy(text, done); });
          } catch (e) {
            legacyCopy(text, done);
          }
        });
        actions.appendChild(copyBtn);

        if (readAloudEngine && readAloudEngine.isSupported()) {
          var speakBtn = document.createElement('button');
          speakBtn.type = 'button';
          speakBtn.className = 'arthur-action-btn arthur-speak-btn';
          speakBtn.innerHTML =
            '<svg class="icon-play" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 5v14l11-7z" fill="currentColor" stroke="none"/></svg>' +
            '<svg class="icon-stop" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="5" fill="currentColor" stroke="none"/></svg>' +
            '<span class="arthur-speak-label">Read aloud</span>';
          speakBtn.addEventListener('click', function () {
            if (speakingBtn === speakBtn) {
              stopSpeaking();
              return;
            }
            stopSpeaking();
            speakingBtn = speakBtn;
            speakBtn.classList.add('speaking');
            speakBtn.querySelector('.arthur-speak-label').textContent = 'Stop';
            readAloudEngine.speak([text], {
              onDone: stopSpeaking,
              onStop: stopSpeaking
            });
          });
          actions.appendChild(speakBtn);
        }

        row.appendChild(actions);

        if (opts.sources && opts.sources.length) {
          var jump = document.createElement('button');
          jump.type = 'button';
          jump.className = 'arthur-jump-btn';
          jump.textContent = 'Show me in the page ↓';
          jump.addEventListener('click', function () {
            opts.sources[0].scrollIntoView({ block: 'center', behavior: 'smooth' });
            opts.sources.forEach(function (el) {
              el.classList.add('arthur-source-highlight');
              setTimeout(function () { el.classList.remove('arthur-source-highlight'); }, 2000);
            });
          });
          row.appendChild(jump);
        }
      }

      messagesEl.appendChild(row);
      messagesEl.scrollTop = messagesEl.scrollHeight;
      return row;
    }

    function legacyCopy(text, cb) {
      try {
        var ta = document.createElement('textarea');
        ta.value = text;
        ta.style.position = 'fixed';
        ta.style.left = '-9999px';
        document.body.appendChild(ta);
        ta.select();
        document.execCommand('copy');
        document.body.removeChild(ta);
        cb();
      } catch (e) {}
    }

    function handleAsk(question) {
      addMessage('user', question);
      var result = arthur.ask(question);
      addMessage('bot', result.answer, { sources: result.sources });
    }

    form.addEventListener('submit', function (e) {
      e.preventDefault();
      var q = input.value.trim();
      if (!q) return;
      input.value = '';
      handleAsk(q);
    });

    function open() {
      panel.hidden = false;
      root.classList.add('open');
      if (!greeted) {
        addMessage('bot', greeting);
        greeted = true;
      }
      input.focus();
    }

    function close() {
      panel.hidden = true;
      root.classList.remove('open');
      stopSpeaking();
    }

    function toggle() {
      if (panel.hidden) open(); else close();
    }

    launcher.addEventListener('click', toggle);
    closeBtn.addEventListener('click', close);

    return { open: open, close: close, toggle: toggle, destroy: function () { stopSpeaking(); root.remove(); } };
  }

  return { mount: mount };
});
