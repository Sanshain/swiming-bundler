//@ts-check

// import "fs";

const fs = require("fs");
const path = require("path");
const { deepMergeMap, genfileStoreName, findPackagePath, findMainfile } = require("./utils");
const { chainingCall } = require("./utils/monadutils");
const { version } = require("./utils/_versions");


// const { encodeLine, decodeLine } = require("./__map");





/**
 * @type {{
 *      sameAsImport: 'same as imports'
 * }}
 */
const requireOptions = {
    sameAsImport: 'same as imports'
}

// /**
//  * @type {{
//  *   ModuleNotFound: {
//  *       doNothing: 0,
//  *       useDefaultHandler: 1,
//  *       raiseError: 2
//  *   }
//  * }}
//  */
// export const OnErrorActions = {
//     ModuleNotFound: {
//         doNothing: 0,        
//         useDefaultHandler: 1,
//         raiseError: 2
//     }
// }


/**
 * @typedef {[number, number, number, number, number?]} VArray
 * @typedef {import("fs").PathOrFileDescriptor} PathOrFileDescriptor
 */

let startWrapLinesOffset = 1;
let endWrapLinesOffset = 5;

const extensions = ['.ts', '.js', '']
var rootOffset = 0;
/**
 * @description expoerted files for uniqie control inside getContent
 * @type {string[]}
 */
var exportedFiles = [];

let logLinesOption = false;
let incrementalOption = false;


// integrate("base.ts", 'result.js')


// exports = {
//     default: combine,
//     build: combine,
//     combine: combine,
//     integrate,
// }



/**
 * @description remove lazy and import inserts into content
 * @param {string} content - source code content;
 * @param {string} rootPath - path to root of source directory name (required for sourcemaps etc)
 * @param {BuildOptions & {targetFname?: string}} options - options
 * @param {Function?} [onSourceMap=null] - onSourceMap
 * @return {string} code with imported involves
 */

function combineContent(content, rootPath, options, onSourceMap) {

    globalOptions = options;
    globalOptions.target = options.targetFname;

    const originContent = content;
    
    /// initial global options:

    rootOffset = 0;

    sourcemaps.splice(0, sourcemaps.length);

    Object.keys(modules).forEach(key => delete modules[key]);
    


    logLinesOption = options.logStub;
    incrementalOption = options.advanced ? options.advanced.incremental : false;

    if (incrementalOption) {
        // look up 
        startWrapLinesOffset = 3;  // start_WrapLinesOffset + 2
        endWrapLinesOffset = 8;   // end_WrapLinesOffset + 3
    }

    exportedFiles = []

    if (options.removeLazy) {
        if (options.sourceMaps || options.getSourceMap) {
            console.warn('\x1B[33m' + 'removeLazy option uncompatible with sourceMap generation now. Therefore it`s passed' + '\x1B[0m');
            options.sourceMaps = null;
            options.getSourceMap = null;
        }
        content = removeLazy(content)
    }

    content = importInsert(content, rootPath, options);
    
    content = mapGenerate({
        target: options.targetFname,
        options,
        originContent,
        content,        
        // cachedMap: mapping
    });

    // here plugins

    if (options.advanced && options.advanced.ts) {
        // exportedFiles.some(w => w.endsWith('.ts') || w.endsWith('.tsx'))

        // sourcemaps for ts is not supported now        
        content = options.advanced.ts(content)
    }

    return content;
}

/**
 * 
 * @param {string} from - file name
 * @param {string} to - target name
 * @param {Omit<BuildOptions, 'entryPoint'> & {entryPoint?: string}} options - options
 * @returns 
 */
function buildFile(from, to, options) {

    const originContent = fs.readFileSync(from).toString();
    const srcFileName = path.resolve(from);    

    const targetFname = to || path.parse(srcFileName).dir + path.sep + path.parse(srcFileName).name + '.js';
    const buildOptions = Object.assign(
        {
            entryPoint: path.basename(srcFileName),
            release: false,
            targetFname
        },
        options
    );

    const legacyFiles = fs.readdirSync ? fs.readdirSync(path.dirname(buildOptions['targetFname'])) : null;

    // let mapping = null;
    
    let content = combineContent(originContent, path.dirname(srcFileName), buildOptions
        // function onSourceMap() {
        //     // sourcemaps adds to content with targetName
        //     mapping = sourcemaps.map(s => s.debugInfo).reduce((p, n) => p.concat(n));
        //     mapping.push(null); // \n//# sourceMappingURL=${path.basename(to)}.map`
        //     return mapping;
        // }
    )
    
    // content = mapGenerate({
    //     target: targetFname,
    //     options,
    //     originContent,
    //     content,
    //     cachedMap: mapping
    // });

    if (legacyFiles) legacyFiles.forEach(file => (path.extname(file) == '.js') && fs.rmSync(path.join(path.dirname(targetFname), file)));

    fs.writeFileSync(targetFname, content)

    return content
}


/**
 * path manager
 */
class PathMan {

    /**
     * @type {string}
     */
    basePath

    /**
     * @param {string} dirname
     * @param { (fileName: PathOrFileDescriptor) => string} pullContent
     */
    constructor(dirname, pullContent) {
        /**
         * root directory of source  code (not project path. it's different)
         */
        this.dirPath = dirname;
        this.getContent = pullContent || getContent;
    }
}


class Importer {

    /**
     * @type {PathMan}
     */
    pathMan

    /**
     * @type {Record<string, string>} - for dynamic imports
     */
    modules = {}

    /**
     * @description - file, where imprting is in progress
     * @type {string}
     */
    currentFile

    /**
     * 
     * @param {PathMan} pathMan 
     */
    constructor(pathMan) {
        this.namedImportsApply = applyNamedImports;
        /*
        * module sealing ()
        */
        this.moduleStamp = moduleSealing;
        this.pathMan = pathMan;        
    }


    /**
     * @returns {boolean}
     * @param {string} fileName
     * @param {string} fileStoreName,
     * @param {{
     *  root: string;
     *  _needMap?: boolean | ?1;
     * }} args
     */
    attachModule(fileName, fileStoreName, {root, _needMap }) {            

        let moduleInfo = this.moduleStamp(fileName, root || undefined, _needMap);
        if (moduleInfo) {
            // .slice(moduleInfo.wrapperLinesOffset) =>? .slice(moduleInfo.wrapperLinesOffset, -5?) -> inside moduleSealing
            const linesMap = moduleInfo.lines.map(([moduleInfoLineNumber, isEmpty], /** @type {number} */ i) => {
                /**
                    номер столбца в сгенерированном файле (#2);
                    индекс исходника в «sources» (#3);
                    номер строки исходника (#4);
                    номер столбца исходника (#5);
                    индекс имени переменной/функции из списка «names»;
                */

                /** 
                 * @type {string|unknown} 
                 * TODO check type (string or boolean)
                 * */
                let lineValue = isEmpty;

                if (i >= (moduleInfo.lines.length - endWrapLinesOffset) || i < startWrapLinesOffset) {
                    return null;
                }

                /** @type {VArray | Array<VArray>} */
                let r = _needMap === 1
                    ? [].map.call(lineValue, (/** @type {any} */ ch, /** @type {any} */ i) => [i, (sourcemaps.length - 1) + 1, moduleInfoLineNumber - startWrapLinesOffset, i]) // i + 1
                    : [[0, (sourcemaps.length - 1) + 1, moduleInfoLineNumber - startWrapLinesOffset, 1]];

                return r;
            });
            sourcemaps.push({
                name: fileStoreName.replace('$$', '@').replace(/(\$|__)/g, '/') + '.js',
                // mappings: linesMap.map(line => line ? encodeLine(line) : '').join(';'),

                //@ts-ignore (TODO fix type)
                debugInfo: linesMap
            });
            
            return true;
        }
        return false;
    }


    generateConverter(root, _needMap, inspectUnique) {


        return (match, __, $, $$, /** @type string */ classNames, defauName, moduleName, isrelative, fileName, offset, source) => {

            const fileStoreName = genfileStoreName(
                // root, fileName
                isrelative
                    ? nodeModules[fileName] ? undefined : root && chainingCall(path.dirname, fileName.match(/\.\.\//g)?.length || 0, root.replace(/\/\.\//g, '/'))
                    : undefined,
                path.extname(fileName)
                    ? fileName.slice(0, -path.extname(fileName).length)
                    // ? fileName.replace(/\.\.\//g, '')
                    : fileName.replace(/\.\.\//g, '')
            );

            // if (~fileName.indexOf('debounce')) {
            //     debugger            
            //     /**
            //     */
            // }
            /// check module on unique and inject it if does not exists:
            if (!modules[fileStoreName]) {

                const _fileName = (root || '.') + '/' + fileName;

                if (isrelative) {
                    const smSuccessAttached = this.attachModule((isrelative || '') + fileName, fileStoreName, { root, _needMap });
                    // if (!smSuccessAttached) {
                    //     // debugger
                    // }
                }
                else {
                    // node modules support
                    if (this.pathMan.getContent == getContent) {

                        nodeModulesPath = nodeModulesPath || findProjectRoot(this.pathMan.dirPath); // or get from cwd
                        if (!fs.existsSync(nodeModulesPath)) {
                            debugger;
                            console.warn('node_modules doesn`t exists. Use $onModuleNotFound method to autoinstall');
                        }
                        else {

                            const packageName = path.normalize(fileName);
                            let packagePath = path.join(nodeModulesPath, packageName);
                            const packageJson = path.join(packagePath, 'package.json');

                            if (fs.existsSync(packageJson)) {
                                var relInsidePathname = findMainfile(packageJson);
                            }
                            else {
                                // direct import from node_modules (invisaged with-in moduleSealing-&-getContext logic) | import specified in `exports` section
                                /**
                                 * @description - always specified to a file!
                                 * @type {string|undefined}
                                 */
                                var relInsidePathname = '';
                                // - but what is the base of the file for the next rel. import from its file?
                                // -- direct import from the module: => get dirname of the file
                                // -- from export: read exports or => get as base of the main file
                            }


                            // nodeModules[fileName] = path.join(packagePath, relInsidePathname);
                            nodeModules[fileName] = relInsidePathname;

                            this.currentFile = fileName;

                            if (relInsidePathname == undefined) {
                                debugger;
                            }

                            this.attachModule(fileName, fileStoreName, {
                                // root,
                                // root: '',
                                root: fileName + '/' + path.dirname(relInsidePathname),
                                _needMap
                            });
                        }
                    }
                }
            }

            /// replace imports to spreads into place:
            if (defauName && inspectUnique(defauName)) {
                return `const { default: ${defauName} } = $${fileStoreName.replace('@', '_')}Exports;`;
            }
            else if (defauName) {
                const error = new Error(`Variable '${defauName}' is duplicated by import './${fileName}.js'`);
                error.name = 'DublicateError';
                // throw error;
                // console.log('\x1b[31m%s\x1b[0m', `${error.name}: ${error.message}`, '\x1b[0m');
                console.log('\x1b[31m%s\x1b[0m', `Detected ${error.name} during build process: ${error.message}`, '\x1b[0m');
                console.log('Fix the errors and restart the build.');
                process.exit(1);
            }
            else if (moduleName) {
                return `const ${moduleName.split(' ').pop()} = $${fileStoreName.replace('@', '_')}Exports;`;
            }
            else {
                let entities = classNames.split(',').map(w => (~w.indexOf(' as ') ? (`${w.trim().split(' ').shift()}: ${w.trim().split(' ').pop()}`) : w).trim());
                for (let entity of entities) {
                    if (~entity.indexOf(':')) {
                        entity = entity.split(': ').pop();
                    }
                    inspectUnique(entity);
                }
                return `const { ${entities.join(', ')} } = $${fileStoreName.replace('@', '_')}Exports`;
            }

        };
    }

    // /**
    //  * @_param {{
    //     fileName: string;
    //     fileStoreName: string;
    //     attach_Module: (fileName: string, fileStoreName: string) => boolean;
    // }} args
    //  * @param {string} fileName
    //  * @param {string} fileStoreName
    //  * @param {(fileName: string, fileStoreName: string) => boolean} attach_Module
    //  */
    // attachFile(fileName, fileStoreName, attach_Module) {
    //     // this.currentFile = fileName;
    //     return attach_Module(fileName, fileStoreName);
    // }
}



/**
 * @param {{ 
 *      options?: Omit<BuildOptions, "entryPoint"> & { entryPoint?: string; }; 
 *      target?: string; originContent?: string; 
 *      content?: string; 
 *      sourceMaps?: any; 
 *      cachedMap?: Array<Array<VArray | null>>
 * }} options
 */
function mapGenerate({ options, content, originContent, target, cachedMap}) {
    
    let pluginsPerformed = false;

    if (options.getSourceMap || options.sourceMaps) {
        /**
         * @type {string[]}
         */
        const moduleContents = Object.values(modules).filter(Boolean);

        // let mapping = sourcemaps.reduce((acc, s) => acc + ';' + s.mappings, '').slice(1) + ';'
        // let accumDebugInfo = sourcemaps.reduce((p, n) => p.debugInfo.concat(n.debugInfo));
        /**
         * @_type {Array<Array<VArray | null>}
         */
        
        let accumDebugInfo = cachedMap || sourcemaps.map(s => s.debugInfo).reduce((p, n) => p.concat(n));

        !cachedMap && accumDebugInfo.push(null); // \n//# sourceMappingURL=${path.basename(to)}.map`

        if (options.getSourceMap) {
            const modifiedMap = options.getSourceMap({
                //@ts-expect-error
                mapping: accumDebugInfo,
                sourcesContent: moduleContents.map(c => c.split('\n').slice(startWrapLinesOffset, -endWrapLinesOffset).join('\n')).concat([originContent]),
                files: sourcemaps.map(s => s.name)
            });
            // if (modifiedMap) accumDebugInfo = modifiedMap;
        }

        if (options.sourceMaps) {

            // const mapping = accumDebugInfo.map(line => line ? encodeLine(line) + ',' + encodeLine([7, line[1], line[2], 7]) : '').join(';')
            // const mapping = accumDebugInfo.map(line => line ? encodeLine(line) : '').join(';')
            // let mapping1 = accumDebugInfo.map(line => line ? line.map(c => encodeLine(c)).join(',') : '').join(';')            
            
            let rawMapping = accumDebugInfo.map((/** @type {any} */ line) => line ? line : []);

            if (options.sourceMaps.shift) rawMapping = Array(options.sourceMaps.shift).fill([]).concat(rawMapping)

            let mapping = options.sourceMaps.encode(rawMapping);

            const targetFile = (path && target) ? path.basename(target) : ''
            const mapObject = {
                version: 3,
                file: targetFile,
                sources: sourcemaps.map(s => s.name),
                // TODO fix sourcemaps for dynamic tests
                sourcesContent: moduleContents.map(c => c.split('\n').slice(startWrapLinesOffset, -endWrapLinesOffset).join('\n')).concat([originContent]),
                names: [],
                mappings: mapping
            };

            /// TODO move to external (to getSourceMap) - DONE 
            if (options.sourceMaps.injectTo) {
                                
                // let rootMappings = injectMap(options.sourceMaps.injectTo, mapObject);
                // //_ts-expect-error
                // mapObject.mappings = options.sourceMaps.encode(handledDataMap.concat(rootMappings))
                
                /// As checked alternative:

                const rootMaps = options.sourceMaps.injectTo;
                // TODO decode case like injectMap
                const { mergedMap, outsideMapInfo } = deepMergeMap({ ...mapObject, files: mapObject.sources, mapping: rawMapping }, {
                    outsideMapInfo: rootMaps,
                    outsideMapping: rootMaps.maps || globalOptions.sourceMaps.decode(rootMaps.mappings)
                })
                
                outsideMapInfo.mappings = options.sourceMaps.encode(rawMapping = mergedMap);
                mapObject.sources = outsideMapInfo.sources;
                mapObject.sourcesContent = outsideMapInfo.sourcesContent;
                            
            }

            if (options.plugins) (pluginsPerformed = true) && options.plugins.forEach(plugin => {
                if (plugin.bundle) {
                    content = plugin.bundle(content, {target, maps: mapObject, rawMap: rawMapping});
                }
            })

            if (options.sourceMaps.verbose) console.log(mapObject.sources, mapObject.sourcesContent, rawMapping);

            if (fs && options.sourceMaps.external === true) {
                fs.writeFileSync(target + '.map', JSON.stringify(mapObject));
                content += `\n//# sourceMappingURL=${targetFile}.map`;
            }
            // else if (options.sourceMaps.external === 'monkeyPatch') {           
                
            //     const _content = new String(content);
            //     _content['maps'] = mapObject;
            //     return _content;
            // }
            else {                
                
                const encodedMap = globalThis.document
                    ? btoa(JSON.stringify(mapObject))                                        // <= for browser
                    : Buffer.from(JSON.stringify(mapObject)).toString('base64');             // <= for node

                content += `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,` + encodedMap;
                // content += `\n//# sourceMappingURL=data:application/json;charset=utf-8;base64,` + 
            }
        }
    }   
    if (options.plugins && !pluginsPerformed) options.plugins.forEach(plugin => {   // if plugins has not performed erlier with sourcemaps:
        if (plugin.bundle) {
            content = plugin.bundle(content, {target});
        }
    })
    return content;
}

/**
 * @typedef {[number, number, number, number, number][][]} RawMapping
 * @typedef {{
 *    entryPoint: string;                                                               // only for sourcemaps and logging
 *    release?: boolean;                                                                // = false (=> remove comments|logs?|minify?? or not)
 *    removeLazy?: boolean,
 *    getContent?: (filename: string) => string
 *    onError?: (error: Error) => boolean
 *    logStub?: boolean,                                                                 // replace standard log to ...
 *    getSourceMap?: (                                                                   // conditions like sourceMaps
 *      arg: {
 *          mapping: ([number, number, number, number, number]|[number, number, number, number])[][],
 *          files: string[], 
 *          sourcesContent: string[]
 *      }) => Omit<BuildOptions['sourceMaps']['injectTo'], 'maps'> | void
 *    sourceMaps?: {     
 *      shift?: number,                                                                            // = false. Possible true if [release=false] & [treeShaking=false] & [!removeLazy]
 *      encode(
 *          arg: Array<Array<[number] | [number, number, number, number, number?]>>
 *      ): string,
 *      decode?: (arg: string) => [number, number, number, number, number][][],                         // required with `injectTo` field!
 *      external?: boolean,                                                                             //  | 'monkeyPatch'
 *      charByChar?: boolean,
 *      verbose?: boolean,
 *      injectTo?: {
 *          maps?: [number, number, number, number, number][][],
 *          mappings: string,
 *          sources: string[],                                                                          // file names
 *          sourcesContent: string[],                                                                   // source contents according file names
 *          names?: string[]
 *      }
 *    }
 *    advanced?: {
 *        require?: requireOptions[keyof requireOptions]
 *        incremental?: boolean,                                                                        // possible true if [release=false]
 *        treeShaking?: false                                                                           // Possible true if [release=true => default>true].
 *        ts?: Function;
 *        nodeModulesDirname?: string  
 *    },
 *    plugins?: Array<{
 *        name?: string,
 *        preprocess?: (code: string, options?: {
 *            target: string,
 *            maps?: Omit<BuildOptions['sourceMaps']['injectTo'], 'maps'>,
 *            rawMap?: RawMapping
 *        }) => [string, BuildOptions['sourceMaps']['injectTo']],                                                   // preprocc (svelte, vue sfc)      
 *        extend?: never & {
 *           filter?: string | RegExp,
 *           callback: (code: string) => {code: string, maps?: BuildOptions['sourceMaps']['injectTo'], rawMap?: RawMapping},          // not Implemented 
 *        }                                                                                                         // additional middleware (json, css)
 *        bundle?: (code: string, options?: {
 *            target: string,
 *            maps?: Omit<BuildOptions['sourceMaps']['injectTo'], 'maps'>, 
 *            rawMap?: RawMapping
 *        }) => string,                                                                                             // postprocessing (jsx, uglify)
 *    }>
 * }} BuildOptions
 */

//*        onModuleNotFound?: OnErrorActions['ModuleNotFound'][keyof OnErrorActions['ModuleNotFound']]   // ?dep

/**
 * @type {BuildOptions & {node_modules_Path?: string, target?: string}}
 */
let globalOptions = null;
/**
 * absolut path to node_modules
 * @type {string}
 */
let nodeModulesPath = null;
const nodeModules = {

}


/**
 * TODO check
 * research function (not checked yet) to inject inside map to external map
 * @param {BuildOptions['sourceMaps']['injectTo']} rootMaps
 * @param {{version?: number;file?: string;sources?: string[];sourcesContent: any;names?: any[];mappings?: string;source?: any;}} mapObject
 * @param {BuildOptions['sourceMaps']['decode']} [decode]
 */
function injectMap(rootMaps, mapObject, decode) {
    
    // const rootMaps = options.sourceMaps.injectTo;

    mapObject.source = mapObject.source.concat(rootMaps.sources);
    mapObject.sourcesContent = mapObject.sourcesContent.concat(rootMaps.sourcesContent);

    let rootMapings = rootMaps.maps || (decode || globalOptions.sourceMaps.decode)(rootMaps.mappings);

    rootMapings = rootMapings.map(line => {

        if (line && line.length) {
            line.forEach((ch, i) => {
                line[i][1] += sourcemaps.length;
            });
            return line;
        }

        return [];
    });

    debugger;
    return rootMapings;
}





/**
 * 
 * @param {string} content - content (source code)
 * @param {string} dirpath - source directory name
 * @param {BuildOptions} options - options
 */
function importInsert(content, dirpath, options) {
    
    let pathman = new PathMan(dirpath, options.getContent || getContent);
    const needMap = !!(options.sourceMaps || options.getSourceMap)

    if (logLinesOption) {
        content = content.replace(/console.log\(/g, function () {
            let line = arguments[2].slice(0, arguments[1]).split('\n').length.toString()
            return 'console.log("' + options.entryPoint + ':' + line + ':", '
        })
    }
    
    const charByChar = options.sourceMaps && options.sourceMaps.charByChar

    // let regex = /^import \* as (?<module>\w+) from \"\.\/(?<filename>\w+)\"/gm;            
    // content = new Importer(pathman).namedImportsApply(content, undefined, (options.getSourceMap && !options.sourceMaps) ? 1 : needMap);
    content = new Importer(pathman).namedImportsApply(
        content, undefined, (options.sourceMaps && options.sourceMaps.charByChar) ? 1 : needMap
    );

    const moduleContents = Object.values(modules).filter(Boolean);
    content = '\n\n//@modules:\n\n\n' + moduleContents.join('\n\n') + `\n\n\n//@${options.entryPoint}: \n` + content;


    const emptyLineInfo = null

    if (needMap) {
                
        rootOffset += 5 + (sourcemaps.length * 2) + 1;
        // rootOffset += endWrapLinesOffset + (sourcemaps.length * 2) + startWrapLinesOffset;
        // rootOffset += 5 + (sourcemaps.length * 2 - 2) + 3;

        if (sourcemaps[0]) {
            // sourcemaps[0].mappings = ';;;' + sourcemaps[0].mappings
            // sourcemaps[0].debugInfo.unshift(emptyLineInfo, emptyLineInfo, emptyLineInfo);
            sourcemaps[0].debugInfo.unshift(emptyLineInfo, emptyLineInfo, emptyLineInfo, emptyLineInfo);
        }
        
        sourcemaps.forEach(sm => {
            // sm.mappings = ';;' + sm.mappings
            // sm.debugInfo.unshift(emptyLineInfo, emptyLineInfo);
            sm.debugInfo.unshift(emptyLineInfo);
        })

        const linesMap = content.split('\n').slice(rootOffset).map((line, i) => {
            // /** @type {[number, number, number, number, number?]} */
            // let r = [0, sourcemaps.length, i, 0];
            
            /** @type {Array<[number, number, number, number, number?]>} */
            let r = charByChar
                ? [[0, sourcemaps.length, i, 0]]
                : [].map.call(line, (/** @type {any} */ ch, /** @type {any} */ j) => [j, sourcemaps.length, i, j]);
            return r;
        })

        // if (!sourcemaps.some(file => file.name === options.entryPoint))         
        sourcemaps.push({
            name: options.entryPoint,
            // mappings: linesMap.map(line => encodeLine(line)).join(';'),
            // mappings: linesMap.map(line => line.map(charDebugInfo => encodeLine(charDebugInfo)).join(',')).join(';'),
            // mappings: ';;;' + linesMap.map(line => encodeLine(line)).join(';'),
            debugInfo: [emptyLineInfo, emptyLineInfo, emptyLineInfo].concat(linesMap)            
        })
    }


    ///* not recommended, but easy for realization:
    // const regex = /^import \"\.\/(?<filename>\w+)\"/gm;    
    // content = content.replace(regex, allocPack.bind(pathman)); //*/

    // regex = /^import {([\w, ]+)} from \".\/(\w+)\"/gm
    // content = content.replace(moduleSealing.bind(pathman)); //*/

    if (options && options.release) {
        
        if (options.sourceMaps) {
            console.warn('Generate truth sourcemaps with options `release = true` is not guaranteed');
        }

        // remove comments:
        
        // keeps line by line sourcemaps:
        content = content.replace(/console\.log\([\s\S]+?\);/g, '');                                       //*/ remove logs
        // content = content.replace(/(?<!\*)[\s]*\/\/[\s\S]*?\n/g, options.sourceMaps ? '\n' : '');               //*/ remove comments
        content = content.replace(/^[\s]*\/\/[\s\S]*?\n/gm, options.sourceMaps ? '\n' : '');               //*/ remove comments
        // content = content.replace(/^[\s]*/gm, ''); //*/                                             // remove unnecessary whitespaces in line start

        // drop sourcemaps:
        /// TODO? here it would be possible to edit the sorsmap in the callback:

        content = content.replace(/\/\*[\s\S]*?\*\//g,  () => '')                                         // remove multiline comments
        // content = content.replace(/\n[\n]+/g, () => '\n')                                                 // remove unnecessary \n
    }

    return content
}


const modules = {};

// const modules = new Proxy({}, {
//     // deleteProperty(target, prop) { // перехватываем удаление свойства
//     //     //@ts-ignore
//     //     if (~prop.indexOf('debounce')) {
//     //         debugger
//     //     } else {
//     //         delete target[prop];
//     //         return true;
//     //     }
//     // }
//     set(target, prop, value) {
//         // debugger
//         target[prop] = value;
//         return true;
//     }
// });


/**
 * @type {Array<{
 *      name: string,
 *      mappings?: never,
 *      debugInfo?: import("sourcemap-codec").SourceMapMappings      
 * }>}
 * //   Array<Array<VArray>>   // Array<VArray | Array<VArray>>   // Array<VArray> | Array<Array<VArray>>
 */
const sourcemaps = []


/**
 * replace imports to object spreads and separate modules
 * @param {string} content
 * @param {?string} [root]
 * @param {boolean | 1?} [_needMap]
 * @this {Importer} *
 * @example :

Supports following forms:

```
import defaultExport from "module_name";
import * as name from "./module-name"
import { named } from "./module_name"
import { named as alias } from "./module_name"
import { named1, named2 } from "./module_name"
import { named1, named2 as a } from "./module_name"
import "./module_name"
```

Unsupported yet:
```
import defaultExport, * as name from "./module-name";
import defaultExport, { tt } from "./module-name";          /// <= TODO this one
```
 */
function applyNamedImports(content, root, _needMap) {

    // const regex = /^import (((\{([\w, ]+)\})|([\w, ]+)|(\* as \w+)) from )?".\/([\w\-\/]+)"/gm;
    // const regex = /^import (((\{([\w, ]+)\})|([\w, ]+)|(\* as \w+)) from )?\".\/([\w\-\/]+)\"/gm;
    // const regex = /^import (((\{([\w, ]+)\})|([\w, ]+)|(\* as \w+)) from )?\"(.\/)?([@\w\-\/]+)\"/gm;        // @ + (./)
    const regex = /^import (((\{([\w, \$]+)\})|([\w, ]+)|(\* as [\w\$]+)) from )?["'](.?.\/)?([@\w\-\/\.]+)["']/gm;       // '" 
    const imports = new Set();

    const importApplier = this.generateConverter(root, _needMap, inspectUnique);

    const _content = content.replace(regex, importApplier);

    /// dynamic imports apply     
    let _content$ = _content.replace(/import\(['"'](\.?\.\/)?([\-\w\d\.\$\/@]+)['"]\)/g, (/** @this {Importer} */ function (match, isrelative, filename, src) {
        const fileName = `${isrelative || ''}${filename}`;
        /// (dynamic imports for web version skip this step)
        if (fs.writeFileSync) {
            // const exactFileName = path.join(this.pathMan.dirPath, fileName) + (!path.extname(fileName)
            const exactFileName = fileName + (!path.extname(fileName)
                ? (globalOptions.advanced.ts ? '.ts' : '.js')
                : '');
            
            // const fileContent = fs.readFileSync(exactFileName).toString();
            
            // var chunkName = './$_' + filename + '_' + version + '.js';
            var chunkName = './$_' + path.basename(filename) + '_' + version + '.js';            
            const rootPath = path.dirname(globalOptions.target)
            // const _fileContent = fileContent.replace(regex, importApplier);

            const baseModuleKeys = new Set(Object.keys(modules));
            this.pathMan.basePath = '.'
            /**
             * @type {{fileStoreName: string}} */            
            const sealInfo  = this.moduleStamp(exactFileName, root, false || _needMap);

            this.pathMan.basePath = undefined;
                        
            const _fileStoreName = sealInfo?.fileStoreName || genfileStoreName(root, fileName.replace(/^\.\//m, ''));
            const _fileContent = modules[_fileStoreName];
            const dynamicModules = Object.keys(modules).filter(mk => !baseModuleKeys.has(mk));

            let chunkDependencies = ''
            for (const key of dynamicModules) {                
                if (key != _fileStoreName) {
                    chunkDependencies += modules[key] + '\n';
                    modules[key] = undefined
                }                
            }
            
            modules[_fileStoreName] = undefined;

            // _fileContent.slice(_fileContent.indexOf('('))
            // const chunkContent = _fileContent.split('\n').map(line => line.replace(/^\s/g, '')).slice(1, -1).join('\n');
            const chunkContent = chunkDependencies + '\n{\n' + _fileContent.split('\n').slice(1, -1).join('\n') + '\n}';

            fs.writeFileSync(path.join(rootPath, chunkName), chunkContent)
        }
        // path.join(path.dirname(nodeModulesPath), 'package.json') => version update        
        return `fetch("${chunkName || fileName}")` + '.then(r => r.text()).then(content => new Function(content)())';
    }).bind(this))

    if (globalOptions?.advanced?.require === requireOptions.sameAsImport) {
        console.log('require import');
        /// works just for named spread
        const __content = (_content$ || _content).replace(
            // /(const|var|let) \{?[ ]*(?<varnames>[\w, :]+)[ ]*\}? = require\(['"](?<filename>[\w\/\.\-]+)['"]\)/g,            // TODO make `const|var|let` optional
            /(const|var|let) ((?<varnames>\{?[\w, ]+\}?) = require\(['"](?<filename>[\w\.\/]+)['"]\)[,\n\s]*)+(?=;|\n)/g,       // TODO make `const|var|let` optional
            (_, key, lastRequire, varnames, filename, $, $$) => {

                _ = _.replace(/(?:(const|var|let) )?(?<varnames>\{?[\w, ]+\}?) = require\(['"](?<filename>[\w\.-\/]+)['"]\)/g, (__, key, varnames, filename) => {
                    

                    // const fileStoreName = genfileStoreName(root, filename = filename.replace(/^\.\//m, ''));
                    const fileStoreName = genfileStoreName(root, filename.replace(/^\.\//m, ''));                    

                    if (!modules[fileStoreName]) {
                        const smSuccessAttached = this.attachModule(filename, fileStoreName, { root, _needMap });
                        // if (!smSuccessAttached) {
                        //     // doNothing | raise Error | [default].getContent
                        //     debugger
                        //     this.attachModule(filename, fileStoreName, { root, _needMap })
                        //     return _
                        // }
                        if (modules[fileStoreName]) {
                            // debugger
                            return `${key || ''} ${varnames} = $${fileStoreName}Exports`;
                        }

                    }

                    const exprStart = __.split('=')[0];
                    return exprStart + `= $${fileStoreName.replace('@', '_')}Exports`
                })
                
                return _;
                
            }
        );

        return __content;
    }

    return _content$ || _content;


    /**
     * @param {string} fileName
     * @param {string} fileStoreName
     * @this {Importer}
     */


    /**
     * @param {string} entity
     */
    function inspectUnique(entity) {

        if (imports.has(entity)) {
            console.warn('Duplicating the imported name')
            return false
        }
        else {
            imports.add(entity);
            return true;
        }
    }
}




/**
 * seal module: read file, replace all exports and apply all imports inside and wrap it to iife with fileStoreName
 * @param {string} fileName
 * @param {string?} root
 * @param {boolean | 1?} __needMap
 * @this {Importer} 
 * @returns {{
 *      fileStoreName: string, 
 *      updatedRootOffset?: number,
 *      lines: Array<[number, boolean]>
 * }}
 * 
 *      start_WrapLinesOffset: number,                                                // by default = 1
 *      end_WrapLinesOffset: number,
 * 
 */
function moduleSealing(fileName, root, __needMap) {

    // extract path:

    // const _root = nodeModules[root] ? path.join(nodeModulesPath, root, path.dirname(nodeModules[root])) : root;

    let fileNameUpdated = null;


    let content = this.pathMan.getContent(
        // (!nodeModules[fileName] && root) ? path.join(root, fileName) : fileName,
        (fileName.startsWith('.') && root)
            ? ((root.startsWith('.') ? './' : '') + path.join(root, fileName))
            : fileName,
        // (!nodeModules[fileName] && nodeModules[root])
        (fileName.startsWith('.') && nodeModules[root])
            ? path.join(nodeModulesPath, root, path.dirname(nodeModules[root]), fileName)
            : undefined,
        (_f) => {
            fileNameUpdated = fileName = _f;
        }
    );
    // if (globalOptions.advanced.onModuleNotFound == OnErrorActions.ModuleNotFound.doNothing) {}

    const fileStoreName = genfileStoreName(
        // nodeModules[fileName] ? undefined : root, fileName.replace('./', '')
        fileName.startsWith('.')
            ? nodeModules[fileName] ? undefined : chainingCall(path.dirname, (fileName.match(/\.\.\//g)?.length - 1) || 0, root?.replace(/\/\.\//g, '/'))
            : undefined,
        fileNameUpdated
            ? path.dirname(fileName)
            // : fileName.replace(/\.\.\//g, '')
            : path.extname(fileName)
                ? fileName.slice(0, -path.extname(fileName).length)
                // ? fileName.replace(/\.\.\//g, '')
                : fileName.replace(/\.\.\//g, '')
    );

    // if (~fileName.indexOf('debounce')) {
    //     debugger
    //     /*
    //         path.extname(fileName)
    //             ? fileName.slice(0, -path.extname(fileName).length)
    //             // ? fileName.replace(/\.\.\//g, '')
    //             : fileName.replace(/\.\.\//g, '')
    //     */
    // }

    if (content === undefined) {
        const error = new Error(`File "${(root ? (root + '/') : '') + fileName}.js" doesn't found`);
        error.name = 'FileNotFound';
        if (__needMap && (!globalOptions.onError || !globalOptions.onError(error))) {
            // TODO map attach to onError callback
            throw error
        }
        return null
    } 
    else if (content == '') {
        return null;
    }
    else {
        // if (nodeModules[fileName]) execDir = fileName;
        // let execDir = nodeModules[fileName] ? fileName : path.dirname(fileName)                 // : fileName.split('/').slice(0, -1).join('/');
        try {
            var execDir = fileName.startsWith('.')
                ? path.dirname(fileName)                     // relative
                : nodeModules[fileName]                      // node_module
                    ? (root || fileName)
                    : path.dirname(Object.keys(nodeModules).find(p => p.startsWith(fileName)) || fileName) 
            // let execDir = path.dirname(fileName)
        }
        catch(er) {
            debugger
        }

        
        if (logLinesOption) {
            content = content.replace(/console.log\(/g, function () {
                let line = arguments[2].slice(0, arguments[1]).split('\n').length.toString()
                return 'console.log("' + fileName + '.js:' + line + ':", '
            })
        }

        execDir = (execDir === '.' ? '' : execDir);
        const _root = ((root && nodeModules[fileName] === undefined && !fileNameUpdated) ? ((root) + (execDir ? '/' : '')) : '') + execDir;  // execDir

        // TODO move it to diff file
        // TODO export {default} from './{module}' => import {default as __default} from './module'; export default __default;
        
        if (~fileName.indexOf('ProviderView')) {
            // debugger
        }

        // default exports like `export {defult} from "a"` preparing
        content = content.replace(/export {[ ]*([\w\d\.-_\$, ]+)[ ]*} from ['"]([\./\w\d@\$]+)['"]/g, function(match, _exports, _from) {
            // 'import {default as __default} from "$2";\nexport default __default;'

            // TODO sourcemaps reapply

            if (_exports == 'default ') {
                return `import {default as __default} from "${_from}";\nexport default __default;`
            }
            else {
                // const exports$ = _exports.replace(/(?<=(?: as )|(?:{|, ))([\w\$\d]+)/g, '_$1');
                // const exports$ = _exports.split(',').map(w => w.trim()).map(_w => _w.replace(/\b([\w\$\d]+)$/, '_$1'))
                _exports = _exports.split(',').map(w => w.trim()).map(_w => _w == 'default' ? 'default as _default' : _w)
                const exports$ = _exports.map(_w => _w.replace(/\b([\w\$\d]+)$/, '_$1'))

                const adjective = _exports
                    .map((el, i) => el.split(' as ').pop().trim())
                    .map(el => el == '_default' ? `export default ${el};` : `export const ${el} = _${el}`)
                    .join('\n');
                const reExport = `import { ${exports$} } from '${_from}';\n${adjective}`;
                // console.log(reExport);
                // debugger
                return reExport;
            }            
        })
        
        content = this.namedImportsApply(content, _root);
    }    

    // matches1 = Array.from(content.matchAll(/^export (let|var) (\w+) = [^\n]+/gm))
    // matches2 = Array.from(content.matchAll(/^export (function) (\w+)[ ]*\([\w, ]*\)[\s]*{[\w\W]*?\n}/gm))
    // matches3 = Array.from(content.matchAll(/^export (class) (\w+)([\s]*{[\w\W]*?\n})/gm))
    // var matches = matches1.concat(matches2, matches3);

    let matches = Array.from(content.matchAll(/^export (class|function|let|const|var) ([\w_\n]+)?[\s]*=?[\s]*/gm));
    let _exports = matches.map(u => u[2]).join(', ');
    
    // TODO join default replaces to performance purpose: UP: check it, may be one of them is unused;

    content = content.replace(
        // with new line or ; after }
        /^export default[ ]+(\{[\s\S]*?\}(?:\n|;))/m, 'var _default = $1\nexport default _default;'      // origin
    )

    /// export default {...}
    content = content.replace(
        // /^export default[ ]+(\{[\s\S]*?\})[;\n]/m, 'var _default = $1;\n\nexport default _default;'           // an incident with strings containing }, nested objs {}, etc...        
        // /^export default[ ]+(\{[\s\S]*?\})/m, 'var _default = $1;export default _default;'
        /^export default[ ]+(\{[ \w\d,\(\):;'"\n\[\]]*?\})/m, function (m, $1) {
            return `var _default = ${$1};\nexport default _default;`
            // 'var _default = $1;\nexport default _default;'
        }
    );

    // TODO pass if `export default` does exists in the file
    if (!_exports) {
        // cjs format
        // does not take into account the end of the file
        // TODO support default exports for objects: module.exports = {} 
        content = content.replace(/^(?:module\.)?exports(?<export_name>\.[\w\$][\w\d\$]*)?[ ]=\s*(?<exports>[\s\S]+?(?:\n\}|;))/mg, function (_match, exportName, exportsValue) {
            
            // ((?<entityName>function|class|\([\w\d$,:<>]*) =>) [name])
            // matches.push(exportName.slice(1));
            _exports += (exportName || ' default: $default').slice(1) + ', ';
            return `var ${(exportName || ' $default').slice(1)} = ${exportsValue}`;
        });
        // _exports = matches.join(', ');
    }    


    /// export { ... as forModal }
    
    // TODO and check sourcemaps for this
    _exports += Array.from(content.matchAll(/^export \{([\s\S]*?)\}/mg,))
        .map(r => {
            return ~r[1].indexOf(' as ') ? r[1].trim().replace(/([\w]+) as ([\w]+)/, '$2: $1') : r[1].trim()
        })
        .join(', ').replace(/[\n\s]+/g, ' ')
    
    content = content.replace(/^export \{[\s\S]*?([\w]+) as ([\w]+)[\s\S]*?\}/m, (r) => r.replace(/([\w]+) as ([\w]+)/, '$1')); // 'var $2 = $1'

    /// export default ...
    // let defauMatch = content.match(/^export default \b([\w_\$]+)\b( [\w_\$]+)?/m);       // \b on $__a is failed cause of $ sign in start
    let defauMatch = content.match(/^export default ([\w_\$]+)\b( [\w_\$]+)?/m);
    if (defauMatch) {
        if (~['function', 'class'].indexOf(defauMatch[1])) {
            if (!defauMatch[2]) {
                /// export default (class|function) () {}
                content = content.replace(/^export default \b([\w_]+)\b/m, 'export default $1 $default')            
            }
            /// export default (class|function) entityName
            _exports += `${_exports && ', '}default: ` + (defauMatch[2] || '$default')                              
        }
        else {
            /// export default entityName;
            _exports += (_exports && ', ') + 'default: ' + defauMatch[1]
        }
    }

    if (_exports.startsWith(' ,')) _exports = _exports.slice(2)
    _exports = `exports = { ${_exports} };` + '\n'.repeat(startWrapLinesOffset)

    // content = '\t' + content.replace(/^export (default (_default;;)?)?/gm, '').trimEnd() + '\n\n' + _exports + '\n' + 'return exports';
    content = '\t' + content.replace(/^export (default ([\w\d_\$]+(?:;|\n))?)?/gm, '').trimEnd() + '\n\n' + _exports + '\n' + 'return exports';
    // if (fileStoreName.endsWith('uppy__dashboard')) {
    //     debugger
    // }

    modules[fileStoreName] = `const $${fileStoreName.replace('@', '_')}Exports = (function (exports) {\n ${content.split('\n').join('\n\t')} \n})({})`

    /// TO DO for future feature `incremental build` :
    if (incrementalOption) {
        // the generated module name can be used as the same role: const $${fileStoreName}Exports?

        modules[fileStoreName] = `\n/*start of ${fileName}*/\n${modules[fileStoreName]}\n/*end*/\n\n`
    }
    

    if (!__needMap) {
        return null; // content
    }
    else {
        // TO DO only inline sourcemap:

        let lines = modules[fileStoreName].split('\n')
        rootOffset += lines.length

        return {
            fileStoreName,                                                      // ==
            // start_WrapLinesOffset,                                               // ?
            // end_WrapLinesOffset,                                                 // ?
            updatedRootOffset: rootOffset,                                      // ?
            // => [1, true], [2, false], [3, true] ... => [1, 3, ...]
            lines: lines.map((/** @type {any} */ line, /** @type {any} */ i) => [i, line])   //  [i, !!(line.trim())]  // .filter(([i, f]) => f).map(([i, f]) => i)
        }
    }

}




/**
 * @param {string} fileName
 * @param {string} [absolutePath]
 * @param {(a: string) => void} [onFilenameChange]
 * @param {{root: string, basePath?: string}} [adjective]
 * @this {PathMan}
 */
function getContent(fileName, absolutePath, onFilenameChange, adjective) {
    
    var _fileName = absolutePath || (
        fileName.startsWith('.')    //  !nodeModules[fileName]
            ? path.normalize(this.dirPath + path.sep + fileName)
            : path.join(this.basePath || nodeModulesPath, fileName, nodeModules[fileName] || '')  // adjective?.basePath || nodeModulesPath
    )

    for (var ext of extensions) {
        if (fs.existsSync(_fileName + ext)) {
            _fileName = _fileName + ext;
            break;
        }
    }

    if (ext === '') {
        // most likely is directory:
        if (_fileName.split(path.sep).pop().split('.').length === 1) {
            // debugger
            _fileName += path.sep + 'index.js'
            if (onFilenameChange) onFilenameChange(fileName + '/index.js');
        }
    }

    if (exportedFiles.includes(_fileName)) {

        // let lineNumber = source.substr(0, offset).split('\n').length
        console.warn(`attempting to re-import '${_fileName}' into 'base.ts' has been rejected`);
        return ''
    }
    else exportedFiles.push(_fileName)


    try {
        // console.log(_fileName);
        var content = fs.readFileSync(_fileName).toString()
    }
    catch {
        // findPackagePath(nodeModulesPath, fileName, fs)
        // = > readExports(packageInfo)
        
        console.warn(`File "${_fileName}" ("import ... from '${fileName}'") doesn't found`)
        return '__'
        // throw new Error(`File "${fileName}" doesn't found`)
    }


    // content = Convert(content)

    return content;
}


/**
 * Remove code fragments marked as lazy inclusions
 * @param {string} content - content
 */
function removeLazy(content) {

    return content.replace(/\/\*@lazy\*\/[\s\S]*?\/\*_lazy\*\//, '');
}


/**
 * @this {Importer}
 * @param {string} sourcePath
 * @returns {string}
 */
function findProjectRoot(sourcePath) {

    if (fs.existsSync(path.join(sourcePath, 'package.json'))) {
        const nodeModulesName = globalOptions.advanced.nodeModulesDirname || 'node_modules';
        return path.join(sourcePath, nodeModulesName)
    }
    else {
        const parentDir = path.dirname(sourcePath);
        if (parentDir.length > 4) {
            return findProjectRoot(parentDir)
        }
        else {
            throw new Error('Project directory and according node_modules folder are not found');
        }
    }

}



exports.default = exports.build = exports.buildContent = exports.combineContent = combineContent;
exports.integrate = exports.packFile = exports.buildFile = buildFile;
exports.requireOptions = requireOptions;

