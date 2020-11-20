function findIndex(source, pat) {
    const s = pat[0];
    for(let i = 0; i < source.length; i++){
        if (source[i] !== s) continue;
        const pin = i;
        let matched = 1;
        let j = i;
        while(matched < pat.length){
            j++;
            if (source[j] !== pat[j - i]) {
                break;
            }
            matched++;
        }
        if (matched === pat.length) {
            return i;
        }
    }
    return -1;
}
function findLastIndex(source, pat) {
    const e = pat[pat.length - 1];
    for(let i = source.length - 1; i >= 0; i--){
        if (source[i] !== e) continue;
        const pin = i;
        let matched = 1;
        let j = i;
        while(matched < pat.length){
            j--;
            if (source[j] !== pat[pat.length - 1 - (i - j)]) {
                break;
            }
            matched++;
        }
        if (matched === pat.length) {
            return i - pat.length + 1;
        }
    }
    return -1;
}
function equal(source, match) {
    if (source.length !== match.length) return false;
    for(let i = 0; i < match.length; i++){
        if (source[i] !== match[i]) return false;
    }
    return true;
}
function hasPrefix(source, prefix) {
    for(let i = 0, max = prefix.length; i < max; i++){
        if (source[i] !== prefix[i]) return false;
    }
    return true;
}
function concat(origin, b) {
    const output = new Uint8Array(origin.length + b.length);
    output.set(origin, 0);
    output.set(b, origin.length);
    return output;
}
function copyBytes(src, dst, off = 0) {
    off = Math.max(0, Math.min(off, dst.byteLength));
    const dstBytesAvailable = dst.byteLength - off;
    if (src.byteLength > dstBytesAvailable) {
        src = src.subarray(0, dstBytesAvailable);
    }
    dst.set(src, off);
    return src.byteLength;
}
function assert1(expr, msg = "") {
    if (!expr) {
        throw new DenoStdInternalError(msg);
    }
}
function deferred() {
    let methods;
    const promise = new Promise((resolve, reject)=>{
        methods = {
            resolve,
            reject
        };
    });
    return Object.assign(promise, methods);
}
class MuxAsyncIterator {
    iteratorCount = 0;
    yields = [];
    throws = [];
    signal = deferred();
    add(iterator) {
        ++this.iteratorCount;
        this.callIteratorNext(iterator);
    }
    async callIteratorNext(iterator) {
        try {
            const { value , done  } = await iterator.next();
            if (done) {
                --this.iteratorCount;
            } else {
                this.yields.push({
                    iterator,
                    value
                });
            }
        } catch (e) {
            this.throws.push(e);
        }
        this.signal.resolve();
    }
    async *iterate() {
        while(this.iteratorCount > 0){
            await this.signal;
            for(let i = 0; i < this.yields.length; i++){
                const { iterator , value  } = this.yields[i];
                yield value;
                this.callIteratorNext(iterator);
            }
            if (this.throws.length) {
                for (const e of this.throws){
                    throw e;
                }
                this.throws.length = 0;
            }
            this.yields.length = 0;
            this.signal = deferred();
        }
    }
    [Symbol.asyncIterator]() {
        return this.iterate();
    }
}
class Server {
    closing = false;
    connections = [];
    constructor(listener){
        this.listener = listener;
    }
    close() {
        this.closing = true;
        this.listener.close();
        for (const conn of this.connections){
            try {
                conn.close();
            } catch (e) {
                if (!(e instanceof Deno.errors.BadResource)) {
                    throw e;
                }
            }
        }
    }
    async *iterateHttpRequests(conn) {
        const reader = new BufReader(conn);
        const writer = new BufWriter(conn);
        while(!this.closing){
            let request;
            try {
                request = await readRequest(conn, reader);
            } catch (error) {
                if (error instanceof Deno.errors.InvalidData || error instanceof Deno.errors.UnexpectedEof) {
                    await writeResponse(writer, {
                        status: 400,
                        body: encode(`${error.message}\r\n\r\n`)
                    });
                }
                break;
            }
            if (request === null) {
                break;
            }
            request.w = writer;
            yield request;
            const responseError = await request.done;
            if (responseError) {
                this.untrackConnection(request.conn);
                return;
            }
            await request.finalize();
        }
        this.untrackConnection(conn);
        try {
            conn.close();
        } catch (e) {
        }
    }
    trackConnection(conn) {
        this.connections.push(conn);
    }
    untrackConnection(conn) {
        const index = this.connections.indexOf(conn);
        if (index !== -1) {
            this.connections.splice(index, 1);
        }
    }
    async *acceptConnAndIterateHttpRequests(mux) {
        if (this.closing) return;
        let conn;
        try {
            conn = await this.listener.accept();
        } catch (error) {
            if (error instanceof Deno.errors.BadResource || error instanceof Deno.errors.InvalidData || error instanceof Deno.errors.UnexpectedEof) {
                return mux.add(this.acceptConnAndIterateHttpRequests(mux));
            }
            throw error;
        }
        this.trackConnection(conn);
        mux.add(this.acceptConnAndIterateHttpRequests(mux));
        yield* this.iterateHttpRequests(conn);
    }
    [Symbol.asyncIterator]() {
        const mux = new MuxAsyncIterator();
        mux.add(this.acceptConnAndIterateHttpRequests(mux));
        return mux.iterate();
    }
}
function _parseAddrFromStr(addr) {
    let url;
    try {
        const host = addr.startsWith(":") ? `0.0.0.0${addr}` : addr;
        url = new URL(`http://${host}`);
    } catch  {
        throw new TypeError("Invalid address.");
    }
    if (url.username || url.password || url.pathname != "/" || url.search || url.hash) {
        throw new TypeError("Invalid address.");
    }
    return {
        hostname: url.hostname,
        port: url.port === "" ? 80 : Number(url.port)
    };
}
function serve(addr) {
    if (typeof addr === "string") {
        addr = _parseAddrFromStr(addr);
    }
    const listener1 = Deno.listen(addr);
    return new Server(listener1);
}
function serveTLS(options) {
    const tlsOptions = {
        ...options,
        transport: "tcp"
    };
    const listener1 = Deno.listenTls(tlsOptions);
    return new Server(listener1);
}
var Status;
(function(Status1) {
    Status1[Status1["Continue"] = 100] = "Continue";
    Status1[Status1["SwitchingProtocols"] = 101] = "SwitchingProtocols";
    Status1[Status1["Processing"] = 102] = "Processing";
    Status1[Status1["EarlyHints"] = 103] = "EarlyHints";
    Status1[Status1["OK"] = 200] = "OK";
    Status1[Status1["Created"] = 201] = "Created";
    Status1[Status1["Accepted"] = 202] = "Accepted";
    Status1[Status1["NonAuthoritativeInfo"] = 203] = "NonAuthoritativeInfo";
    Status1[Status1["NoContent"] = 204] = "NoContent";
    Status1[Status1["ResetContent"] = 205] = "ResetContent";
    Status1[Status1["PartialContent"] = 206] = "PartialContent";
    Status1[Status1["MultiStatus"] = 207] = "MultiStatus";
    Status1[Status1["AlreadyReported"] = 208] = "AlreadyReported";
    Status1[Status1["IMUsed"] = 226] = "IMUsed";
    Status1[Status1["MultipleChoices"] = 300] = "MultipleChoices";
    Status1[Status1["MovedPermanently"] = 301] = "MovedPermanently";
    Status1[Status1["Found"] = 302] = "Found";
    Status1[Status1["SeeOther"] = 303] = "SeeOther";
    Status1[Status1["NotModified"] = 304] = "NotModified";
    Status1[Status1["UseProxy"] = 305] = "UseProxy";
    Status1[Status1["TemporaryRedirect"] = 307] = "TemporaryRedirect";
    Status1[Status1["PermanentRedirect"] = 308] = "PermanentRedirect";
    Status1[Status1["BadRequest"] = 400] = "BadRequest";
    Status1[Status1["Unauthorized"] = 401] = "Unauthorized";
    Status1[Status1["PaymentRequired"] = 402] = "PaymentRequired";
    Status1[Status1["Forbidden"] = 403] = "Forbidden";
    Status1[Status1["NotFound"] = 404] = "NotFound";
    Status1[Status1["MethodNotAllowed"] = 405] = "MethodNotAllowed";
    Status1[Status1["NotAcceptable"] = 406] = "NotAcceptable";
    Status1[Status1["ProxyAuthRequired"] = 407] = "ProxyAuthRequired";
    Status1[Status1["RequestTimeout"] = 408] = "RequestTimeout";
    Status1[Status1["Conflict"] = 409] = "Conflict";
    Status1[Status1["Gone"] = 410] = "Gone";
    Status1[Status1["LengthRequired"] = 411] = "LengthRequired";
    Status1[Status1["PreconditionFailed"] = 412] = "PreconditionFailed";
    Status1[Status1["RequestEntityTooLarge"] = 413] = "RequestEntityTooLarge";
    Status1[Status1["RequestURITooLong"] = 414] = "RequestURITooLong";
    Status1[Status1["UnsupportedMediaType"] = 415] = "UnsupportedMediaType";
    Status1[Status1["RequestedRangeNotSatisfiable"] = 416] = "RequestedRangeNotSatisfiable";
    Status1[Status1["ExpectationFailed"] = 417] = "ExpectationFailed";
    Status1[Status1["Teapot"] = 418] = "Teapot";
    Status1[Status1["MisdirectedRequest"] = 421] = "MisdirectedRequest";
    Status1[Status1["UnprocessableEntity"] = 422] = "UnprocessableEntity";
    Status1[Status1["Locked"] = 423] = "Locked";
    Status1[Status1["FailedDependency"] = 424] = "FailedDependency";
    Status1[Status1["TooEarly"] = 425] = "TooEarly";
    Status1[Status1["UpgradeRequired"] = 426] = "UpgradeRequired";
    Status1[Status1["PreconditionRequired"] = 428] = "PreconditionRequired";
    Status1[Status1["TooManyRequests"] = 429] = "TooManyRequests";
    Status1[Status1["RequestHeaderFieldsTooLarge"] = 431] = "RequestHeaderFieldsTooLarge";
    Status1[Status1["UnavailableForLegalReasons"] = 451] = "UnavailableForLegalReasons";
    Status1[Status1["InternalServerError"] = 500] = "InternalServerError";
    Status1[Status1["NotImplemented"] = 501] = "NotImplemented";
    Status1[Status1["BadGateway"] = 502] = "BadGateway";
    Status1[Status1["ServiceUnavailable"] = 503] = "ServiceUnavailable";
    Status1[Status1["GatewayTimeout"] = 504] = "GatewayTimeout";
    Status1[Status1["HTTPVersionNotSupported"] = 505] = "HTTPVersionNotSupported";
    Status1[Status1["VariantAlsoNegotiates"] = 506] = "VariantAlsoNegotiates";
    Status1[Status1["InsufficientStorage"] = 507] = "InsufficientStorage";
    Status1[Status1["LoopDetected"] = 508] = "LoopDetected";
    Status1[Status1["NotExtended"] = 510] = "NotExtended";
    Status1[Status1["NetworkAuthenticationRequired"] = 511] = "NetworkAuthenticationRequired";
})(Status || (Status = {
}));
const regExpEscapeChars = [
    "!",
    "$",
    "(",
    ")",
    "*",
    "+",
    ".",
    "=",
    "?",
    "[",
    "\\",
    "^",
    "{",
    "|"
];
const rangeEscapeChars = [
    "-",
    "\\",
    "]"
];
let NATIVE_OS = "linux";
const navigator = globalThis.navigator;
if (globalThis.Deno != null) {
    NATIVE_OS = Deno.build.os;
} else if (navigator?.appVersion?.includes?.("Win") ?? false) {
    NATIVE_OS = "windows";
}
const isWindows = NATIVE_OS == "windows";
const _win32 = function() {
    const sep = "\\";
    const delimiter = ";";
    function resolve(...pathSegments) {
        let resolvedDevice = "";
        let resolvedTail = "";
        let resolvedAbsolute = false;
        for(let i = pathSegments.length - 1; i >= -1; i--){
            let path;
            if (i >= 0) {
                path = pathSegments[i];
            } else if (!resolvedDevice) {
                if (globalThis.Deno == null) {
                    throw new TypeError("Resolved a drive-letter-less path without a CWD.");
                }
                path = Deno.cwd();
            } else {
                if (globalThis.Deno == null) {
                    throw new TypeError("Resolved a relative path without a CWD.");
                }
                path = Deno.env.get(`=${resolvedDevice}`) || Deno.cwd();
                if (path === undefined || path.slice(0, 3).toLowerCase() !== `${resolvedDevice.toLowerCase()}\\`) {
                    path = `${resolvedDevice}\\`;
                }
            }
            assertPath(path);
            const len = path.length;
            if (len === 0) continue;
            let rootEnd = 0;
            let device = "";
            let isAbsolute = false;
            const code = path.charCodeAt(0);
            if (len > 1) {
                if (isPathSeparator(code)) {
                    isAbsolute = true;
                    if (isPathSeparator(path.charCodeAt(1))) {
                        let j = 2;
                        let last = j;
                        for(; j < len; ++j){
                            if (isPathSeparator(path.charCodeAt(j))) break;
                        }
                        if (j < len && j !== last) {
                            const firstPart = path.slice(last, j);
                            last = j;
                            for(; j < len; ++j){
                                if (!isPathSeparator(path.charCodeAt(j))) break;
                            }
                            if (j < len && j !== last) {
                                last = j;
                                for(; j < len; ++j){
                                    if (isPathSeparator(path.charCodeAt(j))) break;
                                }
                                if (j === len) {
                                    device = `\\\\${firstPart}\\${path.slice(last)}`;
                                    rootEnd = j;
                                } else if (j !== last) {
                                    device = `\\\\${firstPart}\\${path.slice(last, j)}`;
                                    rootEnd = j;
                                }
                            }
                        }
                    } else {
                        rootEnd = 1;
                    }
                } else if (isWindowsDeviceRoot(code)) {
                    if (path.charCodeAt(1) === 58) {
                        device = path.slice(0, 2);
                        rootEnd = 2;
                        if (len > 2) {
                            if (isPathSeparator(path.charCodeAt(2))) {
                                isAbsolute = true;
                                rootEnd = 3;
                            }
                        }
                    }
                }
            } else if (isPathSeparator(code)) {
                rootEnd = 1;
                isAbsolute = true;
            }
            if (device.length > 0 && resolvedDevice.length > 0 && device.toLowerCase() !== resolvedDevice.toLowerCase()) {
                continue;
            }
            if (resolvedDevice.length === 0 && device.length > 0) {
                resolvedDevice = device;
            }
            if (!resolvedAbsolute) {
                resolvedTail = `${path.slice(rootEnd)}\\${resolvedTail}`;
                resolvedAbsolute = isAbsolute;
            }
            if (resolvedAbsolute && resolvedDevice.length > 0) break;
        }
        resolvedTail = normalizeString(resolvedTail, !resolvedAbsolute, "\\", isPathSeparator);
        return resolvedDevice + (resolvedAbsolute ? "\\" : "") + resolvedTail || ".";
    }
    function normalize(path) {
        assertPath(path);
        const len = path.length;
        if (len === 0) return ".";
        let rootEnd = 0;
        let device;
        let isAbsolute = false;
        const code = path.charCodeAt(0);
        if (len > 1) {
            if (isPathSeparator(code)) {
                isAbsolute = true;
                if (isPathSeparator(path.charCodeAt(1))) {
                    let j = 2;
                    let last = j;
                    for(; j < len; ++j){
                        if (isPathSeparator(path.charCodeAt(j))) break;
                    }
                    if (j < len && j !== last) {
                        const firstPart = path.slice(last, j);
                        last = j;
                        for(; j < len; ++j){
                            if (!isPathSeparator(path.charCodeAt(j))) break;
                        }
                        if (j < len && j !== last) {
                            last = j;
                            for(; j < len; ++j){
                                if (isPathSeparator(path.charCodeAt(j))) break;
                            }
                            if (j === len) {
                                return `\\\\${firstPart}\\${path.slice(last)}\\`;
                            } else if (j !== last) {
                                device = `\\\\${firstPart}\\${path.slice(last, j)}`;
                                rootEnd = j;
                            }
                        }
                    }
                } else {
                    rootEnd = 1;
                }
            } else if (isWindowsDeviceRoot(code)) {
                if (path.charCodeAt(1) === 58) {
                    device = path.slice(0, 2);
                    rootEnd = 2;
                    if (len > 2) {
                        if (isPathSeparator(path.charCodeAt(2))) {
                            isAbsolute = true;
                            rootEnd = 3;
                        }
                    }
                }
            }
        } else if (isPathSeparator(code)) {
            return "\\";
        }
        let tail;
        if (rootEnd < len) {
            tail = normalizeString(path.slice(rootEnd), !isAbsolute, "\\", isPathSeparator);
        } else {
            tail = "";
        }
        if (tail.length === 0 && !isAbsolute) tail = ".";
        if (tail.length > 0 && isPathSeparator(path.charCodeAt(len - 1))) {
            tail += "\\";
        }
        if (device === undefined) {
            if (isAbsolute) {
                if (tail.length > 0) return `\\${tail}`;
                else return "\\";
            } else if (tail.length > 0) {
                return tail;
            } else {
                return "";
            }
        } else if (isAbsolute) {
            if (tail.length > 0) return `${device}\\${tail}`;
            else return `${device}\\`;
        } else if (tail.length > 0) {
            return device + tail;
        } else {
            return device;
        }
    }
    function isAbsolute(path) {
        assertPath(path);
        const len = path.length;
        if (len === 0) return false;
        const code = path.charCodeAt(0);
        if (isPathSeparator(code)) {
            return true;
        } else if (isWindowsDeviceRoot(code)) {
            if (len > 2 && path.charCodeAt(1) === 58) {
                if (isPathSeparator(path.charCodeAt(2))) return true;
            }
        }
        return false;
    }
    function join(...paths) {
        const pathsCount = paths.length;
        if (pathsCount === 0) return ".";
        let joined;
        let firstPart = null;
        for(let i = 0; i < pathsCount; ++i){
            const path = paths[i];
            assertPath(path);
            if (path.length > 0) {
                if (joined === undefined) joined = firstPart = path;
                else joined += `\\${path}`;
            }
        }
        if (joined === undefined) return ".";
        let needsReplace = true;
        let slashCount = 0;
        assert1(firstPart != null);
        if (isPathSeparator(firstPart.charCodeAt(0))) {
            ++slashCount;
            const firstLen = firstPart.length;
            if (firstLen > 1) {
                if (isPathSeparator(firstPart.charCodeAt(1))) {
                    ++slashCount;
                    if (firstLen > 2) {
                        if (isPathSeparator(firstPart.charCodeAt(2))) ++slashCount;
                        else {
                            needsReplace = false;
                        }
                    }
                }
            }
        }
        if (needsReplace) {
            for(; slashCount < joined.length; ++slashCount){
                if (!isPathSeparator(joined.charCodeAt(slashCount))) break;
            }
            if (slashCount >= 2) joined = `\\${joined.slice(slashCount)}`;
        }
        return normalize(joined);
    }
    function relative(from, to) {
        assertPath(from);
        assertPath(to);
        if (from === to) return "";
        const fromOrig = resolve(from);
        const toOrig = resolve(to);
        if (fromOrig === toOrig) return "";
        from = fromOrig.toLowerCase();
        to = toOrig.toLowerCase();
        if (from === to) return "";
        let fromStart = 0;
        let fromEnd = from.length;
        for(; fromStart < fromEnd; ++fromStart){
            if (from.charCodeAt(fromStart) !== 92) break;
        }
        for(; fromEnd - 1 > fromStart; --fromEnd){
            if (from.charCodeAt(fromEnd - 1) !== 92) break;
        }
        const fromLen = fromEnd - fromStart;
        let toStart = 0;
        let toEnd = to.length;
        for(; toStart < toEnd; ++toStart){
            if (to.charCodeAt(toStart) !== 92) break;
        }
        for(; toEnd - 1 > toStart; --toEnd){
            if (to.charCodeAt(toEnd - 1) !== 92) break;
        }
        const toLen = toEnd - toStart;
        const length = fromLen < toLen ? fromLen : toLen;
        let lastCommonSep = -1;
        let i = 0;
        for(; i <= length; ++i){
            if (i === length) {
                if (toLen > length) {
                    if (to.charCodeAt(toStart + i) === 92) {
                        return toOrig.slice(toStart + i + 1);
                    } else if (i === 2) {
                        return toOrig.slice(toStart + i);
                    }
                }
                if (fromLen > length) {
                    if (from.charCodeAt(fromStart + i) === 92) {
                        lastCommonSep = i;
                    } else if (i === 2) {
                        lastCommonSep = 3;
                    }
                }
                break;
            }
            const fromCode = from.charCodeAt(fromStart + i);
            const toCode = to.charCodeAt(toStart + i);
            if (fromCode !== toCode) break;
            else if (fromCode === 92) lastCommonSep = i;
        }
        if (i !== length && lastCommonSep === -1) {
            return toOrig;
        }
        let out = "";
        if (lastCommonSep === -1) lastCommonSep = 0;
        for(i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i){
            if (i === fromEnd || from.charCodeAt(i) === 92) {
                if (out.length === 0) out += "..";
                else out += "\\..";
            }
        }
        if (out.length > 0) {
            return out + toOrig.slice(toStart + lastCommonSep, toEnd);
        } else {
            toStart += lastCommonSep;
            if (toOrig.charCodeAt(toStart) === 92) ++toStart;
            return toOrig.slice(toStart, toEnd);
        }
    }
    function toNamespacedPath(path) {
        if (typeof path !== "string") return path;
        if (path.length === 0) return "";
        const resolvedPath = resolve(path);
        if (resolvedPath.length >= 3) {
            if (resolvedPath.charCodeAt(0) === 92) {
                if (resolvedPath.charCodeAt(1) === 92) {
                    const code = resolvedPath.charCodeAt(2);
                    if (code !== 63 && code !== 46) {
                        return `\\\\?\\UNC\\${resolvedPath.slice(2)}`;
                    }
                }
            } else if (isWindowsDeviceRoot(resolvedPath.charCodeAt(0))) {
                if (resolvedPath.charCodeAt(1) === 58 && resolvedPath.charCodeAt(2) === 92) {
                    return `\\\\?\\${resolvedPath}`;
                }
            }
        }
        return path;
    }
    function dirname(path) {
        assertPath(path);
        const len = path.length;
        if (len === 0) return ".";
        let rootEnd = -1;
        let end = -1;
        let matchedSlash = true;
        let offset = 0;
        const code = path.charCodeAt(0);
        if (len > 1) {
            if (isPathSeparator(code)) {
                rootEnd = offset = 1;
                if (isPathSeparator(path.charCodeAt(1))) {
                    let j = 2;
                    let last = j;
                    for(; j < len; ++j){
                        if (isPathSeparator(path.charCodeAt(j))) break;
                    }
                    if (j < len && j !== last) {
                        last = j;
                        for(; j < len; ++j){
                            if (!isPathSeparator(path.charCodeAt(j))) break;
                        }
                        if (j < len && j !== last) {
                            last = j;
                            for(; j < len; ++j){
                                if (isPathSeparator(path.charCodeAt(j))) break;
                            }
                            if (j === len) {
                                return path;
                            }
                            if (j !== last) {
                                rootEnd = offset = j + 1;
                            }
                        }
                    }
                }
            } else if (isWindowsDeviceRoot(code)) {
                if (path.charCodeAt(1) === 58) {
                    rootEnd = offset = 2;
                    if (len > 2) {
                        if (isPathSeparator(path.charCodeAt(2))) rootEnd = offset = 3;
                    }
                }
            }
        } else if (isPathSeparator(code)) {
            return path;
        }
        for(let i = len - 1; i >= offset; --i){
            if (isPathSeparator(path.charCodeAt(i))) {
                if (!matchedSlash) {
                    end = i;
                    break;
                }
            } else {
                matchedSlash = false;
            }
        }
        if (end === -1) {
            if (rootEnd === -1) return ".";
            else end = rootEnd;
        }
        return path.slice(0, end);
    }
    function basename(path, ext = "") {
        if (ext !== undefined && typeof ext !== "string") {
            throw new TypeError('\"ext\" argument must be a string');
        }
        assertPath(path);
        let start = 0;
        let end = -1;
        let matchedSlash = true;
        let i;
        if (path.length >= 2) {
            const drive = path.charCodeAt(0);
            if (isWindowsDeviceRoot(drive)) {
                if (path.charCodeAt(1) === 58) start = 2;
            }
        }
        if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
            if (ext.length === path.length && ext === path) return "";
            let extIdx = ext.length - 1;
            let firstNonSlashEnd = -1;
            for(i = path.length - 1; i >= start; --i){
                const code = path.charCodeAt(i);
                if (isPathSeparator(code)) {
                    if (!matchedSlash) {
                        start = i + 1;
                        break;
                    }
                } else {
                    if (firstNonSlashEnd === -1) {
                        matchedSlash = false;
                        firstNonSlashEnd = i + 1;
                    }
                    if (extIdx >= 0) {
                        if (code === ext.charCodeAt(extIdx)) {
                            if ((--extIdx) === -1) {
                                end = i;
                            }
                        } else {
                            extIdx = -1;
                            end = firstNonSlashEnd;
                        }
                    }
                }
            }
            if (start === end) end = firstNonSlashEnd;
            else if (end === -1) end = path.length;
            return path.slice(start, end);
        } else {
            for(i = path.length - 1; i >= start; --i){
                if (isPathSeparator(path.charCodeAt(i))) {
                    if (!matchedSlash) {
                        start = i + 1;
                        break;
                    }
                } else if (end === -1) {
                    matchedSlash = false;
                    end = i + 1;
                }
            }
            if (end === -1) return "";
            return path.slice(start, end);
        }
    }
    function extname(path) {
        assertPath(path);
        let start = 0;
        let startDot = -1;
        let startPart = 0;
        let end = -1;
        let matchedSlash = true;
        let preDotState = 0;
        if (path.length >= 2 && path.charCodeAt(1) === 58 && isWindowsDeviceRoot(path.charCodeAt(0))) {
            start = startPart = 2;
        }
        for(let i = path.length - 1; i >= start; --i){
            const code = path.charCodeAt(i);
            if (isPathSeparator(code)) {
                if (!matchedSlash) {
                    startPart = i + 1;
                    break;
                }
                continue;
            }
            if (end === -1) {
                matchedSlash = false;
                end = i + 1;
            }
            if (code === 46) {
                if (startDot === -1) startDot = i;
                else if (preDotState !== 1) preDotState = 1;
            } else if (startDot !== -1) {
                preDotState = -1;
            }
        }
        if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
            return "";
        }
        return path.slice(startDot, end);
    }
    function format(pathObject) {
        if (pathObject === null || typeof pathObject !== "object") {
            throw new TypeError(`The "pathObject" argument must be of type Object. Received type ${typeof pathObject}`);
        }
        return _format("\\", pathObject);
    }
    function parse(path) {
        assertPath(path);
        const ret = {
            root: "",
            dir: "",
            base: "",
            ext: "",
            name: ""
        };
        const len = path.length;
        if (len === 0) return ret;
        let rootEnd = 0;
        let code = path.charCodeAt(0);
        if (len > 1) {
            if (isPathSeparator(code)) {
                rootEnd = 1;
                if (isPathSeparator(path.charCodeAt(1))) {
                    let j = 2;
                    let last = j;
                    for(; j < len; ++j){
                        if (isPathSeparator(path.charCodeAt(j))) break;
                    }
                    if (j < len && j !== last) {
                        last = j;
                        for(; j < len; ++j){
                            if (!isPathSeparator(path.charCodeAt(j))) break;
                        }
                        if (j < len && j !== last) {
                            last = j;
                            for(; j < len; ++j){
                                if (isPathSeparator(path.charCodeAt(j))) break;
                            }
                            if (j === len) {
                                rootEnd = j;
                            } else if (j !== last) {
                                rootEnd = j + 1;
                            }
                        }
                    }
                }
            } else if (isWindowsDeviceRoot(code)) {
                if (path.charCodeAt(1) === 58) {
                    rootEnd = 2;
                    if (len > 2) {
                        if (isPathSeparator(path.charCodeAt(2))) {
                            if (len === 3) {
                                ret.root = ret.dir = path;
                                return ret;
                            }
                            rootEnd = 3;
                        }
                    } else {
                        ret.root = ret.dir = path;
                        return ret;
                    }
                }
            }
        } else if (isPathSeparator(code)) {
            ret.root = ret.dir = path;
            return ret;
        }
        if (rootEnd > 0) ret.root = path.slice(0, rootEnd);
        let startDot = -1;
        let startPart = rootEnd;
        let end = -1;
        let matchedSlash = true;
        let i = path.length - 1;
        let preDotState = 0;
        for(; i >= rootEnd; --i){
            code = path.charCodeAt(i);
            if (isPathSeparator(code)) {
                if (!matchedSlash) {
                    startPart = i + 1;
                    break;
                }
                continue;
            }
            if (end === -1) {
                matchedSlash = false;
                end = i + 1;
            }
            if (code === 46) {
                if (startDot === -1) startDot = i;
                else if (preDotState !== 1) preDotState = 1;
            } else if (startDot !== -1) {
                preDotState = -1;
            }
        }
        if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
            if (end !== -1) {
                ret.base = ret.name = path.slice(startPart, end);
            }
        } else {
            ret.name = path.slice(startPart, startDot);
            ret.base = path.slice(startPart, end);
            ret.ext = path.slice(startDot, end);
        }
        if (startPart > 0 && startPart !== rootEnd) {
            ret.dir = path.slice(0, startPart - 1);
        } else ret.dir = ret.root;
        return ret;
    }
    function fromFileUrl(url) {
        url = url instanceof URL ? url : new URL(url);
        if (url.protocol != "file:") {
            throw new TypeError("Must be a file URL.");
        }
        let path = decodeURIComponent(url.pathname.replace(/\//g, "\\").replace(/%(?![0-9A-Fa-f]{2})/g, "%25")).replace(/^\\*([A-Za-z]:)(\\|$)/, "$1\\");
        if (url.hostname != "") {
            path = `\\\\${url.hostname}${path}`;
        }
        return path;
    }
    function toFileUrl(path) {
        if (!isAbsolute(path)) {
            throw new TypeError("Must be an absolute path.");
        }
        const [, hostname, pathname] = path.match(/^(?:[/\\]{2}([^/\\]+)(?=[/\\][^/\\]))?(.*)/);
        const url = new URL("file:///");
        url.pathname = pathname.replace(/%/g, "%25");
        if (hostname != null) {
            url.hostname = hostname;
            if (!url.hostname) {
                throw new TypeError("Invalid hostname.");
            }
        }
        return url;
    }
    return {
        sep,
        delimiter,
        resolve,
        normalize,
        isAbsolute,
        join,
        relative,
        toNamespacedPath,
        dirname,
        basename,
        extname,
        format,
        parse,
        fromFileUrl,
        toFileUrl
    };
}();
function assertPath(path) {
    if (typeof path !== "string") {
        throw new TypeError(`Path must be a string. Received ${JSON.stringify(path)}`);
    }
}
function isPosixPathSeparator(code) {
    return code === 47;
}
function isPathSeparator(code) {
    return isPosixPathSeparator(code) || code === 92;
}
function isWindowsDeviceRoot(code) {
    return code >= 97 && code <= 122 || code >= 65 && code <= 90;
}
function normalizeString(path, allowAboveRoot, separator, isPathSeparator1) {
    let res = "";
    let lastSegmentLength = 0;
    let lastSlash = -1;
    let dots = 0;
    let code;
    for(let i = 0, len = path.length; i <= len; ++i){
        if (i < len) code = path.charCodeAt(i);
        else if (isPathSeparator1(code)) break;
        else code = 47;
        if (isPathSeparator1(code)) {
            if (lastSlash === i - 1 || dots === 1) {
            } else if (lastSlash !== i - 1 && dots === 2) {
                if (res.length < 2 || lastSegmentLength !== 2 || res.charCodeAt(res.length - 1) !== 46 || res.charCodeAt(res.length - 2) !== 46) {
                    if (res.length > 2) {
                        const lastSlashIndex = res.lastIndexOf(separator);
                        if (lastSlashIndex === -1) {
                            res = "";
                            lastSegmentLength = 0;
                        } else {
                            res = res.slice(0, lastSlashIndex);
                            lastSegmentLength = res.length - 1 - res.lastIndexOf(separator);
                        }
                        lastSlash = i;
                        dots = 0;
                        continue;
                    } else if (res.length === 2 || res.length === 1) {
                        res = "";
                        lastSegmentLength = 0;
                        lastSlash = i;
                        dots = 0;
                        continue;
                    }
                }
                if (allowAboveRoot) {
                    if (res.length > 0) res += `${separator}..`;
                    else res = "..";
                    lastSegmentLength = 2;
                }
            } else {
                if (res.length > 0) res += separator + path.slice(lastSlash + 1, i);
                else res = path.slice(lastSlash + 1, i);
                lastSegmentLength = i - lastSlash - 1;
            }
            lastSlash = i;
            dots = 0;
        } else if (code === 46 && dots !== -1) {
            ++dots;
        } else {
            dots = -1;
        }
    }
    return res;
}
function _format(sep, pathObject) {
    const dir = pathObject.dir || pathObject.root;
    const base = pathObject.base || (pathObject.name || "") + (pathObject.ext || "");
    if (!dir) return base;
    if (dir === pathObject.root) return dir + base;
    return dir + sep + base;
}
const _posix = function() {
    const sep = "/";
    const delimiter = ":";
    function resolve(...pathSegments) {
        let resolvedPath = "";
        let resolvedAbsolute = false;
        for(let i = pathSegments.length - 1; i >= -1 && !resolvedAbsolute; i--){
            let path;
            if (i >= 0) path = pathSegments[i];
            else {
                if (globalThis.Deno == null) {
                    throw new TypeError("Resolved a relative path without a CWD.");
                }
                path = Deno.cwd();
            }
            assertPath(path);
            if (path.length === 0) {
                continue;
            }
            resolvedPath = `${path}/${resolvedPath}`;
            resolvedAbsolute = path.charCodeAt(0) === 47;
        }
        resolvedPath = normalizeString(resolvedPath, !resolvedAbsolute, "/", isPosixPathSeparator);
        if (resolvedAbsolute) {
            if (resolvedPath.length > 0) return `/${resolvedPath}`;
            else return "/";
        } else if (resolvedPath.length > 0) return resolvedPath;
        else return ".";
    }
    function normalize(path) {
        assertPath(path);
        if (path.length === 0) return ".";
        const isAbsolute = path.charCodeAt(0) === 47;
        const trailingSeparator = path.charCodeAt(path.length - 1) === 47;
        path = normalizeString(path, !isAbsolute, "/", isPosixPathSeparator);
        if (path.length === 0 && !isAbsolute) path = ".";
        if (path.length > 0 && trailingSeparator) path += "/";
        if (isAbsolute) return `/${path}`;
        return path;
    }
    function isAbsolute(path) {
        assertPath(path);
        return path.length > 0 && path.charCodeAt(0) === 47;
    }
    function join(...paths) {
        if (paths.length === 0) return ".";
        let joined;
        for(let i = 0, len = paths.length; i < len; ++i){
            const path = paths[i];
            assertPath(path);
            if (path.length > 0) {
                if (!joined) joined = path;
                else joined += `/${path}`;
            }
        }
        if (!joined) return ".";
        return normalize(joined);
    }
    function relative(from, to) {
        assertPath(from);
        assertPath(to);
        if (from === to) return "";
        from = resolve(from);
        to = resolve(to);
        if (from === to) return "";
        let fromStart = 1;
        const fromEnd = from.length;
        for(; fromStart < fromEnd; ++fromStart){
            if (from.charCodeAt(fromStart) !== 47) break;
        }
        const fromLen = fromEnd - fromStart;
        let toStart = 1;
        const toEnd = to.length;
        for(; toStart < toEnd; ++toStart){
            if (to.charCodeAt(toStart) !== 47) break;
        }
        const toLen = toEnd - toStart;
        const length = fromLen < toLen ? fromLen : toLen;
        let lastCommonSep = -1;
        let i = 0;
        for(; i <= length; ++i){
            if (i === length) {
                if (toLen > length) {
                    if (to.charCodeAt(toStart + i) === 47) {
                        return to.slice(toStart + i + 1);
                    } else if (i === 0) {
                        return to.slice(toStart + i);
                    }
                } else if (fromLen > length) {
                    if (from.charCodeAt(fromStart + i) === 47) {
                        lastCommonSep = i;
                    } else if (i === 0) {
                        lastCommonSep = 0;
                    }
                }
                break;
            }
            const fromCode = from.charCodeAt(fromStart + i);
            const toCode = to.charCodeAt(toStart + i);
            if (fromCode !== toCode) break;
            else if (fromCode === 47) lastCommonSep = i;
        }
        let out = "";
        for(i = fromStart + lastCommonSep + 1; i <= fromEnd; ++i){
            if (i === fromEnd || from.charCodeAt(i) === 47) {
                if (out.length === 0) out += "..";
                else out += "/..";
            }
        }
        if (out.length > 0) return out + to.slice(toStart + lastCommonSep);
        else {
            toStart += lastCommonSep;
            if (to.charCodeAt(toStart) === 47) ++toStart;
            return to.slice(toStart);
        }
    }
    function toNamespacedPath(path) {
        return path;
    }
    function dirname(path) {
        assertPath(path);
        if (path.length === 0) return ".";
        const hasRoot = path.charCodeAt(0) === 47;
        let end = -1;
        let matchedSlash = true;
        for(let i = path.length - 1; i >= 1; --i){
            if (path.charCodeAt(i) === 47) {
                if (!matchedSlash) {
                    end = i;
                    break;
                }
            } else {
                matchedSlash = false;
            }
        }
        if (end === -1) return hasRoot ? "/" : ".";
        if (hasRoot && end === 1) return "//";
        return path.slice(0, end);
    }
    function basename(path, ext = "") {
        if (ext !== undefined && typeof ext !== "string") {
            throw new TypeError('\"ext\" argument must be a string');
        }
        assertPath(path);
        let start = 0;
        let end = -1;
        let matchedSlash = true;
        let i;
        if (ext !== undefined && ext.length > 0 && ext.length <= path.length) {
            if (ext.length === path.length && ext === path) return "";
            let extIdx = ext.length - 1;
            let firstNonSlashEnd = -1;
            for(i = path.length - 1; i >= 0; --i){
                const code = path.charCodeAt(i);
                if (code === 47) {
                    if (!matchedSlash) {
                        start = i + 1;
                        break;
                    }
                } else {
                    if (firstNonSlashEnd === -1) {
                        matchedSlash = false;
                        firstNonSlashEnd = i + 1;
                    }
                    if (extIdx >= 0) {
                        if (code === ext.charCodeAt(extIdx)) {
                            if ((--extIdx) === -1) {
                                end = i;
                            }
                        } else {
                            extIdx = -1;
                            end = firstNonSlashEnd;
                        }
                    }
                }
            }
            if (start === end) end = firstNonSlashEnd;
            else if (end === -1) end = path.length;
            return path.slice(start, end);
        } else {
            for(i = path.length - 1; i >= 0; --i){
                if (path.charCodeAt(i) === 47) {
                    if (!matchedSlash) {
                        start = i + 1;
                        break;
                    }
                } else if (end === -1) {
                    matchedSlash = false;
                    end = i + 1;
                }
            }
            if (end === -1) return "";
            return path.slice(start, end);
        }
    }
    function extname(path) {
        assertPath(path);
        let startDot = -1;
        let startPart = 0;
        let end = -1;
        let matchedSlash = true;
        let preDotState = 0;
        for(let i = path.length - 1; i >= 0; --i){
            const code = path.charCodeAt(i);
            if (code === 47) {
                if (!matchedSlash) {
                    startPart = i + 1;
                    break;
                }
                continue;
            }
            if (end === -1) {
                matchedSlash = false;
                end = i + 1;
            }
            if (code === 46) {
                if (startDot === -1) startDot = i;
                else if (preDotState !== 1) preDotState = 1;
            } else if (startDot !== -1) {
                preDotState = -1;
            }
        }
        if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
            return "";
        }
        return path.slice(startDot, end);
    }
    function format(pathObject) {
        if (pathObject === null || typeof pathObject !== "object") {
            throw new TypeError(`The "pathObject" argument must be of type Object. Received type ${typeof pathObject}`);
        }
        return _format("/", pathObject);
    }
    function parse(path) {
        assertPath(path);
        const ret = {
            root: "",
            dir: "",
            base: "",
            ext: "",
            name: ""
        };
        if (path.length === 0) return ret;
        const isAbsolute1 = path.charCodeAt(0) === 47;
        let start;
        if (isAbsolute1) {
            ret.root = "/";
            start = 1;
        } else {
            start = 0;
        }
        let startDot = -1;
        let startPart = 0;
        let end = -1;
        let matchedSlash = true;
        let i = path.length - 1;
        let preDotState = 0;
        for(; i >= start; --i){
            const code = path.charCodeAt(i);
            if (code === 47) {
                if (!matchedSlash) {
                    startPart = i + 1;
                    break;
                }
                continue;
            }
            if (end === -1) {
                matchedSlash = false;
                end = i + 1;
            }
            if (code === 46) {
                if (startDot === -1) startDot = i;
                else if (preDotState !== 1) preDotState = 1;
            } else if (startDot !== -1) {
                preDotState = -1;
            }
        }
        if (startDot === -1 || end === -1 || preDotState === 0 || preDotState === 1 && startDot === end - 1 && startDot === startPart + 1) {
            if (end !== -1) {
                if (startPart === 0 && isAbsolute1) {
                    ret.base = ret.name = path.slice(1, end);
                } else {
                    ret.base = ret.name = path.slice(startPart, end);
                }
            }
        } else {
            if (startPart === 0 && isAbsolute1) {
                ret.name = path.slice(1, startDot);
                ret.base = path.slice(1, end);
            } else {
                ret.name = path.slice(startPart, startDot);
                ret.base = path.slice(startPart, end);
            }
            ret.ext = path.slice(startDot, end);
        }
        if (startPart > 0) ret.dir = path.slice(0, startPart - 1);
        else if (isAbsolute1) ret.dir = "/";
        return ret;
    }
    function fromFileUrl(url) {
        url = url instanceof URL ? url : new URL(url);
        if (url.protocol != "file:") {
            throw new TypeError("Must be a file URL.");
        }
        return decodeURIComponent(url.pathname.replace(/%(?![0-9A-Fa-f]{2})/g, "%25"));
    }
    function toFileUrl(path) {
        if (!isAbsolute(path)) {
            throw new TypeError("Must be an absolute path.");
        }
        const url = new URL("file:///");
        url.pathname = path.replace(/%/g, "%25").replace(/\\/g, "%5C");
        return url;
    }
    return {
        sep,
        delimiter,
        resolve,
        normalize,
        isAbsolute,
        join,
        relative,
        toNamespacedPath,
        dirname,
        basename,
        extname,
        format,
        parse,
        fromFileUrl,
        toFileUrl
    };
}();
const path1 = isWindows ? _win32 : _posix;
const { basename , delimiter , dirname , extname , format , fromFileUrl , isAbsolute , join , normalize , parse , relative , resolve , sep , toFileUrl , toNamespacedPath ,  } = path1;
const SEP = isWindows ? "\\" : "/";
const SEP_PATTERN = isWindows ? /[\\/]+/ : /\/+/;
function normalizeGlob(glob, { globstar =false  } = {
}) {
    if (glob.match(/\0/g)) {
        throw new Error(`Glob contains invalid characters: "${glob}"`);
    }
    if (!globstar) {
        return normalize(glob);
    }
    const s = SEP_PATTERN.source;
    const badParentPattern = new RegExp(`(?<=(${s}|^)\\*\\*${s})\\.\\.(?=${s}|$)`, "g");
    return normalize(glob.replace(badParentPattern, "\u{0}")).replace(/\0/g, "..");
}
function contentType1(filepath) {
    return MIME.DB[extname(filepath)];
}
function hasTrailingSlash(str) {
    if (str.length > 1 && str[str.length - 1] === "/") {
        return true;
    }
    return false;
}
function NotFoundHandler() {
    throw new NotFoundException();
}
const noColor = globalThis.Deno?.noColor ?? true;
let enabled = !noColor;
function code1(open, close) {
    return {
        open: `\x1b[${open.join(";")}m`,
        close: `\x1b[${close}m`,
        regexp: new RegExp(`\\x1b\\[${close}m`, "g")
    };
}
function run(str, code1) {
    return enabled ? `${code1.open}${str.replace(code1.regexp, code1.open)}${code1.close}` : str;
}
function yellow(str) {
    return run(str, code1([
        33
    ], 39));
}
function brightBlack(str) {
    return run(str, code1([
        90
    ], 39));
}
function clampAndTruncate(n, max = 255, min = 0) {
    return Math.trunc(Math.max(Math.min(n, max), min));
}
const ANSI_PATTERN = new RegExp([
    "[\\u001B\\u009B][[\\]()#;?]*(?:(?:(?:[a-zA-Z\\d]*(?:;[-a-zA-Z\\d\\/#&.:=?%@~_]*)*)?\\u0007)",
    "(?:(?:\\d{1,4}(?:;\\d{0,4})*)?[\\dA-PR-TZcf-ntqry=><~]))", 
].join("|"), "g");
class Tokenizer {
    constructor(rules = []){
        this.rules = rules;
    }
    addRule(test, fn) {
        this.rules.push({
            test,
            fn
        });
        return this;
    }
    tokenize(string, receiver = (token)=>token
    ) {
        function* generator(rules1) {
            let index = 0;
            for (const rule of rules1){
                const result = rule.test(string);
                if (result) {
                    const { value , length  } = result;
                    index += length;
                    string = string.slice(length);
                    const token = {
                        ...rule.fn(value),
                        index
                    };
                    yield receiver(token);
                    yield* generator(rules1);
                }
            }
        }
        const tokenGenerator = generator(this.rules);
        const tokens = [];
        for (const token of tokenGenerator){
            tokens.push(token);
        }
        if (string.length) {
            throw new Error(`parser error: string not fully parsed! ${string.slice(0, 25)}`);
        }
        return tokens;
    }
}
function digits(value, count = 2) {
    return String(value).padStart(count, "0");
}
function createLiteralTestFunction(value) {
    return (string)=>{
        return string.startsWith(value) ? {
            value,
            length: value.length
        } : undefined;
    };
}
function createMatchTestFunction(match) {
    return (string)=>{
        const result = match.exec(string);
        if (result) return {
            value: result,
            length: result[0].length
        };
    };
}
const defaultRules = [
    {
        test: createLiteralTestFunction("yyyy"),
        fn: ()=>({
                type: "year",
                value: "numeric"
            })
    },
    {
        test: createLiteralTestFunction("yy"),
        fn: ()=>({
                type: "year",
                value: "2-digit"
            })
    },
    {
        test: createLiteralTestFunction("MM"),
        fn: ()=>({
                type: "month",
                value: "2-digit"
            })
    },
    {
        test: createLiteralTestFunction("M"),
        fn: ()=>({
                type: "month",
                value: "numeric"
            })
    },
    {
        test: createLiteralTestFunction("dd"),
        fn: ()=>({
                type: "day",
                value: "2-digit"
            })
    },
    {
        test: createLiteralTestFunction("d"),
        fn: ()=>({
                type: "day",
                value: "numeric"
            })
    },
    {
        test: createLiteralTestFunction("HH"),
        fn: ()=>({
                type: "hour",
                value: "2-digit"
            })
    },
    {
        test: createLiteralTestFunction("H"),
        fn: ()=>({
                type: "hour",
                value: "numeric"
            })
    },
    {
        test: createLiteralTestFunction("hh"),
        fn: ()=>({
                type: "hour",
                value: "2-digit",
                hour12: true
            })
    },
    {
        test: createLiteralTestFunction("h"),
        fn: ()=>({
                type: "hour",
                value: "numeric",
                hour12: true
            })
    },
    {
        test: createLiteralTestFunction("mm"),
        fn: ()=>({
                type: "minute",
                value: "2-digit"
            })
    },
    {
        test: createLiteralTestFunction("m"),
        fn: ()=>({
                type: "minute",
                value: "numeric"
            })
    },
    {
        test: createLiteralTestFunction("ss"),
        fn: ()=>({
                type: "second",
                value: "2-digit"
            })
    },
    {
        test: createLiteralTestFunction("s"),
        fn: ()=>({
                type: "second",
                value: "numeric"
            })
    },
    {
        test: createLiteralTestFunction("SSS"),
        fn: ()=>({
                type: "fractionalSecond",
                value: 3
            })
    },
    {
        test: createLiteralTestFunction("SS"),
        fn: ()=>({
                type: "fractionalSecond",
                value: 2
            })
    },
    {
        test: createLiteralTestFunction("S"),
        fn: ()=>({
                type: "fractionalSecond",
                value: 1
            })
    },
    {
        test: createLiteralTestFunction("a"),
        fn: (value)=>({
                type: "dayPeriod",
                value: value
            })
    },
    {
        test: createMatchTestFunction(/^(')(?<value>\\.|[^\']*)\1/),
        fn: (match)=>({
                type: "literal",
                value: match.groups.value
            })
    },
    {
        test: createMatchTestFunction(/^.+?\s*/),
        fn: (match)=>({
                type: "literal",
                value: match[0]
            })
    }, 
];
class DateTimeFormatter {
    #format;
    constructor(formatString, rules1 = defaultRules){
        const tokenizer = new Tokenizer(rules1);
        this.#format = tokenizer.tokenize(formatString, ({ type , value , hour12  })=>{
            const result = {
                type,
                value
            };
            if (hour12) result.hour12 = hour12;
            return result;
        });
    }
    format(date, options = {
    }) {
        let string = "";
        const utc = options.timeZone === "UTC";
        for (const token of this.#format){
            const type = token.type;
            switch(type){
                case "year":
                    {
                        const value = utc ? date.getUTCFullYear() : date.getFullYear();
                        switch(token.value){
                            case "numeric":
                                {
                                    string += value;
                                    break;
                                }
                            case "2-digit":
                                {
                                    string += digits(value, 2).slice(-2);
                                    break;
                                }
                            default:
                                throw Error(`FormatterError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "month":
                    {
                        const value = (utc ? date.getUTCMonth() : date.getMonth()) + 1;
                        switch(token.value){
                            case "numeric":
                                {
                                    string += value;
                                    break;
                                }
                            case "2-digit":
                                {
                                    string += digits(value, 2);
                                    break;
                                }
                            default:
                                throw Error(`FormatterError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "day":
                    {
                        const value = utc ? date.getUTCDate() : date.getDate();
                        switch(token.value){
                            case "numeric":
                                {
                                    string += value;
                                    break;
                                }
                            case "2-digit":
                                {
                                    string += digits(value, 2);
                                    break;
                                }
                            default:
                                throw Error(`FormatterError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "hour":
                    {
                        let value = utc ? date.getUTCHours() : date.getHours();
                        value -= token.hour12 && date.getHours() > 12 ? 12 : 0;
                        switch(token.value){
                            case "numeric":
                                {
                                    string += value;
                                    break;
                                }
                            case "2-digit":
                                {
                                    string += digits(value, 2);
                                    break;
                                }
                            default:
                                throw Error(`FormatterError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "minute":
                    {
                        const value = utc ? date.getUTCMinutes() : date.getMinutes();
                        switch(token.value){
                            case "numeric":
                                {
                                    string += value;
                                    break;
                                }
                            case "2-digit":
                                {
                                    string += digits(value, 2);
                                    break;
                                }
                            default:
                                throw Error(`FormatterError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "second":
                    {
                        const value = utc ? date.getUTCSeconds() : date.getSeconds();
                        switch(token.value){
                            case "numeric":
                                {
                                    string += value;
                                    break;
                                }
                            case "2-digit":
                                {
                                    string += digits(value, 2);
                                    break;
                                }
                            default:
                                throw Error(`FormatterError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "fractionalSecond":
                    {
                        const value = utc ? date.getUTCMilliseconds() : date.getMilliseconds();
                        string += digits(value, Number(token.value));
                        break;
                    }
                case "timeZoneName":
                    {
                    }
                case "dayPeriod":
                    {
                        string += token.value ? date.getHours() >= 12 ? "PM" : "AM" : "";
                        break;
                    }
                case "literal":
                    {
                        string += token.value;
                        break;
                    }
                default:
                    throw Error(`FormatterError: { ${token.type} ${token.value} }`);
            }
        }
        return string;
    }
    parseToParts(string) {
        const parts = [];
        for (const token of this.#format){
            const type = token.type;
            let value = "";
            switch(token.type){
                case "year":
                    {
                        switch(token.value){
                            case "numeric":
                                {
                                    value = /^\d{1,4}/.exec(string)?.[0];
                                    break;
                                }
                            case "2-digit":
                                {
                                    value = /^\d{1,2}/.exec(string)?.[0];
                                    break;
                                }
                        }
                        break;
                    }
                case "month":
                    {
                        switch(token.value){
                            case "numeric":
                                {
                                    value = /^\d{1,2}/.exec(string)?.[0];
                                    break;
                                }
                            case "2-digit":
                                {
                                    value = /^\d{2}/.exec(string)?.[0];
                                    break;
                                }
                            case "narrow":
                                {
                                    value = /^[a-zA-Z]+/.exec(string)?.[0];
                                    break;
                                }
                            case "short":
                                {
                                    value = /^[a-zA-Z]+/.exec(string)?.[0];
                                    break;
                                }
                            case "long":
                                {
                                    value = /^[a-zA-Z]+/.exec(string)?.[0];
                                    break;
                                }
                            default:
                                throw Error(`ParserError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "day":
                    {
                        switch(token.value){
                            case "numeric":
                                {
                                    value = /^\d{1,2}/.exec(string)?.[0];
                                    break;
                                }
                            case "2-digit":
                                {
                                    value = /^\d{2}/.exec(string)?.[0];
                                    break;
                                }
                            default:
                                throw Error(`ParserError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "hour":
                    {
                        switch(token.value){
                            case "numeric":
                                {
                                    value = /^\d{1,2}/.exec(string)?.[0];
                                    if (token.hour12 && parseInt(value) > 12) {
                                        console.error(`Trying to parse hour greater than 12. Use 'H' instead of 'h'.`);
                                    }
                                    break;
                                }
                            case "2-digit":
                                {
                                    value = /^\d{2}/.exec(string)?.[0];
                                    if (token.hour12 && parseInt(value) > 12) {
                                        console.error(`Trying to parse hour greater than 12. Use 'HH' instead of 'hh'.`);
                                    }
                                    break;
                                }
                            default:
                                throw Error(`ParserError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "minute":
                    {
                        switch(token.value){
                            case "numeric":
                                {
                                    value = /^\d{1,2}/.exec(string)?.[0];
                                    break;
                                }
                            case "2-digit":
                                {
                                    value = /^\d{2}/.exec(string)?.[0];
                                    break;
                                }
                            default:
                                throw Error(`ParserError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "second":
                    {
                        switch(token.value){
                            case "numeric":
                                {
                                    value = /^\d{1,2}/.exec(string)?.[0];
                                    break;
                                }
                            case "2-digit":
                                {
                                    value = /^\d{2}/.exec(string)?.[0];
                                    break;
                                }
                            default:
                                throw Error(`ParserError: value "${token.value}" is not supported`);
                        }
                        break;
                    }
                case "fractionalSecond":
                    {
                        value = new RegExp(`^\\d{${token.value}}`).exec(string)?.[0];
                        break;
                    }
                case "timeZoneName":
                    {
                        value = token.value;
                        break;
                    }
                case "dayPeriod":
                    {
                        value = /^(A|P)M/.exec(string)?.[0];
                        break;
                    }
                case "literal":
                    {
                        if (!string.startsWith(token.value)) {
                            throw Error(`Literal "${token.value}" not found "${string.slice(0, 25)}"`);
                        }
                        value = token.value;
                        break;
                    }
                default:
                    throw Error(`${token.type} ${token.value}`);
            }
            if (!value) {
                throw Error(`value not valid for token { ${type} ${value} } ${string.slice(0, 25)}`);
            }
            parts.push({
                type,
                value
            });
            string = string.slice(value.length);
        }
        if (string.length) {
            throw Error(`datetime string was not fully parsed! ${string.slice(0, 25)}`);
        }
        return parts;
    }
    partsToDate(parts) {
        const date = new Date();
        const utc = parts.find((part)=>part.type === "timeZoneName" && part.value === "UTC"
        );
        utc ? date.setUTCHours(0, 0, 0, 0) : date.setHours(0, 0, 0, 0);
        for (const part of parts){
            switch(part.type){
                case "year":
                    {
                        const value = Number(part.value.padStart(4, "20"));
                        utc ? date.setUTCFullYear(value) : date.setFullYear(value);
                        break;
                    }
                case "month":
                    {
                        const value = Number(part.value) - 1;
                        utc ? date.setUTCMonth(value) : date.setMonth(value);
                        break;
                    }
                case "day":
                    {
                        const value = Number(part.value);
                        utc ? date.setUTCDate(value) : date.setDate(value);
                        break;
                    }
                case "hour":
                    {
                        let value = Number(part.value);
                        const dayPeriod = parts.find((part1)=>part1.type === "dayPeriod"
                        );
                        if (dayPeriod?.value === "PM") value += 12;
                        utc ? date.setUTCHours(value) : date.setHours(value);
                        break;
                    }
                case "minute":
                    {
                        const value = Number(part.value);
                        utc ? date.setUTCMinutes(value) : date.setMinutes(value);
                        break;
                    }
                case "second":
                    {
                        const value = Number(part.value);
                        utc ? date.setUTCSeconds(value) : date.setSeconds(value);
                        break;
                    }
                case "fractionalSecond":
                    {
                        const value = Number(part.value);
                        utc ? date.setUTCMilliseconds(value) : date.setMilliseconds(value);
                        break;
                    }
            }
        }
        return date;
    }
    parse(string) {
        const parts = this.parseToParts(string);
        return this.partsToDate(parts);
    }
}
const MINUTE = 1000 * 60;
const HOUR = MINUTE * 60;
const DAY = HOUR * 24;
const WEEK = DAY * 7;
var Day;
(function(Day1) {
    Day1[Day1["Sun"] = 0] = "Sun";
    Day1[Day1["Mon"] = 1] = "Mon";
    Day1[Day1["Tue"] = 2] = "Tue";
    Day1[Day1["Wed"] = 3] = "Wed";
    Day1[Day1["Thu"] = 4] = "Thu";
    Day1[Day1["Fri"] = 5] = "Fri";
    Day1[Day1["Sat"] = 6] = "Sat";
})(Day || (Day = {
}));
function toIMF(date) {
    function dtPad(v, lPad = 2) {
        return v.padStart(lPad, "0");
    }
    const d = dtPad(date.getUTCDate().toString());
    const h = dtPad(date.getUTCHours().toString());
    const min = dtPad(date.getUTCMinutes().toString());
    const s = dtPad(date.getUTCSeconds().toString());
    const y = date.getUTCFullYear();
    const days = [
        "Sun",
        "Mon",
        "Tue",
        "Wed",
        "Thu",
        "Fri",
        "Sat"
    ];
    const months = [
        "Jan",
        "Feb",
        "Mar",
        "Apr",
        "May",
        "Jun",
        "Jul",
        "Aug",
        "Sep",
        "Oct",
        "Nov",
        "Dec", 
    ];
    return `${days[date.getUTCDay()]}, ${d} ${months[date.getUTCMonth()]} ${y} ${h}:${min}:${s} GMT`;
}
function calculateMonthsDifference(bigger, smaller) {
    const biggerDate = new Date(bigger);
    const smallerDate = new Date(smaller);
    const yearsDiff = biggerDate.getFullYear() - smallerDate.getFullYear();
    const monthsDiff = biggerDate.getMonth() - smallerDate.getMonth();
    const calendarDiffrences = Math.abs(yearsDiff * 12 + monthsDiff);
    const compareResult = biggerDate > smallerDate ? 1 : -1;
    biggerDate.setMonth(biggerDate.getMonth() - compareResult * calendarDiffrences);
    const isLastMonthNotFull = biggerDate > smallerDate ? 1 : -1 === -compareResult ? 1 : 0;
    const months = compareResult * (calendarDiffrences - isLastMonthNotFull);
    return months === 0 ? 0 : months;
}
function toString(cookie) {
    if (!cookie.name) {
        return "";
    }
    const out = [];
    out.push(`${cookie.name}=${cookie.value}`);
    if (cookie.name.startsWith("__Secure")) {
        cookie.secure = true;
    }
    if (cookie.name.startsWith("__Host")) {
        cookie.path = "/";
        cookie.secure = true;
        delete cookie.domain;
    }
    if (cookie.secure) {
        out.push("Secure");
    }
    if (cookie.httpOnly) {
        out.push("HttpOnly");
    }
    if (typeof cookie.maxAge === "number" && Number.isInteger(cookie.maxAge)) {
        assert1(cookie.maxAge > 0, "Max-Age must be an integer superior to 0");
        out.push(`Max-Age=${cookie.maxAge}`);
    }
    if (cookie.domain) {
        out.push(`Domain=${cookie.domain}`);
    }
    if (cookie.sameSite) {
        out.push(`SameSite=${cookie.sameSite}`);
    }
    if (cookie.path) {
        out.push(`Path=${cookie.path}`);
    }
    if (cookie.expires) {
        const dateString = toIMF(cookie.expires);
        out.push(`Expires=${dateString}`);
    }
    if (cookie.unparsed) {
        out.push(cookie.unparsed.join("; "));
    }
    return out.join("; ");
}
function getCookies(req) {
    const cookie = req.headers.get("Cookie");
    if (cookie != null) {
        const out = {
        };
        const c = cookie.split(";");
        for (const kv of c){
            const [cookieKey, ...cookieVal] = kv.split("=");
            assert1(cookieKey != null);
            const key = cookieKey.trim();
            out[key] = cookieVal.join("=");
        }
        return out;
    }
    return {
    };
}
function setCookie(res, cookie) {
    if (!res.headers) {
        res.headers = new Headers();
    }
    const v = toString(cookie);
    if (v) {
        res.headers.append("Set-Cookie", v);
    }
}
const DEFAULT_BUFFER_SIZE = 32 * 1024;
async function copyN(r, dest, size) {
    let bytesRead = 0;
    let buf = new Uint8Array(DEFAULT_BUFFER_SIZE);
    while(bytesRead < size){
        if (size - bytesRead < DEFAULT_BUFFER_SIZE) {
            buf = new Uint8Array(size - bytesRead);
        }
        const result = await r.read(buf);
        const nread = result ?? 0;
        bytesRead += nread;
        if (nread > 0) {
            let n = 0;
            while(n < nread){
                n += await dest.write(buf.slice(n, nread));
            }
            assert1(n === nread, "could not write");
        }
        if (result === null) {
            break;
        }
    }
    return bytesRead;
}
async function readShort(buf) {
    const high = await buf.readByte();
    if (high === null) return null;
    const low = await buf.readByte();
    if (low === null) throw new Deno.errors.UnexpectedEof();
    return high << 8 | low;
}
async function readInt(buf) {
    const high = await readShort(buf);
    if (high === null) return null;
    const low = await readShort(buf);
    if (low === null) throw new Deno.errors.UnexpectedEof();
    return high << 16 | low;
}
const MAX_SAFE_INTEGER = BigInt(Number.MAX_SAFE_INTEGER);
class MultiReader {
    currentIndex = 0;
    constructor(...readers){
        this.readers = readers;
    }
    async read(p) {
        const r = this.readers[this.currentIndex];
        if (!r) return null;
        const result = await r.read(p);
        if (result === null) {
            this.currentIndex++;
            return 0;
        }
        return result;
    }
}
function str(buf) {
    if (buf == null) {
        return "";
    } else {
        return decode(buf);
    }
}
function charCode(s) {
    return s.charCodeAt(0);
}
class TextProtoReader {
    constructor(r){
        this.r = r;
    }
    async readLine() {
        const s = await this.readLineSlice();
        if (s === null) return null;
        return str(s);
    }
    async readMIMEHeader() {
        const m = new Headers();
        let line;
        let buf = await this.r.peek(1);
        if (buf === null) {
            return null;
        } else if (buf[0] == charCode(" ") || buf[0] == charCode("\t")) {
            line = await this.readLineSlice();
        }
        buf = await this.r.peek(1);
        if (buf === null) {
            throw new Deno.errors.UnexpectedEof();
        } else if (buf[0] == charCode(" ") || buf[0] == charCode("\t")) {
            throw new Deno.errors.InvalidData(`malformed MIME header initial line: ${str(line)}`);
        }
        while(true){
            const kv = await this.readLineSlice();
            if (kv === null) throw new Deno.errors.UnexpectedEof();
            if (kv.byteLength === 0) return m;
            let i = kv.indexOf(charCode(":"));
            if (i < 0) {
                throw new Deno.errors.InvalidData(`malformed MIME header line: ${str(kv)}`);
            }
            const key = str(kv.subarray(0, i));
            if (key == "") {
                continue;
            }
            i++;
            while(i < kv.byteLength && (kv[i] == charCode(" ") || kv[i] == charCode("\t"))){
                i++;
            }
            const value = str(kv.subarray(i)).replace(/[^\t\x20-\x7e\x80-\xff]/g, encodeURI);
            try {
                m.append(key, value);
            } catch  {
            }
        }
    }
    async readLineSlice() {
        let line;
        while(true){
            const r1 = await this.r.readLine();
            if (r1 === null) return null;
            const { line: l , more  } = r1;
            if (!line && !more) {
                if (this.skipSpace(l) === 0) {
                    return new Uint8Array(0);
                }
                return l;
            }
            line = line ? concat(line, l) : l;
            if (!more) {
                break;
            }
        }
        return line;
    }
    skipSpace(l) {
        let n = 0;
        for(let i = 0; i < l.length; i++){
            if (l[i] === charCode(" ") || l[i] === charCode("\t")) {
                continue;
            }
            n++;
        }
        return n;
    }
}
function hasOwnProperty(obj, v) {
    if (obj == null) {
        return false;
    }
    return Object.prototype.hasOwnProperty.call(obj, v);
}
function randomBoundary() {
    let boundary = "--------------------------";
    for(let i = 0; i < 24; i++){
        boundary += Math.floor(Math.random() * 16).toString(16);
    }
    return boundary;
}
function scanUntilBoundary(buf, dashBoundary, newLineDashBoundary, total, eof) {
    if (total === 0) {
        if (hasPrefix(buf, dashBoundary)) {
            switch(matchAfterPrefix(buf, dashBoundary, eof)){
                case -1:
                    return dashBoundary.length;
                case 0:
                    return 0;
                case 1:
                    return null;
            }
        }
        if (hasPrefix(dashBoundary, buf)) {
            return 0;
        }
    }
    const i = findIndex(buf, newLineDashBoundary);
    if (i >= 0) {
        switch(matchAfterPrefix(buf.slice(i), newLineDashBoundary, eof)){
            case -1:
                return i + newLineDashBoundary.length;
            case 0:
                return i;
            case 1:
                return i > 0 ? i : null;
        }
    }
    if (hasPrefix(newLineDashBoundary, buf)) {
        return 0;
    }
    const j = findLastIndex(buf, newLineDashBoundary.slice(0, 1));
    if (j >= 0 && hasPrefix(newLineDashBoundary, buf.slice(j))) {
        return j;
    }
    return buf.length;
}
class PartReader {
    n = 0;
    total = 0;
    constructor(mr, headers){
        this.mr = mr;
        this.headers = headers;
    }
    async read(p) {
        const br = this.mr.bufReader;
        let peekLength = 1;
        while(this.n === 0){
            peekLength = Math.max(peekLength, br.buffered());
            const peekBuf = await br.peek(peekLength);
            if (peekBuf === null) {
                throw new Deno.errors.UnexpectedEof();
            }
            const eof = peekBuf.length < peekLength;
            this.n = scanUntilBoundary(peekBuf, this.mr.dashBoundary, this.mr.newLineDashBoundary, this.total, eof);
            if (this.n === 0) {
                assert1(eof === false);
                peekLength++;
            }
        }
        if (this.n === null) {
            return null;
        }
        const nread = Math.min(p.length, this.n);
        const buf = p.subarray(0, nread);
        const r1 = await br.readFull(buf);
        assert1(r1 === buf);
        this.n -= nread;
        this.total += nread;
        return nread;
    }
    close() {
    }
    getContentDispositionParams() {
        if (this.contentDispositionParams) return this.contentDispositionParams;
        const cd = this.headers.get("content-disposition");
        const params = {
        };
        assert1(cd != null, "content-disposition must be set");
        const comps = decodeURI(cd).split(";");
        this.contentDisposition = comps[0];
        comps.slice(1).map((v)=>v.trim()
        ).map((kv)=>{
            const [k, v] = kv.split("=");
            if (v) {
                const s = v.charAt(0);
                const e = v.charAt(v.length - 1);
                if (s === e && s === '\"' || s === "\'") {
                    params[k] = v.substr(1, v.length - 2);
                } else {
                    params[k] = v;
                }
            }
        });
        return this.contentDispositionParams = params;
    }
    get fileName() {
        return this.getContentDispositionParams()["filename"];
    }
    get formName() {
        const p = this.getContentDispositionParams();
        if (this.contentDisposition === "form-data") {
            return p["name"];
        }
        return "";
    }
}
function skipLWSPChar(u) {
    const ret = new Uint8Array(u.length);
    const sp = " ".charCodeAt(0);
    const ht = "\t".charCodeAt(0);
    let j = 0;
    for(let i = 0; i < u.length; i++){
        if (u[i] === sp || u[i] === ht) continue;
        ret[j++] = u[i];
    }
    return ret.slice(0, j);
}
class MultipartReader {
    newLine = encoder.encode("\r\n");
    newLineDashBoundary = encoder.encode(`\r\n--${this.boundary}`);
    dashBoundaryDash = encoder.encode(`--${this.boundary}--`);
    dashBoundary = encoder.encode(`--${this.boundary}`);
    constructor(reader, boundary){
        this.boundary = boundary;
        this.bufReader = new BufReader(reader);
    }
    async readForm(maxMemory = 10 << 20) {
        const fileMap = new Map();
        const valueMap = new Map();
        let maxValueBytes = maxMemory + (10 << 20);
        const buf = new Deno.Buffer(new Uint8Array(maxValueBytes));
        for(;;){
            const p = await this.nextPart();
            if (p === null) {
                break;
            }
            if (p.formName === "") {
                continue;
            }
            buf.reset();
            if (!p.fileName) {
                const n = await copyN(p, buf, maxValueBytes);
                maxValueBytes -= n;
                if (maxValueBytes < 0) {
                    throw new RangeError("message too large");
                }
                const value = new TextDecoder().decode(buf.bytes());
                valueMap.set(p.formName, value);
                continue;
            }
            let formFile;
            const n = await copyN(p, buf, maxValueBytes);
            const contentType1 = p.headers.get("content-type");
            assert1(contentType1 != null, "content-type must be set");
            if (n > maxMemory) {
                const ext = extname(p.fileName);
                const filepath = await Deno.makeTempFile({
                    dir: ".",
                    prefix: "multipart-",
                    suffix: ext
                });
                const file = await Deno.open(filepath, {
                    write: true
                });
                try {
                    const size = await Deno.copy(new MultiReader(buf, p), file);
                    file.close();
                    formFile = {
                        filename: p.fileName,
                        type: contentType1,
                        tempfile: filepath,
                        size
                    };
                } catch (e) {
                    await Deno.remove(filepath);
                    throw e;
                }
            } else {
                formFile = {
                    filename: p.fileName,
                    type: contentType1,
                    content: buf.bytes(),
                    size: buf.length
                };
                maxMemory -= n;
                maxValueBytes -= n;
            }
            if (formFile) {
                const mapVal = fileMap.get(p.formName);
                if (mapVal !== undefined) {
                    if (Array.isArray(mapVal)) {
                        mapVal.push(formFile);
                    } else {
                        fileMap.set(p.formName, [
                            mapVal,
                            formFile
                        ]);
                    }
                } else {
                    fileMap.set(p.formName, formFile);
                }
            }
        }
        return multipatFormData(fileMap, valueMap);
    }
    partsRead = 0;
    async nextPart() {
        if (this.currentPart) {
            this.currentPart.close();
        }
        if (equal(this.dashBoundary, encoder.encode("--"))) {
            throw new Error("boundary is empty");
        }
        let expectNewPart = false;
        for(;;){
            const line = await this.bufReader.readSlice("\n".charCodeAt(0));
            if (line === null) {
                throw new Deno.errors.UnexpectedEof();
            }
            if (this.isBoundaryDelimiterLine(line)) {
                this.partsRead++;
                const r1 = new TextProtoReader(this.bufReader);
                const headers1 = await r1.readMIMEHeader();
                if (headers1 === null) {
                    throw new Deno.errors.UnexpectedEof();
                }
                const np = new PartReader(this, headers1);
                this.currentPart = np;
                return np;
            }
            if (this.isFinalBoundary(line)) {
                return null;
            }
            if (expectNewPart) {
                throw new Error(`expecting a new Part; got line ${line}`);
            }
            if (this.partsRead === 0) {
                continue;
            }
            if (equal(line, this.newLine)) {
                expectNewPart = true;
                continue;
            }
            throw new Error(`unexpected line in nextPart(): ${line}`);
        }
    }
    isFinalBoundary(line) {
        if (!hasPrefix(line, this.dashBoundaryDash)) {
            return false;
        }
        const rest = line.slice(this.dashBoundaryDash.length, line.length);
        return rest.length === 0 || equal(skipLWSPChar(rest), this.newLine);
    }
    isBoundaryDelimiterLine(line) {
        if (!hasPrefix(line, this.dashBoundary)) {
            return false;
        }
        const rest = line.slice(this.dashBoundary.length);
        return equal(skipLWSPChar(rest), this.newLine);
    }
}
function multipatFormData(fileMap, valueMap) {
    function file(key) {
        return fileMap.get(key);
    }
    function value(key) {
        return valueMap.get(key);
    }
    function* entries() {
        yield* fileMap;
        yield* valueMap;
    }
    async function removeAll() {
        const promises = [];
        for (const val of fileMap.values()){
            if (Array.isArray(val)) {
                for (const subVal of val){
                    if (!subVal.tempfile) continue;
                    promises.push(Deno.remove(subVal.tempfile));
                }
            } else {
                if (!val.tempfile) continue;
                promises.push(Deno.remove(val.tempfile));
            }
        }
        await Promise.all(promises);
    }
    return {
        file,
        value,
        entries,
        removeAll,
        [Symbol.iterator] () {
            return entries();
        }
    };
}
class PartWriter {
    closed = false;
    headersWritten = false;
    constructor(writer, boundary1, headers1, isFirstBoundary){
        this.writer = writer;
        this.boundary = boundary1;
        this.headers = headers1;
        let buf = "";
        if (isFirstBoundary) {
            buf += `--${boundary1}\r\n`;
        } else {
            buf += `\r\n--${boundary1}\r\n`;
        }
        for (const [key1, value] of headers1.entries()){
            buf += `${key1}: ${value}\r\n`;
        }
        buf += `\r\n`;
        this.partHeader = buf;
    }
    close() {
        this.closed = true;
    }
    async write(p) {
        if (this.closed) {
            throw new Error("part is closed");
        }
        if (!this.headersWritten) {
            await this.writer.write(encoder.encode(this.partHeader));
            this.headersWritten = true;
        }
        return this.writer.write(p);
    }
}
function checkBoundary(b) {
    if (b.length < 1 || b.length > 70) {
        throw new Error(`invalid boundary length: ${b.length}`);
    }
    const end = b.length - 1;
    for(let i = 0; i < end; i++){
        const c = b.charAt(i);
        if (!c.match(/[a-zA-Z0-9'()+_,\-./:=?]/) || c === " " && i !== end) {
            throw new Error("invalid boundary character: " + c);
        }
    }
    return b;
}
const encoder = new TextEncoder();
function encode(input) {
    return encoder.encode(input);
}
const decoder = new TextDecoder();
function decode(input) {
    return decoder.decode(input);
}
const { cwd , readFile , readAll  } = Deno;
class Context {
    response = {
        headers: new Headers()
    };
    params = {
    };
    #store;
    #body;
    get cookies() {
        return getCookies(this.request);
    }
    get path() {
        return this.url.pathname;
    }
    get method() {
        return this.request.method;
    }
    get queryParams() {
        const params = {
        };
        for (const [k, v] of this.url.searchParams){
            params[k] = v;
        }
        return params;
    }
    get body() {
        return this.#body ?? (this.#body = this.#readBody());
    }
    get(key) {
        return this.#store?.get(key);
    }
    set(key, val) {
        if (this.#store === undefined) {
            this.#store = new Map();
        }
        this.#store.set(key, val);
    }
    constructor(optionsOrContext){
        if (optionsOrContext instanceof Context) {
            Object.assign(this, optionsOrContext);
            this.customContext = this;
            return;
        }
        const opts = optionsOrContext;
        this.app = optionsOrContext.app;
        this.request = optionsOrContext.r;
        this.url = new URL(this.request.url, `http://0.0.0.0`);
    }
    #writeContentType=(v)=>{
        if (!this.response.headers.has(Header.ContentType)) {
            this.response.headers.set(Header.ContentType, v);
        }
    };
    #readBody=async ()=>{
        const contentType1 = this.request.headers.get(Header.ContentType);
        walk: {
            let data = {
            };
            if (contentType1) {
                if (contentType1.includes(MIME.ApplicationJSON)) {
                    data = JSON.parse(decode(await readAll(this.request.body)));
                } else if (contentType1.includes(MIME.ApplicationForm)) {
                    for (const [k, v] of new URLSearchParams(decode(await readAll(this.request.body)))){
                        data[k] = v;
                    }
                } else if (contentType1.includes(MIME.MultipartForm)) {
                    const match = contentType1.match(/boundary=([^\s]+)/);
                    const boundary2 = match ? match[1] : undefined;
                    if (boundary2) {
                        const mr1 = new MultipartReader(this.request.body, boundary2);
                        const form = await mr1.readForm();
                        for (const [k, v] of form.entries()){
                            data[k] = v;
                        }
                    }
                } else {
                    break walk;
                }
            } else {
                break walk;
            }
            return data;
        }
        return decode(await readAll(this.request.body));
    };
    string(v, code = Status.OK) {
        this.#writeContentType(MIME.TextPlainCharsetUTF8);
        this.response.status = code;
        this.response.body = encode(v);
    }
    json(v, code = Status.OK) {
        this.#writeContentType(MIME.ApplicationJSONCharsetUTF8);
        this.response.status = code;
        this.response.body = encode(typeof v === "object" ? JSON.stringify(v) : v);
    }
    html(v, code = Status.OK) {
        this.#writeContentType(MIME.TextHTMLCharsetUTF8);
        this.response.status = code;
        this.response.body = encode(v);
    }
    htmlBlob(b, code = Status.OK) {
        this.blob(b, MIME.TextHTMLCharsetUTF8, code);
    }
    async render(name, data = {
    }, code = Status.OK) {
        if (!this.app.renderer) {
            throw new Error();
        }
        const r1 = await this.app.renderer.render(name, data);
        this.htmlBlob(r1, code);
    }
    blob(b, contentType, code = Status.OK) {
        if (contentType) {
            this.#writeContentType(contentType);
        }
        this.response.status = code;
        this.response.body = b;
    }
    async file(filepath) {
        filepath = join(cwd(), filepath);
        try {
            this.blob(await readFile(filepath), contentType1(filepath));
        } catch  {
            NotFoundHandler();
        }
    }
    setCookie(c) {
        setCookie(this.response, c);
    }
    redirect(url, code = Status.Found) {
        this.response.headers.set(Header.Location, url);
        this.response.status = code;
    }
}
class Node1 {
    children = new Map();
    path = "";
    constructor(node){
        if (node) {
            Object.assign(this, node);
        }
    }
    add(path, func) {
        let n = this;
        let i = 0;
        for(; i < path.length && !isWildcard(path[i]); ++i);
        n = n.#merge(path.slice(0, i));
        let j = i;
        for(; i < path.length; ++i){
            if (isWildcard(path[i])) {
                if (j !== i) {
                    n = n.#insert(path.slice(j, i));
                    j = i;
                }
                ++i;
                for(; i < path.length && path[i] !== "/"; ++i){
                    if (isWildcard(path[i])) {
                        throw new Error(`only one wildcard per path segment is allowed, has: "${path.slice(j, i)}" in path "${path}"`);
                    }
                }
                if (path[j] === ":" && i - j === 1) {
                    throw new Error(`param must be named with a non-empty name in path "${path}"`);
                }
                n = n.#insert(path.slice(j, i));
                j = i;
            }
        }
        if (j === path.length) {
            n.#merge("", func);
        } else {
            n.#insert(path.slice(j), func);
        }
    }
    find(path) {
        let func;
        let params = new Map();
        const stack = [
            [
                this,
                path,
                false
            ], 
        ];
        for(let i = 0; i >= 0;){
            const [n, p, v] = stack[i];
            let np;
            if (v) {
                --i;
                if (n.path[0] === ":") {
                    params.delete(n.path.slice(1));
                }
                continue;
            } else {
                stack[i][2] = true;
            }
            if (n.path[0] === "*") {
                if (n.path.length > 1) {
                    params.set(n.path.slice(1), p);
                }
                np = undefined;
            } else if (n.path[0] === ":") {
                const [_cp, _np] = splitFromFirstSlash(p);
                params.set(n.path.slice(1), _cp);
                np = _np === "" ? undefined : _np;
            } else if (n.path === p) {
                if (n.func === undefined) {
                    if (n.children.has("*")) {
                        np = "";
                    } else {
                        --i;
                        continue;
                    }
                } else {
                    np = undefined;
                }
            } else {
                const lcp = longestCommonPrefix(n.path, p);
                if (lcp !== n.path.length) {
                    --i;
                    continue;
                } else {
                    np = p.slice(lcp);
                }
            }
            if (np === undefined) {
                func = n.func;
                break;
            }
            let c = n.children.get("*");
            if (c) {
                stack[++i] = [
                    c,
                    np,
                    false
                ];
            }
            if (np === "") {
                continue;
            }
            c = n.children.get(":");
            if (c) {
                stack[++i] = [
                    c,
                    np,
                    false
                ];
            }
            c = n.children.get(np[0]);
            if (c) {
                stack[++i] = [
                    c,
                    np,
                    false
                ];
            }
        }
        return [
            func,
            params
        ];
    }
    #merge=(path2, func)=>{
        let n = this;
        if (n.path === "" && n.children.size === 0) {
            n.path = path2;
            n.func = func;
            return n;
        }
        if (path2 === "") {
            if (n.func) {
                throw new Error(`a function is already registered for path "${n.path}"`);
            }
            n.func = func;
            return n;
        }
        for(;;){
            const i = longestCommonPrefix(path2, n.path);
            if (i < n.path.length) {
                const c = new Node1({
                    path: n.path.slice(i),
                    children: n.children,
                    func: n.func
                });
                n.children = new Map([
                    [
                        c.path[0],
                        c
                    ]
                ]);
                n.path = path2.slice(0, i);
                n.func = undefined;
            }
            if (i < path2.length) {
                path2 = path2.slice(i);
                let c = n.children.get(path2[0]);
                if (c) {
                    n = c;
                    continue;
                }
                c = new Node1({
                    path: path2,
                    func
                });
                n.children.set(path2[0], c);
                n = c;
            } else if (func) {
                if (n.func) {
                    throw new Error(`a function is already registered for path "${path2}"`);
                }
                n.func = func;
            }
            break;
        }
        return n;
    };
    #insert=(path2, func)=>{
        let n = this;
        let c = n.children.get(path2[0]);
        if (c) {
            n = c.#merge(path2, func);
        } else {
            c = new Node1({
                path: path2,
                func
            });
            n.children.set(path2[0], c);
            n = c;
        }
        return n;
    };
}
function longestCommonPrefix(a, b) {
    let i = 0;
    let len = Math.min(a.length, b.length);
    for(; i < len && a[i] === b[i]; ++i);
    return i;
}
function splitFromFirstSlash(path2) {
    let i = 0;
    for(; i < path2.length && path2[i] !== "/"; ++i);
    return [
        path2.slice(0, i),
        path2.slice(i)
    ];
}
function isWildcard(c) {
    assert2(c.length === 1);
    return c === ":" || c === "*";
}
function assert2(expr, msg = "") {
    if (!expr) {
        throw new AssertionError(msg);
    }
}
class AssertionError extends Error {
    constructor(message){
        super(message);
        this.name = "AssertionError";
    }
}
class Router {
    trees = {
    };
    add(method, path, h) {
        if (path[0] !== "/") {
            path = `/${path}`;
        }
        if (hasTrailingSlash(path)) {
            path = path.slice(0, path.length - 1);
        }
        let root = this.trees[method];
        if (!root) {
            root = new Node1();
            this.trees[method] = root;
        }
        root.add(path, h);
    }
    find(method, c) {
        const node1 = this.trees[method];
        let path2 = c.path;
        if (hasTrailingSlash(path2)) {
            path2 = path2.slice(0, path2.length - 1);
        }
        let h;
        if (node1) {
            const [handle, params] = node1.find(path2);
            if (params) {
                for (const [k, v] of params){
                    c.params[k] = v;
                }
            }
            if (handle) {
                h = handle;
            }
        }
        return h ?? NotFoundHandler;
    }
}
class Group {
    constructor(opts1){
        this.prefix = opts1.prefix || "";
        this.app = opts1.app || {
        };
        this.middleware = [];
    }
    use(...m) {
        this.middleware.push(...m);
        if (this.middleware.length !== 0) {
            this.any("", NotFoundHandler);
        }
        return this;
    }
    connect(path, h, ...m) {
        return this.add("CONNECT", path, h, ...m);
    }
    delete(path, h, ...m) {
        return this.add("DELETE", path, h, ...m);
    }
    get(path, h, ...m) {
        return this.add("GET", path, h, ...m);
    }
    head(path, h, ...m) {
        return this.add("HEAD", path, h, ...m);
    }
    options(path, h, ...m) {
        return this.add("OPTIONS", path, h, ...m);
    }
    patch(path, h, ...m) {
        return this.add("PATCH", path, h, ...m);
    }
    post(path, h, ...m) {
        return this.add("POST", path, h, ...m);
    }
    put(path, h, ...m) {
        return this.add("PUT", path, h, ...m);
    }
    trace(path, h, ...m) {
        return this.add("TRACE", path, h, ...m);
    }
    any(path, h, ...m) {
        const methods = [
            "CONNECT",
            "DELETE",
            "GET",
            "HEAD",
            "OPTIONS",
            "PATCH",
            "POST",
            "PUT",
            "TRACE", 
        ];
        for (const method of methods){
            this.add(method, path, h, ...m);
        }
        return this;
    }
    match(methods, path, h, ...m) {
        for (const method of methods){
            this.add(method, path, h, ...m);
        }
        return this;
    }
    add(method, path, handler, ...middleware) {
        this.app.add(method, this.prefix + path, handler, ...this.middleware, ...middleware);
        return this;
    }
    static(prefix, root) {
        this.app.static(join(this.prefix, prefix), root);
        return this;
    }
    file(p, filepath, ...m) {
        this.app.file(join(this.prefix, p), filepath, ...m);
        return this;
    }
    group(prefix, ...m) {
        const g = this.app.group(this.prefix + prefix, ...this.middleware, ...m);
        return g;
    }
}
function createHttpExceptionBody(msgOrBody, error, statusCode) {
    if (typeof msgOrBody === "object" && !Array.isArray(msgOrBody)) {
        return msgOrBody;
    } else if (typeof msgOrBody === "string") {
        return {
            statusCode,
            error,
            message: msgOrBody
        };
    }
    return {
        statusCode,
        error
    };
}
class HttpException extends Error {
    constructor(response, status){
        super();
        this.response = response;
        this.status = status;
        this.message = response;
    }
}
class InternalServerErrorException extends HttpException {
    constructor(message1, error = "Internal Server Error"){
        super(createHttpExceptionBody(message1, error, Status.InternalServerError), Status.InternalServerError);
    }
}
class Application {
    router = new Router();
    middleware = [];
    premiddleware = [];
    #process;
    get θprocess() {
        console.warn(yellow("`Application#\u{3b8}process` is UNSTABLE!"));
        return this.#process;
    }
    #start=async (s)=>{
        this.server = s;
        for await (const req of this.server){
            const c = new Context({
                r: req,
                app: this
            });
            let h;
            if (this.premiddleware.length === 0) {
                h = this.router.find(req.method, c);
                h = this.#applyMiddleware(h, ...this.middleware);
            } else {
                h = (c1)=>{
                    h = this.router.find(req.method, c1);
                    h = this.#applyMiddleware(h, ...this.middleware);
                    return h(c1);
                };
                h = this.#applyMiddleware(h, ...this.premiddleware);
            }
            this.#transformResult(c, h).then(()=>{
                req.respond(c.response).catch(()=>{
                });
            });
        }
    };
    #applyMiddleware=(h, ...m)=>{
        for(let i = m.length - 1; i >= 0; --i){
            h = m[i](h);
        }
        return h;
    };
    start(sc) {
        this.#process = this.#start(serve(sc));
    }
    startTLS(sc) {
        this.#process = this.#start(serveTLS(sc));
    }
    async close() {
        if (this.server) {
            this.server.close();
        }
        await this.#process;
    }
    pre(...m) {
        this.premiddleware.push(...m);
        return this;
    }
    use(...m) {
        this.middleware.push(...m);
        return this;
    }
    connect(path, h, ...m) {
        return this.add("CONNECT", path, h, ...m);
    }
    delete(path, h, ...m) {
        return this.add("DELETE", path, h, ...m);
    }
    get(path, h, ...m) {
        return this.add("GET", path, h, ...m);
    }
    head(path, h, ...m) {
        return this.add("HEAD", path, h, ...m);
    }
    options(path, h, ...m) {
        return this.add("OPTIONS", path, h, ...m);
    }
    patch(path, h, ...m) {
        return this.add("PATCH", path, h, ...m);
    }
    post(path, h, ...m) {
        return this.add("POST", path, h, ...m);
    }
    put(path, h, ...m) {
        return this.add("PUT", path, h, ...m);
    }
    trace(path, h, ...m) {
        return this.add("TRACE", path, h, ...m);
    }
    any(path, h, ...m) {
        const methods = [
            "CONNECT",
            "DELETE",
            "GET",
            "HEAD",
            "OPTIONS",
            "PATCH",
            "POST",
            "PUT",
            "TRACE", 
        ];
        for (const method of methods){
            this.add(method, path, h, ...m);
        }
        return this;
    }
    match(methods, path, h, ...m) {
        for (const method of methods){
            this.add(method, path, h, ...m);
        }
        return this;
    }
    add(method, path, handler, ...middleware) {
        this.router.add(method, path, (c)=>{
            let h = handler;
            for (const m of middleware){
                h = m(h);
            }
            return h(c);
        });
        return this;
    }
    group(prefix, ...m) {
        const g = new Group({
            app: this,
            prefix
        });
        g.use(...m);
        return g;
    }
    static(prefix, root, ...m) {
        if (prefix[prefix.length - 1] === "/") {
            prefix = prefix.slice(0, prefix.length - 1);
        }
        const h = (c)=>{
            const filepath = c.path.substr(prefix.length);
            return c.file(join(root, filepath));
        };
        return this.get(`${prefix}/*`, h, ...m);
    }
    file(path, filepath, ...m) {
        return this.get(path, (c)=>c.file(filepath)
        , ...m);
    }
    #transformResult=async (c, h)=>{
        let result;
        try {
            result = await h(c);
        } catch (e) {
            if (e instanceof HttpException) {
                result = c.json(typeof e.response === "object" ? e.response : createHttpExceptionBody(e.response, undefined, e.status), e.status);
            } else {
                console.log(e);
                e = new InternalServerErrorException(e.message);
                result = c.json(e.response, e.status);
            }
        }
        if (c.response.status == undefined) {
            switch(typeof result){
                case "object":
                    if (result instanceof Uint8Array) {
                        c.blob(result);
                    } else {
                        c.json(result);
                    }
                    break;
                case "string":
                    /^\s*</.test(result) ? c.html(result) : c.string(result);
                    break;
                default:
                    c.string(String(result));
            }
        }
    };
}
const app = new Application();
app.static('/', './public');
app.get("/", async (ctx)=>{
    await ctx.file("/public/index.html");
});
app.start({
    port: 3000
});
