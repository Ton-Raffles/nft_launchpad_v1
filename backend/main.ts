import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { keyPairFromSecretKey } from 'ton-crypto';
import { Address } from 'ton';

config();

const app = express();
const keyPair = keyPairFromSecretKey(Buffer.from(process.env.ADMIN_SECRET_KEY!, 'hex'));
const adminAddress = Address.parse(process.env.ADMIN_ADDRESS!);
const endpoint = process.env.TONAPI_ENDPOINT;
const tonApiKey = process.env.TONAPI_KEY!;
const jwtSecretKey = process.env.JWT_ADMIN!;

const pool = new Pool({
    user: process.env.PGUSER,
    host: process.env.PGHOST,
    database: process.env.PGDATABASE,
    password: process.env.PGPASSWORD,
    port: parseInt(process.env.PGPORT!),
});

pool.query(`
    CREATE TABLE IF NOT EXISTS launchpads (
        id SERIAL PRIMARY KEY,
        nft_collection TEXT,
        jetton TEXT,
        whitelisted_users text[]
    )
`);

interface JwtPayloadWithRole extends JwtPayload {
    role?: string;
}

// This function checks whether user holds any NFTs from specific collection
async function checkIfAddressHoldsNFT(address: Address, collection: Address): Promise<boolean> {
    const result = await axios.get(
        endpoint +
            '/v2/accounts/' +
            address.toRawString() +
            '/nfts?collection=' +
            collection.toRawString() +
            '&limit=1&indirect_ownership=false',
        {
            headers: {
                Authorization: 'Bearer ' + tonApiKey,
            },
        }
    );
    const items = result.data.nft_items!;
    return items.length > 0;
}

// This function checks whether user has positive balance of specific Jetton
async function checkIfAddressHoldsJetton(address: Address, jetton: Address): Promise<boolean> {
    const result = await axios.get(endpoint + '/v2/accounts/' + address.toRawString() + '/jettons', {
        headers: {
            Authorization: 'Bearer ' + tonApiKey,
        },
    });
    const balances = result.data.balances!.filter((j: any) => j.jetton.address == jetton.toRawString());
    if (balances.length == 0) {
        return false;
    }
    return balances.balance! != '0';
}

function authorizeAdmin(req: Request, res: Response, next: NextFunction) {
    const authHeader = req.headers.authorization;

    if (!authHeader) {
        return res.status(403).send('No token provided');
    }

    const token = authHeader.split(' ')[1];

    jwt.verify(token, jwtSecretKey, (err, decoded) => {
        if (err) {
            return res.status(401).send('Unauthorized access');
        }

        const decodedPayload = decoded as JwtPayloadWithRole;
        if (!decodedPayload || decodedPayload.role !== 'admin') {
            return res.status(403).send('Forbidden');
        }

        next();
    });
}

app.post('/createLaunchpad', authorizeAdmin, async (req, res) => {
    const { nft_collections, jettons, whitelisted_users } = req.body;
    try {
        const result = await pool.query(
            'INSERT INTO launchpads (nft_collections, jettons, whitelisted_users) VALUES ($1, $2, $3) RETURNING *',
            [nft_collections, jettons, whitelisted_users]
        );
        res.json(result.rows[0]);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.delete('/removeLaunchpad/:id', authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('DELETE FROM launchpads WHERE id = $1', [id]);
        res.json({ message: 'Deleted launchpad' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/editLaunchpad/:id', authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { nft_collections, jettons, whitelisted_users } = req.body;
    try {
        const result = await pool.query(
            'UPDATE launchpads SET nft_collections = $1, jettons = $2, whitelisted_users = $3 WHERE id = $4 RETURNING *',
            [nft_collections, jettons, whitelisted_users, id]
        );
        res.json(result.rows[0]);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/checkUser/:launchpadId', async (req, res) => {
    const { launchpadId } = req.params;
    const { address } = req.query;

    try {
        const result = await pool.query('SELECT * FROM launchpads WHERE id = $1', [launchpadId]);
        const launchpad = result.rows[0];

        if (!launchpad) {
            return res.status(404).send('Launchpad not found');
        }

        const userAddress = Address.parse(address as string);

        // Check if user is whitelisted
        if (launchpad.whitelisted_users.includes(address)) {
            return res.json({ access: true });
        }

        // Check if user holds necessary NFT
        if (launchpad.nft_collection) {
            const nftAddress = Address.parse(launchpad.nft_collection);
            const hasNFT = await checkIfAddressHoldsNFT(userAddress, nftAddress);
            if (!hasNFT) {
                return res.json({ access: false, reason: 'User does not hold the necessary NFT.' });
            }
        }

        // Check if user holds necessary Jetton
        if (launchpad.jetton) {
            const jettonAddress = Address.parse(launchpad.jetton);
            const hasJetton = await checkIfAddressHoldsJetton(userAddress, jettonAddress);
            if (!hasJetton) {
                return res.json({ access: false, reason: 'User does not hold the necessary Jetton.' });
            }
        }

        return res.json({ access: true });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(process.env.PORT!, () => {
    console.log(`API is listening on port ${process.env.PORT!}`);
});
