import mongoose from 'mongoose';

const DEFAULT_MONGODB_URI = 'mongodb://localhost:27017/coverage';

export async function connectDatabase(): Promise<void> {
  const uri = process.env.MONGODB_URI || DEFAULT_MONGODB_URI;
  await mongoose.connect(uri);
  console.log(`MongoDB connected successfully (${uri})`);
}

export async function disconnectDatabase(): Promise<void> {
  await mongoose.disconnect();
}
