"use strict";

const Socket = require("net").Socket;
const tls = require("tls");
const parseListUnix = require("./parseListUnix");

/**
 * Minimal requirements for an FTP client.
 */
class Client {  
    
    constructor(timeoutMillis = 0) {
        // A timeout can be applied to the control connection.
        this._timeoutMillis = timeoutMillis;
        // The current task to be resolved or rejected.
        this._task = undefined;
        // A function that handles incoming messages and resolves or rejects a task.
        this._handler = undefined;
        // Options for TLS connections.
        this.tlsOptions = {};
        // The client can log every outgoing and incoming message.
        this.verbose = false;
        // The control connection to the FTP server.
        this.socket = new Socket();
        // The data connection to the FTP server.
        this.dataSocket = undefined;
    }

    /**
     * Closes control and data socket.
     */
    close() {
        this.log("Closing sockets.");
        this._closeSocket(this._socket);
        this._closeSocket(this._dataSocket);
    }

    get socket() {
        return this._socket;
    }

    set socket(socket) {
        this._socket = this._setupSocket(socket, this._socket);
        if (this._socket) {
            this._socket.setKeepAlive(true);
            this._socket.on("data", data => {
                const message = data.toString().trim();
                const code = parseInt(message.substr(0, 3), 10);
                this.log(`< ${message}`);
                this._respond({ code, message });
            });
        }
    }

    get dataSocket() {
        return this._dataSocket;
    }

    set dataSocket(socket) {
        this._dataSocket = this._setupSocket(socket, this._dataSocket);
    }

    /**
     * Returns true if TLS is enabled for the control socket.
     */
    get hasTLS() {
        return this._socket && this._socket.getSession !== undefined;
    }

    /**
     * Send an FTP command.
     */
    send(command) {
        const hasPass = command.indexOf("PASS") !== -1;
        const message = hasPass ? "> PASS ###" : `> ${command}`;
        this.log(message);
        this._socket.write(command + "\r\n");
    }

    /**
     * Send an FTP command and handle any response until the newly task is resolved. 
     */
    handle(command, handler) {
        return new Promise((resolvePromise, rejectPromise) => {
            this._handler = handler;
            this._task = {
                // When resolving or rejecting we also don't want the handler
                // to be no longer responsible for any responses or errors.
                resolve: (...args) => {
                    this._handler = undefined;
                    resolvePromise(...args);
                },
                reject: (...args) => {
                    this._handler = undefined;
                    rejectPromise(...args);
                }
            };
            if (command !== undefined) {
                this.send(command);
            }
        });
    }

    log(message) {
        if (this.verbose) {
            console.log(message);
        }
    }

    _respond(payload) {
        if (this._handler) {
            this._handler(payload, this._task);
        }        
    }

    _setupSocket(newSocket, oldSocket) {
        if (oldSocket) {
            oldSocket.removeAllListeners();
        }
        if (newSocket) {
            // All sockets share the same timeout.
            newSocket.setTimeout(this._timeoutMillis);
            // Reroute any events to the single communication channel with the currently responsible handler.
            newSocket.on("error", error => this._respond({ error }));
            newSocket.on("timeout", () => this._respond({ error: "Timeout" }));
        }
        return newSocket;
    }

    _closeSocket(socket) {
        if (socket) {
            socket.destroy();
        }
    }
}

// Public API
module.exports = {
    Client,
    // Basic API
    connect,
    send,
    useTLS,
    enterPassiveMode,
    list,
    download,
    upload,
    // Convenience
    login,
    useDefaultSettings,
    // Useful for custom extensions
    parseIPV4PasvResponse,
    upgradeSocket
};

/**
 * Connect to an FTP server.
 * 
 * @param {Client} client
 * @param {string} host
 * @param {number} port
 * @return {Promise<void>}
 */
function connect(client, host, port) {
    client.socket.connect(port, host);
    return client.handle(undefined, (res, task) => {
        if (res.code === 220) {
            task.resolve();
        }
        else {
            task.reject(res);
        }
    });
}

/**
 * Send an FTP command.
 * 
 * @param {Client} client
 * @param {string} command
 * @param {boolean} ignoreError
 * @return {Promise<number>}
 */
function send(client, command, ignoreErrorCodes = false) {
    return client.handle(command, (res, task) => {
        const success = res.code >= 200 && res.code < 400;
        if (success || (res.code && ignoreErrorCodes)) {
            task.resolve(res.code);
        }
        else {
            task.reject(res);
        }
    });
}

/**
 * Upgrade the current socket connection to TLS.
 * 
 * @param {Client} client
 * @param {Object} options
 * @return {Promise<void>}
 */
function useTLS(client, options) {
    return client.handle("AUTH TLS", (res, task) => {
        if (res.code === 200 || res.code === 234) {
            upgradeSocket(client.socket, options).then(tlsSocket => {
                client.log("Control socket is using " + tlsSocket.getProtocol());
                client.socket = tlsSocket; // TLS socket is the control socket from now on
                client.tlsOptions = options; // Keep the TLS options for later data connections that should use the same options.
                task.resolve();
            }).catch(err => task.reject(err));
        }
        else {
            task.reject(res);
        }  
    });
}

/**
 * Upgrade a socket connection.
 * 
 * @param {Socket} socket 
 * @param {Object} options The options for tls.connect(options)
 */
function upgradeSocket(socket, options) {
    return new Promise((resolve, reject) => {
        options = Object.assign({}, options, { 
            socket // Establish the secure connection using the existing socket connection.
        }); 
        const tlsSocket = tls.connect(options, () => {
            const expectCertificate = options.rejectUnauthorized !== false;
            if (expectCertificate && !tlsSocket.authorized) {
                reject(tlsSocket.authorizationError);
            }
            else {
                resolve(tlsSocket);
            }
        });                
    });
}

/**
 * Prepare a data socket using passive mode.
 * 
 * @param {Client} client
 * @return {Promise<void>}
 */
function enterPassiveMode(client, parsePasvResponse = parseIPV4PasvResponse) {
    return client.handle("PASV", (res, task) => {
        if (res.code === 227) {
            const target = parsePasvResponse(res.message);
            if (!target) {
                task.reject("Can't parse PASV response", res.message);
                return;
            }
            let socket = new Socket();
            socket.once("error", err => {
                task.reject("Can't open data connection in passive mode: " + err.message);
            });
            socket.connect(target.port, target.host, () => {
                if (client.hasTLS) {
                    // Upgrade to TLS, reuse TLS session of control socket.
                    const options = Object.assign({}, client.tlsOptions, { 
                        socket, 
                        session: client.socket.getSession()
                    });
                    socket = tls.connect(options);
                    client.log("Data socket uses " + socket.getProtocol());
                }
                socket.removeAllListeners();
                client.dataSocket = socket;
                task.resolve();    
            });
        }
        else {
            task.reject(res);
        }
    });   
}

const regexPasv = /([-\d]+,[-\d]+,[-\d]+,[-\d]+),([-\d]+),([-\d]+)/;

/**
 * Parse a PASV response message.
 * 
 * @param {string} message
 * @returns {{host: string, port: number}}
 */
function parseIPV4PasvResponse(message) {
    // From something like "227 Entering Passive Mode (192,168,3,200,10,229)",
    // extract host and port.
    const groups = message.match(regexPasv);
    if (!groups || groups.length !== 4) {
        return undefined;
    }
    return {
        host: groups[1].replace(/,/g, "."),
        port: (parseInt(groups[2], 10) & 255) * 256 + (parseInt(groups[3], 10) & 255)
    };
}

/**
 * @typedef {Object} ListEntry
 * @property {boolean} isDirectory
 * @property {string} name
 */

/**
 * List files and folders of current directory. Returns promise of `{isDirectory: boolean, name: string}[]`
 * 
 * @param {Client} client
 * @param {(rawList: string) => ListEntry[]} parseList
 * @return {FileInfo[]>}
 */
function list(client, parseList = parseListUnix) {
    let list = "";
    return client.handle("LIST", (res, task) => {
        if (res.code === 150) { // Ready to download
            client.dataSocket.on("data", data => {
                list += data.toString();
            });
            client.dataSocket.once("end", () => {
                client.log(list);
                task.resolve(parseList(list));
            });
        }
        // 226 Transfer complete might be incoming, let the closed data socket mark the end of transfer.
        else if (res.code > 400 || res.error) {
            task.reject(res);
        }
    }); 
}

/**
 * Upload stream data as a file. For example:
 * 
 * `upload(client, fs.createReadStream(localFilePath), remoteFilename)`
 * 
 * @param {Client} client 
 * @param {stream.Readable} readableStream 
 * @param {string} remoteFilename 
 * @returns {Promise<void>}
 */
function upload(client, readableStream, remoteFilename) {
    const command = "STOR " + remoteFilename;
    return client.handle(command, (res, task) => {
        if (res.code === 150) { // Ready to upload
            readableStream.pipe(client.dataSocket);
        }
        else if (res.code === 226) { // Transfer complete
            task.resolve();
        }
        else if (res.code > 400 || res.error) {
            task.reject(res);
        }
    });
}

/**
 * Download a remote file as a stream. For example:
 * 
 * `download(client, fs.createWriteStream(localFilePath), remoteFilename)`
 * 
 * @param {Client} client 
 * @param {stream.Writable} writableStream 
 * @param {string} remoteFilename 
 * @param {number} startAt 
 * @returns {Promise<void>}
 */
function download(client, writableStream, remoteFilename, startAt = 0) {
    const command = startAt > 0 ? `REST ${startAt}` : `RETR ${remoteFilename}`;
    return client.handle(command, (res, task) => {
        if (res.code === 150) { // Ready to download
            client.dataSocket.pipe(writableStream);
        }
        else if (res.code === 350) { // Restarting at startAt.
            client.send("RETR " + remoteFilename);
        }
        else if (res.code === 226) { // Transfer complete
            task.resolve();
        }
        else if (res.code > 400 || res.error) {
            task.reject(res);
        }
    });
}

/**
 * Login
 * 
 * @param {Client} client 
 * @param {string} user 
 * @param {string} password 
 */
async function login(client, user, password) {
    await send(client, "USER " + user);
    await send(client, "PASS " + password);
}

/**
 * Set some default settings.
 * 
 * @param {Client} client 
 */
async function useDefaultSettings(client) {
    await send(client, "TYPE I"); // Binary mode
    await send(client, "STRU F"); // Use file structure
    if (client.hasTLS) {
        await send(client, "PBSZ 0", true); // Set to 0 for TLS
        await send(client, "PROT P", true); // Protect channel (also for data connections)
    }
}