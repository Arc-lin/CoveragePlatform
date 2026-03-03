import app from './app';

const PORT = process.env.PORT || 3001;

app.listen(PORT, () => {
  console.log(`
╔════════════════════════════════════════════════════════════╗
║                                                            ║
║     Code Coverage Platform Backend                         ║
║                                                            ║
║     Server running on http://localhost:${PORT}              ║
║                                                            ║
╚════════════════════════════════════════════════════════════╝
  `);
  console.log('API Documentation: http://localhost:' + PORT + '/api');
  console.log('Health Check: http://localhost:' + PORT + '/health');
});
