/* eslint-disable no-unused-vars */
require('should')
require('loud-rejection/register')

const embed = require('../src')
const { promisify } = require('util')
const fs = require('fs')
const path = require('path')
const readFile = promisify(fs.readFile)
const fauxJax = require('faux-jax')
const mime = require('mime-types')

describe('module', () => {
  it('should export a function', function () {
    embed.should.be.a.Function()
  })
})

describe('discovering', () => {  
  it('should find links with type text/css', async () => {
    const { stylesheetUrls } = await embed('<link type="text/css" href="main.css">', { download: false })
    stylesheetUrls.length.should.be.equal(1)
  })
  
  it('should find links with rel stylesheet', async () => {
    const { stylesheetUrls } = await embed('<link rel="stylesheet" href="main.css">', { download: false })
    stylesheetUrls.length.should.be.equal(1)
  })
  
  it('should not return stylesheets without href', async () => {
    const { stylesheetUrls } = await embed('<link type="text/css">', { download: false })
    stylesheetUrls.length.should.be.equal(0)
  })
  
  it('should not return stylesheets with empty href', async () => {
    const { stylesheetUrls } = await embed('<link type="text/css" href="">', { download: false })
    stylesheetUrls.length.should.be.equal(0)
  })
  
  it('should not return stylesheets with whitespace-only href', async () => {
    const { stylesheetUrls } = await embed('<link type="text/css" href=" ">', { download: false })
    stylesheetUrls.length.should.be.equal(0)
  })
  
  it('should not return duplicate stylesheets', async () => {
    const input = `
      <link type="text/css" href="main.css">
      <link rel="stylesheet" href="main.css">
      <link type="text/css" rel="stylesheet" href="main.css">
    `
    const { stylesheetUrls } = await embed(input, { download: false })
    stylesheetUrls.length.should.be.equal(1)
  })
})

describe('resolving in html', () => {
  it('should resolve stylesheets with a simple relative path', async () => {
    const baseUrl = 'http://example.com'
    const input = '<link type="text/css" href="main.css">'
    const { stylesheetUrls } = await embed(input, { resolveTo: baseUrl, download: false })
    stylesheetUrls[0].should.be.equal('http://example.com/main.css')
  })
  
  it('should not care if relativeTo ends with a slash / or not', async () => {
    const baseUrl = 'http://example.com/'
    const input = '<link type="text/css" href="main.css">'
    const { stylesheetUrls } = await embed(input, { resolveTo: baseUrl, download: false })
    stylesheetUrls[0].should.be.equal('http://example.com/main.css')
  })
  
  it('should resolve stylesheets with a hierarchical relative path', async () => {
    const baseUrl = 'http://example.com'
    const input = '<link type="text/css" href="up/../main.css">'
    const { stylesheetUrls } = await embed(input, { resolveTo: baseUrl, download: false })
    stylesheetUrls[0].should.be.equal('http://example.com/main.css')
  })
  
  it('should resolve stylesheets with a relative root / path', async () => {
    const baseUrl = 'http://example.com'
    const input = '<link type="text/css" href="/main.css">'
    const { stylesheetUrls } = await embed(input, { resolveTo: baseUrl, download: false })
    stylesheetUrls[0].should.be.equal('http://example.com/main.css')
  })
  
  it('should resolve stylesheets with a relative ./ path', async () => {
    const baseUrl = 'http://example.com'
    const input = '<link type="text/css" href="./main.css">'
    const { stylesheetUrls } = await embed(input, { resolveTo: baseUrl, download: false })
    stylesheetUrls[0].should.be.equal('http://example.com/main.css')
  })
  
  it('should resolve stylesheets with an absolute http:// path', async () => {
    const baseUrl = 'http://example.com'
    const input = '<link type="text/css" href="http://example.com/main.css">'
    const { stylesheetUrls } = await embed(input, { resolveTo: baseUrl, download: false })
    stylesheetUrls[0].should.be.equal('http://example.com/main.css')
  })
  
  it('should resolve stylesheets with an absolute https:// path', async () => {
    const baseUrl = 'https://example.com'
    const input = '<link type="text/css" href="https://example.com/main.css">'
    const { stylesheetUrls } = await embed(input, { resolveTo: baseUrl, download: false })
    stylesheetUrls[0].should.be.equal('https://example.com/main.css')
  })
  
  it('should resolve stylesheets with an absolute // path with https base', async () => {
    const baseUrl = 'https://example.com'
    const input = '<link type="text/css" href="//example.com/assets/main.css">'
    const { stylesheetUrls } = await embed(input, { resolveTo: baseUrl, download: false })
    stylesheetUrls[0].should.be.equal('https://example.com/assets/main.css')
  })
  
  it('should resolve stylesheets with an absolute // path with http base', async () => {
    const baseUrl = 'http://example.com'
    const input = '<link type="text/css" href="//external.io/assets/main.css">'
    const { stylesheetUrls } = await embed(input, { resolveTo: baseUrl, download: false })
    stylesheetUrls[0].should.be.equal('http://external.io/assets/main.css')
  })
})

// http mocking
describe('http mocking', function() {
  this.timeout(5000)
  
  var rootBaseUrl = 'http://example.com/'
  var rootExternalBaseUrl = 'http://external.com/'
  var baseUrl
  var externalBaseUrl

  beforeEach(function() {
    baseUrl = rootBaseUrl
    externalBaseUrl = rootExternalBaseUrl

    fauxJax.install({ gzip: true })
    fauxJax.on('request', function(request)
    {
      var localPathIndex = (request.requestURL.indexOf(rootBaseUrl) !== -1)
        && rootBaseUrl.length

      var externalPathIndex = (request.requestURL.indexOf(externalBaseUrl) !== -1)
        && externalBaseUrl.length

      if (!localPathIndex && !externalPathIndex) {
        throw new Error( "fauxJax requestURL did not contain local or external domain" )
      }

      var relativePath = request.requestURL
        .slice(localPathIndex || externalPathIndex)
        .replace(/\?.*/, '')

      var headers = {
        'Content-Type': mime.contentType(path.extname(relativePath))
      }

      var storageDir = localPathIndex ? `${__dirname}/cases` : `${__dirname}/cases/external`

      try {
        var content = fs.readFileSync(path.join(storageDir, relativePath))
        request.respond(200, headers, content)
      } catch (err) {
        if (err.code === 'ENOENT')
        {
          request.respond(404, headers)
        } else {
          throw err
        }
      }
    })
  })

  afterEach(function() {
    fauxJax.restore()
  })
  
  // downloading stylesheets
  describe('downloading stylesheets', () => {
    it('should download resolved stylesheets', async () => {
      fauxJax.once('request', function(request) {
          request.requestURL.should.be.equal('http://example.com/assets/main.css')
      });
      const input = await readFile(`${__dirname}/cases/simple.html`, { encoding: 'utf8' })
      await embed(input, { resolveTo: baseUrl })
    })
  })
  
  // resolving in css
  describe('resolving in css', () => {
    it('should resolve relative urls inside stylesheets', async () => {
      const input = await readFile(`${__dirname}/cases/simple.html`, { encoding: 'utf8' })
      const expected = await readFile(`${__dirname}/cases/assets/main.resolved.css`, { 
        encoding: 'utf8' 
      })
      const { stylesheets } = await embed(input, { resolveTo: baseUrl })
      stylesheets.length.should.be.equal(1)
      stylesheets[0].should.be.equal(expected)
    })
    
    it('should not resolve urls pointing to an element identifier like for svgs', async () => {
      const input = await readFile(`${__dirname}/cases/svg.html`, { encoding: 'utf8' })
      const expected = await readFile(`${__dirname}/cases/assets/svg.css`, { 
        encoding: 'utf8' 
      })
      const { stylesheets } = await embed(input, { resolveTo: baseUrl })
      stylesheets.length.should.be.equal(1)
      stylesheets[0].should.be.equal(expected)
    })
    
    it('should only parse the same stylesheet once', async () => {
      const input = await readFile(`${__dirname}/cases/duplicates.html`, { encoding: 'utf8' })
      const { stylesheets, stylesheetUrls } = await embed(input, { resolveTo: baseUrl })
      stylesheets.length.should.be.equal(1)
      stylesheetUrls.length.should.be.equal(1)
    })
  })
  
  //replacing
  describe('replacing html', () => {
    it('should replace multiple occurances to the same stylesheet with a single stylesheet', async () => {
      const input = await readFile(`${__dirname}/cases/duplicates.html`, { encoding: 'utf8' })
      const output = await readFile(`${__dirname}/cases/duplicates.output.html`, { encoding: 'utf8' })
      const { html } = await embed(input, { resolveTo: baseUrl })
      
      console.log(html)
      
      html.should.be.equal(output)
    })
  })
})