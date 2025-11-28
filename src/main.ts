import { createHash } from "crypto";
import { readdirSync, readFileSync, statSync } from "fs";
import { inflateSync } from "zlib";

/**
 * ファイルパスをkeyにした、SHA-1ハッシュの辞書型
 */
type FileMap = Map<string, string>;

/**
 * SHA-1ハッシュを比較して得る、ファイルの状態の辞書型
 */
type Status = "new file" | "modified" | "deleted";
type StatusMap = Map<string, Status>;

/**
 * 文字列処理を多用するため、型チェックを定義
 */
const typecheck = (str: string | undefined): string => {
    if (typeof str === "undefined") {
        throw new Error(`Get undefined str: ${str}`)
    }
    return str
}

/**
 * HEADのcommit IDを取得する
 */
const getHEAD = (): string => {
    // .git/HEADからrefsを取得
    // detached HEADを考慮しない
    const headContent = readFileSync(".git/HEAD", "utf8").trim();
    const ref = headContent.replace("ref: ", "");
    const branchName = ref.slice("refs/heads/".length);
    console.log(`On branch ${branchName}`);

    // .git/refs/heads下から、HEADのブランチが指すcommit IDを取得
    const headCommitId = readFileSync(`.git/refs/heads/${branchName}`, "utf8").trim();
    return headCommitId;
};

/**
 * SHA-1ハッシュから.git/objects下のファイルを取得する  
 * zlib圧縮を展開する  
 * バイナリデータで返却する
 */
const getGitObject = (objectId: string | undefined): Buffer<ArrayBuffer> => {
    const objectDir = typecheck(objectId).slice(0, 2);
    const objectPath = typecheck(objectId).slice(2);
    const GitObject = readFileSync(`.git/objects/${objectDir}/${objectPath}`);

    // zlib展開
    const content = inflateSync(Uint8Array.from(GitObject));
    return content;
};

/**
 * commitObjectに対応するtreeObjectから、FileMapを作る
 */
const getFileMapHEAD = (commitId: string): FileMap => {
    const commitObject = getGitObject(commitId).toString("utf8");

    // treeのIDを取得し、対応するオブジェクトを取得
    const treeId = commitObject.split("\n")[0]?.split("tree ")[1];
    const treeObject = getGitObject(treeId);

    const fileMap: FileMap = new Map();
    let offset = 0;

    // 最初のNullバイトは、ヘッダーとコンテンツの境界
    const headerNull = treeObject.indexOf(0, offset);
    offset = headerNull + 1;

    while (offset < treeObject.length) {
        // 以降のNullバイトは、ファイルのメタデータとオブジェクトIDの境界
        const boundaryNull = treeObject.indexOf(0, offset);
        const meta = treeObject.toString("utf8", offset, boundaryNull);
        // サブディレクトリを考慮せず、すべてのmodeが100644と仮定
        const filePath = meta.slice("100644 ".length);

        const blobId = treeObject.toString("hex", boundaryNull + 1, boundaryNull + 21);
        fileMap.set(typecheck(filePath), blobId);

        offset = boundaryNull + 21;
    }
    return fileMap;
};

/**
 * IndexからFileMapを作る
 */
const getFileMapIndex = (): FileMap => {
    const gitIndex = readFileSync(".git/index");
    const numberofEntries = gitIndex.readUint32BE(8);
    const indexEntries = gitIndex.subarray(12);
    const fileMap: FileMap = new Map()

    let offset = 0;
    for (let i = 0; i < numberofEntries; i++) {
        // ファイルのメタデータは固定長 (Git Index Version 2に限定)
        const blobIndex = offset + 40;
        const filePathIndex = offset + 62;

        // ファイルパスの直後にpaddingでNullバイトが入る
        const filePathEndIndex = indexEntries.indexOf(0, filePathIndex)

        const filePath = indexEntries.toString("utf8", filePathIndex, filePathEndIndex);
        const blobId = indexEntries.toString("hex", blobIndex, blobIndex + 20);
        fileMap.set(filePath, blobId);

        // paddingによってエントリー全体の長さは8の倍数
        const entryLength = 62 + filePath.length;
        const padding = 8 - (entryLength % 8);
        offset += entryLength + padding;

    }
    return fileMap;
};

/**
 * working dirからFileMapを作る
 */
const getFileMapWorkingDir = (): FileMap => {
    const fileMap: FileMap = new Map()
    const files = readdirSync(".").filter(f => f !== ".git");
    for (const file of files) {
        if (!statSync(file).isFile()) {
            throw new Error(`Get sub-directory: ${file}, use this script for repository without sub-directory`)
        }
        const fileData = readFileSync(file);
        const blobHeader = Buffer.from(`blob ${fileData.toString("utf8").length}\0`, "utf8");
        const sha1 = createHash("sha1").update(Buffer.concat([blobHeader, fileData])).digest("hex");
        fileMap.set(file, sha1);
    }
    return fileMap;
};

const getGitStatus = (): string => {
    const commitId = getHEAD();
    const fileMapHEAD = getFileMapHEAD(commitId);
    const fileMapIndex = getFileMapIndex();
    const fileMapWorkingDir = getFileMapWorkingDir();

    const allFiles = new Set([
        ...fileMapHEAD.keys(),
        ...fileMapIndex.keys(),
        ...fileMapWorkingDir.keys(),
    ]);

    const toBeCommited: StatusMap = new Map()
    const notStaged: StatusMap = new Map()
    const untracked = []

    for (const file of allFiles) {
        const headHash = fileMapHEAD.get(file);
        const indexHash = fileMapIndex.get(file);
        const workHash = fileMapWorkingDir.get(file);

        if (!indexHash && workHash) {
            untracked.push(file);
        } else {
            if (indexHash !== workHash) {
                if (!workHash) {notStaged.set(file, "deleted")}
                else if (!headHash) {notStaged.set(file, "new file")}
                else {notStaged.set(file, "modified")}
            }
            if (indexHash !== headHash) {
                if (!indexHash) {toBeCommited.set(file, "deleted")}
                else if (!headHash) {toBeCommited.set(file, "new file")}
                else {toBeCommited.set(file, "modified")}
            }
        }
    }

    if (toBeCommited.size === 0 && notStaged.size === 0 && untracked.length === 0) {
        return "nothing to commit, working tree clean"
    }
    let statusStr = ""
    if (toBeCommited.size !== 0) {
        statusStr += "Changes to be committed:\n"
        for (const file of toBeCommited) {
            statusStr += `\t${file[1]}:\t${file[0]}\n`
        }
        statusStr += "\n"
    }
    if (notStaged.size !== 0) {
        statusStr += "Changes not staged for commit:\n"
        for (const file of notStaged) {
            statusStr += `\t${file[1]}:\t${file[0]}\n`
        }
        statusStr += "\n"
    }
    if (untracked.length !== 0) {
        statusStr += "Untracked files:\n"
        for (const file of untracked) {
            statusStr += `\t${file}`
        }
        statusStr += "\n"
    }
    return statusStr;
};

const statusStr = getGitStatus()
console.log(statusStr)
