
//@ts-check
//\/ <reference path="../types/utils.d.ts" />

const path = require("path");
const fs = require("fs");
const { benchmarkFunc } = require("./utils/benchmarks");
const { execSync } = require("child_process");


/**
 * @typedef {import("sourcemap-codec").SourceMapMappings} SourceMapMappings
 * @typedef {{
 *      sources: string[],
 *      sourcesContent: string[],
 *      mappings?: string
 * }} MapInfo
 */



/**
 * @description Merge advanced map (`externalMap`) for preprocessed multifiles with inside maps based also on multi files
 * 
 * @param {{ mapping: SourceMapMappings; sourcesContent: string[]; files: string[]; }} insideMapInfo
 * @param {{ 
 *   outsideMapInfo: MapInfo,
 *   outsideMapping: SourceMapMappings; 
 * }} externalMap
 * @param {(arg: import("sourcemap-codec").SourceMapSegment[][]) => string} [encode]
 * @returns {{
 *   outsideMapInfo: MapInfo,
 *   mergedMap: import("sourcemap-codec").SourceMapSegment[][],
 * }}
 */
 function deepMergeMap(insideMapInfo, externalMap, encode) {

    const { outsideMapInfo, outsideMapping } = externalMap;
    const { sourcesContent, files } = insideMapInfo;

    /// update file links inside:

    const mapping = insideMapInfo.mapping.map(line => {

        if (line && line.length) {
            line.forEach((ch, i) => {
                if (line[i][1] < files.length - 1) line[i][1] += outsideMapInfo.sources.length;
            });
            return line;
        }

        return [];
    });

    /// merge itself SourceMapMappings (reduce whatever lines to root lines):
    
    let mergedMap = mapping.map((line, i) => {

        if (!line || !line.length) return [];

        let _line = (line || []).map((ch, j, arr) => {

            const origCharMap = outsideMapping[line[j][2]];

            if (origCharMap && origCharMap.length) return origCharMap[0];
            else {
                if (ch[1] > outsideMapInfo.sources.length - 1) return ch;
                else {
                    return null;
                }
            }
        });

        return _line.filter(l => l);
    });

    outsideMapInfo.sources = outsideMapInfo.sources.concat(files.slice(0, -1));
    outsideMapInfo.sourcesContent = outsideMapInfo.sourcesContent.concat((sourcesContent || []).slice(0, -1));
     
     if (encode) {
        outsideMapInfo.mappings = encode(mergedMap)
     }

    return { mergedMap, outsideMapInfo }

    /// Further: outsideMap.mappings = encode(mergedMap);
}



//  * @param {{
//  *      mapStartToken?: string,                                 // [mapStartToken='//# sourceMappingURL=data:application/json;charset=utf-8;base64,']
//  *      pluginMapping?: import('./utils').SourceMapMappings,
//  *      decode: (arg: string) => ([number] | [number, number, number, number] | [number, number, number, number, number])[][]
//  * }} options 

//  * @template P
//  * @typedef {P extends SourceMapMappings ? {} 
//  *    : { 
//  *       decode: (arg: string) => ([number] | [number, number, number, number] | [number, number, number, number, number])[][]
//  *    }
//  * } MergeMapsOptions


/**
 * @description merge advancedMap for preprocessed finished single file (code) with origin map based on multi files
 * @param {string} builtCode
 * @param {import('sourcemap-codec').SourceMapMappings} originMapSheet
 * @param {{
 *      mapStartToken?: string,                                 // [mapStartToken='//# sourceMappingURL=data:application/json;charset=utf-8;base64,']
 *      pluginMapping?: import('./utils').SourceMapMappings,
 *      decode?: (arg: string) => SourceMapMappings
 * }} options 
 * @returns {[string, import('sourcemap-codec').SourceMapMappings]}
 */
function mergeFlatMaps(builtCode, originMapSheet, options) {

    const { mapStartToken, pluginMapping, decode } = options || {};

    if (pluginMapping) var advancedMap = pluginMapping
    else {
        var [advancedMap, $, code] = extractEmbedMap(builtCode, { sourceMapToken: mapStartToken, decode });
    }

    // jsMap[tsMap.map(el => el ? el[0] : null)[2][2]]

    
    /// CHECKED (TS?)?
    const mergedMap = advancedMap.map(line => line ? line[0] : []).map(line => originMapSheet[line[2]])

    
    /// CHECKED ON CODEPEN WITH BUBLE
    // const mergedMap = advancedMap.map(line => (line && line.length) ? [line[0]] : []).map(line => line.length ? (originMapSheet[line[0][2]] || []) : [])


    /// ALERNATIVES (SIMPLEST. NOT CHECKED YET): 

    // tsMap.map(line => jsMap[line[0][2]])
    // or
    // let mergedMap = tsMap.map(m => m.map(c => jsMap[c[2]]));         // its wrong fow some reason and ts swears!!!

    return [code || builtCode, mergedMap];
}



/**
 * @description extract origin sourcemap from inline code
 * @param {string} code
 * @param {{
 *      sourceMapToken?: string, 
 *      decode: (arg: string) => SourceMapMappings
 * }} options
 * @returns {[import('sourcemap-codec').SourceMapMappings, {sourcesContent: string[], sources: string[], mappings: string, file: string, files: string[]}, string]}
 */
function extractEmbedMap(code, options) {

    let { sourceMapToken } = options || {};

    sourceMapToken = sourceMapToken || '//# sourceMappingURL=data:application/json;charset=utf-8;base64,'

    const sourceMapIndex = code.lastIndexOf(sourceMapToken);

    if (~sourceMapIndex) {
        const baseOriginSourceMap = code.slice(sourceMapIndex + sourceMapToken.length);

        const originSourceMap = JSON.parse(globalThis.document
            ? globalThis.atob(baseOriginSourceMap)
            : Buffer.from(baseOriginSourceMap, 'base64').toString()
        );

        const jsMap = options.decode(originSourceMap.mappings);

        return [jsMap, originSourceMap, code.slice(0, sourceMapIndex)];
    }
    
    return [null, null, code.slice(0, sourceMapIndex)];
}



exports.deepMergeMap = deepMergeMap;
exports.mergeFlatMaps = mergeFlatMaps;
exports.extractEmbedMap = extractEmbedMap;

/**
 * generates fileStoreName under rool: root + fileName.replace('.?./' => '')
 * @param {string} root 
 * @param {string} fileName 
 * @returns 
 */
exports.genfileStoreName = function genfileStoreName(root, fileName) {

    // const _genfileStoreName = ((root || '').replace('./', '') + fileName).replace(/[\/]/g, '$')  // .replace(/\./g, '');    
    // ((root || '').replace('./', '') + (filename = filename.replace(/^\.\//m, ''))).replace(/\//g, '$')  // .replace(/\./g, '')    

    const isrelative = fileName.match(/^\.?\.\//g, )

    var _root = ''

    if (isrelative) {
        
        // fileName = fileName.replace(/^\.?\.\//g, '')

        var parentDir = path.dirname(fileName);

        // if (isrelative[0].startsWith('..')) {
        //     debugger
        // }

        _root = (parentDir !== '.')
            ? path.join(root || '', parentDir)
            : (root || '');        
    }

    // const _fileName = isrelative ? path.basename(fileName) : fileName
    const _fileName = (isrelative ? path.basename(fileName) : fileName).replace(/\.[\w]+$/m, '')  // <- remove extension...

    
    // const _genfileStoreName = ((_root || '').replace('./', '') + '__' + _fileName.replace('.', '')).replace('@', '$$').replace(/[\/\\\-]/g, '$');
    // const _genfileStoreName = ((_root || '').replace('./', '') + '$' + _fileName.replace('.', '')).replace('@', '__').replace(/[\/\\\-]/g, '$');
    // const _genfileStoreName = path.join(_root, fileName).replace('@', '__').replace(/[\/\\\-]/g, '$')
    const _genfileStoreName = path.join(_root, _fileName).replace('@', '__').replace(/[\/\\]/g, '$').replace(/-/g, '_')

    // if (_genfileStoreName == '__$uppy$utils$lib$getFileNameAndExtension') {
    //     debugger
    // }
    // else if (_genfileStoreName == '$uppy$utils$lib__getFileNameAndExtension') {
    //     debugger
    // }

    // if (_genfileStoreName == '__uppy$dashboard$lib$locale') {
    //     // msw$lib$utils$internal$isStringEqual
    //     debugger
    //     // locale ... on dashboard
    // }
    // else if (_genfileStoreName == 'msw$lib$utils$internal$isStringEqual') {
    //     debugger
    // }
    // else if (_genfileStoreName == 'swiper$modules$shared$create_element_if_not_defined') {
    //     debugger
    // }
    // else if (_genfileStoreName == 'shared$create_element_if_not_defined') {
    //     debugger
    // }

    if (~_genfileStoreName.indexOf('.')) {
        if (_genfileStoreName == '') {
            debugger
        }
        // debugger
        // return _genfileStoreName.replace('.', '');
        return _genfileStoreName.replace(/\./g, '');
    }

    return _genfileStoreName;
}


class DublicateError extends Error{

}


/**
 * @param {string} nodeModulesPath
 * @param {string} fileName
 * @param {{ existsSync: (arg0: string) => boolean; }} [fs]
 */
function findPackagePath(nodeModulesPath, fileName, fs) {
    const pathTree = fileName.split('/');

    let basePath = nodeModulesPath
    let currentPath = fileName

    for (let i = 0; i < pathTree.length; i++) {                                    
        basePath += '/' + pathTree[i];
        currentPath = path.join(basePath, 'package.json');
        if (fs.existsSync(currentPath)) {
            return currentPath
        }
    }
    return currentPath
    if (fileName == 'nanoid/non-secure') {
        debugger
    }
}

/**
 * @this {Importer}
 * @param {string} sourcePath
 * @param {import("./main").BuildOptions & {targetFname?: string}} options
 * @returns {string} - node_modules absolute path
 */
function findProjectRoot(sourcePath, options) {

    if (fs.existsSync(path.join(sourcePath, 'package.json'))) {
        const nodeModulesName = options.advanced?.nodeModulesDirname || 'node_modules';
        return path.join(sourcePath, nodeModulesName)
    }
    else {
        const parentDir = path.dirname(sourcePath);
        if (parentDir.length > 4) {
            return findProjectRoot(parentDir, options)
        }
        else {
            throw new Error('Project directory and according node_modules folder are not found');
        }
    }
}

exports.findPackagePath = findPackagePath
exports.findProjectRoot = findProjectRoot


/**
 * @description find main file inside package json
 * @param {string} packageJson
 * -param {{ readFileSync: (filename: string) => { toString (): string }; }} [fs]
 * @returns {string}
 */
function findMainfile(packageJson) {
    /**
    * @type {{main?: string, module?: string, exports?: string | Record<string, {default?: string}>}}
    */
    const packageInfo = JSON.parse(fs.readFileSync(packageJson).toString());
    var relInsidePathname = packageInfo.module || packageInfo.main;
    if (!relInsidePathname && packageInfo.exports) {
        relInsidePathname = typeof packageInfo.exports == 'string' ? packageInfo.exports : packageInfo.exports['.'].default 
    }
    if (!relInsidePathname) {
        debugger        
    }
    return relInsidePathname || undefined;
}


exports.findMainfile = findMainfile



/**
 * @param {string} packageJson
 * -param {{ readFileSync: (filename: string) => { toString (): string }; }} [fs]
 * @returns {Record<string, {default?: string}>}
 */
function readExports(packageJson) {
    /**
    * @type {{main?: string, module?: string, exports?: Record<string, {default?: string}>}}
    */
    const packageInfo = JSON.parse(fs.readFileSync(packageJson).toString());    
    return packageInfo.exports;
}



const extensions = ['.js', '.ts', '']
exports.extensions = extensions;


exports.fileNameRefine = function fileNameRefine(_fileName) {
    for (var ext of extensions) {
        if (benchmarkFunc(fs.existsSync, _fileName + ext)) {
            _fileName = _fileName + ext;
            break;
        }
    }
    return [_fileName, ext];
}

exports.refineExtension = function fileNameRefineByDir(_fileName) {
    const _extensions = extensions.slice(0, -1);
    if (!~_extensions.indexOf(path.extname(_fileName))) {
        // for existing app.js.js and passed app.js - possible bug
        
        const basename = path.basename(_fileName);

        // just the check takes 15ms! TODO optimize!
        /**
         * @type {string[]}
         */
        //@ts-ignore string[]|Buffer[] => string[]
        // const _execls = benchmarkFunc(execSync, `ls ${path.dirname(_fileName)}`).toString().split('\n').filter(f => !f.endsWith('.map') && f)
        // const _execls = benchmarkFunc(fs.readdirSync, path.dirname(_fileName), {
        //     // withFileTypes: true
        // });
        const _execls = benchmarkFunc(readDir, path.dirname(_fileName));
        // let fileExists = false;
        for (var ext of extensions) {
            // if (fileExists = fs.existsSync(_fileName + ext)) {
            if (~_execls.indexOf(basename + ext)) {
                _fileName = _fileName + ext;
                // break;
                return [_fileName, ext];
            }
        }
    }

    return [_fileName, ext];
}


const _dirsCache = {}
/**
 * @param {string} dirname
 */
function readDir(dirname) {
    if (_dirsCache[dirname]) {
        return _dirsCache[dirname]
    }
    else {
        // return dirsCache[dirname] || (dirsCache[dirname] = benchmarkFunc(fs.readdirSync, path.dirname(dirname), {
        return (_dirsCache[dirname] = benchmarkFunc(fs.readdirSync, dirname, {
            // withFileTypes: true
        }).filter(f => !f.endsWith('.map')))
    }
}

const symlinksCache = {}
let noSymlinks = false;
var ls = 0

function isSymbolLink(packageName) {
    if (symlinksCache[packageName]) {
        return symlinksCache[packageName]
    }
    else if (Object.keys(symlinksCache).filter(w => packageName.startsWith(w)).length) {
        return symlinksCache[packageName]
    }
    else {
        return (symlinksCache[packageName] = benchmarkFunc(fs.lstatSync, packageName).isSymbolicLink())
    }
}

exports.readDir = readDir;
exports.isSymbolLink = isSymbolLink;