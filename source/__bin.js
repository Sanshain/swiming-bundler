//@ts-check

const path = require('path')
const fs = require('fs')
const performance = require('perf_hooks').performance;
const { execSync } = require('child_process')

const buble = require('buble');
const babel = require('babel-standalone');
const jsxTransform = require('babel-plugin-transform-react-jsx');


const build = require('./main').buildFile;



const TS_MapToken = '//# sourceMappingURL=data:application/json;base64,';
const cache = {}


if (~process.argv.indexOf('-h')) {
    console.log(`
-s 		- source file name (could be passed as first arg without the flag -s)
-t 		- target file name (required)
-m 		- generate sourcemap file 	(optional)
--time 	- verbose build time  		(optional)
    `);
    process.exit(0)
};



function getArgv(argk) {
    let index = process.argv.indexOf(argk) + 1
    if (index) {
        return process.argv[index]
    }
    else {
        return null;
    }
}

const helpers = {
    s: 'source file',
    t: 'target file'
}

let source = resolveFile('s', 1);
let target = resolveFile('t', false);

const sourcemapInline = ~process.argv.indexOf('--inline-m');
const sourcemap = sourcemapInline || ~process.argv.indexOf('-m');
const minify = sourcemapInline || ~process.argv.indexOf('--minify');
const jsx__converter = sourcemapInline || ~process.argv.indexOf('--jsx-converter');
const release = ~process.argv.indexOf('-r');
if (release && sourcemap) {
    console.log(`\x1B[34m >> using the -k option in conjunction with - is not recommended, since these options have not been tested together.\x1B[0m`);
}


console.time('built in')

let result = build(source, target, {
    release: !!release == true,
    sourceMaps: sourcemap
        ? (() => {
            // also look at cjs-to-es6 ?
            
            // let encode = null;
            const packageName = 'sourcemap-codec'

            try { var { encode } = require(packageName); }
            catch (err) {
                console.log('\x1B[33mThe package needed to generate the source map has not been found and will be installed automatically\x1B[0m');
                console.log(execSync('npm i sourcemap-codec').toString());                                                                              // -D?

                var { encode } = require(packageName);
            }

            return {
                encode,
                external: !!sourcemapInline == true
            }
        })()
        : null,
    advanced: source.endsWith('.ts') ? {
        ts: (/** @type {string} */ code) => {

            const ts = importPackage({ packageName: 'typescript' })

            
            var [jsMap, mapInfo, code] = extractEmbedMap(code);

            const js = ts.transpile(code, { sourceMap: true, inlineSourceMap: true, inlineSources: true, jsx: true, allowJs: true })

            if (!mapInfo) {

                return js
            }

            var [code, mergedMap] = mergeMaps(js, jsMap, TS_MapToken)

            
            /** @type {(source: import('sourcemap-codec').SourceMapMappings) => string} */
            const encode = importPackage({ packageName: 'sourcemap-codec', funcName: 'encode' })
            mapInfo.mappings = encode(mergedMap); mapInfo.file = ''

            return code + '\n' + TS_MapToken + Buffer.from(JSON.stringify(mapInfo)).toString('base64')
        }
    } : null,
    plugins: [].concat(minify ? [{
        name: 'neo-minify-plugin',
        bundle: (/** @type {string} */ code, { maps, rawMap }) => {
            const uglifier = importPackage({ packageName: 'uglify-js' })
            const result = uglifier.minify({ target: code }, {
                sourceMap: sourcemap ? {
                    content: JSON.stringify(maps),
                    url: sourcemapInline ? "inline" : (target + ".map")
                } : undefined
            });

            if (sourcemap && !sourcemapInline) {
                fs.writeFileSync(target + '.map', result.map)
                // fs.writeFileSync(target + '.map', JSON.stringify(result.map))
            }

            return result.code
        }
    }] : []).concat(jsx__converter ? [
        {
            name: 'neo-jsx-convert-plugin',
            bundle: (/** @type {string} */ code, { maps, rawMap }) => {
                                
                // const buble = importPackage({ packageName: 'buble' })
                const r1 = buble.transform("my(<jsx/>, 'code');", {})     // 1) input sourcemap has no 2) jsx: React.createElement - by default. Not from context

                const r2 = babel.transform("my(<jsx/>, 'code');", {
                    inputSourceMap: null,
                    sourceMaps: true,
                    plugins: [
                        jsxTransform
                        // "@babel/plugin-transform-react-jsx"
                    ]
                })

                return ''
                
            }
        }
    ] : [])
})



if (result) {    
    console.log(`\x1B[34m${source} => ${target}\x1B[0m`);
    if (sourcemap && !!sourcemapInline == false) {
        console.log(`\x1B[34m${'.'.repeat(source.length)} => ${target}.map\x1B[0m`)
    }
    if (~process.argv.indexOf('--time')) {
        console.timeEnd('built in')
    }
}





/**
 * @param {string} originCode
 * @param {import('sourcemap-codec').SourceMapMappings} originMapSheet
 * @param {?string} [mapStartToken='']
 * @returns {[string, import('sourcemap-codec').SourceMapMappings]}
 */
function mergeMaps(originCode, originMapSheet, mapStartToken) {

    const [tsMap, $, code] = extractEmbedMap(originCode, mapStartToken);

    // jsMap[tsMap.map(el => el ? el[0] : null)[2][2]]

    const mergedMap = tsMap.map(line => line ? line[0] : null).map(line => originMapSheet[line[2]])
    // tsMap.map(line => jsMap[line[0][2]])

    // let mergedMap = tsMap.map(m => m.map(c => jsMap[c[2]]));         // its wrong fow some reason and ts swears!!!

    return [code, mergedMap];
}



/**
 * @param {string} [code]
 * @param {string?} [sourceMapToken=null]
 * @returns {[import('sourcemap-codec').SourceMapMappings, {sourcesContent: string[], sources: string[], mappings: string, file: string, files: string[]}, string]}
 */
function extractEmbedMap(code, sourceMapToken) {

    sourceMapToken = sourceMapToken || '//# sourceMappingURL=data:application/json;charset=utf-8;base64,'

    const sourceMapIndex = code.lastIndexOf(sourceMapToken);

    const baseOriginSourceMap = code.slice(sourceMapIndex + sourceMapToken.length);
    const originSourceMap = JSON.parse(Buffer.from(baseOriginSourceMap, 'base64').toString());
    
    const decode = importPackage({ packageName: 'sourcemap-codec', funcName: 'decode' })

    const jsMap = decode(originSourceMap.mappings);

    return [jsMap, originSourceMap, code.slice(0, sourceMapIndex)];
}


/**
 * @param {{
 *      packageName: 'typescript'|'sourcemap-codec'|'uglify-js'|'buble',
 *      funcName?: string,
 *      destDesc?: string                                   // to generate the source map
 * }} packInfo
 */
function importPackage({ packageName, funcName, destDesc }) {
    const cacheName = packageName + '.' + (funcName || 'default');
    if (cache[cacheName]) {
        return cache[cacheName];
    }

    try { var encode = funcName ? require(packageName)[funcName] : require(packageName); }
    catch (err) {
        console.log(`\x1B[33mThe package ${packageName} needed ${destDesc} has not been found and will be tried to install automatically\x1B[0m`);
        console.log(execSync('npm i ' + packageName).toString());                                                                              // -D?

        var encode = require(packageName);
    }
    cache[cacheName] = encode;
    return encode;
}


/**
 * @param {keyof typeof helpers} flag 
 * @param {boolean|1} [check=undefined] 
 * @returns {string}
 */
function resolveFile(flag, check) {
    
    let target = getArgv('-' + flag) || (check === 1 ? process.argv[check + 1] : null)

    if (!target) {
        const errMessage = `the path is not specified (use the -${flag} <filename> option for specify ${helpers[flag]})`;
        console.warn('\x1B[31m' + errMessage + '\x1B[0m')
        process.exit(1)
    }

    if (!path.isAbsolute(target)) {
        target = path.resolve(process.cwd(), target);
    }

    if (check && check !== undefined && !fs.existsSync(target)) {
        console.log(process.cwd);
        console.warn('\x1B[31m' + `${target} file not found` + '\x1B[0m')
        // throw new Error(`${target} file not found`);
        process.exit(1)
    }

    return target;
}


