/// <reference types="node" />
import { Readable, Writable } from "stream";
import { ConnectionOptions } from "tls";
import { FileInfo } from "./FileInfo";
import { FTPContext, FTPResponse } from "./FtpContext";
import { ProgressHandler, ProgressTracker } from "./ProgressTracker";
export interface AccessOptions {
    /** Host the client should connect to. Optional, default is "localhost". */
    readonly host?: string;
    /** Port the client should connect to. Optional, default is 21. */
    readonly port?: number;
    /** Username to use for login. Optional, default is "anonymous". */
    readonly user?: string;
    /** Password to use for login. Optional, default is "guest". */
    readonly password?: string;
    /** Use explicit FTPS over TLS. Optional, default is false. */
    readonly secure?: boolean;
    /** TLS options as in `tls.connect(options)`, optional. */
    readonly secureOptions?: ConnectionOptions;
}
export declare type TransferStrategy = (client: Client) => Promise<FTPResponse>;
export declare type RawListParser = (rawList: string) => FileInfo[];
/**
 * Client offers an API to interact with an FTP server.
 */
export declare class Client {
    /** FTP context handling low-level tasks. */
    readonly ftp: FTPContext;
    /** Function that prepares a data connection for transfer. */
    prepareTransfer: TransferStrategy;
    /** Function that parses raw directoy listing data. */
    parseList: RawListParser;
    /** Tracks progress of data transfers. */
    protected progressTracker: ProgressTracker;
    /**
     * Instantiate an FTP client.
     *
     * @param timeout  Timeout in milliseconds, use 0 for no timeout. Optional, default is 30 seconds.
     */
    constructor(timeout?: number);
    /**
     * Close the client and all open socket connections.
     *
     * Close the client and all open socket connections. The client can’t be used anymore after calling this method,
     * you have to either reconnect with `access` or `connect` or instantiate a new instance to continue any work.
     * A client is also closed automatically if any timeout or connection error occurs.
     */
    close(): void;
    /**
     * Returns true if the client is closed and can't be used anymore.
     */
    readonly closed: boolean;
    /**
     * Connect (or reconnect) to an FTP server.
     *
     * This is an instance method and thus can be called multiple times during the lifecycle of a `Client`
     * instance. Whenever you do, the client is reset with a new control connection. This also implies that
     * you can reopen a `Client` instance that has been closed due to an error when reconnecting with this
     * method. In fact, reconnecting is the only way to continue using a closed `Client`.
     *
     * @param host  Host the client should connect to. Optional, default is "localhost".
     * @param port  Port the client should connect to. Optional, default is 21.
     */
    connect(host?: string, port?: number): Promise<FTPResponse>;
    /**
     * Send an FTP command.
     *
     * If successful it will return a response object that contains the return code as well
     * as the whole message. Ignore FTP error codes if you don't want an exception to be thrown
     * if an FTP command didn't succeed.
     *
     * @param command  FTP command to send.
     * @param ignoreErrorCodes  Whether to ignore FTP error codes in result. Optional, default is false.
     */
    send(command: string, ignoreErrorCodes?: boolean): Promise<FTPResponse>;
    /**
     * Upgrade the current socket connection to TLS.
     *
     * @param options  TLS options as in `tls.connect(options)`, optional.
     * @param command  Set the authentication command. Optional, default is "AUTH TLS".
     */
    useTLS(options?: ConnectionOptions, command?: string): Promise<FTPResponse>;
    /**
     * Login a user with a password.
     *
     * @param user  Username to use for login. Optional, default is "anonymous".
     * @param password  Password to use for login. Optional, default is "guest".
     */
    login(user?: string, password?: string): Promise<FTPResponse>;
    /**
     * Set the usual default settings.
     *
     * Settings used:
     * * Binary mode (TYPE I)
     * * File structure (STRU F)
     * * Additional settings for FTPS (PBSZ 0, PROT P)
     */
    useDefaultSettings(): Promise<void>;
    /**
     * Convenience method that calls `connect`, `useTLS`, `login` and `useDefaultSettings`.
     *
     * This is an instance method and thus can be called multiple times during the lifecycle of a `Client`
     * instance. Whenever you do, the client is reset with a new control connection. This also implies that
     * you can reopen a `Client` instance that has been closed due to an error when reconnecting with this
     * method. In fact, reconnecting is the only way to continue using a closed `Client`.
     */
    access(options?: AccessOptions): Promise<FTPResponse>;
    /**
     * Get the current working directory.
     */
    pwd(): Promise<string>;
    /**
     * Get a description of supported features.
     *
     * This sends the FEAT command and parses the result into a Map where keys correspond to available commands
     * and values hold further information. Be aware that your FTP servers might not support this
     * command in which case this method will not throw an exception but just return an empty Map.
     */
    features(): Promise<Map<string, string>>;
    /**
     * Set the working directory.
     */
    cd(path: string): Promise<FTPResponse>;
    /**
     * Switch to the parent directory of the working directory.
     */
    cdup(): Promise<FTPResponse>;
    /**
     * Get the last modified time of a file. This is not supported by every FTP server, in which case
     * calling this method will throw an exception.
     */
    lastMod(path: string): Promise<Date>;
    /**
     * Get the size of a file.
     */
    size(path: string): Promise<number>;
    /**
     * Rename a file.
     *
     * Depending on the FTP server this might also be used to move a file from one
     * directory to another by providing full paths.
     */
    rename(srcPath: string, destPath: string): Promise<FTPResponse>;
    /**
     * Remove a file from the current working directory.
     *
     * You can ignore FTP error return codes which won't throw an exception if e.g.
     * the file doesn't exist.
     */
    remove(path: string, ignoreErrorCodes?: boolean): Promise<FTPResponse>;
    /**
     * Report transfer progress for any upload or download to a given handler.
     *
     * This will also reset the overall transfer counter that can be used for multiple transfers. You can
     * also pass `undefined` as a handler to stop reporting to an earlier one.
     *
     * @param handler  Handler function to call on transfer progress.
     */
    trackProgress(handler: ProgressHandler): void;
    /**
     * Upload data from a readable stream and store it as a file with a given filename in the current working directory.
     *
     * @param source  The stream to read from.
     * @param remotePath  The path of the remote file to write to.
     */
    upload(source: Readable, remotePath: string): Promise<FTPResponse>;
    /**
     * Download a file with a given filename from the current working directory
     * and pipe its data to a writable stream. You may optionally start at a specific
     * offset, for example to resume a cancelled transfer.
     *
     * @param destination  The stream to write to.
     * @param remotePath  The name of the remote file to read from.
     * @param startAt  The offset to start at.
     */
    download(destination: Writable, remotePath: string, startAt?: number): Promise<FTPResponse>;
    /**
     * List files and directories in the current working directory.
     *
     * @param path The name of the remote file or directory. If undefined, will use current directory
     */
    list(path?: string): Promise<FileInfo[]>;
    /**
     * Remove a directory and all of its content.
     *
     * After successfull completion the current working directory will be the parent
     * of the removed directory if possible.
     *
     * @param remoteDirPath  The path of the remote directory to delete.
     * @example client.removeDir("foo") // Remove directory 'foo' using a relative path.
     * @example client.removeDir("foo/bar") // Remove directory 'bar' using a relative path.
     * @example client.removeDir("/foo/bar") // Remove directory 'bar' using an absolute path.
     * @example client.removeDir("/") // Remove everything.
     */
    removeDir(remoteDirPath: string): Promise<void>;
    /**
     * Remove all files and directories in the working directory without removing
     * the working directory itself.
     */
    clearWorkingDir(): Promise<void>;
    /**
     * Upload the contents of a local directory to the working directory.
     *
     * You can optionally provide a `remoteDirName` to put the contents inside a directory which
     * will be created if necessary. This will overwrite existing files with the same names and
     * reuse existing directories. Unrelated files and directories will remain untouched.
     *
     * @param localDirPath  A local path, e.g. "foo/bar" or "../test"
     * @param remoteDirName  The name of the remote directory. If undefined, directory contents will be uploaded to the working directory.
     */
    uploadDir(localDirPath: string, remoteDirName?: string): Promise<void>;
    /**
     * Download all files and directories of the working directory to a local directory.
     *
     * @param localDirPath  The local directory to download to.
     */
    downloadDir(localDirPath: string): Promise<void>;
    /**
     * Make sure a given remote path exists, creating all directories as necessary.
     * This function also changes the current working directory to the given path.
     */
    ensureDir(remoteDirPath: string): Promise<void>;
    /**
     * Remove an empty directory, will fail if not empty.
     */
    protected removeEmptyDir(path: string): Promise<FTPResponse>;
    /**
     * FTP servers can't handle filenames that have leading whitespace. This method transforms
     * a given path to fix that issue for most cases.
     */
    protected protectWhitespace(path: string): Promise<string>;
}
