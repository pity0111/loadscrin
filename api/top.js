import mysql from "mysql2/promise";

export default async function handler(req, res) {
    const db = await mysql.createConnection({
        host: "92.53.90.39",
        user: "gameserver33368",
        password: "2pL00hVr",
        database: "gameserver33368"
    });

    const [rows] = await db.execute(`
        SELECT CAST(uid AS CHAR) as uid, wallet, rpname
        FROM darkrp_player
        ORDER BY wallet DESC
        LIMIT 10
    `);

    res.status(200).json(rows);
}
