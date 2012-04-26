module.exports = Templar

var path = require('path')
, fs = require('fs')
, util = require('util')
, LRU = require('lru-cache')
, compileCache = new LRU(50)
, outputCache = new LRU(500)
, crypto = require('crypto')
, templateCache = {}
, loaded = {}

// should really load the template folder before using it.
Templar.loadFolder = loadFolder

function Templar (req, res, opts) {
  if (!opts) throw new Error('Please provide options to Templar')

  var folder = opts.folder
  , engine = opts.engine

  if (!engine || !folder) {
    throw new Error('Templar needs engine and folder options')
  }

  folder = path.resolve(folder)


  // In order to support include() methods, we need to load up
  // all of the templates in the folder.  This has the other
  // somewhat nice effect of meaning that we don't have to do
  // any fs.readFile calls later on.
  //
  // Of course, this sucks a lot if you have a lot of different
  // folders where templates go, but that's pretty rare.
  if (!loaded[folder]) loadFolder(folder)

  return template

  function template (f, data, code) {
    for (var i = 0; i < arguments.length; i ++) {
      switch (typeof arguments[i]) {
        case 'number': code = arguments[i]; break
        case 'string': f = arguments[i]; break
        case 'object': data = arguments[i]; break
        default: throw new Error('bad argument to template')
      }
    }

    if (!f) throw new Error('no template provided')
    f = path.resolve(folder, f)

    // the data is part of the ETag
    var tpl = templateCache[f]

    if (!tpl) throw new Error('invalid template: '+f)

    // serving the same template with the same data = same result
    var ins = util.inspect(data, true, Infinity, false)
    , tag = getETag(tpl.key + ":" + ins)
    if (req.headers['if-none-match'] === tag) {
      res.statusCode = 304
      return res.end()
    }
    res.setHeader('etag', tag)

    // only generate if we have to
    var finished = outputCache.get(tag)

    if (!finished) {
      // only compile if we have to.
      var compiled = compileCache.get(f)
      if (!compiled) {
        compiled = engine.compile(
          tpl.contents, { filename: f, debug: opts.debug })
      }
      if (!compiled) throw new Error('failed to compile template: '+f)

      finished = compiled(data)
      outputCache.set(tag, finished)
    }

    // ok, actually send a result.
    res.statusCode = code || 200
    var curCT = res.getHeader('content-type')
    if (!curCT) res.setHeader('content-type', 'text/html')
    res.end(finished)
  }
}

function getETag (str) {
  var h = crypto.createHash("sha1")
  h.update(str)
  return '"' + h.digest('base64') + '"'
}

function loadFolder (folder) {
  loadFolder_(folder, templateCache, 0, 10)
  loaded[folder] = true
}

function loadFolder_ (folder, c, depth, maxDepth) {
  if (depth > maxDepth) return

  // synchronously read all the files in the folder, and save
  // their data and signatures for later.
  var queue = []
  fs.readdirSync(folder).forEach(function (file) {
    file = path.resolve(folder, file)
    var st = fs.statSync(file)
    if (!st) return
    if (st.isDirectory()) return queue.push(file)
    st.contents = fs.readFileSync(file, 'utf8')
    st.key = st.dev + ':' + st.ino
    c[file] = st
  })
  queue.forEach(function (folder) {
    loadFolder_(folder, c, depth + 1, maxDepth)
  })
}
