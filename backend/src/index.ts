import dotenv from 'dotenv';
dotenv.config();

import app from './app';
import { connectDatabase } from './config/database';

const PORT = process.env.PORT || 3001;

// 连接 MongoDB 并启动服务器
async function startServer() {
  try {
    // 连接 MongoDB
    await connectDatabase();
    
    // 启动服务器
    app.listen(PORT, () => {
      console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║     Code Coverage Platform Backend                         ║
║                                                            ║
║     Server running on http://localhost:${PORT}              ║
║     Database: MongoDB                                      ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
      `);
      console.log('API Documentation: http://localhost:' + PORT + '/api');
      console.log('Health Check: http://localhost:' + PORT + '/health');
    });
  } catch (error) {
    console.error('Failed to start server:', error);
    process.exit(1);
  }
}

startServer();
