const sql = require('mssql');
require('dotenv').config();

const config = {
    server: process.env.DB_SERVER,   // localhost
    database: process.env.DB_NAME,
    user: process.env.DB_USER,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT), // 1433
    options: {
        trustServerCertificate: true,
        encrypt: false
    },
    connectionTimeout: 30000,
    requestTimeout: 30000
};

const poolPromise = new sql.ConnectionPool(config)
    .connect()
    .then(pool => {
        console.log('✅ SQL Server Connected — SCTMS Database Ready!');
        return pool;
    })
    .catch(err => {
        console.error('❌ Database Connection Failed:', err.message);
        process.exit(1);
    });

module.exports = { sql, poolPromise };