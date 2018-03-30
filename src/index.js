const cheerio = require('cheerio')
const url = require('url')
const request = require('request-promise-native')
const encodeUrl = require('encodeurl')
const absCss = require('css-absolutely')
const parseImport = require('parse-import')

const defaultOpts = {
  resolveTo: null,
  download: true
}

/**
 * Insert html and receive back html with all stylesheets embedded. Can resolve relative urls inside stylesheets to a given root url.
 * @function embedStylesheets
 * @param {string} html - the HTML to parse for stylesheets
 * @param { { resolveTo: string, download: Boolean } } opts - object with options.
 * `resolveTo` defines to which root url discovered urls in stylesheets should be resolved.
 * `download` defines whether resolved stylesheets should be downloaded and embedded, defaults to true.
 * @returns { { html: string, stylesheetUrls: [string], stylesheets: [string] } } - an object returning the html with stylesheets embedded, an array of unique stylesheet urls that were found, and an array of stylesheets with inner urls resolved.
 * @example
 * const embedStylesheets = require('html-embed-stylesheets')
 *
 * async function main () {
 *   const { html } = await embedStylesheets(html, { resolveTo: 'https://www.example.com' })
 *   console.log(html)
 * }
 *
 * main()
 */
async function embedStylesheets (html, opts = {}) {
  opts = Object.assign({}, defaultOpts, opts)
  
  const $ = cheerio.load(html, {
    decodeEntities: true,
    lowerCaseTags: true,
    lowerCaseAttributeNames: true
  })
  
  // the sources to be resolved
  let sources = []
  
  // gather links while storing their source href and original reference
  $('link[type="text/css"],link[rel="stylesheet"]')
  .each((i, link) => {
    if (link.attribs.href && link.attribs.href.trim()) {
      sources.push({
        href: encodeUrl(link.attribs.href),
        originalElement: link
      })
    }
  })

  // gather sources from @import statements in embedded stylesheets
  $('style')
  .each((i, style) => {
    const $style = $(style)
    const imports = parseImport($style.html())
    for (let imp of imports) {
      sources.push({
        href: encodeUrl(imp.path),
        originalElement: style,
        condition: imp.condition,
        insertBefore: true
      })

      // remove the now embedded import statement
      $style.html($style.html().replace(`${imp.rule};`, ''))
    }
  })
  
  // remove any stylesheet preloads because these assets are now embedded
  $('link[rel="preload"][as="style"]').remove()
  $('link[rel="prefetch"][href*=".css"]').remove()
  
  // resolve urls to the given base path
  if (opts.resolveTo) {
    sources = sources.map(source => {
      source.href = url.resolve(opts.resolveTo, source.href)
      return source
    })
  }
  
  // remove duplicate sources
  sources = sources
  .filter((source, i, arr) => {
    if (arr.map(mSource => mSource.href).indexOf(source.href) === i) {
      return true
    }
    else {
      $(source.originalElement).remove()
      return false
    }
  })
  
  // download each stylesheet
  let stylesheets = []
  let notFounds = []
  let index = 0
  if (opts.download) {
    for (let source of sources) {
      const results = await getStylesheetsFromSrc(source, opts.resolveTo)
      stylesheets = stylesheets.concat(results.stylesheets)
      notFounds = notFounds.concat(results.notFounds)
    }
  }
  
  // embed each stylesheet into html
  for (let stylesheet of stylesheets) {
    if (stylesheet.condition) {
      stylesheet.css = `
      @media ${stylesheet.condition} {
        ${stylesheet.css}
      }
      `
    }

    if (stylesheet.insertBefore) {
      $(stylesheet.originalElement).before(`<style>${stylesheet.css}</style>`)
    }
    else {
      $(stylesheet.originalElement).replaceWith(`<style>${stylesheet.css}</style>`)
    }
  }
    
  return {
    html: $.html(),
    stylesheetUrls: sources.map(o => o.href),
    stylesheets: stylesheets.map(o => o.css),
    notFounds
  }
}

async function getStylesheetsFromSrc(source, resolveTo = '', insertBefore = false) {
  if (source.insertBefore) insertBefore = true
  
  const sUrl = source.href
  let stylesheets = []
  let notFounds = []
      
  let { statusCode, body: stylesheet, headers } = await request({
    uri: sUrl,
    gzip: true,
    encoding: 'utf8',
    resolveWithFullResponse: true,
    simple: false
  })
  
  if (statusCode >= 200 && statusCode < 300 && headers['content-type']
    && headers['content-type'].indexOf('text/css') !== -1) {
    if (resolveTo) {
      stylesheet = absCss(stylesheet, sUrl)
    }
    
    // resolve special case where svgs might use data:img uris with utf8 encoding
    // and can therefore include <style> tags too; these must be removed
    // see also https://css-tricks.com/probably-dont-base64-svg/
    // and https://regex101.com/r/ieOR59/1
    stylesheet = stylesheet.replace(/<style[\s\S]*?>([\s\S]*?)<\/style[\s\S]*?>/ig, '')

    // embed imports, if any
    const imports = parseImport(stylesheet)
    for (let imp of imports) {
      const href = url.resolve(resolveTo, imp.path)
      const results = await getStylesheetsFromSrc({
        href: href,
        condition: imp.condition,
        originalElement: source.originalElement
      }, resolveTo, true)
      stylesheets = stylesheets.concat(results.stylesheets)
      notFounds = notFounds.concat(results.notFounds)

      // remove the now embedded import statement
      stylesheet = stylesheet.replace(`${imp.rule};`, '')
    }
    
    stylesheets.push({
      css: stylesheet,
      originalElement: source.originalElement,
      condition: source.condition,
      insertBefore
    })
  }
  else {
    notFounds.push(sUrl)
  }

  return {
    stylesheets,
    notFounds
  }
}

module.exports = embedStylesheets
