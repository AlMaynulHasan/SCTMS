const express = require('express');
const router = express.Router();
const { sql, poolPromise } = require('../config/db');
const { protect, adminOnly } = require('../middleware/auth');

let _vehicleCols = null;

async function getVehicleCols(pool) {
    if (_vehicleCols) return _vehicleCols;
    const result = await pool.request()
        .input('TableName', sql.NVarChar, 'Vehicles')
        .query(`
            SELECT LOWER(COLUMN_NAME) AS name
            FROM INFORMATION_SCHEMA.COLUMNS
            WHERE TABLE_NAME = @TableName
        `);
    _vehicleCols = new Set(result.recordset.map(r => r.name));
    return _vehicleCols;
}

function statusToIsActive(status) {
    if (status === undefined || status === null || status === '') return 1;
    const s = String(status).toLowerCase();
    if (s === 'blocked' || s === 'inactive' || s === '0' || s === 'false') return 0;
    return 1;
}

router.get('/', protect, adminOnly, async (req, res) => {
    try {
        const pool = await poolPromise;
        const cols = await getVehicleCols(pool);
        const regCol = cols.has('registrationnumber')
            ? 'RegistrationNumber'
            : (cols.has('regnumber') ? 'RegNumber AS RegistrationNumber' : null);
        const classCol = cols.has('class')
            ? '[Class] AS Class'
            : (cols.has('vehicleclass') ? 'VehicleClass AS Class' : null);

        const selectParts = [
            'VehicleID',
            'VehicleName',
            'Type',
            'Type AS VehicleType',
            'TotalSeats',
            'Amenities',
            'IsActive',
            "CASE WHEN IsActive = 1 THEN 'active' ELSE 'inactive' END AS Status"
        ];
        if (regCol) selectParts.push(regCol);
        if (classCol) selectParts.push(classCol);

        const result = await pool.request()
            .query(`SELECT ${selectParts.join(', ')} FROM Vehicles ORDER BY VehicleID DESC`);
        res.json(result.recordset);
    } catch (err) {
        res.status(500).json({ message: 'Server error.' });
    }
});

router.post('/', protect, adminOnly, async (req, res) => {
    const {
        VehicleName,
        VehicleType,
        Type,
        TotalSeats,
        Amenities,
        RegistrationNumber,
        Class,
        Status
    } = req.body;

    const vType = VehicleType || Type;
    if (!VehicleName || !vType || !TotalSeats) {
        return res.status(400).json({ message: 'VehicleName, VehicleType, TotalSeats required.' });
    }

    try {
        const pool = await poolPromise;
        const cols = await getVehicleCols(pool);
        const regCol = cols.has('registrationnumber')
            ? 'RegistrationNumber'
            : (cols.has('regnumber') ? 'RegNumber' : null);
        const classCol = cols.has('class')
            ? '[Class]'
            : (cols.has('vehicleclass') ? 'VehicleClass' : null);

        const insertCols = ['VehicleName', 'Type', 'TotalSeats', 'Amenities', 'IsActive'];
        const insertVals = ['@VehicleName', '@Type', '@TotalSeats', '@Amenities', '@IsActive'];

        if (regCol) { insertCols.push(regCol); insertVals.push('@RegistrationNumber'); }
        if (classCol) { insertCols.push(classCol); insertVals.push('@Class'); }

        await pool.request()
            .input('VehicleName', sql.NVarChar, VehicleName)
            .input('Type', sql.NVarChar, vType)
            .input('TotalSeats', sql.Int, TotalSeats)
            .input('Amenities', sql.NVarChar, Amenities || null)
            .input('IsActive', sql.Bit, statusToIsActive(Status))
            .input('RegistrationNumber', sql.NVarChar, RegistrationNumber || null)
            .input('Class', sql.NVarChar, Class || null)
            .query(`INSERT INTO Vehicles (${insertCols.join(', ')}) VALUES (${insertVals.join(', ')})`);

        res.status(201).json({ message: 'Vehicle created.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error.' });
    }
});

router.put('/:id', protect, adminOnly, async (req, res) => {
    const {
        VehicleName,
        VehicleType,
        Type,
        TotalSeats,
        Amenities,
        RegistrationNumber,
        Class,
        Status
    } = req.body;

    const vType = VehicleType || Type;
    if (!VehicleName || !vType || !TotalSeats) {
        return res.status(400).json({ message: 'VehicleName, VehicleType, TotalSeats required.' });
    }

    try {
        const pool = await poolPromise;
        const cols = await getVehicleCols(pool);
        const regCol = cols.has('registrationnumber')
            ? 'RegistrationNumber'
            : (cols.has('regnumber') ? 'RegNumber' : null);
        const classCol = cols.has('class')
            ? '[Class]'
            : (cols.has('vehicleclass') ? 'VehicleClass' : null);

        const setParts = [
            'VehicleName=@VehicleName',
            'Type=@Type',
            'TotalSeats=@TotalSeats',
            'Amenities=@Amenities',
            'IsActive=@IsActive'
        ];
        if (regCol) setParts.push(`${regCol}=@RegistrationNumber`);
        if (classCol) setParts.push(`${classCol}=@Class`);

        const result = await pool.request()
            .input('VehicleID', sql.Int, req.params.id)
            .input('VehicleName', sql.NVarChar, VehicleName)
            .input('Type', sql.NVarChar, vType)
            .input('TotalSeats', sql.Int, TotalSeats)
            .input('Amenities', sql.NVarChar, Amenities || null)
            .input('IsActive', sql.Bit, statusToIsActive(Status))
            .input('RegistrationNumber', sql.NVarChar, RegistrationNumber || null)
            .input('Class', sql.NVarChar, Class || null)
            .query(`UPDATE Vehicles SET ${setParts.join(', ')} WHERE VehicleID=@VehicleID`);

        if (!result.rowsAffected[0]) return res.status(404).json({ message: 'Vehicle not found.' });
        res.json({ message: 'Vehicle updated.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error.' });
    }
});

router.delete('/:id', protect, adminOnly, async (req, res) => {
    try {
        const pool = await poolPromise;
        const result = await pool.request()
            .input('VehicleID', sql.Int, req.params.id)
            .query(`UPDATE Vehicles SET IsActive=0 WHERE VehicleID=@VehicleID`);
        if (!result.rowsAffected[0]) return res.status(404).json({ message: 'Vehicle not found.' });
        res.json({ message: 'Vehicle deactivated.' });
    } catch (err) {
        res.status(500).json({ message: 'Server error.' });
    }
});

module.exports = router;
