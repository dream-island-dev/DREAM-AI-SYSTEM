/**
 * ============================================================================
 *  Dream Island / Tzalam Nadlan — Drive RAG Bridge (Google Apps Script)
 * ----------------------------------------------------------------------------
 *  Deployed as a Web App and called server-side by the Supabase `chat` Edge
 *  Function:
 *
 *      GET  ?action=search&folder=<DriveFolderUrlOrId>&query=<text>&limit=5
 *
 *  Returns JSON:
 *      { ok: true, results: [ { name, snippet, score, url } ], engine: "keyword" }
 *
 *  The result snippets are injected into the Gemini/Claude prompt as context
 *  (Retrieval-Augmented Generation) BEFORE the model answers.
 *
 *  OWNER ACCOUNT: deploy this script under tzalamnadlan@gmail.com so it has
 *  access to that account's Drive. In the deploy dialog set:
 *      Execute as:  Me (tzalamnadlan@gmail.com)
 *      Who has access:  Anyone  (the Edge Function calls it unauthenticated)
 *
 *  NOTE ON "SEMANTIC" SEARCH:
 *  This implementation uses fast tokenized term-frequency scoring (BM25-lite),
 *  which works well for keyword-rich operational docs and needs no external
 *  services. TRUE vector/semantic search would require generating embeddings
 *  (e.g. Vertex AI text-embeddings) and a vector store — see getEmbedding()
 *  stub at the bottom for the optional upgrade path.
 * ============================================================================
 */

// ── Tunables ────────────────────────────────────────────────────────────────
var DEFAULT_LIMIT   = 5;      // max documents returned
var MAX_FILES_SCAN  = 200;    // safety cap on files scanned per request
var MAX_DEPTH       = 3;      // sub-folder recursion depth
var SNIPPET_RADIUS  = 220;    // chars of context around the best match
var MAX_TEXT_CHARS  = 40000;  // cap text read per file (perf)
var FILENAME_WEIGHT = 5;      // a query hit in the filename counts this much

// Hebrew + English stop-words to ignore when scoring.
var STOPWORDS = {
  'של':1,'את':1,'עם':1,'על':1,'אם':1,'או':1,'גם':1,'כי':1,'זה':1,'זו':1,'יש':1,
  'לא':1,'מה':1,'מי':1,'הוא':1,'היא':1,'אני':1,'אתה':1,'הם':1,'הן':1,'אנחנו':1,
  'the':1,'a':1,'an':1,'of':1,'to':1,'and':1,'or':1,'is':1,'are':1,'in':1,'on':1,
  'for':1,'with':1,'as':1,'at':1,'by':1,'it':1,'this':1,'that':1,'be':1,'i':1
};

// ── Entry point ───────────────────────────────────────────────────────────────
function doGet(e) {
  try {
    var params = (e && e.parameter) || {};
    var action = params.action || 'search';

    if (action === 'ping') {
      return json({ ok: true, pong: true, time: new Date().toISOString() });
    }

    if (action === 'search') {
      var query  = (params.query || '').toString();
      var folder = (params.folder || '').toString();
      var limit  = Math.min(parseInt(params.limit, 10) || DEFAULT_LIMIT, 20);

      if (!query.trim())  return json({ ok: false, error: 'missing query' });
      if (!folder.trim()) return json({ ok: false, error: 'missing folder' });

      var folderId = extractFolderId(folder);
      if (!folderId) return json({ ok: false, error: 'could not parse folder id' });

      var results = searchDrive(folderId, query, limit);
      return json({ ok: true, results: results, engine: 'keyword' });
    }

    return json({ ok: false, error: 'unknown action: ' + action });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

// Allow POST too (same contract, body = JSON).
function doPost(e) {
  try {
    var body = e && e.postData && e.postData.contents
      ? JSON.parse(e.postData.contents) : {};
    return doGet({ parameter: body });
  } catch (err) {
    return json({ ok: false, error: String(err && err.message || err) });
  }
}

// ── Core search ───────────────────────────────────────────────────────────────
function searchDrive(folderId, query, limit) {
  var tokens = tokenize(query);
  if (tokens.length === 0) return [];

  var folder = DriveApp.getFolderById(folderId);
  var scored = [];
  var scanned = { n: 0 };

  scanFolder(folder, tokens, scored, scanned, 0);

  scored.sort(function (a, b) { return b.score - a.score; });

  return scored
    .filter(function (r) { return r.score > 0; })
    .slice(0, limit)
    .map(function (r) {
      return { name: r.name, snippet: r.snippet, score: r.score, url: r.url };
    });
}

function scanFolder(folder, tokens, scored, scanned, depth) {
  if (depth > MAX_DEPTH || scanned.n >= MAX_FILES_SCAN) return;

  var files = folder.getFiles();
  while (files.hasNext() && scanned.n < MAX_FILES_SCAN) {
    scanned.n++;
    var file = files.next();
    try {
      var text = getFileText(file);
      var name = file.getName();
      var hay  = (name + '\n' + text).toLowerCase();

      var score = 0;
      for (var i = 0; i < tokens.length; i++) {
        var tok = tokens[i];
        score += countOccurrences(text.toLowerCase(), tok);
        // Filename hits weighted heavier.
        if (name.toLowerCase().indexOf(tok) !== -1) score += FILENAME_WEIGHT;
      }

      if (score > 0) {
        scored.push({
          name: name,
          score: score,
          snippet: buildSnippet(text, tokens),
          url: safeUrl(file)
        });
      }
    } catch (err) {
      // skip unreadable file
    }
  }

  // Recurse into sub-folders.
  var subs = folder.getFolders();
  while (subs.hasNext() && scanned.n < MAX_FILES_SCAN) {
    scanFolder(subs.next(), tokens, scored, scanned, depth + 1);
  }
}

// ── Text extraction by MIME type ───────────────────────────────────────────────
function getFileText(file) {
  var mime = file.getMimeType();

  if (mime === MimeType.GOOGLE_DOCS) {
    return DocumentApp.openById(file.getId()).getBody().getText().slice(0, MAX_TEXT_CHARS);
  }

  if (mime === MimeType.GOOGLE_SHEETS) {
    var ss = SpreadsheetApp.openById(file.getId());
    var out = [];
    var sheets = ss.getSheets();
    for (var s = 0; s < sheets.length && out.join(' ').length < MAX_TEXT_CHARS; s++) {
      var values = sheets[s].getDataRange().getValues();
      for (var r = 0; r < values.length; r++) out.push(values[r].join(' '));
    }
    return out.join('\n').slice(0, MAX_TEXT_CHARS);
  }

  if (mime === MimeType.PLAIN_TEXT || mime === 'text/csv' || mime === 'application/json') {
    return file.getBlob().getDataAsString().slice(0, MAX_TEXT_CHARS);
  }

  if (mime === MimeType.GOOGLE_SLIDES) {
    var pres = SlidesApp.openById(file.getId());
    var slides = pres.getSlides();
    var txt = [];
    for (var p = 0; p < slides.length; p++) {
      var shapes = slides[p].getShapes();
      for (var sh = 0; sh < shapes.length; sh++) {
        try { txt.push(shapes[sh].getText().asString()); } catch (e) {}
      }
    }
    return txt.join('\n').slice(0, MAX_TEXT_CHARS);
  }

  // PDFs / images / others: filename-only matching (text extraction would
  // require Drive OCR conversion — out of scope for the keyword engine).
  return '';
}

// ── Helpers ─────────────────────────────────────────────────────────────────
function tokenize(query) {
  var raw = query.toLowerCase().split(/[^0-9a-z֐-׿]+/);
  var seen = {};
  var out = [];
  for (var i = 0; i < raw.length; i++) {
    var t = raw[i];
    if (t.length < 2) continue;        // drop single chars
    if (STOPWORDS[t]) continue;        // drop stop-words
    if (seen[t]) continue;             // dedupe
    seen[t] = 1;
    out.push(t);
  }
  return out;
}

function countOccurrences(haystack, needle) {
  if (!needle) return 0;
  var count = 0, idx = 0;
  while ((idx = haystack.indexOf(needle, idx)) !== -1) { count++; idx += needle.length; }
  return count;
}

function buildSnippet(text, tokens) {
  if (!text) return '';
  var lower = text.toLowerCase();
  var pos = -1;
  for (var i = 0; i < tokens.length; i++) {
    var p = lower.indexOf(tokens[i]);
    if (p !== -1 && (pos === -1 || p < pos)) pos = p;
  }
  if (pos === -1) pos = 0;
  var start = Math.max(0, pos - SNIPPET_RADIUS);
  var end   = Math.min(text.length, pos + SNIPPET_RADIUS);
  var snip  = text.slice(start, end).replace(/\s+/g, ' ').trim();
  return (start > 0 ? '…' : '') + snip + (end < text.length ? '…' : '');
}

function extractFolderId(input) {
  if (!input) return '';
  // Already an ID?
  if (/^[a-zA-Z0-9_-]{20,}$/.test(input)) return input;
  // .../folders/<id>  or  ...?id=<id>  or  .../d/<id>
  var m = input.match(/\/folders\/([a-zA-Z0-9_-]+)/) ||
          input.match(/[?&]id=([a-zA-Z0-9_-]+)/) ||
          input.match(/\/d\/([a-zA-Z0-9_-]+)/);
  return m ? m[1] : '';
}

function safeUrl(file) {
  try { return file.getUrl(); } catch (e) { return ''; }
}

function json(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

// ── OPTIONAL upgrade: true semantic search via embeddings ─────────────────────
// To switch from keyword to vector search, generate an embedding for the query
// and each document chunk, then rank by cosine similarity. Requires a Vertex AI
// (or Gemini) embeddings endpoint + API key stored in Script Properties.
//
// function getEmbedding(text) {
//   var key = PropertiesService.getScriptProperties().getProperty('GEMINI_API_KEY');
//   var res = UrlFetchApp.fetch(
//     'https://generativelanguage.googleapis.com/v1beta/models/text-embedding-004:embedContent?key=' + key,
//     { method: 'post', contentType: 'application/json',
//       payload: JSON.stringify({ content: { parts: [{ text: text }] } }) });
//   return JSON.parse(res.getContentText()).embedding.values; // number[]
// }
