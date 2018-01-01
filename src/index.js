const cheerio = require('cheerio')
const url = require('url')
const request = require('request-promise-native')
const encodeUrl = require('encodeurl')
const absCss = require('css-absolutely')

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
  const sources = []
  
  // links
  const $links = $('link[type="text/css"],link[rel="stylesheet"]')
  .filter((i, link) => {
    return link.attribs.href
      && link.attribs.href.trim()
      && sources.push(encodeUrl(link.attribs.href))
  })
  .remove()
  
  // remove any stylesheet preloads because these assets are now embedded
  $('link[rel="preload"][as="style"]').remove()
  $('link[rel="prefetch"][href*=".css"]').remove()
  
  // generate a unique set of stylesheets to be embedded
  // urls are resolved to the given base path
  const stylesheetUrls = new Set()
  for (var source of sources) {
    if (opts.resolveTo) {
      source = url.resolve(opts.resolveTo, source)
    }
    stylesheetUrls.add(source)
  }
  
  // download each stylesheet
  let stylesheets = []
  let notFounds = []
  if (opts.download) {
    for (let sUrl of stylesheetUrls) {
      let { statusCode, body: stylesheet, headers } = await request({
        uri: sUrl,
        gzip: true,
        encoding: 'utf8',
        resolveWithFullResponse: true,
        simple: false
      })
      
      if (statusCode >= 200 && statusCode < 300 && headers['content-type']
        && headers['content-type'].indexOf('text/css') !== -1) {
        if (opts.resolveTo) {
          stylesheet = absCss(stylesheet, sUrl)
        }
        
        stylesheets.push(stylesheet)
      }
      else {
        notFounds.push(sUrl)
      }
    }
  }
  
  // embed each stylesheet into html
  for (let stylesheet of stylesheets) {
    $('head').append(`<style>${stylesheet}</style>`)
  }
    
  return {
    html: $.html(),
    stylesheetUrls: Array.from(stylesheetUrls),
    stylesheets,
    notFounds
  }
}

module.exports = embedStylesheets
