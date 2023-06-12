import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import jwt, { JwtPayload } from 'jsonwebtoken';
import { Pool } from 'pg';
import { config } from 'dotenv';
import { keyPairFromSecretKey, sign } from 'ton-crypto';
import { Address, Cell, WalletContractV3R2, beginCell, internal } from 'ton';
import { Launchpad, LaunchpadConfig, launchpadConfigToCell } from '../wrappers/Launchpad';
import * as fs from 'fs';

config();

const app = express();
const keyPair = keyPairFromSecretKey(Buffer.from(process.env.ADMIN_SECRET_KEY!, 'hex'));
const adminAddress = Address.parse(process.env.ADMIN_ADDRESS!);
const endpoint = process.env.TONAPI_ENDPOINT;
const tonApiKey = process.env.TONAPI_KEY!;
const jwtSecretKey = process.env.JWT_ADMIN!;
const launchpadCode = Cell.fromBoc(
    Buffer.from(JSON.parse(fs.readFileSync('./build/Launchpad.compiled.json').toString('utf-8')).hex, 'hex')
)[0];
const adminWallet = WalletContractV3R2.create({ workchain: 0, publicKey: keyPair.publicKey });

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
        whitelisted_users text[],
        status TEXT DEFAULT 'active'
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

// This function checks whether user has positive balance of specific Jetton
async function sendRawMessage(message: Cell): Promise<[number, any[]]> {
    const result = await axios.post(endpoint + '/v2/blockchain/message', {
        headers: {
            Authorization: 'Bearer ' + tonApiKey,
        },
        data: {
            boc: message.toBoc(),
        },
    });
    return [result.status, result.data];
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
    const { nft_collection, jetton, whitelisted_users, startTime, endTime, price, available, buyerLimit, lastIndex } =
        req.body;
    try {
        // 1. Insert the new launchpad into the database
        const result = await pool.query(
            'INSERT INTO launchpads (nft_collection, jetton, whitelisted_users) VALUES ($1, $2, $3) RETURNING *',
            [nft_collection, jetton, whitelisted_users]
        );
        const launchpadData = result.rows[0];

        // 2. Assemble the configuration for the contract
        const config: LaunchpadConfig = {
            adminPubkey: keyPair.publicKey,
            available: BigInt(available),
            price: BigInt(price),
            lastIndex: BigInt(lastIndex),
            collection: Address.parse(nft_collection),
            buyerLimit: BigInt(buyerLimit),
            startTime: BigInt(startTime),
            endTime: BigInt(endTime),
            adminAddress: adminAddress,
        };

        // 3. Create the contract
        // Note: You need to provide the contract's code Cell (e.g. fetched from some other source)
        const contract = Launchpad.createFromConfig(config, launchpadCode);

        const transferCell = adminWallet.createTransfer({
            seqno: 0,
            secretKey: keyPair.secretKey,
            messages: [
                internal({
                    value: '0.1',
                    to: contract.address,
                    init: {
                        code: launchpadCode,
                        data: launchpadConfigToCell(config),
                    },
                }),
            ],
        });

        // 4. Deploy the contract to the blockchain
        // Note: You need to provide the ContractProvider and Sender, as well as the initial balance (in nanograms)
        const [status, error] = await sendRawMessage(transferCell);
        if (status != 200) {
            res.status(status).json({ error });
        }

        // Return the new launchpad data, along with the contract address
        res.json({ ...launchpadData, contractAddress: contract.address.toString() });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/removeLaunchpad/:id', authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    try {
        await pool.query('UPDATE launchpads SET status = $1 WHERE id = $2', ['inactive', id]);
        res.json({ message: 'Marked launchpad as inactive' });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.put('/editLaunchpad/:id', authorizeAdmin, async (req, res) => {
    const { id } = req.params;
    const { nft_collection, jetton, whitelisted_users } = req.body;
    try {
        const result = await pool.query(
            'UPDATE launchpads SET nft_collection = $1, jetton = $2, whitelisted_users = $3 WHERE id = $4 RETURNING *',
            [nft_collection, jetton, whitelisted_users, id]
        );
        res.json(result.rows[0]);
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.get('/checkUser/:launchpadId', async (req, res) => {
    const { launchpadId } = req.params;
    const { address, query_id } = req.query;

    try {
        const result = await pool.query('SELECT * FROM launchpads WHERE id = $1 AND status = $2', [
            launchpadId,
            'active',
        ]);
        const launchpad = result.rows[0];

        if (!launchpad) {
            return res.status(404).send('Launchpad not found');
        }

        const userAddress = Address.parse(address as string);
        const queryId = BigInt(query_id as string);

        const bodyCell = beginCell().storeUint(queryId, 64).storeAddress(userAddress).endCell();
        const signature = sign(bodyCell.hash(), keyPair.secretKey);

        // Check if user is whitelisted
        if (launchpad.whitelisted_users.includes(address)) {
            return res.json({ access: true, signature: signature.toString('hex') });
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

        return res.json({ access: true, signature: signature.toString('hex') });
    } catch (err: any) {
        res.status(500).json({ error: err.message });
    }
});

app.listen(process.env.PORT!, () => {
    console.log(`API is listening on port ${process.env.PORT!}`);
});
