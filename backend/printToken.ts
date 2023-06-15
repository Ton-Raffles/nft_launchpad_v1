import jwt from 'jsonwebtoken';
import { config } from 'dotenv';

config();

const adminPayload = { role: 'admin' };
const secretKey = process.env.JWT_ADMIN!;

const token = jwt.sign(adminPayload, secretKey, { expiresIn: '3650d' });

console.log(token);
