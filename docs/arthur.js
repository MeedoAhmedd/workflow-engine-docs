/*!
 * Arthur — v1.2.0
 * A small, dependency-free, in-browser question-answering engine with
 * a bounded personality. Arthur indexes the text content already on a
 * page (headings and passages you give it) and, when asked a
 * question, ranks and returns the passages most relevant to it — a
 * local, keyword-based retrieval engine, not a call to any external
 * AI service. On top of that, Arthur recognizes small talk (greetings,
 * thanks, "who are you"), understands common abbreviations and
 * internet shorthand ("who r u", "wsp", "ngl", "hru"), can greet and
 * make small talk in a handful of other languages, and refuses
 * questions unrelated to the page or to himself, in character, rather
 * than pretending to be a general-purpose assistant.
 *
 * This is a standalone project with no knowledge of any particular
 * page's subject matter beyond what it's given. It only knows how to
 * index and search text, recognize a fixed set of conversational
 * intents (in English and in a small set of other languages), and
 * decide whether a question is in scope.
 *
 * ---------------------------------------------------------------
 * Why keyword search, not a real conversational model
 * ---------------------------------------------------------------
 * Arthur runs entirely in the visitor's browser, with no server, no
 * API key, and no network call. That means it cannot generate novel
 * sentences the way a large language model can, and it cannot browse
 * the web — it can only find and return the most relevant passages
 * already present on the page it was given, plus a small set of
 * hand-written conversational replies for greetings and questions
 * about itself. For many "does this page cover X?" or "where does it
 * explain Y?" questions, that is exactly what's needed, delivered
 * instantly and for free, with no data ever leaving the browser. It
 * will not handle open-ended reasoning, follow-up questions that need
 * synthesis across passages, or anything not already written on the
 * page or built into its own small talk responses.
 *
 * ---------------------------------------------------------------
 * Abbreviations and slang
 * ---------------------------------------------------------------
 * Before anything else runs, Arthur expands a fixed table of common
 * shorthand — "u"→"you", "r"→"are", "ngl"→"not gonna lie", "wsp"→
 * "what's up", and similar — so "who r u" is understood exactly like
 * "who are you". This is a lookup table, not language understanding:
 * it only knows the specific abbreviations listed in SLANG_MAP.
 *
 * ---------------------------------------------------------------
 * Multiple languages — small talk only, not translation
 * ---------------------------------------------------------------
 * Arthur can recognize and reply to greetings, thanks, farewells, and
 * "who are you" in English plus a handful of other languages (Spanish,
 * French, German, Arabic, Hindi, Chinese), each with hand-written
 * replies in that language — see LOCALIZED_REPLIES. This is NOT
 * machine translation: Arthur has no language model and cannot
 * translate the indexed document content itself. If your page's
 * content is in English, a non-English speaker gets a friendly reply
 * in their own language, but his document answers stay in whatever
 * language the page was written in — his own replies say this
 * honestly (see each language's `language_note`).
 *
 * ---------------------------------------------------------------
 * The on-topic boundary
 * ---------------------------------------------------------------
 * Arthur is deliberately scoped to two things: the content you index
 * into him, and questions about himself (what he is, what he can do,
 * his limits). A question that doesn't overlap with either — asked
 * about a subject the page never mentions — gets a firm, in-character
 * refusal instead of a generic "I don't know" or, worse, an attempt to
 * answer from general knowledge he doesn't actually have. See
 * `isOnTopic` / the `offTopicMessage` option to see or change exactly
 * where that line is drawn.
 *
 * ---------------------------------------------------------------
 * Quick start
 * ---------------------------------------------------------------
 *   <script src="arthur.js"></script>
 *   <script>
 *     const arthur = Arthur.create({ name: 'Arthur' });
 *     arthur.index(document.querySelectorAll('h2, h3, p, li'));
 *
 *     const result = arthur.ask('who r u');
 *     console.log(result.answer);   // understood as "who are you"
 *
 *     const result2 = arthur.ask('hola');
 *     console.log(result2.answer);      // a Spanish greeting reply
 *     console.log(result2.language);    // 'es'
 *
 *     const result3 = arthur.ask('how do guards work?');
 *     console.log(result3.answer);      // best-effort natural-language answer
 *     console.log(result3.sources);     // the DOM elements it drew from
 *     console.log(result3.confidence);  // 0–1, how sure Arthur is
 *     console.log(result3.intent);      // 'search' | 'greeting' | 'thanks' | 'about_self' | 'off_topic' | ...
 *   </script>
 * ---------------------------------------------------------------
 */

(function (root, factory) {
  var built = factory();
  if (typeof module === 'object' && module.exports) {
    module.exports = built;
  }
  if (root) {
    root.Arthur = built;
  }
})(typeof window !== 'undefined' ? window : (typeof self !== 'undefined' ? self : this), function () {
  'use strict';

  var STOPWORDS = (
    'a an the is are was were be been being of to in on for with and or ' +
    'but if then than so as at by from into onto up down out over under ' +
    'again further once here there when where why how all any both each ' +
    'few more most other some such no nor not only own same too very can ' +
    'will just should now this that these those it its it\'s his her their ' +
    'what which who whom does do did doing have has had having i you he ' +
    'she we they them your my our'
  ).split(/\s+/);
  var STOPWORD_SET = {};
  STOPWORDS.forEach(function (w) { STOPWORD_SET[w] = true; });

  // A deliberately small, safe suffix-stripping stemmer — not a real
  // Porter stemmer, just enough to match "opens"/"opening"/"open" or
  // "located"/"location" against each other, which matters a lot for
  // short questions where the exact word form the visitor uses often
  // differs from the page's wording. Keeps words of 4+ letters only,
  // so short words like "was" or "has" are left alone.
  function stem(word) {
    if (word.length <= 4) return word;
    // Deliberately strips only "ion"/"ions" (not "ation"/"ations" as a
    // whole unit) so "location" reduces to "locat" — the same root
    // "located" reaches by stripping "ed" — instead of over-stripping
    // to "loc", which would then fail to match "located" at all.
    var suffixes = ['ions', 'ion', 'ing', 'edly', 'ed', 'ly', 'ies', 'es', 's'];
    for (var i = 0; i < suffixes.length; i++) {
      var suf = suffixes[i];
      if (word.length - suf.length >= 3 && word.slice(-suf.length) === suf) {
        return word.slice(0, word.length - suf.length);
      }
    }
    return word;
  }

  // Internet-speak and common abbreviations, expanded to their plain
  // English equivalent before anything else runs — intent matching,
  // tokenizing, and search all see the expanded form. This is a fixed
  // lookup table, not a language model: it only knows the specific
  // shorthand listed here, matched as a whole word so it never mangles
  // a real word that happens to contain one as a substring (the \b
  // boundaries below are what make "you" untouched while "u" expands).
  var SLANG_MAP = {
    'u': 'you', 'ur': 'your', "you're": 'you are', 'r': 'are',
    'y': 'why', 'k': 'okay', 'kk': 'okay', 'ok': 'okay',
    'pls': 'please', 'plz': 'please', 'thx': 'thanks', 'ty': 'thanks',
    'np': 'no problem', 'idk': "i do not know", 'imo': 'in my opinion',
    'imho': 'in my honest opinion', 'tbh': 'to be honest',
    'ngl': 'not gonna lie', 'fr': 'for real', 'frfr': 'for real',
    'wsp': "what's up", 'wsup': "what's up", 'sup': "what's up",
    'whatsup': "what's up", 'wyd': 'what are you doing',
    'hbu': 'how about you', 'hru': 'how are you', 'howru': 'how are you',
    'gonna': 'going to', 'wanna': 'want to', 'gotta': 'got to',
    'lemme': 'let me', 'gimme': 'give me', 'dunno': "do not know",
    'btw': 'by the way', 'afaik': 'as far as i know',
    'rn': 'right now', 'atm': 'at the moment', 'asap': 'as soon as possible',
    'cuz': 'because', 'bc': 'because', 'b4': 'before',
    '2day': 'today', '2moro': 'tomorrow', '2nite': 'tonight',
    'gr8': 'great', 'l8r': 'later', 'nvm': 'never mind',
    'lol': 'that is funny', 'lmao': 'that is funny', 'omg': 'oh my goodness',
    'wat': 'what', 'wut': 'what', 'wht': 'what', 'wich': 'which',
    'wich?': 'which', 'dis': 'this', 'dat': 'that', 'wen': 'when',
    'wer': 'where', 'wher': 'where', 'hw': 'how', 'wht\'s': "what's",
    'yea': 'yes', 'yeah': 'yes', 'yep': 'yes', 'yup': 'yes',
    'nah': 'no', 'nope': 'no'
  };

  function expandSlang(text) {
    return text.replace(/[a-z0-9']+/gi, function (word) {
      var lower = word.toLowerCase();
      return SLANG_MAP.hasOwnProperty(lower) ? SLANG_MAP[lower] : word;
    });
  }

  function tokenize(text) {
    return (expandSlang(text).toLowerCase().match(/[a-z0-9']+/g) || []).filter(function (w) {
      return w.length > 1 && !STOPWORD_SET[w];
    }).map(stem);
  }

  // ---------------------------------------------------------------
  // Multilingual small talk
  // ---------------------------------------------------------------
  // Arthur cannot translate — he has no language model and makes no
  // network call. What's here instead is a fixed, hand-written table:
  // for each of a handful of common languages, a regex that recognizes
  // a greeting/thanks/farewell/"who are you" in that language, and a
  // hand-written reply in that same language. This is real multilingual
  // small talk, not machine translation — the document search itself
  // still only matches whatever language the indexed page content is
  // actually written in, and every language's "about_self"/"summary"
  // replies say so honestly rather than implying full translation.
  var LANGUAGES = {
    en: { name: 'English' },
    es: {
      name: 'Spanish',
      greetingWords: /^\s*(hola|buenos\s?d[ií]as|buenas\s?tardes|buenas\s?noches|qu[eé]\s?tal)\b/i,
      thanksWords: /^\s*(gracias|muchas\s?gracias)\b/i,
      farewellWords: /^\s*(adi[oó]s|hasta\s?luego|chao|nos\s?vemos)\b/i,
      aboutSelfWords: /\b(qui[eé]n\s?eres|qu[eé]\s?eres|c[oó]mo\s?te\s?llamas)\b/i,
      howAreYouWords: /\b(c[oó]mo\s?est[aá]s|qu[eé]\s?tal\s?est[aá]s)\b/i
    },
    fr: {
      name: 'French',
      greetingWords: /^\s*(bonjour|salut|bonsoir|coucou)\b/i,
      thanksWords: /^\s*(merci|merci\s?beaucoup)\b/i,
      farewellWords: /^\s*(au\s?revoir|salut|[aà]\s?bient[oô]t)\b/i,
      aboutSelfWords: /\b(qui\s?es[- ]tu|qui\s?[eê]tes[- ]vous|comment\s?tu\s?t'appelles)\b/i,
      howAreYouWords: /\b(comment\s?[cç]a\s?va|comment\s?allez[- ]vous)\b/i
    },
    de: {
      name: 'German',
      greetingWords: /^\s*(hallo|guten\s?(morgen|tag|abend)|servus|moin)\b/i,
      thanksWords: /^\s*(danke|vielen\s?dank|danke\s?sch[oö]n)\b/i,
      farewellWords: /^\s*(tsch[uü]ss|auf\s?wiedersehen|bis\s?bald)\b/i,
      aboutSelfWords: /\b(wer\s?bist\s?du|wer\s?sind\s?sie|wie\s?hei[sß]t\s?du)\b/i,
      howAreYouWords: /\b(wie\s?geht'?s|wie\s?geht\s?es\s?dir)\b/i
    },
    ar: {
      name: 'Arabic',
      greetingWords: /^\s*(مرحبا|أهلا|السلام\s?عليكم|هلا)/,
      thanksWords: /^\s*(شكرا|شكرا\s?جزيلا)/,
      farewellWords: /^\s*(مع\s?السلامة|إلى\s?اللقاء|باي)/,
      aboutSelfWords: /(من\s?أنت|ما\s?اسمك|مين\s?انت)/,
      howAreYouWords: /(كيف\s?حالك|ازيك|عامل\s?ايه)/
    },
    hi: {
      name: 'Hindi',
      greetingWords: /^\s*(नमस्ते|नमस्कार|हाय)/,
      thanksWords: /^\s*(धन्यवाद|शुक्रिया)/,
      farewellWords: /^\s*(अलविदा|फिर\s?मिलेंगे)/,
      aboutSelfWords: /(तुम\s?कौन\s?हो|आप\s?कौन\s?हैं|तुम्हारा\s?नाम\s?क्या\s?है)/,
      howAreYouWords: /(कैसे\s?हो|कैसे\s?हैं\s?आप)/
    },
    zh: {
      name: 'Chinese',
      greetingWords: /^\s*(你好|您好|嗨)/,
      thanksWords: /^\s*(谢谢|多谢)/,
      farewellWords: /^\s*(再见|拜拜)/,
      aboutSelfWords: /(你是谁|你叫什么名字)/,
      howAreYouWords: /(你好吗|最近怎么样)/
    }
  };

  // Hand-written small-talk replies per language. `{name}` and
  // `{subject}` are substituted at reply time. Intentionally short and
  // fixed — this is a phrase table, not generation, so it never says
  // anything Arthur wasn't explicitly given the words for.
  var LOCALIZED_REPLIES = {
    es: {
      greeting: '¡Hola! Soy {name}. Pregúntame lo que quieras sobre {subject}.',
      thanks: '¡De nada! ¿Algo más sobre {subject}?',
      farewell: '¡Adiós! Vuelve si tienes más preguntas sobre {subject}.',
      how_are_you: 'Estoy bien, gracias. Aquí estoy para lo que necesites sobre {subject}.',
      about_self: 'Soy {name}, un asistente de chat local para {subject}. Busco en el propio texto de la página — no traduzco con inteligencia artificial ni navego por internet, así que mis respuestas sobre {subject} siguen basándose en su contenido en inglés.',
      language_note: 'Puedo saludar y charlar en español, pero el contenido de {subject} está en inglés, así que mis respuestas detalladas seguirán en ese idioma.'
    },
    fr: {
      greeting: 'Salut ! Je suis {name}. Demande-moi ce que tu veux savoir sur {subject}.',
      thanks: 'De rien ! Autre chose sur {subject} ?',
      farewell: 'Au revoir ! Reviens si tu as d\'autres questions sur {subject}.',
      how_are_you: 'Je vais bien, merci. Je suis là pour {subject}.',
      about_self: 'Je suis {name}, un assistant local pour {subject}. Je cherche dans le texte de la page elle-même — je ne traduis pas avec une IA et je ne navigue pas sur le web, donc mes réponses détaillées sur {subject} restent en anglais.',
      language_note: 'Je peux discuter en français, mais le contenu de {subject} est en anglais, donc mes réponses détaillées resteront dans cette langue.'
    },
    de: {
      greeting: 'Hallo! Ich bin {name}. Frag mich alles über {subject}.',
      thanks: 'Gern geschehen! Noch etwas zu {subject}?',
      farewell: 'Tschüss! Komm zurück, wenn du weitere Fragen zu {subject} hast.',
      how_are_you: 'Mir geht es gut, danke. Ich bin hier für Fragen zu {subject}.',
      about_self: 'Ich bin {name}, ein lokaler Chat-Assistent für {subject}. Ich durchsuche den Text der Seite selbst — ich übersetze nicht mit KI und durchsuche nicht das Internet, daher bleiben meine ausführlichen Antworten zu {subject} auf Englisch.',
      language_note: 'Ich kann auf Deutsch plaudern, aber der Inhalt von {subject} ist auf Englisch, daher bleiben meine ausführlichen Antworten in dieser Sprache.'
    },
    ar: {
      greeting: 'مرحبًا! أنا {name}. اسألني أي شيء عن {subject}.',
      thanks: 'عفوًا! هل هناك شيء آخر عن {subject}؟',
      farewell: 'مع السلامة! عد إذا كان لديك المزيد من الأسئلة عن {subject}.',
      how_are_you: 'أنا بخير، شكرًا لسؤالك. أنا هنا من أجل {subject}.',
      about_self: 'أنا {name}، مساعد محادثة محلي لـ {subject}. أبحث في نص الصفحة نفسها — لا أترجم باستخدام الذكاء الاصطناعي ولا أتصفح الإنترنت، لذا تبقى إجاباتي التفصيلية عن {subject} بالإنجليزية.',
      language_note: 'يمكنني الدردشة بالعربية، لكن محتوى {subject} مكتوب بالإنجليزية، لذا ستبقى إجاباتي التفصيلية بتلك اللغة.'
    },
    hi: {
      greeting: 'नमस्ते! मैं {name} हूँ। {subject} के बारे में मुझसे कुछ भी पूछें।',
      thanks: 'कोई बात नहीं! {subject} के बारे में कुछ और?',
      farewell: 'अलविदा! अगर {subject} के बारे में और सवाल हों तो वापस आएं।',
      how_are_you: 'मैं ठीक हूँ, धन्यवाद। मैं {subject} के लिए यहाँ हूँ।',
      about_self: 'मैं {name} हूँ, {subject} के लिए एक स्थानीय चैट सहायक। मैं पेज के टेक्स्ट में ही खोजता हूँ — मैं AI से अनुवाद नहीं करता और वेब नहीं ब्राउज़ करता, इसलिए {subject} के बारे में मेरे विस्तृत उत्तर अंग्रेज़ी में ही रहेंगे।',
      language_note: 'मैं हिंदी में बातचीत कर सकता हूँ, लेकिन {subject} की सामग्री अंग्रेज़ी में है, इसलिए मेरे विस्तृत उत्तर उसी भाषा में रहेंगे।'
    },
    zh: {
      greeting: '你好！我是{name}。关于{subject}的任何问题都可以问我。',
      thanks: '不客气！还有关于{subject}的问题吗？',
      farewell: '再见！如果还有关于{subject}的问题，欢迎回来。',
      how_are_you: '我很好，谢谢。我在这里帮你解答{subject}的问题。',
      about_self: '我是{name}，{subject}的本地聊天助手。我在页面文本中搜索——我不使用人工智能翻译，也不浏览网络，所以关于{subject}的详细回答仍会是英文。',
      language_note: '我可以用中文聊天，但{subject}的内容是英文的，所以我的详细回答仍会是英文。'
    }
  };

  function fillTemplate(template, name, subject) {
    return template.replace(/\{name\}/g, name).replace(/\{subject\}/g, subject);
  }

  // Detects which of the small, fixed LANGUAGES table a message
  // matches, checking greeting/thanks/farewell/about-self/how-are-you
  // patterns for each non-English language in turn. Returns null for
  // English or for anything not recognized — Arthur does not guess at
  // languages he has no phrase table for.
  function detectLanguage(text) {
    var trimmed = text.trim();
    for (var code in LANGUAGES) {
      if (code === 'en' || !LANGUAGES.hasOwnProperty(code)) continue;
      var lang = LANGUAGES[code];
      if (
        (lang.greetingWords && lang.greetingWords.test(trimmed)) ||
        (lang.thanksWords && lang.thanksWords.test(trimmed)) ||
        (lang.farewellWords && lang.farewellWords.test(trimmed)) ||
        (lang.aboutSelfWords && lang.aboutSelfWords.test(trimmed)) ||
        (lang.howAreYouWords && lang.howAreYouWords.test(trimmed))
      ) {
        return code;
      }
    }
    return null;
  }

  function detectLocalizedIntent(text, langCode) {
    var lang = LANGUAGES[langCode];
    if (!lang) return null;
    if (lang.greetingWords && lang.greetingWords.test(text)) return 'greeting';
    if (lang.thanksWords && lang.thanksWords.test(text)) return 'thanks';
    if (lang.farewellWords && lang.farewellWords.test(text)) return 'farewell';
    if (lang.aboutSelfWords && lang.aboutSelfWords.test(text)) return 'about_self';
    if (lang.howAreYouWords && lang.howAreYouWords.test(text)) return 'how_are_you';
    return null;
  }

  // A small set of hand-recognized conversational intents, checked
  // before any keyword search runs. This is what lets Arthur say hi
  // back, answer "what are you" honestly, and decline off-topic
  // questions in his own voice, instead of running everything through
  // the document search and returning "I couldn't find anything."
  // Each pattern is a regex tested against the raw lowercased input.
  var INTENT_PATTERNS = {
    greeting: /^\s*(hi|hello|hey|hiya|yo|sup|what'?s\s?up|good\s?(morning|afternoon|evening))\b[\s!.]*$/i,
    thanks: /^\s*(thanks|thank\s?you|thx|ty|cheers|appreciate\s?it)\b/i,
    farewell: /^\s*(bye|goodbye|see\s?ya|later|cya)\b/i,
    how_are_you: /\b(how\s?are\s?you|how'?s\s?it\s?going|you\s?good|you\s?ok)\b/i,
    about_self: /\b(who\s?are\s?you|what\s?are\s?you|what'?s\s?your\s?name|tell\s?me\s?about\s?yourself)\b/i,
    capabilities: /\b(what\s?can\s?you\s?(do|answer|help)|what\s?do\s?you\s?know|how\s?do\s?you\s?work|how\s?were\s?you\s?(made|built)|are\s?you\s?(a\s?)?(real\s?)?(ai|robot|bot|human))\b/i,
    // "what is this", "whats this all", "what's this about", "what does
    // this do", "give me a summary", "tl;dr" — the single most obvious
    // thing a visitor asks a docs chatbot, and the one intent v1.1 was
    // missing entirely. Kept separate from about_self: this asks about
    // the SUBJECT (the page), not about Arthur. Checked only against
    // short, vague phrasings — "explain how X" style specific questions
    // fall through to search. The trailing "(all|about|going on)?" is
    // deliberately loose so filler words after "this" don't break the
    // match, since real visitors type "whats this all" without "about".
    summary: /^\s*(what'?s?\s?is\s?this|what'?s\s?this\b(\s?(all|about|going\s?on))?|what\s?does\s?this\s?(do|cover)|(give\s?me\s?a\s?)?(quick\s?)?summary|summarize\s?(this|it)?|tl;?dr|explain\s?this\s?(to\s?me)?)\s*[?.!]*\s*$/i
  };

  // Words that unambiguously signal a question is NOT about this page
  // or about Arthur — general-knowledge, current-events, or clearly
  // unrelated subject matter a keyword search might otherwise stumble
  // into matching by accident (e.g. a stray shared word like "state").
  // Kept short and specific on purpose: this is a blocklist for clearly
  // out-of-scope topics, not a whitelist that would make Arthur overly
  // suspicious of legitimate paraphrased questions.
  var OFF_TOPIC_SIGNALS = new RegExp(
    '\\b(' + [
      'weather', 'nuclear', 'weapon', 'bomb', 'president', 'election',
      'stock\\s?market', 'cryptocurrency', 'bitcoin', 'sports', 'football',
      'basketball', 'movie', 'celebrity', 'recipe', 'cook(ing)?', 'joke',
      'poem', 'song', 'lyrics', 'politics', 'religion', 'war', 'game\\s?of\\s?thrones',
      'capital\\s?of', 'population\\s?of', 'meaning\\s?of\\s?life',
      'write\\s?me\\s?a', 'translate', 'homework', 'essay'
    ].join('|') + ')\\b',
    'i'
  );

  // Synonym groups: indexing and searching both expand every token to
  // include its group's other members, so a question phrased with a
  // different (but equivalent) word than the page uses still matches.
  // This runs entirely on top of the existing stemmer/tokenizer — it
  // does not replace them, just widens what counts as "the same word."
  var SYNONYM_GROUPS = [
    ['guard', 'guards', 'condition', 'conditions', 'restrict', 'restriction'],
    ['role', 'roles', 'permission', 'permissions', 'access'],
    ['transition', 'transitions', 'move', 'moves', 'moving', 'change'],
    ['state', 'states', 'status'],
    ['instance', 'instances', 'record'],
    ['workflow', 'workflows', 'process', 'processes'],
    ['limitation', 'limitations', 'gap', 'gaps', 'missing', 'lacking', 'weakness'],
    ['owner', 'owners', 'ownerid', 'tenant'],
    ['history', 'log', 'audit', 'trail'],
    ['event', 'events', 'webhook', 'notification'],
    ['secure', 'security', 'safe', 'safety', 'auth', 'authentication'],
    ['summary', 'summarize', 'overview', 'recap', 'tldr'],
    ['explain', 'explanation', 'describe', 'clarify', 'meaning']
  ];
  var SYNONYM_MAP = {};
  SYNONYM_GROUPS.forEach(function (group) {
    var stemmedGroup = group.map(stem);
    stemmedGroup.forEach(function (word) {
      SYNONYM_MAP[word] = stemmedGroup;
    });
  });

  function expandWithSynonyms(tokens) {
    var expanded = tokens.slice();
    tokens.forEach(function (t) {
      if (SYNONYM_MAP[t]) {
        SYNONYM_MAP[t].forEach(function (syn) {
          if (expanded.indexOf(syn) === -1) expanded.push(syn);
        });
      }
    });
    return expanded;
  }

  function detectIntent(rawText) {
    // Slang-expanded first, so "who r u" and "wsp" match the same
    // patterns as "who are you" and "what's up" would.
    var text = expandSlang(rawText.trim());
    for (var intent in INTENT_PATTERNS) {
      if (INTENT_PATTERNS.hasOwnProperty(intent) && INTENT_PATTERNS[intent].test(text)) {
        return intent;
      }
    }
    return null;
  }

  /**
   * Creates a new Arthur instance.
   *
   * @param {Object} [options]
   * @param {string} [options.name='Arthur'] Display name, used in small
   *   talk replies and default fallback messages.
   * @param {string} [options.subject='this document'] How Arthur refers
   *   to the thing he's scoped to, in his own replies — e.g. "this
   *   workflow engine" reads better than the generic default in some
   *   deployments. Purely cosmetic; does not change what's indexed.
   * @param {string} [options.offTopicMessage] Overrides the default
   *   in-character refusal shown for questions flagged by
   *   `OFF_TOPIC_SIGNALS` or otherwise judged out of scope.
   * @param {string} [options.summary] A short, hand-written overview of
   *   the page, returned verbatim when a visitor asks "what is this" /
   *   "summarize this" / etc. Strongly recommended: without it, Arthur
   *   falls back to listing the indexed heading text in document order,
   *   which is honest but far less useful than an actual summary.
   * @param {number} [options.minScore=1] Minimum keyword-overlap score
   *   (roughly: matched-term weight) before a passage counts as a real
   *   match, versus falling back to the "don't know" response.
   */
  function create(options) {
    options = options || {};
    var name = options.name || 'Arthur';
    var minScore = typeof options.minScore === 'number' ? options.minScore : 1;

    // Each indexed entry: { el, text, tokens: {token: count}, weight }
    var index = [];

    function weightFor(el) {
      if (!el || !el.tagName) return 1;
      var tag = el.tagName.toLowerCase();
      if (tag === 'h1') return 3;
      if (tag === 'h2') return 2.5;
      if (tag === 'h3' || tag === 'h4') return 2;
      return 1;
    }

    /**
     * Indexes a list of elements (or plain {text, el?, weight?} objects).
     * Call multiple times to add more content; does not clear existing
     * index entries first — call `clear()` if you need to rebuild.
     *
     * @param {(Element|{text:string,el?:Element,weight?:number})[]} items
     */
    function addIndex(items) {
      Array.prototype.forEach.call(items, function (item) {
        var el = null, text = '', weight = 1;
        if (item && item.nodeType === 1) {
          el = item;
          text = item.textContent || '';
          weight = weightFor(item);
        } else if (item && typeof item === 'object') {
          el = item.el || null;
          text = item.text || '';
          weight = typeof item.weight === 'number' ? item.weight : weightFor(el);
        } else {
          text = String(item);
        }
        text = text.trim();
        if (!text) return;

        // Indexed under both the passage's own words and each word's
        // synonym-group members, so a question phrased with a synonym
        // ("permissions" for "roles") still finds this passage without
        // needing the exact word the page happens to use.
        var tokens = {};
        expandWithSynonyms(tokenize(text)).forEach(function (t) {
          tokens[t] = (tokens[t] || 0) + 1;
        });

        index.push({ el: el, text: text, tokens: tokens, weight: weight });
      });
    }

    function clear() {
      index = [];
    }

    function size() {
      return index.length;
    }

    /**
     * Scores every indexed passage against a question and returns the
     * top matches, best first. Does not consult any external service —
     * pure in-memory keyword overlap over whatever was indexed.
     *
     * @param {string} question
     * @param {number} [limit=3]
     * @returns {{el:Element|null, text:string, score:number}[]}
     */
    function search(question, limit) {
      limit = typeof limit === 'number' ? limit : 3;
      var qTokens = expandWithSynonyms(tokenize(question));
      if (!qTokens.length) return [];

      var qCounts = {};
      qTokens.forEach(function (t) { qCounts[t] = (qCounts[t] || 0) + 1; });

      var scored = index.map(function (entry, position) {
        var score = 0;
        Object.keys(qCounts).forEach(function (t) {
          if (entry.tokens[t]) {
            // Term frequency in both question and passage, scaled by
            // the passage's structural weight (headings score higher).
            score += Math.min(entry.tokens[t], 3) * qCounts[t];
          }
        });
        score *= entry.weight;
        // `position` is exposed so ask() can pull in a matched heading's
        // very next passage in document order — usually the paragraph
        // that heading introduces — even when that paragraph doesn't
        // itself share a keyword with the question.
        return { el: entry.el, text: entry.text, score: score, position: position };
      });

      scored.sort(function (a, b) { return b.score - a.score; });
      return scored.filter(function (s) { return s.score > 0; }).slice(0, limit);
    }

    // Small talk replies. Kept short, in Arthur's own voice, and
    // clearly scoped — every one of these either engages briefly and
    // redirects toward the document, or states his limits honestly
    // rather than pretending to be a general-purpose assistant.
    // 'summary' is deliberately not handled here — it needs access to
    // the index to build a fallback, so ask() handles it directly.
    function smallTalkReply(intent) {
      var subject = options.subject || 'this document';
      switch (intent) {
        case 'greeting':
          return "Hey! I'm " + name + ". Ask me anything about " + subject + " — how something works, what a term means, or for a quick summary of a section.";
        case 'thanks':
          return "You're welcome! Anything else about " + subject + " I can help with?";
        case 'farewell':
          return "Bye! Come back if you have more questions about " + subject + ".";
        case 'how_are_you':
          return "I'm doing well, thanks for asking. I'm here whenever you want to ask something about " + subject + ".";
        case 'about_self':
          return "I'm " + name + ", a small chat assistant built into this page. I don't reason freely or browse the web — I search " + subject + "'s own text for the passage that answers your question, and I stick to that and to questions about myself.";
        case 'capabilities':
          return "I can answer questions about " + subject + " — explaining how something works, what a term means, or summarizing a section — and I can tell you about myself. I'm a local keyword-search tool, not a general AI, so I won't answer things unrelated to " + subject + ", and I can't browse the web or make things up.";
        default:
          return null;
      }
    }

    // Builds the answer to "what is this" / "summarize this" / etc.
    // Prefers the hand-written options.summary when given (strongly
    // recommended — see create()'s JSDoc). Falls back to stitching
    // together the highest-weighted indexed passages (usually the
    // biggest headings) in document order, which is honest about the
    // page's shape even without a real summary supplied.
    function buildSummaryAnswer() {
      var subject = options.subject || 'this document';
      if (options.summary) {
        return { text: options.summary, sources: [] };
      }
      if (!index.length) {
        return {
          text: "I don't have anything indexed yet, so I can't summarize " + subject + ".",
          sources: []
        };
      }
      var headingLike = index
        .map(function (entry, position) { return { entry: entry, position: position }; })
        .filter(function (x) { return x.entry.weight >= 2; })
        .sort(function (a, b) { return a.position - b.position; })
        .slice(0, 6);
      var chosen = headingLike.length ? headingLike : index.slice(0, 3).map(function (entry, position) {
        return { entry: entry, position: position };
      });
      var topicList = chosen.map(function (x) { return x.entry.text; }).join(', ');
      return {
        text: "Here's the shape of " + subject + ": it covers " + topicList + ". Ask me about any of these and I'll go into detail.",
        sources: chosen.map(function (x) { return x.entry.el; }).filter(Boolean)
      };
    }

    // The off-topic refusal, stated once so every caller (this engine
    // and any calling UI) can rely on getting the same boundary message
    // rather than each writing its own.
    function offTopicReply() {
      var subject = options.subject || 'this document';
      return options.offTopicMessage ||
        ("I'm built specifically to answer questions about " + subject + " and about myself — I won't get into that. Ask me something about " + subject + " instead.");
    }

    /**
     * Decides whether a question is in scope: it either matches
     * something in the index, or it's recognizable small talk / a
     * question about Arthur himself. Anything else — including
     * questions that hit a known off-topic signal word, or that
     * simply share no vocabulary with the indexed content at all — is
     * out of scope. Exposed separately from `ask()` so a calling UI
     * can pre-check a question before deciding how to render it.
     *
     * @param {string} question
     * @returns {boolean}
     */
    function isOnTopic(question) {
      var intent = detectIntent(question);
      if (intent) return true;
      if (OFF_TOPIC_SIGNALS.test(question)) return false;
      var results = search(question, 1);
      return results.length > 0 && results[0].score >= minScore;
    }

    /**
     * Asks Arthur a question. Checks for small talk first, then
     * whether the question is clearly off-topic, then falls back to
     * document search. Returns a best-effort natural-language answer
     * built from the top matching passage(s), the source elements it
     * drew from (for the caller to scroll to / highlight), and a rough
     * confidence score.
     *
     * @param {string} question
     * @param {Object} [opts]
     * @param {number} [opts.limit=2] How many source passages to draw from.
     * @returns {{answer: string, sources: Element[], confidence: number, matched: boolean, intent: string, language?: string}}
     *   `language` is only present when a non-English small-talk match
     *   fired (e.g. 'es', 'fr') — absent for English and for document search.
     */
    function ask(question, opts) {
      opts = opts || {};
      var limit = typeof opts.limit === 'number' ? opts.limit : 2;
      var subject = options.subject || 'this document';

      // Non-English small talk, checked first: if the message matches
      // a greeting/thanks/farewell/about-self/how-are-you pattern in
      // one of Arthur's known languages, reply in that same language.
      // This is real hand-written multilingual small talk, not machine
      // translation — document search itself still only matches the
      // language the page's own content is written in.
      var langCode = detectLanguage(question);
      if (langCode) {
        var localIntent = detectLocalizedIntent(question, langCode);
        var phrases = LOCALIZED_REPLIES[langCode];
        if (localIntent && phrases && phrases[localIntent]) {
          return {
            answer: fillTemplate(phrases[localIntent], name, subject),
            sources: [],
            confidence: 1,
            matched: true,
            intent: localIntent,
            language: langCode
          };
        }
      }

      var intent = detectIntent(question);
      if (intent === 'summary') {
        var built = buildSummaryAnswer();
        return {
          answer: built.text,
          sources: built.sources,
          confidence: 1,
          matched: true,
          intent: 'summary'
        };
      }
      if (intent) {
        return {
          answer: smallTalkReply(intent),
          sources: [],
          confidence: 1,
          matched: true,
          intent: intent
        };
      }

      if (OFF_TOPIC_SIGNALS.test(question)) {
        return {
          answer: offTopicReply(),
          sources: [],
          confidence: 0,
          matched: false,
          intent: 'off_topic'
        };
      }

      var results = search(question, limit);

      if (!results.length || results[0].score < minScore) {
        return {
          answer: "I couldn't find anything about that in " + (options.subject || 'this document') + ". Try asking about one of its section topics, or ask me what I can help with.",
          sources: [],
          confidence: 0,
          matched: false,
          intent: 'no_match'
        };
      }

      var topScore = results[0].score;

      // If the best match is a short passage (typically a bare heading
      // like "Location"), pull in whatever was indexed immediately after
      // it in document order — usually the paragraph that heading
      // introduces — even though that paragraph may not itself share a
      // keyword with the question. Without this, a question that only
      // matches a heading returns just the heading's own short text.
      var topWordCount = tokenize(results[0].text).length;
      if (topWordCount <= 4 && results[0].position + 1 < index.length) {
        var neighbor = index[results[0].position + 1];
        var alreadyIncluded = results.some(function (r) { return r.text === neighbor.text; });
        if (!alreadyIncluded) {
          results = results.concat([{ el: neighbor.el, text: neighbor.text, score: 0, position: results[0].position + 1 }]);
        }
      }

      var answerText = results.map(function (r) { return r.text; }).join(' ');
      var sources = results.map(function (r) { return r.el; }).filter(Boolean);

      // Confidence is a rough, bounded heuristic — not a calibrated
      // probability. It exists so a calling UI can hedge low-confidence
      // answers ("I think this is about...") versus confident ones.
      var confidence = Math.max(0, Math.min(1, topScore / 12));

      return {
        answer: answerText,
        sources: sources,
        confidence: confidence,
        matched: true,
        intent: 'search'
      };
    }

    return {
      name: name,
      index: addIndex,
      clear: clear,
      size: size,
      search: search,
      isOnTopic: isOnTopic,
      ask: ask
    };
  }

  return { create: create, VERSION: '1.2.0' };
});
