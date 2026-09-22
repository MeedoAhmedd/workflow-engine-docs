/*!
 * Read Aloud Engine — v1.1.0
 * A tiny, dependency-free wrapper around the browser's built-in
 * SpeechSynthesis API (Web Speech API). Speaks a target element's
 * content one "chunk" at a time (lines, sentences, or whatever the
 * caller feeds it), tracks which chunk is currently speaking, and
 * exposes a play/pause/stop control plus an automatic best-voice
 * picker biased toward natural-sounding female voices.
 *
 * No network calls, no external services, no build step. Drop this
 * one file into any page and call ReadAloudEngine.create(...).
 *
 * Browser support depends entirely on the viewer's own OS/browser:
 * Chrome, Edge, and Safari all report different voice lists, and
 * some browsers (older Firefox, some mobile browsers) may not
 * support SpeechSynthesis at all. Always check `.isSupported()`
 * before wiring up UI that assumes speech works.
 *
 * v1.1.0 fixes a real Chrome/Edge bug where calling speak() right
 * after cancel() in the same synchronous tick silently dropped the
 * new utterance — no error, no event, just a button that appears to
 * do nothing. speak() now defers its first utterance to the next
 * tick, and a periodic pause()/resume() keeps Chrome from suspending
 * long speech after ~15 seconds. See speak() below for the full
 * explanation.
 *
 * ---------------------------------------------------------------
 * Quick start
 * ---------------------------------------------------------------
 *   <script src="read-aloud-engine.js"></script>
 *   <script>
 *     const engine = ReadAloudEngine.create();
 *     const chunks = document.querySelectorAll('.my-paragraph');
 *     document.getElementById('playBtn').addEventListener('click', () => {
 *       engine.speak(chunks, {
 *         onChunkStart: (el) => el.classList.add('reading'),
 *         onChunkEnd:   (el) => el.classList.remove('reading'),
 *         onDone:       () => console.log('finished reading')
 *       });
 *     });
 *   </script>
 *
 * See README.md in this folder for the full guide, including how to
 * plug this into an existing site's markup and how the voice picker
 * UI (optional, separate file) attaches to it.
 * ---------------------------------------------------------------
 */

(function (root, factory) {
  var built = factory();
  // Always attach to the global in a browser-like environment (anything
  // with a window/self), even if a stray `module` object also exists —
  // some sandboxed page runtimes define a `module` global for unrelated
  // reasons, and taking the CommonJS branch in that case would silently
  // skip setting window.ReadAloudEngine, leaving every page's own script
  // unable to find it (the classic "button does nothing" bug). Node/
  // bundler consumers still get a real module.exports either way.
  if (typeof module === 'object' && module.exports) {
    module.exports = built;
  }
  if (root) {
    root.ReadAloudEngine = built;
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  // Known high-quality, natural-sounding female voice names across
  // common platforms and browsers, ranked roughly best-first. Matched
  // case-insensitively against whatever voice list the viewer's
  // browser actually reports — the exact voices available are outside
  // this engine's control and vary by OS, browser, and installed
  // language packs.
  //
  // No browser exposes Apple's actual Siri voice to web pages — it is
  // not reachable through SpeechSynthesis. The closest real match is
  // Safari's own "Siri Voice" / enhanced-quality entries, which use the
  // same neural voice models Siri itself speaks with on macOS and iOS;
  // those are ranked first below. Chrome/Edge's natural-sounding cloud
  // voices come next, then the older, more robotic-sounding platform
  // defaults as a last resort.
  var DEFAULT_FEMALE_VOICE_HINTS = [
    // Safari/macOS/iOS — actual Siri voice models, when available
    'siri voice', 'siri', 'samantha (enhanced)', 'samantha (premium)',
    // Chrome/Edge — natural-sounding cloud/neural voices
    'google us english', 'google uk english female',
    'microsoft aria online', 'microsoft jenny online', 'microsoft libby online',
    'microsoft aria', 'microsoft jenny', 'microsoft libby', 'microsoft hazel',
    // macOS defaults (still decent, pre-enhanced)
    'samantha', 'victoria', 'karen', 'moira', 'tessa', 'fiona',
    // Generic fallback
    'microsoft zira', 'microsoft susan', 'female'
  ];

  function scoreVoice(voice, hints) {
    var name = voice.name.toLowerCase();
    for (var i = 0; i < hints.length; i++) {
      if (name.indexOf(hints[i]) !== -1) {
        var base = (hints.length - i) * 10;
        if (/^en/i.test(voice.lang)) base += 5;
        return base;
      }
    }
    return /^en/i.test(voice.lang) ? 1 : 0;
  }

  /**
   * Creates a new engine instance.
   *
   * @param {Object} [options]
   * @param {string[]} [options.voiceHints] Ordered list of lowercase
   *   substrings to match against voice names, best match first.
   *   Defaults to a built-in list biased toward female voices.
   * @param {number} [options.rate=0.98] Speech rate (0.1–10, per the
   *   Web Speech spec; 1 is normal human pace).
   * @param {number} [options.pitch=1.0] Speech pitch (0–2; 1 is default).
   *   Left at the voice's own natural pitch by default — a raised pitch
   *   makes a good neural voice sound more artificial, not more pleasant.
   * @param {string} [options.storageKey='read-aloud-voice'] localStorage
   *   key used to remember the reader's chosen voice across visits.
   *   Pass null to disable persistence.
   * @param {function(string):boolean} [options.skipChunk] Optional
   *   predicate; return true for a chunk's text to skip it silently
   *   (e.g. blank lines, lines that are only punctuation).
   */
  function create(options) {
    options = options || {};
    var hints = options.voiceHints || DEFAULT_FEMALE_VOICE_HINTS;
    var rate = typeof options.rate === 'number' ? options.rate : 0.98;
    var pitch = typeof options.pitch === 'number' ? options.pitch : 1.0;
    var storageKey = options.storageKey === undefined ? 'read-aloud-voice' : options.storageKey;
    var skipChunk = typeof options.skipChunk === 'function' ? options.skipChunk : function () { return false; };

    var synth = (typeof window !== 'undefined') ? window.speechSynthesis : null;
    var supported = !!synth && typeof SpeechSynthesisUtterance !== 'undefined';

    var state = {
      chunks: [],
      elements: [],
      index: 0,
      speaking: false,
      voice: null,
      callbacks: {}
    };

    function isSupported() {
      return supported;
    }

    function getVoices() {
      if (!supported) return [];
      return synth.getVoices() || [];
    }

    function pickBestVoice() {
      var voices = getVoices();
      if (!voices.length) return null;
      var ranked = voices.slice().sort(function (a, b) {
        return scoreVoice(b, hints) - scoreVoice(a, hints);
      });
      return ranked[0] || voices[0];
    }

    function loadSavedVoice() {
      if (!storageKey) return pickBestVoice();
      var voices = getVoices();
      if (!voices.length) return null;
      var savedName = null;
      try { savedName = localStorage.getItem(storageKey); } catch (e) {}
      if (savedName) {
        var match = voices.filter(function (v) { return v.name === savedName; })[0];
        if (match) return match;
      }
      return pickBestVoice();
    }

    function setVoice(voice) {
      state.voice = voice || null;
      if (storageKey && voice) {
        try { localStorage.setItem(storageKey, voice.name); } catch (e) {}
      }
    }

    function getVoice() {
      return state.voice;
    }

    /** Ranked list of every voice this browser reports, best match first. */
    function listVoicesRanked(limit) {
      var voices = getVoices();
      var ranked = voices.slice().sort(function (a, b) {
        return scoreVoice(b, hints) - scoreVoice(a, hints);
      });
      return typeof limit === 'number' ? ranked.slice(0, limit) : ranked;
    }

    if (supported) {
      state.voice = loadSavedVoice();
      synth.addEventListener('voiceschanged', function () {
        if (!state.voice) state.voice = loadSavedVoice();
      });
    }

    function clearActiveElement() {
      state.elements.forEach(function (el) {
        if (el && el.classList) el.classList.remove('read-aloud-active');
      });
    }

    // Chrome/Edge periodically suspend an in-progress utterance after
    // roughly 15 seconds (a long-standing Chromium bug, not a spec
    // requirement) unless something keeps nudging the engine. Calling
    // pause()+resume() on a short interval while speaking is the
    // standard workaround: it has no audible effect on correctly
    // running speech, but prevents Chrome's speech queue from silently
    // going idle mid-utterance.
    var keepAliveTimer = null;
    function startKeepAlive() {
      stopKeepAlive();
      if (!supported) return;
      keepAliveTimer = setInterval(function () {
        if (!state.speaking) { stopKeepAlive(); return; }
        try { synth.pause(); synth.resume(); } catch (e) {}
      }, 12000);
    }
    function stopKeepAlive() {
      if (keepAliveTimer) { clearInterval(keepAliveTimer); keepAliveTimer = null; }
    }

    function stop() {
      if (!supported) return;
      stopKeepAlive();
      synth.cancel();
      clearActiveElement();
      var wasSpeaking = state.speaking;
      state.speaking = false;
      state.chunks = [];
      state.elements = [];
      state.index = 0;
      if (wasSpeaking && state.callbacks.onStop) state.callbacks.onStop();
    }

    function pause() {
      if (!supported || !state.speaking) return;
      synth.pause();
    }

    function resume() {
      if (!supported) return;
      synth.resume();
    }

    function isSpeaking() {
      return state.speaking;
    }

    function speakNext() {
      if (state.index >= state.chunks.length) {
        var elementsSnapshot = state.elements;
        stopKeepAlive();
        clearActiveElement();
        state.speaking = false;
        if (state.callbacks.onDone) state.callbacks.onDone(elementsSnapshot);
        return;
      }

      clearActiveElement();
      var text = state.chunks[state.index];
      var el = state.elements[state.index];
      if (el && el.classList) el.classList.add('read-aloud-active');
      if (state.callbacks.onChunkStart) state.callbacks.onChunkStart(el, state.index);

      var trimmed = (text || '').trim();
      var currentIndex = state.index;
      state.index++;

      if (!trimmed || skipChunk(trimmed)) {
        if (state.callbacks.onChunkEnd) state.callbacks.onChunkEnd(el, currentIndex);
        speakNext();
        return;
      }

      var utter = new SpeechSynthesisUtterance(trimmed);
      if (state.voice) utter.voice = state.voice;
      utter.rate = rate;
      utter.pitch = pitch;
      utter.onend = function () {
        if (state.callbacks.onChunkEnd) state.callbacks.onChunkEnd(el, currentIndex);
        speakNext();
      };
      utter.onerror = function () {
        if (state.callbacks.onChunkEnd) state.callbacks.onChunkEnd(el, currentIndex);
        speakNext();
      };
      synth.speak(utter);
    }

    /**
     * Speaks a list of chunks in order. Each chunk can be either a
     * plain string, or a DOM element (its .textContent is read and
     * the element itself is passed to onChunkStart/onChunkEnd so the
     * caller can highlight/scroll to it).
     *
     * @param {(string|Element)[]} chunks
     * @param {Object} [callbacks]
     * @param {function(Element|null, number)} [callbacks.onChunkStart]
     * @param {function(Element|null, number)} [callbacks.onChunkEnd]
     * @param {function(Element[])} [callbacks.onDone]
     * @param {function()} [callbacks.onStop]
     */
    function speak(chunks, callbacks) {
      if (!supported) return false;
      stop();

      state.elements = chunks.map(function (c) {
        return (c && c.nodeType === 1) ? c : null;
      });
      state.chunks = chunks.map(function (c) {
        return (c && c.nodeType === 1) ? c.textContent : String(c);
      });
      state.index = 0;
      state.speaking = true;
      state.callbacks = callbacks || {};
      startKeepAlive();

      // Deliberately deferred to the next tick rather than called
      // synchronously here. Chrome/Edge have a long-standing bug where
      // calling speechSynthesis.cancel() (inside stop(), just above)
      // immediately followed by speechSynthesis.speak() in the SAME
      // synchronous frame silently drops the new utterance — no error,
      // no event, it just never speaks. Letting cancel() fully settle
      // on the event loop before the first speak() call is the
      // documented workaround, and it's the actual root cause of "the
      // button does nothing" reported against this engine.
      setTimeout(function () {
        // A stop() called in the interim (double-click, navigating
        // away) already reset state.speaking — don't resurrect it.
        if (!state.speaking) return;
        speakNext();
      }, 50);

      return true;
    }

    return {
      isSupported: isSupported,
      getVoices: getVoices,
      listVoicesRanked: listVoicesRanked,
      getVoice: getVoice,
      setVoice: setVoice,
      speak: speak,
      stop: stop,
      pause: pause,
      resume: resume,
      isSpeaking: isSpeaking
    };
  }

  return { create: create, VERSION: '1.1.0' };
});
