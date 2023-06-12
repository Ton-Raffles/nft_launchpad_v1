import express, { Request, Response, NextFunction } from 'express';
import axios from 'axios';
import jwt, { JwtPayload } from 'jsonwebtoken';
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

app.get('/createLaunchpad', authorizeAdmin, async (req, res) => {});

app.get('/removeLaunchpad', authorizeAdmin, async (req, res) => {});

app.get('/editLaunchpad', authorizeAdmin, async (req, res) => {});

app.get('/checkUser', async (req, res) => {});

app.listen(process.env.PORT!, () => {
    console.log(`API is listening on port ${process.env.PORT!}`);
});
