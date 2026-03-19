const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../config/db');
const { protect, adminOnly } = require('../middleware/auth');

let _routeCols = null;

async function getRouteCols(pool) {
    if (_routeCols) return _routeCols;
    const result = await pool.request()
        .input('TableName', sql.NVarChar, 'Routes')
        .query(`
            SELECT LOWER(COLUMN_NAME) AS name
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = @TableName
        `);
    _routeCols = new Set(result.recordset.map(r => r.name));
    return _routeCols;
}

function statusToIsActive(status) {
    if (status === undefined || status === null || status === '') return 1;
    const s = String(status).toLowerCase();
    if (s === 'inactive' || s === 'blocked' || s === '0' || s === 'false') return 0;
    return 1;
}

router.get('/', protect, adminOnly, async (req, res) => {
    try {
        const pool = await poolPromise;
        const cols = await getRouteCols(pool);
        const baseFareCol = cols.has('basefare')
            ? 'BaseFare'
            : (cols.has('fare') ? 'Fare AS BaseFare' : null);
        const durationCol = cols.has('estimatedduration')
            ? 'EstimatedDuration'
            : (cols.has('duration') ? 'Duration AS EstimatedDuration' : null);

        const selectParts = [
            'RouteID',
            'Origin',
            'Destination',
            'DistanceKM AS Distance',
            'DistanceKM',
            'IsActive',
            "CASE WHEN IsActive = 1 THEN 'active' ELSE 'inactive' END AS Status"
        ];
        if (baseFareCol) selectParts.push(baseFareCol);
        if (durationCol) selectParts.push(durationCol);

        const result = await pool.request()
            .query(`SELECT ${selectParts.join(', ')} FROM Routes ORDER BY RouteID DESC`);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ message: 'Server error.' });
    }
});

router.post('/', protect, adminOnly, async (req, res) => {
    const {
        Origin,
        Destination,
        Distance,
        DistanceKM,
        BaseFare,
        EstimatedDuration,
        Status
    } = req.body;

    if (!Origin || !Destination) {
        return res.status(400).json({ message: 'Origin and Destination required.' });
    }

    try {
        const pool = await poolPromise;
        const cols = await getRouteCols(pool);
        const baseFareCol = cols.has('basefare')
            ? 'BaseFare'
            : (cols.has('fare') ? 'Fare' : null);
        const durationCol = cols.has('estimatedduration')
            ? 'EstimatedDuration'
            : (cols.has('duration') ? 'Duration' : null);

        const insertCols = ['Origin', 'Destination', 'DistanceKM', 'IsActive'];
        const insertVals = ['@Origin', '@Destination', '@DistanceKM', '@IsActive'];
        if (baseFareCol) { insertCols.push(baseFareCol); insertVals.push('@BaseFare'); }
        if (durationCol) { insertCols.push(durationCol); insertVals.push('@EstimatedDuration'); }

        await pool.request()
            .input('Origin', sql.NVarChar, Origin)
            .input('Destination', sql.NVarChar, Destination)
            .input('DistanceKM', sql.Decimal(8,2), DistanceKM ?? Distance ?? 0)
            .input('IsActive', sql.Bit, statusToIsActive(Status))
            .input('BaseFare', sql.Decimal(10,2), BaseFare ?? null)
            .input('EstimatedDuration', sql.Decimal(8,2), EstimatedDuration ?? null)
            .query(`INSERT INTO Routes (${insertCols.join(', ')}) VALUES (${insertVals.join(', ')})`);

        res.status(201).json({ message: 'Route created.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error.' });
    }
});

router.put('/:id', protect, adminOnly, async (req, res) => {
    const {
        Origin,
        Destination,
        Distance,
        DistanceKM,
        BaseFare,
        EstimatedDuration,
        Status
    } = req.body;

    if (!Origin || !Destination) {
        return res.status(400).json({ message: 'Origin and Destination required.' });
    }

    try {
        const pool = await poolPromise;
        const cols = await getRouteCols(pool);
        const baseFareCol = cols.has('basefare')
            ? 'BaseFare'
            : (cols.has('fare') ? 'Fare' : null);
        const durationCol = cols.has('estimatedduration')
            ? 'EstimatedDuration'
            : (cols.has('duration') ? 'Duration' : null);

        const setParts = [
            'Origin=@Origin',
            'Destination=@Destination',
            'DistanceKM=@DistanceKM',
            'IsActive=@IsActive'
        ];
        if (baseFareCol) setParts.push(`${baseFareCol}=@BaseFare`);
        if (durationCol) setParts.push(`${durationCol}=@EstimatedDuration`);

        const result = await pool.request()
            .input('RouteID', sql.Int, req.params.id)
            .input('Origin', sql.NVarChar, Origin)
            .input('Destination', sql.NVarChar, Destination)
            .input('DistanceKM', sql.Decimal(8,2), DistanceKM ?? Distance ?? 0)
            .input('IsActive', sql.Bit, statusToIsActive(Status))
            .input('BaseFare', sql.Decimal(10,2), BaseFare ?? null)
            .input('EstimatedDuration', sql.Decimal(8,2), EstimatedDuration ?? null)
            .query(`UPDATE Routes SET ${setParts.join(', ')} WHERE RouteID=@RouteID`);

        if (!result.rowsAffected[0]) return res.status(404).json({ message: 'Route not found.' });
        res.json({ message: 'Route updated.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error.' });
    }
});

router.delete('/:id', protect, adminOnly, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('RouteID', sql.Int, req.params.id)
            .query(`UPDATE Routes SET IsActive=0 WHERE RouteID=@RouteID`);
        if (!result.rowsAffected[0]) return res.status(404).json({ message: 'Route not found.' });
        res.json({ message: 'Route deactivated.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error.' });
    }
});

module.exports = router;
