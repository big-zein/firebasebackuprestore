import fs from 'fs'
import https from 'https'
import archiver from 'archiver'
import moment from 'moment'
import rimraf from 'rimraf'
import admin from './common.js'

/*
 * Initialize Firestore
 */
const db = admin.firestore()

const backupFolder = 'backups'
const filesFolder = '__files'
const dataFilename = '__data.json'

if (!fs.existsSync(backupFolder)) {
    fs.mkdirSync(backupFolder)
}

/*
 * Backup
 */

await readCollections(await db.listCollections(), backupFolder)

// Zipping
const zipName = `${backupFolder}_${moment().format('YYYYMMDD_HHmmss')}.zip`
const output = fs.createWriteStream(zipName)
const zip = archiver('zip', {})
zip.pipe(output)
zip.directory(backupFolder, false)
await zip.finalize()

// Delete Temp Folder
if (fs.existsSync(zipName)) {
    await rimraf(backupFolder, {}, () => {
    })
}

/*
 * Functions
 */
async function readCollections(collections, folder) {
    for (const collection of collections) {
        const collectionFolder = `${folder}/${collection.id}`
        if (!fs.existsSync(collectionFolder)) {
            fs.mkdirSync(collectionFolder)
        }

        const snapshots = await collection.get()
        for (const doc of snapshots.docs) {
            if (folder == backupFolder) {
                console.log(`Backing Up: ${collection.id}/${doc.id}`)
            }

            const docFolder = `${collectionFolder}/${doc.id}`
            if (!fs.existsSync(docFolder)) {
                fs.mkdirSync(docFolder)
                fs.mkdirSync(`${docFolder}/${filesFolder}`)
            }
            const result = await readDocument(doc, docFolder)
            fs.writeFileSync(`${docFolder}/${dataFilename}`, JSON.stringify(result))

            await readCollections(await db.doc(doc.ref.path).listCollections(), docFolder)
        }
    }
}

async function readDocument(document, folder) {
    const data = document.data()
    const fields = Object.keys(data)

    for (const field of fields) {
        const datum = data[field]
        if (typeof datum === 'string' && datum.startsWith('https://firebasestorage')) {
            const filename = `firebasestorage---${new URL(datum).pathname.split('/').pop()}`
            const filepath = `${folder}/${filesFolder}/${filename}`
            const res = await downloadObjectRetry(datum, filepath)
            if (res === 0) {
                data[field] = filename
            }
        }
    }

    return data
}

function downloadObjectRetry(url, filepath, options = {}) {
    return new Promise(async (resolve, reject) => {
        const maxRetries = options.maxRetries ?? 3
        let attempt

        for (attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const res = await downloadObject(url, filepath)
                return resolve(res)
            } catch (e) {
                console.error(e)
            }
        }

        if (attempt >= maxRetries) {
            reject('Download Object, max retries reached')
        }
    })
}

function downloadObject(url, filepath) {
    return new Promise((resolve, reject) => {
        https.get(url, res => {
            const writeStream = fs.createWriteStream(filepath)
            res.pipe(writeStream)
            writeStream.on("finish", () => {
                writeStream.close()
                resolve(0)
            })
            writeStream.on("error", () => {
                writeStream.close()
                reject(`Download File '${url}' Error`)
            })
        })
    })
}