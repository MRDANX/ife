var identRE = /^[$_a-zA-Z]+[\w$]*$/

var Path = {}

/**
 * Path-parsing algorithm scooped from Polymer/observe-js
 */

var pathStateMachine = {
  'beforePath': {
    'ws': ['beforePath'],
    'ident': ['inIdent', 'append'],
    '[': ['beforeElement'],
    'eof': ['afterPath']
  },

  'inPath': {
    'ws': ['inPath'],
    '.': ['beforeIdent'],
    '[': ['beforeElement'],
    'eof': ['afterPath']
  },

  'beforeIdent': {
    'ws': ['beforeIdent'],
    'ident': ['inIdent', 'append']
  },

  'inIdent': {
    'ident': ['inIdent', 'append'],
    '0': ['inIdent', 'append'],
    'number': ['inIdent', 'append'],
    'ws': ['inPath', 'push'],
    '.': ['beforeIdent', 'push'],
    '[': ['beforeElement', 'push'],
    'eof': ['afterPath', 'push']
  },

  'beforeElement': {
    'ws': ['beforeElement'],
    '0': ['afterZero', 'append'],
    'number': ['inIndex', 'append'],
    "'": ['inSingleQuote', 'append', ''],
    '"': ['inDoubleQuote', 'append', '']
  },

  'afterZero': {
    'ws': ['afterElement', 'push'],
    ']': ['inPath', 'push']
  },

  'inIndex': {
    '0': ['inIndex', 'append'],
    'number': ['inIndex', 'append'],
    'ws': ['afterElement'],
    ']': ['inPath', 'push']
  },

  'inSingleQuote': {
    "'": ['afterElement'],
    'eof': 'error',
    'else': ['inSingleQuote', 'append']
  },

  'inDoubleQuote': {
    '"': ['afterElement'],
    'eof': 'error',
    'else': ['inDoubleQuote', 'append']
  },

  'afterElement': {
    'ws': ['afterElement'],
    ']': ['inPath', 'push']
  }
}

function noop () {}

/**
 * Determine the type of a character in a keypath.
 *
 * @param {Char} char
 * @return {String} type
 */

function getPathCharType (char) {
  if (char === undefined) {
    return 'eof'
  }

  var code = char.charCodeAt(0)

  switch(code) {
    case 0x5B: // [
    case 0x5D: // ]
    case 0x2E: // .
    case 0x22: // "
    case 0x27: // '
    case 0x30: // 0
      return char

    case 0x5F: // _
    case 0x24: // $
      return 'ident'

    case 0x20: // Space
    case 0x09: // Tab
    case 0x0A: // Newline
    case 0x0D: // Return
    case 0xA0:  // No-break space
    case 0xFEFF:  // Byte Order Mark
    case 0x2028:  // Line Separator
    case 0x2029:  // Paragraph Separator
      return 'ws'
  }

  // a-z, A-Z
  if ((0x61 <= code && code <= 0x7A) ||
      (0x41 <= code && code <= 0x5A)) {
    return 'ident'
  }

  // 1-9
  if (0x31 <= code && code <= 0x39) {
    return 'number'
  }

  return 'else'
}

/**
 * Parse a string path into an array of segments
 * Todo implement cache
 *
 * @param {String} path
 * @return {Array|undefined}
 */

function parsePath (path) {
  var keys = []
  var index = -1
  var mode = 'beforePath'
  var c, newChar, key, type, transition, action, typeMap

  var actions = {
    push: function() {
      if (key === undefined) {
        return
      }
      keys.push(key)
      key = undefined
    },
    append: function() {
      if (key === undefined) {
        key = newChar
      } else {
        key += newChar
      }
    }
  }

  function maybeUnescapeQuote () {
    var nextChar = path[index + 1]
    if ((mode === 'inSingleQuote' && nextChar === "'") ||
        (mode === 'inDoubleQuote' && nextChar === '"')) {
      index++
      newChar = nextChar
      actions.append()
      return true
    }
  }

  while (mode) {
    index++
    c = path[index]

    if (c === '\\' && maybeUnescapeQuote()) {
      continue
    }

    type = getPathCharType(c)
    typeMap = pathStateMachine[mode]
    transition = typeMap[type] || typeMap['else'] || 'error'

    if (transition === 'error') {
      return // parse error
    }

    mode = transition[0]
    action = actions[transition[1]] || noop
    newChar = transition[2] === undefined
      ? c
      : transition[2]
    action()

    if (mode === 'afterPath') {
      return keys
    }
  }
}

/**
 * Format a accessor segment based on its type.
 *
 * @param {String} key
 * @return {Boolean}
 */

function formatAccessor(key) {
  if (identRE.test(key)) { // identifier
    return '.' + key
  } else if (+key === key >>> 0) { // bracket index
    return '[' + key + ']';
  } else { // bracket string
    return '["' + key.replace(/"/g, '\\"') + '"]';
  }
}

/**
 * Compiles a getter function with a fixed path.
 *
 * @param {Array} path
 * @return {Function}
 */

Path.compileGetter = function (path) {
  var body = 'if (o != null'
  var pathString = 'o'
  var key
  for (var i = 0, l = path.length - 1; i < l; i++) {
    key = path[i]
    pathString += formatAccessor(key)
    body += ' && ' + pathString + ' != null'
  }
  key = path[i]
  pathString += formatAccessor(key)
  body += ') return ' + pathString
  return new Function('o', body)
}

/**
 * External parse that check for a cache hit first
 *
 * @param {String} path
 * @return {Array|undefined}
 */

Path.parse = function (path) {
  var hit = pathCache.get(path)
  if (!hit) {
    hit = parsePath(path)
    if (hit) {
      hit.get = Path.compileGetter(hit)
      pathCache.put(path, hit)
    }
  }
  return hit
}

/**
 * Get from an object from a path string
 *
 * @param {Object} obj
 * @param {String} path
 */

Path.get = function (obj, path) {
  path = Path.parse(path)
  if (path) {
    return path.get(obj)
  }
}

/**
 * Get from an object from an array
 *
 * @param {Object} obj
 * @param {Array} path
 */

Path.getFromArray = function (obj, path) {
  for (var i = 0, l = path.length; i < l; i++) {
    if (obj == null) return
    obj = obj[path[i]]
  }
  return obj
}

/**
 * Get from an object from an Observer-delimitered path.
 * e.g. "a\bb\bc"
 *
 * @param {Object} obj
 * @param {String} path
 */

Path.getFromObserver = function (obj, path) {
  // var hit = pathCache.get(path)
  var hit
  if (!hit) {
    hit = path.split(Observer.pathDelimiter)
    hit.get = Path.compileGetter(hit)
    // pathCache.put(path, hit)
  }
  return hit.get(obj)
}

/**
 * Set on an object from a path
 *
 * @param {Object} obj
 * @param {String | Array} path
 * @param {*} val
 */

Path.set = function (obj, path, val) {
  if (typeof path === 'string') {
    path = Path.parse(path)
  }
  if (!path || !isSettable(obj)) {
    return false
  }
  var last, key
  for (var i = 0, l = path.length - 1; i < l; i++) {
    last = obj
    key = path[i]
    obj = obj[key]
    if (!isSettable(obj)) {
      obj = {}
      add(last, key, obj)
    }
  }
  key = path[i]
  if (obj.hasOwnProperty(key)) {
    obj[key] = val
  } else {
    add(obj, key, val)
  }
  return true
}

/**
 * Check if a value is an object that can have values
 * set on it. Slightly faster than _.isObject.
 *
 * @param {*} val
 * @return {Boolean}
 */

function isSettable (val) {
  return val && typeof val === 'object'
}

/**
 * Add a property to an object, using $add if target
 * has been augmented by Vue's observer.
 *
 * @param {Object} obj
 * @param {String} key
 * @param {*} val
 */

function add (obj, key, val) {
  if (obj.$add) {
    obj.$add(key, val)
  } else {
    obj[key] = val
  }
}