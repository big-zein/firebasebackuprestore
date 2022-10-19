import fs from 'fs'
import admin from './common.js'
import {fileURLToPath} from 'url'
import path from 'path'
import {v4} from 'uuid'
import extract from "extract-zip";

/*
 * Initialize Firestore and Storage
 */
const db = admin.firestore()
const storage = admin.storage()

const credentials = JSON.parse(fs.readFileSync('./credentials.json', 'utf8'))
const bucketName = credentials.storage_bucket_name
const bucket = storage.bucket(`gs://${bucketName}`)

const __filename = fileURLToPath(import.meta.url)
const __dirname = path.dirname(__filename)
const backupFolder = 'backups'
const filesFolder = '__files'
const dataFilename = '__data.json'
if (!fs.existsSync(backupFolder)) {
    fs.mkdirSync(backupFolder)
}

/*
 * Restore
 */

const zipName = process.argv[2]
await extract(zipName, {dir: `${__dirname}/${backupFolder}`})
await writeCollections(backupFolder)

/*
 * Functions
 */
async function writeCollections(folder, path = '') {
    const collections = fs.readdirSync(folder)
    for (const collection of collections) {
        if (collection === filesFolder || collection === dataFilename) {
            continue;
        }

        const collectionFolder = `${folder}/${collection}`
        const collectionPath = `${path}${collection}`
        const documents = fs.readdirSync(collectionFolder)
        for (const document of documents) {
            if (path == '') {
                console.log(`Restoring: ${collection}/${document}`)
            }

            const documentFolder = `${collectionFolder}/${document}`
            const data = JSON.parse(fs.readFileSync(`${documentFolder}/${dataFilename}`, 'utf8'))

            const fields = Object.keys(data)
            for (const field of fields) {
                const datum = data[field]
                if (typeof datum === 'string' && datum.startsWith('firebasestorage---')) {
                    const filename = datum
                    const filepath = `${documentFolder}/${filesFolder}/${filename}`
                    const url = await uploadObjectRetry(filepath)
                    if (url) {
                        data[field] = url
                    }
                }
            }

            await db.collection(collectionPath).doc(document).set(data)
            await writeCollections(documentFolder, `${collectionPath}/${document}/`)
        }
    }
}

function uploadObjectRetry(filepath, options = {}) {
    return new Promise(async (resolve, reject) => {
        const maxRetries = options.maxRetries ?? 3
        let attempt

        for (attempt = 0; attempt < maxRetries; attempt++) {
            try {
                const res = await uploadObject(filepath)
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

function uploadObject(filepath) {
    return new Promise(async (resolve, reject) => {
        const rawFilename = path.basename(filepath).replace('firebasestorage---', '')
        const rawPath = decodeURIComponent(rawFilename)
        const filename = path.basename(rawPath)
        const destination = rawPath.replace(filename, '').replace(/\/$/g, '')
        const token = v4()

        try {
            const res = await bucket.upload(filepath, {
                public: true,
                destination: `${destination}/${filename}`,
                metadata: {
                    metadata: {
                        firebaseStorageDownloadTokens: token,
                    },
                },
            })
            const url = `https://firebasestorage.googleapis.com/v0/b/${bucketName}/o/${rawFilename}?alt=media&token=${token}`
            return resolve(url)
        } catch (e) {
            reject('Upload failed')
        }
    })
}