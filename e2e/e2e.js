/* eslint-disable no-unused-vars */
require('should')
require('loud-rejection/register')

const embedStylesheets = require('../src')
const { promisify } = require('util')
const fs = require('fs')
const readFile = promisify(fs.readFile)
const writeFile = promisify(fs.writeFile)
const mkdirp = promisify(require('mkdirp'))
const path = require('path')
const ls = require('ls')
const outputPath = `${__dirname}/output`
const cheerio = require('cheerio')

const whitelist404s = ['domraider.io.html', 'torquemag.io.html']

async function main() {
  const inputs = ls(`${__dirname}/input/*.html`).map(o => o.full).filter(n => n.indexOf('torquemag') !== -1)
  await mkdirp(path.dirname(outputPath))
  
  describe('e2e', function () {
    this.timeout(120000)
    
    for (let input of inputs) {
      const baseName = path.basename(input)
      it(`should embed stylesheets at ${baseName}`, async () => {
        const rawHtml = await readFile(input, { encoding: 'utf8' })
        const resolveTo = await readFile(`${input}.meta`, { encoding: 'utf8' })
        
        // original should have links
        let $ = cheerio.load(rawHtml)
        $('link[type="text/css"],link[rel="stylesheet"]').length.should.be.above(0)
        
        // embed stylesheets
        const { html, notFounds } = await embedStylesheets(rawHtml, { resolveTo })
        await writeFile(`${outputPath}/${baseName}`, html)
        $ = cheerio.load(html)
        
        // should have no 404s except for whitelisted domains
        if (!whitelist404s.includes(baseName)) {
          notFounds.length.should.eql(0)
        }
        
        // should have no more links
        $('link[type="text/css"],link[rel="stylesheet"]').length.should.eql(0)
        
        // size should now be significantly larger
        html.length.should.be.above(rawHtml.length*1.1)
        
      })
    }
    
    run()
  })
}

main()