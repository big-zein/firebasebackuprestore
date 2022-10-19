// Import the functions you need from the SDKs you need
import admin from "firebase-admin"
import fs from 'fs'

/*
 * Firebase
 */
const credentials = JSON.parse(fs.readFileSync('./credentials.json', 'utf8'))
admin.initializeApp({credential: admin.credential.cert(credentials)})
const db = admin.firestore()
const storage = admin.storage()

export default admin