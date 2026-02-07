import { z } from "zod";
export declare const PublicSessionInitSchema: z.ZodObject<{
    merchant_slug: z.ZodString;
    device_id: z.ZodString;
}, "strip", z.ZodTypeAny, {
    merchant_slug: string;
    device_id: string;
}, {
    merchant_slug: string;
    device_id: string;
}>;
export declare const PublicClaimStartSchema: z.ZodEffects<z.ZodObject<{
    public_token: z.ZodString;
    phone: z.ZodOptional<z.ZodString>;
    email: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    public_token: string;
    phone?: string | undefined;
    email?: string | undefined;
}, {
    public_token: string;
    phone?: string | undefined;
    email?: string | undefined;
}>, {
    public_token: string;
    phone?: string | undefined;
    email?: string | undefined;
}, {
    public_token: string;
    phone?: string | undefined;
    email?: string | undefined;
}>;
export declare const PublicClaimVerifySchema: z.ZodObject<{
    challenge: z.ZodString;
    code: z.ZodString;
}, "strip", z.ZodTypeAny, {
    code: string;
    challenge: string;
}, {
    code: string;
    challenge: string;
}>;
export declare const TokenResolveSchema: z.ZodObject<{
    public_token: z.ZodString;
}, "strip", z.ZodTypeAny, {
    public_token: string;
}, {
    public_token: string;
}>;
export declare const TokenRevokeSchema: z.ZodEffects<z.ZodObject<{
    token_id: z.ZodOptional<z.ZodString>;
    public_token: z.ZodOptional<z.ZodString>;
}, "strip", z.ZodTypeAny, {
    public_token?: string | undefined;
    token_id?: string | undefined;
}, {
    public_token?: string | undefined;
    token_id?: string | undefined;
}>, {
    public_token?: string | undefined;
    token_id?: string | undefined;
}, {
    public_token?: string | undefined;
    token_id?: string | undefined;
}>;
export declare const TokenBindNfcSchema: z.ZodObject<{
    nfc_uid: z.ZodString;
    public_token: z.ZodString;
}, "strip", z.ZodTypeAny, {
    public_token: string;
    nfc_uid: string;
}, {
    public_token: string;
    nfc_uid: string;
}>;
export declare const EarnSchema: z.ZodObject<{
    public_token: z.ZodString;
    amount: z.ZodNumber;
    idempotency_key: z.ZodString;
}, "strip", z.ZodTypeAny, {
    public_token: string;
    amount: number;
    idempotency_key: string;
}, {
    public_token: string;
    amount: number;
    idempotency_key: string;
}>;
export declare const RedeemSchema: z.ZodObject<{
    public_token: z.ZodString;
    reward_id: z.ZodString;
    idempotency_key: z.ZodString;
}, "strip", z.ZodTypeAny, {
    public_token: string;
    idempotency_key: string;
    reward_id: string;
}, {
    public_token: string;
    idempotency_key: string;
    reward_id: string;
}>;
export type PublicSessionInitInput = z.infer<typeof PublicSessionInitSchema>;
