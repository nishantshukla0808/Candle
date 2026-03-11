import { MongoClient } from 'mongodb';

if (!process.env.MONGO_URL) {
  throw new Error('MONGO_URL environment variable is not set');
}

const uri = process.env.MONGO_URL;
const dbName = process.env.DB_NAME || 'candle';

let client;
let clientPromise;

if (process.env.NODE_ENV === 'development') {
  if (!global._mongoClientPromise) {
    client = new MongoClient(uri);
    global._mongoClientPromise = client.connect();
  }
  clientPromise = global._mongoClientPromise;
} else {
  client = new MongoClient(uri);
  clientPromise = client.connect();
}

export async function getDb() {
  const client = await clientPromise;
  return client.db(dbName);
}

export default clientPromise;
