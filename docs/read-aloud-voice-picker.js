/*!
 * Read Aloud Voice Picker — v1.0.0
 * Optional companion UI for read-aloud-engine.js. Renders a small
 * dropdown listing the browser's available voices (ranked by the
 * engine's own scoring) and lets the reader pick one, persisting the
 * choice through the engine's own storage key.
 *
 * This file is entirely separate from the engine on purpose: the
 * engine has no DOM/UI opinions at all, so a page that wants its own
 * voice-selection design doesn't have to load or fight this file.
 *
 * Requires read-aloud-engine.js to be loaded first (uses the engine
 * instance you already created — it does not create its own).
 *
 * ---------------------------------------------------------------
 * Quick start
 * ---------------------------------------------------------------
 *   <script src="read-aloud-engine.js"></script>
 *   <script src="read-aloud-voice-picker.js"></script>
 *   <script>
 *     const engine = ReadAloudEngine.create();
 *     const picker = ReadAloudVoicePicker.attach(engine);
 *     someButton.addEventListener('dblclick', (e) => picker.openNear(someButton));
 *   </script>
 * ---------------------------------------------------------------
 */

(function (root, factory) {
  var built = factory();
  // See read-aloud-engine.js for why this always attaches to the
  // global in a browser context instead of branching on `module`.
  if (typeof module === 'object' && module.exports) {
    module.exports = built;
  }
  if (root) {
    root.ReadAloudVoicePicker = built;
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  function attach(engine, options) {
    options = options || {};
    var maxVoices = options.maxVoices || 12;
    var className = options.className || 'read-aloud-voice-picker';

    var el = document.createElement('div');
    el.className = className;
    el.setAttribute('role', 'menu');
    el.style.position = 'fixed';
    el.style.zIndex = String(options.zIndex || 1000);
    el.style.display = 'none';
    document.body.appendChild(el);

    function render() {
      var voices = engine.listVoicesRanked(maxVoices);
      if (!voices.length) {
        el.innerHTML = '<div class="read-aloud-voice-empty">No voices available yet.</div>';
        return;
      }
      var current = engine.getVoice();
      var html = '';
      voices.forEach(function (v) {
        var selected = current && current.name === v.name;
        html += '<button type="button" data-voice="' + v.name.replace(/"/g, '&quot;') + '"' +
          (selected ? ' data-selected="true"' : '') + '>' + v.name +
          ' <span class="read-aloud-voice-lang">(' + v.lang + ')</span></button>';
      });
      el.innerHTML = html;
      el.querySelectorAll('button[data-voice]').forEach(function (btn) {
        btn.addEventListener('click', function () {
          var name = btn.getAttribute('data-voice');
          var match = engine.getVoices().filter(function (v) { return v.name === name; })[0];
          if (match) engine.setVoice(match);
          close();
        });
      });
    }

    function openNear(anchorEl) {
      render();
      var rect = anchorEl.getBoundingClientRect();
      el.style.top = (window.scrollY + rect.bottom + 6) + 'px';
      el.style.left = Math.max(8, rect.right - 230) + 'px';
      el.style.display = 'block';
    }

    function close() {
      el.style.display = 'none';
    }

    document.addEventListener('click', function (e) {
      if (el.style.display !== 'none' && !el.contains(e.target) && !e.target.closest('[data-voice-picker-trigger]')) {
        close();
      }
    });

    return { el: el, openNear: openNear, close: close, render: render };
  }

  return { attach: attach };
});
