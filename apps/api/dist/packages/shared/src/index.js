"use strict";
Object.defineProperty(exports, "__esModule", { value: true });
exports.RedeemSchema = exports.EarnSchema = exports.TokenBindNfcSchema = exports.TokenRevokeSchema = exports.TokenResolveSchema = exports.PublicClaimVerifySchema = exports.PublicClaimStartSchema = exports.PublicSessionInitSchema = void 0;
const zod_1 = require("zod");
exports.PublicSessionInitSchema = zod_1.z.object({
    merchant_slug: zod_1.z.string().min(1),
    device_id: zod_1.z.string().uuid(),
});
exports.PublicClaimStartSchema = zod_1.z.object({
    public_token: zod_1.z.string().min(16),
    phone: zod_1.z.string().min(4).optional(),
    email: zod_1.z.string().email().optional(),
}).refine((value) => value.phone || value.email, {
    message: "phone or email is required",
});
exports.PublicClaimVerifySchema = zod_1.z.object({
    challenge: zod_1.z.string().min(8),
    code: zod_1.z.string().min(4),
});
exports.TokenResolveSchema = zod_1.z.object({
    public_token: zod_1.z.string().min(16),
});
exports.TokenRevokeSchema = zod_1.z.object({
    token_id: zod_1.z.string().uuid().optional(),
    public_token: zod_1.z.string().min(16).optional(),
}).refine((value) => value.token_id || value.public_token, {
    message: "token_id or public_token is required",
});
exports.TokenBindNfcSchema = zod_1.z.object({
    nfc_uid: zod_1.z.string().min(4),
    public_token: zod_1.z.string().min(16),
});
exports.EarnSchema = zod_1.z.object({
    public_token: zod_1.z.string().min(16),
    amount: zod_1.z.number().positive(),
    idempotency_key: zod_1.z.string().min(8),
});
exports.RedeemSchema = zod_1.z.object({
    public_token: zod_1.z.string().min(16),
    reward_id: zod_1.z.string().uuid(),
    idempotency_key: zod_1.z.string().min(8),
});
